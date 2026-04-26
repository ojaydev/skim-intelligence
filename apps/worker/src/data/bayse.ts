import type { MarketSnapshot } from "@skim/shared";
import type { Env } from "../env";
import { proxyFetch } from "./proxy-fetch";

// ════════════════════════════════════════════════════════════════════════
// Bayse client — https://docs.bayse.markets
//
// REST:  https://relay.bayse.markets          (HMAC-SHA256, see authHeaders)
// WS:    wss://socket.bayse.markets/ws/v1/markets   (public, no auth)
// ════════════════════════════════════════════════════════════════════════

const BAYSE_REST = "https://relay.bayse.markets";
export const BAYSE_WS_URL = "wss://socket.bayse.markets/ws/v1/markets";

// ─── Types ────────────────────────────────────────────────────────────

export interface BayseMarket {
  id: string;
  title: string;
  outcome1Id: string;
  outcome1Label: string;
  outcome1Price: number;
  outcome2Id: string;
  outcome2Label: string;
  outcome2Price: number;
  feePercentage: number;
  status: string;
  totalOrders?: number;
  makerRebate?: {
    configId?: string;
    rebatePercentage?: number;
    minPayoutUsd?: number;
  };
}

export interface BayseEvent {
  id: string;
  title: string;
  category: string;
  closingDate?: string;
  liquidity?: number;
  totalVolume?: number;
  status?: string;
  engine?: string;
  markets: BayseMarket[];
}

export interface BayseOrderbookLevel {
  price: number;
  quantity: number;
  total: number;
}

export interface BayseOrderbookMsg {
  type: "orderbook_update";
  data: {
    orderbook: {
      marketId: string;
      outcomeId: string;
      timestamp: string;
      bids: BayseOrderbookLevel[];
      asks: BayseOrderbookLevel[];
      lastTradedPrice: number;
      lastTradedSide: "BUY" | "SELL";
    };
  };
  timestamp: number;
}

export interface BaysePriceUpdateMsg {
  type: "price_update";
  data: {
    id: string;
    slug: string;
    title: string;
    markets: Array<{
      id: string;
      prices: { YES?: number; NO?: number };
      engine?: string;
    }>;
  };
  timestamp: number;
}

export type BayseWsMessage =
  | BayseOrderbookMsg
  | BaysePriceUpdateMsg
  | { type: "pong"; timestamp: number }
  | { type: "subscribed" | "unsubscribed"; room?: string; timestamp?: number }
  | { type: string; data?: unknown; timestamp?: number };

// ─── REST: signing ────────────────────────────────────────────────────

async function sha256Hex(body: string): Promise<string> {
  if (!body) return "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export async function createSignature(
  secret: string,
  timestampSec: number,
  method: string,
  path: string,
  body = "",
): Promise<string> {
  const bodyHash = await sha256Hex(body);
  const payload = `${timestampSec}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toBase64(new Uint8Array(sig));
}

async function authHeaders(
  env: Env,
  method: string,
  path: string,
): Promise<Record<string, string>> {
  if (!env.BAYSE_PUBLIC_API_KEY) return {};
  const headers: Record<string, string> = {
    "X-Public-Key": env.BAYSE_PUBLIC_API_KEY,
  };
  if (env.BAYSE_API_SECRET) {
    const ts = Math.floor(Date.now() / 1000);
    headers["X-Timestamp"] = String(ts);
    headers["X-Signature"] = await createSignature(
      env.BAYSE_API_SECRET,
      ts,
      method,
      path,
    );
  }
  return headers;
}

// ─── REST: events listing ─────────────────────────────────────────────

export async function fetchBayseEvents(env: Env): Promise<BayseEvent[]> {
  const path = "/v1/pm/events";
  const headers = await authHeaders(env, "GET", path);

  // Prefer proxy when configured (CF Workers' direct egress is WAF-blocked
  // by Bayse). The proxy fetch uses raw TCP + HTTP CONNECT + TLS.
  if (env.PROXY_URL) {
    const res = await proxyFetch(env.PROXY_URL, `${BAYSE_REST}${path}`, {
      method: "GET",
      headers,
      timeoutMs: 15_000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`bayse_events_${res.status}`);
    }
    const body = JSON.parse(res.body) as { events?: BayseEvent[] };
    return body.events ?? [];
  }

  // Direct egress path — falls back here when no proxy configured.
  const res = await fetch(`${BAYSE_REST}${path}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`bayse_events_${res.status}`);
  const body = (await res.json()) as { events?: BayseEvent[] };
  return body.events ?? [];
}

