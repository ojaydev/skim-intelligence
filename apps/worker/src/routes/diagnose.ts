import { Hono } from "hono";
import type { Env } from "../env";
import { createSignature, loadSeededBayseEvents } from "../data/bayse";

/**
 * Diagnostic probes — verify reachability of various Bayse hostnames from
 * the Worker runtime, isolating which (if any) are IP-blocked.
 */
export const diagnose = new Hono<{ Bindings: Env }>();

diagnose.get("/bayse", async (c) => {
  const results: Record<string, unknown> = {};

  // 1. REST relay (known 403 from CF)
  results.rest_health = await probe(
    "https://relay.bayse.markets/health",
    "GET",
  );

  // 2. REST relay with signed auth
  if (c.env.BAYSE_PUBLIC_API_KEY && c.env.BAYSE_API_SECRET) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await createSignature(
      c.env.BAYSE_API_SECRET,
      ts,
      "GET",
      "/v1/pm/events",
    );
    results.rest_events_signed = await probe(
      "https://relay.bayse.markets/v1/pm/events",
      "GET",
      {
        "X-Public-Key": c.env.BAYSE_PUBLIC_API_KEY,
        "X-Timestamp": String(ts),
        "X-Signature": sig,
      },
    );
  }

  // 3. WS subdomain — health/root probe over HTTP
  results.ws_https_root = await probe(
    "https://socket.bayse.markets/",
    "GET",
  );

  // 4. WS upgrade attempt
  try {
    const resp = await fetch("https://socket.bayse.markets/ws/v1/markets", {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(6_000),
    });
    const ws = resp.webSocket;
    if (ws) {
      ws.accept();
      // Try sending a subscribe and wait for one message
      let firstMsg: string | null = null;
      const msgPromise = new Promise<string>((resolve) => {
        ws.addEventListener("message", (ev) => {
          const data =
            typeof ev.data === "string"
              ? ev.data
              : new TextDecoder().decode(ev.data);
          resolve(data.slice(0, 200));
        });
        setTimeout(() => resolve("[timeout]"), 3000);
      });
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: "prices",
          eventId: "probe-nonexistent",
        }),
      );
      firstMsg = await msgPromise;
      ws.close();
      results.ws_upgrade = {
        status: resp.status,
        accepted: true,
        first_frame: firstMsg,
      };
    } else {
      const body = await resp.text();
      results.ws_upgrade = {
        status: resp.status,
        accepted: false,
        body: body.slice(0, 200),
      };
    }
  } catch (err) {
    results.ws_upgrade = { error: String(err).slice(0, 200) };
  }

  return c.json(results);
});

diagnose.get("/proxy", async (c) => {
  if (!c.env.PROXY_URL) return c.json({ error: "no_proxy_configured" }, 503);

  try {
    const { proxyFetch } = await import("../data/proxy-fetch");
    const res = await proxyFetch(c.env.PROXY_URL, "https://relay.bayse.markets/health", {
      timeoutMs: 15_000,
    });
    return c.json({
      status: res.status,
      headers: res.headers,
      body: res.body.slice(0, 400),
      connect_response:
        (globalThis as { __lastConnectResp?: string }).__lastConnectResp,
    });
  } catch (err) {
    return c.json({
      error: String(err).slice(0, 400),
      connect_response:
        (globalThis as { __lastConnectResp?: string }).__lastConnectResp,
    }, 500);
  }
});

/**
 * Stay connected for N seconds and collect all frames — used to diagnose
 * why the WS closes after the connected ack. Subscribes to a real event
 * using the KV-seeded list.
 */
diagnose.get("/bayse/ws-collect", async (c) => {
  const seconds = Math.min(Number(c.req.query("seconds") ?? "15"), 30);
  const channel = c.req.query("channel") ?? "prices"; // prices | orderbook | activity

  const events = await loadSeededBayseEvents(c.env);
  if (events.length === 0) {
    return c.json({ error: "no_seed" }, 503);
  }
  const top = events[0];
  if (!top) return c.json({ error: "no_seed" }, 503);
  const eventId = top.id;
  // Collect up to 10 market IDs across the seeded events
  const allMarketIds: string[] = [];
  for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (allMarketIds.length < 10) allMarketIds.push(m.id);
    }
  }

  let sub: Record<string, unknown>;
  if (channel === "orderbook") {
    sub = { type: "subscribe", channel: "orderbook", marketIds: allMarketIds };
  } else if (channel === "activity") {
    sub = { type: "subscribe", channel: "activity", eventId };
  } else if (channel === "asset_prices") {
    sub = { type: "subscribe", channel: "asset_prices", symbols: ["BTCUSDT"] };
  } else {
    sub = { type: "subscribe", channel: "prices", eventId };
  }

  try {
    const resp = await fetch("https://socket.bayse.markets/ws/v1/markets", {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(8_000),
    });
    const ws = resp.webSocket;
    if (!ws) {
      return c.json({ error: "no_webSocket", status: resp.status }, 502);
    }
    ws.accept();

    const frames: string[] = [];
    let closedCode: number | null = null;
    let closedReason = "";

    let connectedReceived = false;
    ws.addEventListener("message", (ev) => {
      const data =
        typeof ev.data === "string"
          ? ev.data
          : new TextDecoder().decode(ev.data);
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        frames.push(trimmed.slice(0, 400));
        // Subscribe only AFTER the connected frame is received
        if (!connectedReceived && trimmed.includes('"type":"connected"')) {
          connectedReceived = true;
          try {
            ws.send(JSON.stringify(sub));
          } catch { /* */ }
        }
      }
    });
    ws.addEventListener("close", (ev) => {
      closedCode = ev.code;
      closedReason = ev.reason;
    });

    // Also send a ping every 5s while collecting
    const pingId = setInterval(() => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch { /* closed */ }
    }, 5_000);

    await new Promise((r) => setTimeout(r, seconds * 1000));
    clearInterval(pingId);
    try { ws.close(); } catch { /* */ }

    return c.json({
      subscribed: sub,
      event: { id: eventId, title: top.title, markets: allMarketIds },
      frame_count: frames.length,
      frames: frames.slice(0, 20),
      closed: closedCode !== null,
      close_code: closedCode,
      close_reason: closedReason,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

async function probe(
  url: string,
  method: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(6_000),
    });
    const body = await res.text();
    return { status: res.status, body: body.slice(0, 300) };
  } catch (err) {
    return { status: 0, body: String(err).slice(0, 200) };
  }
}
