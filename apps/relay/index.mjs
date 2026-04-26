// ════════════════════════════════════════════════════════════════════════
// Bayse market-data relay
//
// Runs on any non-Cloudflare egress (residential VPS, home server). Holds
// the upstream Bayse WS, fetches the REST event seed, and pushes both into
// the Skim worker over HTTPS using a shared RELAY_SECRET.
//
// Why this exists:
//   1. Bayse WAF returns 403 to Cloudflare egress on signed REST endpoints
//   2. Bayse silently drops `subscribe` frames originating from CF IPs
// Both kill the worker's ability to ingest Bayse data directly. This relay
// is the production fix referenced in apps/worker/src/.env.example.
//
// Required env (see .env.example):
//   BAYSE_PUBLIC_API_KEY  Bayse HMAC public key
//   BAYSE_API_SECRET      Bayse HMAC private key
//   WORKER_URL            e.g. https://skim.<account>.workers.dev
//   RELAY_SECRET          shared with worker (X-Relay-Auth header)
// Optional:
//   MAX_MARKETS=10        cap on subscribed marketIds (Bayse docs limit)
//   SEED_REFRESH_MINUTES=30
//   HEALTH_PORT=3000      /healthz JSON status
//   FRAME_DEBOUNCE_MS=500 per-market debounce — avoids KV write storms
// ════════════════════════════════════════════════════════════════════════

import { createHmac, createHash } from "node:crypto";
import http from "node:http";
import WebSocket from "ws";

// ─── Config ─────────────────────────────────────────────────────────────

const cfg = {
  bayseKey: requireEnv("BAYSE_PUBLIC_API_KEY"),
  bayseSecret: requireEnv("BAYSE_API_SECRET"),
  workerUrl: requireEnv("WORKER_URL").replace(/\/+$/, ""),
  relaySecret: requireEnv("RELAY_SECRET"),
  maxMarkets: clamp(Number(process.env.MAX_MARKETS ?? 10), 1, 10),
  seedRefreshMin: Math.max(5, Number(process.env.SEED_REFRESH_MINUTES ?? 30)),
  healthPort: Number(process.env.HEALTH_PORT ?? 3000),
  debounceMs: Math.max(0, Number(process.env.FRAME_DEBOUNCE_MS ?? 500)),
};

function requireEnv(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`relay: missing required env ${k}`);
    process.exit(1);
  }
  return v;
}
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

const REST_BASE = "https://relay.bayse.markets";
const WS_URL = "wss://socket.bayse.markets/ws/v1/markets";

// ─── State (surfaced via /healthz) ──────────────────────────────────────

const state = {
  startedAt: Date.now(),
  wsConnected: false,
  marketsSubscribed: 0,
  framesReceived: 0,
  framesForwarded: 0,
  framesDroppedDebounce: 0,
  framesForwardErrors: 0,
  seedLastAt: 0,
  seedLastCount: 0,
  lastFrameAt: 0,
  lastError: null,
};

// ─── Bayse REST signing ─────────────────────────────────────────────────

function sha256Hex(body = "") {
  return body ? createHash("sha256").update(body).digest("hex") : "";
}

function signBayse(method, path, body = "") {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${ts}.${method.toUpperCase()}.${path}.${sha256Hex(body)}`;
  const sig = createHmac("sha256", cfg.bayseSecret)
    .update(payload)
    .digest("base64");
  return {
    "X-Public-Key": cfg.bayseKey,
    "X-Timestamp": String(ts),
    "X-Signature": sig,
  };
}

// ─── Bayse REST: events ────────────────────────────────────────────────

async function fetchBayseEvents() {
  const path = "/v1/pm/events";
  const res = await fetch(`${REST_BASE}${path}`, { headers: signBayse("GET", path) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`bayse_rest_${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.events) ? data.events : [];
}

// Trim to the same shape the worker expects (matches admin.ts trimmer).
function trimEvents(events) {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    closingDate: e.closingDate,
    liquidity: e.liquidity,
    totalVolume: e.totalVolume,
    status: e.status,
    engine: e.engine,
    markets: (e.markets ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      outcome1Id: m.outcome1Id,
      outcome1Label: m.outcome1Label,
      outcome1Price: m.outcome1Price,
      outcome2Id: m.outcome2Id,
      outcome2Label: m.outcome2Label,
      outcome2Price: m.outcome2Price,
      feePercentage: m.feePercentage,
      status: m.status,
      totalOrders: m.totalOrders,
      makerRebate: m.makerRebate,
    })),
  }));
}

// ─── Worker push ────────────────────────────────────────────────────────