const BAYSE_SEED_KV_KEY = "bayse:events:seed";
const BAYSE_SEED_TTL_S = 24 * 60 * 60; // 24h

interface SeedMeta {
  stored_at: number;
  count: number;
}

/**
 * Pull events seeded into KV by an allowlisted residential-IP source
 * (apps/relay, the admin shell, or the authenticated dashboard). Returned
 * from cache when REST is blocked by the relay WAF on CF Workers egress.
 */
export async function loadSeededBayseEvents(env: Env): Promise<BayseEvent[]> {
  const raw = await env.CACHE.get(BAYSE_SEED_KV_KEY, "json");
  if (!raw || !Array.isArray(raw)) return [];
  return raw as BayseEvent[];
}

export async function saveBayseEventsSeed(
  env: Env,
  events: BayseEvent[],
): Promise<void> {
  const metadata: SeedMeta = { stored_at: Date.now(), count: events.length };
  await env.CACHE.put(BAYSE_SEED_KV_KEY, JSON.stringify(events), {
    expirationTtl: BAYSE_SEED_TTL_S,
    metadata,
  });
}

export async function getBayseSeedMeta(env: Env): Promise<{
  stored_at_ms: number | null;
  age_ms: number | null;
  count: number;
}> {
  const result = await env.CACHE.getWithMetadata(BAYSE_SEED_KV_KEY);
  const meta = (result?.metadata ?? null) as SeedMeta | null;
  if (!meta?.stored_at) return { stored_at_ms: null, age_ms: null, count: 0 };
  return {
    stored_at_ms: meta.stored_at,
    age_ms: Date.now() - meta.stored_at,
    count: meta.count ?? 0,
  };
}

/**
 * Tries REST first (works from residential IPs + Cloudflare-allowlisted
 * environments), falls back to KV seed if the relay 403s CF egress.
 */
export async function fetchOrLoadBayseEvents(
  env: Env,
): Promise<{ events: BayseEvent[]; source: "rest" | "kv" | "none"; error?: string }> {
  try {
    const events = await fetchBayseEvents(env);
    return { events, source: "rest" };
  } catch (err) {
    const seeded = await loadSeededBayseEvents(env);
    if (seeded.length > 0) {
      return { events: seeded, source: "kv", error: String(err).slice(0, 120) };
    }
    return { events: [], source: "none", error: String(err).slice(0, 120) };
  }
}

export interface BayseProbeResult {
  authenticated: boolean;
  events_count: number;
  markets_count: number;
  source: "rest" | "kv" | "none";
  seed_age_ms: number | null;
  seed_stored_at_ms: number | null;
  error?: string;
}

export async function probeBayse(env: Env): Promise<BayseProbeResult> {
  if (!env.BAYSE_PUBLIC_API_KEY) {
    return {
      authenticated: false,
      events_count: 0,
      markets_count: 0,
      source: "none",
      seed_age_ms: null,
      seed_stored_at_ms: null,
      error: "no_credentials",
    };
  }
  const [loaded, seedMeta] = await Promise.all([
    fetchOrLoadBayseEvents(env),
    getBayseSeedMeta(env),
  ]);
  const markets = loaded.events.reduce(
    (a, e) => a + (e.markets?.length ?? 0),
    0,
  );
  return {
    authenticated: loaded.source === "rest",
    events_count: loaded.events.length,
    markets_count: markets,
    source: loaded.source,
    seed_age_ms: seedMeta.age_ms,
    seed_stored_at_ms: seedMeta.stored_at_ms,
    error: loaded.error,
  };
}

// ─── WS: open + parse batched frames ──────────────────────────────────

/**
 * Open the public Bayse market-data WebSocket.
 * Cloudflare Workers requires https:// in fetch URL — scheme is flipped here.
 */
