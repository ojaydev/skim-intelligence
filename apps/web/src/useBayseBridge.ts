import { useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════════
// Browser-side Bayse bridge.
//
// Cloudflare Workers egress is silently soft-blocked from Bayse's WS data
// layer (welcome + ping pass, subscribes get dropped). The dashboard runs
// on residential IPs where this works fine, so we open the WS in the
// browser and forward orderbook updates to the Worker over HTTPS.
//
// Flow:
//   1. GET /api/bayse/subscriptions  → worker returns top-N {event_id, market_id, outcome1Id, outcome2Id}
//   2. Open wss://socket.bayse.markets/ws/v1/markets
//   3. Send  {type:"subscribe", channel:"orderbook", marketIds:[...10]}
//   4. On each orderbook_update frame, POST /api/bayse/orderbook
// ════════════════════════════════════════════════════════════════════════

const BAYSE_WS = "wss://socket.bayse.markets/ws/v1/markets";
const MAX_BATCH_MARKETS = 10;

interface Subscription {
  event_id: string;
  event_title: string;
  market_id: string;
  outcome1_id: string;
  outcome2_id: string;
}

export interface BayseBridgeState {
  connected: boolean;
  markets_subscribed: number;
  updates_received: number;
  updates_forwarded: number;
  last_error: string | null;
}

export function useBayseBridge(enabled = true): BayseBridgeState {
  const [state, setState] = useState<BayseBridgeState>({
    connected: false,
    markets_subscribed: 0,
    updates_received: 0,
    updates_forwarded: 0,
    last_error: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    async function connect() {
      if (cancelled) return;

      // 1. Load subscriptions from worker
      let subs: Subscription[] = [];
      try {
        const res = await fetch("/api/bayse/subscriptions");
        if (!res.ok) throw new Error(`subs_${res.status}`);
        const body = (await res.json()) as { markets: Subscription[] };
        subs = body.markets.slice(0, MAX_BATCH_MARKETS);
      } catch (err) {
        setState((s) => ({ ...s, last_error: `subs: ${err}` }));
        scheduleReconnect();
        return;
      }
      if (subs.length === 0) {
        setState((s) => ({ ...s, last_error: "no_seeded_events" }));
        scheduleReconnect();
        return;
      }

      // Build market → outcome lookup for routing incoming frames
      const marketLookup = new Map<
        string,
        { event_id: string; outcome1_id: string; outcome2_id: string }
      >();
      for (const s of subs) {
        marketLookup.set(s.market_id, {
          event_id: s.event_id,
          outcome1_id: s.outcome1_id,
          outcome2_id: s.outcome2_id,
        });
      }

      // 2. Open WS
      const ws = new WebSocket(BAYSE_WS);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        // 3. Subscribe after we see `connected` frame (see message handler)
      });

      ws.addEventListener("message", (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : "";
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg: { type?: string; data?: unknown };
          try {
            msg = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (msg.type === "connected") {
            // Send subscribe as soon as we have the welcome
            ws.send(
              JSON.stringify({
                type: "subscribe",
                channel: "orderbook",
                marketIds: subs.map((s) => s.market_id),
              }),
            );
            setState((s) => ({
              ...s,
              connected: true,
              markets_subscribed: subs.length,
              last_error: null,
            }));
          } else if (msg.type === "orderbook_update") {
            setState((s) => ({ ...s, updates_received: s.updates_received + 1 }));
            handleOrderbook(msg.data, marketLookup).catch((err) =>
              setState((s) => ({ ...s, last_error: `forward: ${err}` })),
            );
          }
        }
      });

      ws.addEventListener("close", () => {
        setState((s) => ({ ...s, connected: false }));
        if (pingTimer) clearInterval(pingTimer);
        scheduleReconnect();
      });
      ws.addEventListener("error", () => { /* close handler will fire */ });

      // Application-level keepalive (docs: server pings every ~54s, app ping optional)
      pingTimer = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch { /* closed */ }
      }, 25_000);
    }

    async function handleOrderbook(
      data: unknown,
      lookup: Map<
        string,
        { event_id: string; outcome1_id: string; outcome2_id: string }
      >,
    ) {
      const ob = (data as { orderbook?: unknown }).orderbook as
        | {
            marketId: string;
            outcomeId: string;
            bids: Array<{ price: number; quantity: number; total: number }>;
            asks: Array<{ price: number; quantity: number; total: number }>;
            timestamp: string;
            lastTradedPrice?: number;
          }
        | undefined;
      if (!ob) return;
      const meta = lookup.get(ob.marketId);
      if (!meta) return;

      const res = await fetch("/api/bayse/orderbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: ob.marketId,
          outcome_id: ob.outcomeId,
          bids: ob.bids,
          asks: ob.asks,
          timestamp: ob.timestamp,
          last_traded_price: ob.lastTradedPrice,
        }),
      });
      if (res.ok) {
        setState((s) => ({ ...s, updates_forwarded: s.updates_forwarded + 1 }));
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 5_000);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [enabled]);

  return state;
}