async function postWorker(path, body) {
  const res = await fetch(`${cfg.workerUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Auth": cfg.relaySecret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`worker_${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json().catch(() => ({}));
}

async function refreshSeed() {
  console.log("relay: fetching Bayse events…");
  const events = await fetchBayseEvents();
  const trimmed = trimEvents(events);
  const r = await postWorker("/api/admin/bayse/seed", { events: trimmed });
  state.seedLastAt = Date.now();
  state.seedLastCount = trimmed.length;
  state.lastError = null;
  console.log(`relay: seeded ${trimmed.length} events / ${r.markets ?? "?"} markets`);
  return trimmed;
}

// ─── WS connection + forwarding ────────────────────────────────────────

let ws = null;
let pingTimer = null;
let reconnectDelayMs = 1000;
let activeMarketIds = [];
const lastSentPerMarket = new Map();

function pickMarketIds(events, max) {
  const candidates = [];
  for (const e of events) {
    if (e.status && e.status !== "open") continue;
    for (const m of e.markets ?? []) {
      if (m.status === "open") {
        candidates.push({ marketId: m.id, volume: Number(e.totalVolume ?? 0) });
      }
    }
  }
  candidates.sort((a, b) => b.volume - a.volume);
  return candidates.slice(0, max).map((c) => c.marketId);
}

function connectWs() {
  if (activeMarketIds.length === 0) {
    console.warn("relay: no markets to subscribe; skipping WS connect");
    return;
  }
  console.log(`relay: opening Bayse WS for ${activeMarketIds.length} markets…`);
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    state.wsConnected = true;
    reconnectDelayMs = 1000;
    console.log("relay: WS open, awaiting connected frame");
  });

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      handleFrame(msg);
    }
  });

  ws.on("close", (code, reason) => {
    state.wsConnected = false;
    console.warn(`relay: WS closed code=${code} reason=${String(reason).slice(0, 80)}`);
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    state.lastError = String(err).slice(0, 200);
    console.error("relay: WS error", err.message);
  });

  pingTimer = setInterval(() => {
    try {
      ws?.send(JSON.stringify({ type: "ping" }));
    } catch { /* socket closed; close handler reconnects */ }
  }, 25_000);
}

function handleFrame(msg) {
  if (msg.type === "connected") {
    console.log("relay: subscribing to orderbook channel");
    ws.send(JSON.stringify({
      type: "subscribe",
      channel: "orderbook",
      marketIds: activeMarketIds.slice(0, 10),
    }));
    state.marketsSubscribed = Math.min(activeMarketIds.length, 10);
  } else if (msg.type === "subscribed") {
    console.log(`relay: subscribed${msg.room ? ` ${msg.room}` : ""}`);
  } else if (msg.type === "orderbook_update") {
    state.framesReceived++;
    state.lastFrameAt = Date.now();
    forwardOrderbook(msg.data).catch((err) => {
      state.framesForwardErrors++;
      state.lastError = String(err).slice(0, 200);
    });
  }
  // Other types (pong, price_update, etc.) are no-ops here.
}

async function forwardOrderbook(data) {
  const ob = data?.orderbook;
  if (!ob) return;
  const marketId = ob.marketId;

  const last = lastSentPerMarket.get(marketId) ?? 0;
  if (Date.now() - last < cfg.debounceMs) {
    state.framesDroppedDebounce++;
    return;
  }
  lastSentPerMarket.set(marketId, Date.now());

  await postWorker("/api/bayse/orderbook", {
    market_id: marketId,
    outcome_id: ob.outcomeId,
    bids: ob.bids ?? [],
    asks: ob.asks ?? [],
    timestamp: ob.timestamp,
    last_traded_price: ob.lastTradedPrice,
  });
  state.framesForwarded++;
}

function scheduleReconnect() {
  const delay = Math.min(reconnectDelayMs, 30_000);
  console.log(`relay: reconnecting in ${delay}ms`);
  setTimeout(() => {
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
    connectWs();
  }, delay);
}

// ─── Health server ──────────────────────────────────────────────────────

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      const now = Date.now();
      const seedAgeMs = state.seedLastAt ? now - state.seedLastAt : null;
      const lastFrameAgeMs = state.lastFrameAt ? now - state.lastFrameAt : null;
      const ok =
        state.wsConnected && lastFrameAgeMs !== null && lastFrameAgeMs < 60_000;
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok,
        uptime_s: Math.round((now - state.startedAt) / 1000),
        ws_connected: state.wsConnected,
        markets_subscribed: state.marketsSubscribed,
        frames_received: state.framesReceived,
        frames_forwarded: state.framesForwarded,
        frames_dropped_debounce: state.framesDroppedDebounce,
        frames_forward_errors: state.framesForwardErrors,
        seed_last_at_ms: state.seedLastAt || null,
        seed_age_ms: seedAgeMs,
        seed_event_count: state.seedLastCount,
        last_frame_age_ms: lastFrameAgeMs,
        last_error: state.lastError,
      }, null, 2));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not_found");
  })
  .listen(cfg.healthPort, () => {
    console.log(`relay: health on http://0.0.0.0:${cfg.healthPort}/healthz`);
  });

// ─── Bootstrap ──────────────────────────────────────────────────────────

(async () => {
  try {
    const events = await refreshSeed();
    activeMarketIds = pickMarketIds(events, cfg.maxMarkets);
    connectWs();
  } catch (err) {
    state.lastError = String(err).slice(0, 200);
    console.error("relay: cold start failed; exiting in 30s for restart", err);
    setTimeout(() => process.exit(1), 30_000);
    return;
  }

  setInterval(async () => {
    try {
      const events = await refreshSeed();
      const fresh = pickMarketIds(events, cfg.maxMarkets);
      // We don't dynamically resubscribe — markets list is stable in
      // practice. To rotate markets, restart the relay.
      if (fresh.length !== activeMarketIds.length) {
        console.log(
          `relay: market set changed (${activeMarketIds.length} → ${fresh.length}); restart relay to resubscribe`,
        );
      }
    } catch (err) {
      state.lastError = String(err).slice(0, 200);
      console.error("relay: periodic seed refresh failed", err.message);
    }
  }, cfg.seedRefreshMin * 60_000);
})();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`relay: ${sig}, closing`);
    try { ws?.close(); } catch { /* */ }
    process.exit(0);
  });
}
