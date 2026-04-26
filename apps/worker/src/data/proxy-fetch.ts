import { connect } from "cloudflare:sockets";

// ════════════════════════════════════════════════════════════════════════
// proxyFetch — HTTPS requests through an HTTP CONNECT proxy, using
// Cloudflare Workers' `cloudflare:sockets` API.
//
// Flow (per RFC 7231 + RFC 8446):
//   1. TCP connect to proxy host:port
//   2. Send  CONNECT target:443 HTTP/1.1  with Proxy-Authorization
//   3. Read  HTTP/1.1 200 Connection established
//   4. startTls({ servername: target })   — upgrade tunnel to TLS
//   5. Send  HTTP request  →  read response  (parse Content-Length or
//      Transfer-Encoding: chunked, and ignore trailers)
// ════════════════════════════════════════════════════════════════════════

export interface ProxyConfig {
  host: string;
  port: number;
  auth: string; // base64 of "user:pass"
}

export function parseProxyUrl(urlStr: string): ProxyConfig {
  const u = new URL(urlStr);
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  return {
    host: u.hostname,
    port: Number(u.port) || 80,
    auth: btoa(`${user}:${pass}`),
  };
}

export interface ProxyFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Fetch an HTTPS URL through the given HTTP CONNECT proxy.
 * Returns a minimal response shape: { status, headers, body }.
 */
export async function proxyFetch(
  proxyUrl: string,
  targetUrl: string,
  opts: ProxyFetchOptions = {},
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const proxy = parseProxyUrl(proxyUrl);
  const target = new URL(targetUrl);
  if (target.protocol !== "https:") {
    throw new Error("proxyFetch requires https targets");
  }
  const targetHost = target.hostname;
  const targetPort = Number(target.port) || 443;

  const timeout = opts.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeout;

  // 1. TCP connect to proxy — starttls enables upgrade after CONNECT tunnel
  const socket = connect(
    { hostname: proxy.host, port: proxy.port },
    { secureTransport: "starttls", allowHalfOpen: false },
  );

  try {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // 2. Send CONNECT
    const connectReq =
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
      `Host: ${targetHost}:${targetPort}\r\n` +
      `Proxy-Authorization: Basic ${proxy.auth}\r\n` +
      `Proxy-Connection: keep-alive\r\n\r\n`;
    await writer.write(new TextEncoder().encode(connectReq));

    // 3. Read CONNECT response until \r\n\r\n
    let connectRespBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    while (!hasCrlfCrlf(connectRespBuf)) {
      if (Date.now() > deadline) throw new Error("proxy_connect_timeout");
      const { value, done } = await reader.read();
      if (done || !value) throw new Error("proxy_connect_eof");
      connectRespBuf = concat(connectRespBuf, new Uint8Array(value));
    }
    const connectResp = new TextDecoder().decode(connectRespBuf);
    const firstLine = connectResp.split("\r\n")[0] ?? "";
    if (!firstLine.includes(" 200 ")) {
      throw new Error(
        `proxy_connect_failed: ${connectResp.slice(0, 300)}`,
      );
    }
    // Expose CONNECT response for diagnostic route
    (globalThis as { __lastConnectResp?: string }).__lastConnectResp =
      connectResp.slice(0, 400);

    writer.releaseLock();
    reader.releaseLock();

    // 4. Upgrade to TLS
    // Small delay to ensure proxy has finished any post-200 housekeeping
    await new Promise((r) => setTimeout(r, 50));

    // cloudflare:sockets uses `expectedServerHostname` for SNI on startTls.
    const tls = socket.startTls({ expectedServerHostname: targetHost });

    // Log for diagnostics
    console.log(
      `proxyFetch: CONNECT ok to ${targetHost}, first line = "${firstLine}"`,
    );
    const tlsWriter = tls.writable.getWriter();
    const tlsReader = tls.readable.getReader();

    // 5. Build + send HTTP request
    const method = (opts.method ?? "GET").toUpperCase();
    const body = opts.body ?? "";
    const headers: Record<string, string> = {
      Host: targetHost,
      Connection: "close",
      "User-Agent": "skim-intelligence/1.0",
      Accept: "*/*",
      ...(opts.headers ?? {}),
    };
    if (body) {
      headers["Content-Length"] = String(new TextEncoder().encode(body).length);
    }
    let httpReq = `${method} ${target.pathname}${target.search} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) httpReq += `${k}: ${v}\r\n`;
    httpReq += "\r\n";
    if (body) httpReq += body;
    await tlsWriter.write(new TextEncoder().encode(httpReq));

    // Read full response (Connection: close makes this easy — read until EOF)
    let raw: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    while (true) {
      if (Date.now() > deadline) throw new Error("response_timeout");
      const { value, done } = await tlsReader.read();
      if (done) break;
      if (value) raw = concat(raw, new Uint8Array(value));
    }
    try {
      await tls.close();
    } catch { /* */ }

    return parseHttpResponse(raw);
  } catch (err) {
    // Rethrow with hostname context for diagnostics
    throw new Error(
      `proxyFetch[${targetHost}:${targetPort}]: ${String(err).slice(0, 200)}`,
    );
  } finally {
    try {
      await socket.close();
    } catch { /* */ }
  }
}

function concat(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function hasCrlfCrlf(buf: Uint8Array): boolean {
  // Look for \r\n\r\n (0x0D 0x0A 0x0D 0x0A)
  for (let i = 0; i <= buf.length - 4; i++) {
    if (
      buf[i] === 0x0d &&
      buf[i + 1] === 0x0a &&
      buf[i + 2] === 0x0d &&
      buf[i + 3] === 0x0a
    ) {
      return true;
    }
  }
  return false;
}

function parseHttpResponse(raw: Uint8Array): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  // Find headers/body separator
  let sep = -1;
  for (let i = 0; i <= raw.length - 4; i++) {
    if (
      raw[i] === 0x0d &&
      raw[i + 1] === 0x0a &&
      raw[i + 2] === 0x0d &&
      raw[i + 3] === 0x0a
    ) {
      sep = i;
      break;
    }
  }
  if (sep < 0) throw new Error("malformed_http_response");

  const headerText = new TextDecoder().decode(raw.slice(0, sep));
  const bodyBytes = raw.slice(sep + 4);

  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const match = statusLine?.match(/HTTP\/1\.\d (\d+)/);
  const status = match ? Number(match[1]) : 0;

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const ci = line.indexOf(":");
    if (ci > 0) {
      const key = line.slice(0, ci).trim().toLowerCase();
      const val = line.slice(ci + 1).trim();
      headers[key] = val;
    }
  }

  // Handle chunked transfer encoding
  let body: string;
  if ((headers["transfer-encoding"] ?? "").toLowerCase().includes("chunked")) {
    body = decodeChunked(bodyBytes);
  } else {
    body = new TextDecoder().decode(bodyBytes);
  }

  return { status, headers, body };
}

function decodeChunked(buf: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  const td = new TextDecoder();
  while (i < buf.length) {
    // Read chunk size line
    let j = i;
    while (j < buf.length - 1 && !(buf[j] === 0x0d && buf[j + 1] === 0x0a)) j++;
    const sizeLine = td.decode(buf.slice(i, j)).trim();
    const sz = parseInt(sizeLine.split(";")[0] ?? "0", 16);
    if (!Number.isFinite(sz) || sz === 0) break;
    i = j + 2;
    for (let k = 0; k < sz && i + k < buf.length; k++) {
      const byte = buf[i + k];
      if (byte !== undefined) out.push(byte);
    }
    i += sz + 2; // skip \r\n after chunk
  }
  return td.decode(new Uint8Array(out));
}