export async function openBayseWs(): Promise<WebSocket | null> {
  try {
    const httpUrl = BAYSE_WS_URL.replace(/^wss:\/\//, "https://");
    const resp = await fetch(httpUrl, {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(6_000),
    });
    const ws = resp.webSocket;
    if (!ws) {
      console.warn(`bayse: ws upgrade rejected status=${resp.status}`);
      return null;
    }
    ws.accept();
    return ws;
  } catch (err) {
    console.warn("bayse: ws open failed", err);
    return null;
  }
}

/**
 * Docs: the server may batch multiple JSON messages into a single WS frame
 * separated by newlines. Parse each line independently.
 */
export function parseBayseFrame(raw: string): BayseWsMessage[] {
  const out: BayseWsMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as BayseWsMessage);
    } catch {
      /* skip unparseable line */
    }
  }
  return out;
}

export function subscribeOrderbookMsg(marketIds: string[]): string {
  // Docs cap: max 10 marketIds per subscribe
  return JSON.stringify({
    type: "subscribe",
    channel: "orderbook",
    marketIds: marketIds.slice(0, 10),
  });
}

export function subscribePricesMsg(eventId: string): string {
  return JSON.stringify({
    type: "subscribe",
    channel: "prices",
    eventId,
  });
}

export const BAYSE_PING = JSON.stringify({ type: "ping" });

// ─── Snapshot conversion ─────────────────────────────────────────────

function levelsDepthUsd(levels: BayseOrderbookLevel[], top = 5): number {
  let sum = 0;
  for (let i = 0; i < Math.min(top, levels.length); i++) {
    const l = levels[i];
    if (!l) continue;
    sum += l.price * l.quantity;
  }
  return sum;
}

/**
 * Rich MarketSnapshot from a Bayse orderbook update + parent event/market
 * metadata. When we only have a `price_update` (no orderbook), caller falls
 * back to synthesising a band around the quote.
 */
export function bayseSnapshotFromOrderbook(
  ev: BayseEvent,
  m: BayseMarket,
  yesBook: { bids: BayseOrderbookLevel[]; asks: BayseOrderbookLevel[] },
  noBook: { bids: BayseOrderbookLevel[]; asks: BayseOrderbookLevel[] } | null,
  timestampMs: number,
): MarketSnapshot {
  const yesBestBid = yesBook.bids[0]?.price ?? 0;
  const yesBestAsk = yesBook.asks[0]?.price ?? 1;
  const noBestBid = noBook?.bids[0]?.price ?? 1 - yesBestAsk;
  const noBestAsk = noBook?.asks[0]?.price ?? 1 - yesBestBid;

  const mid = (yesBestBid + yesBestAsk) / 2;
  const spreadPct = mid > 0 ? (yesBestAsk - yesBestBid) / mid : 0;

  const feeRate = (m.feePercentage ?? 5) / 100;
  const rewardRate = (m.makerRebate?.rebatePercentage ?? 0) / 100;
  const twoSided = !!m.makerRebate && rewardRate > 0;

  const resolutionDays = ev.closingDate
    ? Math.max(
        0,
        (new Date(ev.closingDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      )
    : 999;

  const liquidity = Number(ev.liquidity ?? 0);
  const ageMs = Date.now() - timestampMs;

  return {
    market_id: `bayse_${m.id}`,
    title: `${ev.title} — ${m.title}`,
    category: (ev.category ?? "other").toLowerCase(),

    best_bid: yesBestBid,
    best_ask: yesBestAsk,
    yes_bid_depth_usd: levelsDepthUsd(yesBook.bids),
    yes_ask_depth_usd: levelsDepthUsd(yesBook.asks),
    no_bid_depth_usd: noBook ? levelsDepthUsd(noBook.bids) : liquidity * 0.25,
    no_ask_depth_usd: noBook ? levelsDepthUsd(noBook.asks) : liquidity * 0.25,

    mid_price: mid,
    spread_pct: spreadPct,
    complement_sum: yesBestAsk + noBestAsk,
    complement_diff: 1 - (yesBestBid + noBestBid),

    resolution_days: resolutionDays,
    volume_24h_usd: Number(ev.totalVolume ?? 0),
    taker_fee_rate: feeRate,

    reward_pool_remaining_usd:
      twoSided && liquidity > 0 ? liquidity * rewardRate : 0,
    reward_epoch_end: ev.closingDate ?? "",
    two_sided_eligible: twoSided,
    estimated_reward_yield: rewardRate,

    snapshot_age_ms: ageMs,
    data_quality: ageMs < 60_000 ? "fresh" : ageMs < 300_000 ? "stale" : "dead",
    fetched_at: new Date(timestampMs).toISOString(),
  };
}
