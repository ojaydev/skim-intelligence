import type { Env } from "../env";
import {
  bayseSnapshotFromOrderbook,
  fetchOrLoadBayseEvents,
  probeBayse,
  type BayseEvent,
  type BayseMarket,
  type BayseOrderbookLevel,
  type BayseProbeResult,
} from "../data/bayse";
import {
  fetchActiveMarkets,
  fetchBook,
  marketSubscribeMessage,
  type Book,
  type BookLevel,
  type ParsedMarket,
} from "../data/polymarket";
import { computeSnapshot } from "../data/snapshot";

const PING_INTERVAL_MS = 10_000;
const POLYMARKET_MAX = 5;
const BAYSE_MAX = 10; // docs cap per subscribe — also enforced by relay

interface PolyState {
  market: ParsedMarket;
  yesBook: Book;
  noBook: Book;
}

interface BayseState {
  event: BayseEvent;
  market: BayseMarket;
  yesBook: { bids: BayseOrderbookLevel[]; asks: BayseOrderbookLevel[] };
  noBook: { bids: BayseOrderbookLevel[]; asks: BayseOrderbookLevel[] } | null;
  yesOutcomeId: string;
  noOutcomeId: string;
  lastUpdateMs: number;
}

/**
 * Scanner Durable Object — singleton.
 *
 *  • Polymarket: holds a long-lived outgoing WebSocket and consumes
 *    book deltas directly (no auth needed, CF egress allowed).
 *  • Bayse:      data is pushed in over HTTPS by apps/relay (the
 *    CF→Bayse WS subscribe path is silently dropped by Bayse's WAF, and
 *    the REST relay is 403-blocked). The DO holds in-memory book state,
 *    so frame application and snapshot persistence look the same.
 */
export class ScannerDO implements DurableObject {
  // Polymarket
  private polyWs: WebSocket | null = null;
  private polyState = new Map<string, PolyState>();
  private polyTokenMap = new Map<
    string,
    { market: ParsedMarket; side: "yes" | "no" }
  >();
  private polyMsgs = 0;
  private polyLastMsgMs: number | null = null;

  // Bayse (state populated from KV seed; frames pushed by apps/relay)
  private bayseState = new Map<string, BayseState>();
  private bayseMsgs = 0;
  private bayseLastMsgMs: number | null = null;
  private bayseProbe: BayseProbeResult | null = null;

