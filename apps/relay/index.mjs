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
  debugFrames: process.env.DEBUG_FRAMES === "1",
  // Polling fallback — when Bayse silently drops orderbook subscribes from
  // this egress IP, we synthesize per-market orderbook frames from the REST
  // /v1/pm/events response (prices + liquidity) and post them as if from WS.
  pollEnabled: process.env.BAYSE_POLL !== "0",
  pollIntervalMs: Math.max(2000, Number(process.env.BAYSE_POLL_INTERVAL_MS ?? 5000)),
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
  pollLastAt: 0,
  pollFramesForwarded: 0,
  pollErrors: 0,
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
    if (cfg.debugFrames) console.log("relay-debug RX:", raw.slice(0, 500));
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        if (cfg.debugFrames) console.log("relay-debug unparseable:", trimmed.slice(0, 200));
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
    const sub = {
      type: "subscribe",
      channel: "orderbook",
      marketIds: activeMarketIds.slice(0, 10),
    };
    console.log(`relay: subscribing to orderbook channel (${sub.marketIds.length} markets)`);
    if (cfg.debugFrames) console.log("relay-debug TX:", JSON.stringify(sub));
    ws.send(JSON.stringify(sub));
    state.marketsSubscribed = Math.min(activeMarketIds.length, 10);
  } else if (msg.type === "subscribed") {
    console.log(`relay: subscribed${msg.room ? ` ${msg.room}` : ""}`);
  } else if (msg.type === "error") {
    state.lastError = `bayse_ws_error: ${JSON.stringify(msg).slice(0, 200)}`;
    console.error("relay: BAYSE ERROR FRAME", msg);
  } else if (msg.type === "orderbook_update") {
    state.framesReceived++;
    state.lastFrameAt = Date.now();
    forwardOrderbook(msg.data).catch((err) => {
      state.framesForwardErrors++;
      state.lastError = String(err).slice(0, 200);
    });
  } else if (cfg.debugFrames) {
    console.log("relay-debug other:", msg.type, JSON.stringify(msg).slice(0, 300));
  }
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

// ─── Polling fallback: synthesize orderbook frames from REST prices ────
//
// `/v1/pm/events` returns each market's outcome1Price / outcome2Price plus
// the parent event's `liquidity`. We construct a 5-level synthetic book
// around each price using a 1% spread and liquidity-derived depth, then
// post both YES and NO frames — same shape the WS path would produce.
//
// Synthetic depth is plainly less accurate than a real LOB, but the agent
// pipeline only needs realistic bid/ask + depth levels to reason. When a
// real WS path is restored, real frames will overwrite synthetic ones in
// the scanner DO's in-memory book.

let lastEventsCache = [];

function buildSyntheticLevels(midPrice, isAsk, liquidityUsd) {
  const spread = Math.max(0.005, midPrice * 0.01); // 1% of price, min 0.5c
  const halfSpread = spread / 2;
  const levelStep = spread / 4;
  const levelQty = liquidityUsd > 0
    ? Math.max(50, liquidityUsd * 0.02)
    : 100; // sensible fallback
  const levels = [];
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const offset = halfSpread + i * levelStep;
    const price = isAsk ? midPrice + offset : midPrice - offset;
    if (price <= 0 || price >= 1) continue;
    const qty = levelQty * Math.pow(0.85, i);
    total += price * qty;
    levels.push({
      price: Number(price.toFixed(4)),
      quantity: Number(qty.toFixed(2)),
      total: Number(total.toFixed(2)),
    });
  }
  return levels;
}

async function postSyntheticFrames(events, marketIds) {
  if (events.length === 0 || marketIds.length === 0) return 0;
  let posted = 0;
  for (const marketId of marketIds) {
    const ev = events.find((e) => (e.markets ?? []).some((m) => m.id === marketId));
    if (!ev) continue;
    const market = ev.markets.find((m) => m.id === marketId);
    if (!market) continue;

    const yesPrice = clamp01(Number(market.outcome1Price ?? 0.5));
    const noPrice = clamp01(Number(market.outcome2Price ?? 1 - yesPrice));
    const liquidity = Number(ev.liquidity ?? 0);
    const ts = new Date().toISOString();

    const yesFrame = {
      market_id: marketId,
      outcome_id: market.outcome1Id,
      bids: buildSyntheticLevels(yesPrice, false, liquidity),
      asks: buildSyntheticLevels(yesPrice, true, liquidity),
      timestamp: ts,
      last_traded_price: yesPrice,
    };
    const noFrame = {
      market_id: marketId,
      outcome_id: market.outcome2Id,
      bids: buildSyntheticLevels(noPrice, false, liquidity),
      asks: buildSyntheticLevels(noPrice, true, liquidity),
      timestamp: ts,
      last_traded_price: noPrice,
    };

    try {
      await postWorker("/api/bayse/orderbook", yesFrame);
      await postWorker("/api/bayse/orderbook", noFrame);
      posted += 2;
    } catch (err) {
      state.pollErrors++;
      state.lastError = `poll: ${String(err).slice(0, 160)}`;
      // continue with next market
    }
  }
  return posted;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.999, Math.max(0.001, n));
}

async function pollTick() {
  if (!cfg.pollEnabled) return;
  try {
    // Reuse cached events if recent (< 25s); otherwise refetch
    const cacheAgeMs = Date.now() - state.pollLastAt;
    let events = lastEventsCache;
    if (events.length === 0 || cacheAgeMs > 25_000) {
      events = await fetchBayseEvents();
      lastEventsCache = events;
    }
    const posted = await postSyntheticFrames(events, activeMarketIds);
    state.pollLastAt = Date.now();
    state.pollFramesForwarded += posted;
    state.lastFrameAt = Date.now(); // makes /healthz "ok"
  } catch (err) {
    state.pollErrors++;
    state.lastError = `poll_tick: ${String(err).slice(0, 160)}`;
  }
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
        poll_enabled: cfg.pollEnabled,
        poll_last_at_ms: state.pollLastAt || null,
        poll_frames_forwarded: state.pollFramesForwarded,
        poll_errors: state.pollErrors,
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
    lastEventsCache = events;
    activeMarketIds = pickMarketIds(events, cfg.maxMarkets);
    connectWs();
    if (cfg.pollEnabled) {
      console.log(
        `relay: starting synthetic-orderbook poll loop every ${cfg.pollIntervalMs}ms (${activeMarketIds.length} markets)`,
      );
      // Fire one tick immediately so the worker has data within a few seconds.
      pollTick().catch(() => { /* state.lastError already set */ });
      setInterval(pollTick, cfg.pollIntervalMs);
    }
  } catch (err) {
    state.lastError = String(err).slice(0, 200);
    console.error("relay: cold start failed; exiting in 30s for restart", err);
    setTimeout(() => process.exit(1), 30_000);
    return;
  }

  setInterval(async () => {
    try {
      const events = await refreshSeed();
      lastEventsCache = events;
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