  private bootstrapAt: number | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.startScanner();
      case "/disconnect":
        return this.stopScanner();
      case "/bayse-frame":
        return this.handleBayseFrame(request);
      case "/health": {
        const now = Date.now();
        const bayseLive =
          this.bayseLastMsgMs !== null && now - this.bayseLastMsgMs < 60_000;
        return Response.json({
          polymarket: {
            connected: this.polyWs?.readyState === WebSocket.OPEN,
            markets: this.polyState.size,
            tokens: this.polyTokenMap.size,
            messageCount: this.polyMsgs,
            lastMessageAt: this.polyLastMsgMs,
          },
          bayse: {
            connected: bayseLive,
            via_relay: true,
            markets: this.bayseState.size,
            messageCount: this.bayseMsgs,
            lastMessageAt: this.bayseLastMsgMs,
            probe: this.bayseProbe,
          },
          bootstrapAt: this.bootstrapAt,
        });
      }
      default:
        return new Response("not_found", { status: 404 });
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  private async startScanner(): Promise<Response> {
    const polyOpen = this.polyWs?.readyState === WebSocket.OPEN;

    try {
      this.bayseProbe = await probeBayse(this.env);
      console.log("scanner: bayse probe →", this.bayseProbe);

      const [poly, bayse] = await Promise.allSettled([
        polyOpen ? null : this.bootstrapPolymarket(),
        this.bootstrapBayse(),
      ]);

      if (poly.status === "rejected") console.error("scanner: poly bootstrap", poly.reason);
      if (bayse.status === "rejected") console.error("scanner: bayse bootstrap", bayse.reason);

      if (!polyOpen && this.polyState.size > 0) await this.openPolyWs();

      this.bootstrapAt = Date.now();
      await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS);

      return Response.json({
        status: "connected",
        polymarket: { markets: this.polyState.size, tokens: this.polyTokenMap.size },
        bayse: {
          markets: this.bayseState.size,
          via_relay: true,
          probe: this.bayseProbe,
        },
      });
    } catch (err) {
      console.error("scanner: start failed", err);
      return Response.json(
        { status: "error", message: String(err) },
        { status: 500 },
      );
    }
  }

  private async stopScanner(): Promise<Response> {
    try {
      this.polyWs?.close(1000, "shutdown");
    } catch { /* */ }
    this.polyWs = null;
    await this.ctx.storage.deleteAlarm();
    return Response.json({ status: "disconnected" });
  }

  // ─── Polymarket bootstrap + WS ──────────────────────────────────────

  private async bootstrapPolymarket(): Promise<void> {
    const markets = await fetchActiveMarkets(POLYMARKET_MAX);
    console.log(`scanner: polymarket ${markets.length} markets`);
    for (const m of markets) {
      try {
        const [yesBook, noBook] = await Promise.all([
          fetchBook(m.yesTokenId),
          fetchBook(m.noTokenId),
        ]);
        this.polyState.set(m.conditionId, { market: m, yesBook, noBook });
        this.polyTokenMap.set(m.yesTokenId, { market: m, side: "yes" });
        this.polyTokenMap.set(m.noTokenId, { market: m, side: "no" });
        await this.persistPolySnapshot(m.conditionId);
      } catch (err) {
        console.error(`scanner: poly bootstrap ${m.conditionId}`, err);
      }
    }
  }

  private async openPolyWs(): Promise<void> {
    const tokens = Array.from(this.polyTokenMap.keys());
    if (tokens.length === 0) return;
    const httpUrl = this.env.POLYMARKET_WS_URL.replace(/^wss:\/\//, "https://");
    const resp = await fetch(httpUrl, {
      headers: { Upgrade: "websocket" },
    });
    const ws = resp.webSocket;
    if (!ws) throw new Error("poly ws upgrade failed");
    ws.accept();
    this.polyWs = ws;

    ws.addEventListener("message", (ev) => this.onPolyMessage(ev.data));
    ws.addEventListener("close", () => {
      this.polyWs = null;
    });
    ws.addEventListener("error", (err) =>
      console.error("scanner: poly ws error", err),
    );
    ws.send(marketSubscribeMessage(tokens));
    console.log(`scanner: poly subscribed (${tokens.length} tokens)`);
  }

  private onPolyMessage(data: string | ArrayBuffer) {
    const raw =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    if (raw.trim().toUpperCase() === "PONG") return;
    this.polyMsgs++;
    this.polyLastMsgMs = Date.now();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const ev of events)
      this.applyPolyEvent(ev as Record<string, unknown>);
  }

  private applyPolyEvent(ev: Record<string, unknown>): void {
    const eventType = String(ev.event_type ?? "");
    const assetId = String(ev.asset_id ?? "");
    if (!assetId) return;
    const ref = this.polyTokenMap.get(assetId);
    if (!ref) return;
    const mState = this.polyState.get(ref.market.conditionId);
    if (!mState) return;
    const targetBook = ref.side === "yes" ? mState.yesBook : mState.noBook;

    if (eventType === "book") {
      const newBook: Book = {
        market: String(ev.market ?? targetBook.market),
        asset_id: assetId,
        timestamp: String(ev.timestamp ?? Date.now()),
        bids: Array.isArray(ev.bids) ? (ev.bids as BookLevel[]) : [],
        asks: Array.isArray(ev.asks) ? (ev.asks as BookLevel[]) : [],
      };
      if (ref.side === "yes") mState.yesBook = newBook;
      else mState.noBook = newBook;
    } else if (eventType === "price_change") {
      const changes = Array.isArray(ev.changes)
        ? (ev.changes as Array<{ price: string; side: string; size: string }>)
        : [];
      for (const c of changes) {
        const sideArr =
          c.side?.toUpperCase() === "BUY" ? targetBook.bids : targetBook.asks;
        const idx = sideArr.findIndex((l) => l.price === c.price);
        if (Number(c.size) === 0) {
          if (idx >= 0) sideArr.splice(idx, 1);
        } else if (idx >= 0) {
          const e = sideArr[idx];
          if (e) e.size = c.size;
        } else {
          sideArr.push({ price: c.price, size: c.size });
          sideArr.sort((a, b) => Number(a.price) - Number(b.price));
        }
      }
      targetBook.timestamp = String(ev.timestamp ?? Date.now());
    } else {
      return;
    }
    this.persistPolySnapshot(ref.market.conditionId).catch((err) =>
      console.error("scanner: poly persist failed", err),
    );
  }

  private async persistPolySnapshot(conditionId: string): Promise<void> {
    const s = this.polyState.get(conditionId);
    if (!s) return;
    const snapshot = computeSnapshot(s.market, s.yesBook, s.noBook);
    await this.env.CACHE.put(
      `market:${conditionId}:snapshot`,
      JSON.stringify(snapshot),
      { expirationTtl: 3600 },
    );
  }

  // ─── Bayse: bootstrap state + handle relay-pushed frames ────────────

  private async bootstrapBayse(): Promise<void> {
    if (!this.env.BAYSE_PUBLIC_API_KEY) return;

    // Seed comes from KV (populated by apps/relay or admin shell). REST
    // direct from CF is 403-blocked — the relay does that fetch instead.
    const loaded = await fetchOrLoadBayseEvents(this.env);
    console.log(
      `scanner: bayse source=${loaded.source} events=${loaded.events.length} err=${loaded.error ?? "none"}`,
    );
    if (loaded.events.length === 0) return;

    const candidates: Array<{ event: BayseEvent; market: BayseMarket }> = [];
    for (const ev of loaded.events) {
      if (ev.status && ev.status !== "open") continue;
      for (const m of ev.markets ?? []) {
        if (m.status === "open") candidates.push({ event: ev, market: m });
      }
    }
    candidates.sort(
      (a, b) => Number(b.event.totalVolume ?? 0) - Number(a.event.totalVolume ?? 0),
    );
    const picked = candidates.slice(0, BAYSE_MAX);

    this.bayseState.clear();
    for (const { event, market } of picked) {
      this.bayseState.set(market.id, {
        event,
        market,
        yesBook: { bids: [], asks: [] },
        noBook: null,
        yesOutcomeId: market.outcome1Id,
        noOutcomeId: market.outcome2Id,
        lastUpdateMs: 0,
      });
    }
    console.log(`scanner: bayse picked ${picked.length} markets`);
  }

  private async handleBayseFrame(request: Request): Promise<Response> {
    const body = await request.json<{
      market_id?: string;
      outcome_id?: string;
      bids?: BayseOrderbookLevel[];
      asks?: BayseOrderbookLevel[];
      timestamp?: string;
      last_traded_price?: number;
    }>();

    if (!body.market_id || !body.outcome_id) {
      return Response.json({ error: "missing_fields" }, { status: 400 });
    }

    // Lazy bootstrap on cold DO restart, or if the seed has rotated.
    if (this.bayseState.size === 0) {
      await this.bootstrapBayse();
    }
    let s = this.bayseState.get(body.market_id);
    if (!s) {
      await this.bootstrapBayse();
      s = this.bayseState.get(body.market_id);
      if (!s) {
        return Response.json(
          { error: "unknown_market", market_id: body.market_id },
          { status: 404 },
        );
      }
    }

    this.bayseMsgs++;
    this.bayseLastMsgMs = Date.now();

    const book = { bids: body.bids ?? [], asks: body.asks ?? [] };
    if (body.outcome_id === s.yesOutcomeId) s.yesBook = book;
    else if (body.outcome_id === s.noOutcomeId) s.noBook = book;
    else
      return Response.json({ error: "outcome_mismatch" }, { status: 400 });

    s.lastUpdateMs = body.timestamp
      ? new Date(body.timestamp).getTime() || Date.now()
      : Date.now();

    await this.persistBayseSnapshot(body.market_id);
    return Response.json({
      ok: true,
      market_id: body.market_id,
      has_both_sides: !!(s.yesBook.bids.length && s.noBook),
    });
  }

  private async persistBayseSnapshot(marketId: string): Promise<void> {
    const s = this.bayseState.get(marketId);
    if (!s) return;
    const snapshot = bayseSnapshotFromOrderbook(
      s.event,
      s.market,
      s.yesBook,
      s.noBook,
      s.lastUpdateMs || Date.now(),
    );
    await this.env.CACHE.put(
      `market:${snapshot.market_id}:snapshot`,
      JSON.stringify(snapshot),
      { expirationTtl: 3600 },
    );
  }

  // ─── Alarm loop: ping Polymarket WS only ────────────────────────────
  // Bayse data is pushed in by apps/relay over HTTPS — no WS keepalive here.

  async alarm(): Promise<void> {
    const polyOpen = this.polyWs?.readyState === WebSocket.OPEN;

    if (polyOpen) {
      try { this.polyWs?.send("PING"); } catch { /* */ }
    } else if (this.polyState.size > 0) {
      this.openPolyWs().catch((err) => console.error("poly reconnect", err));
    }

    await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }
}
