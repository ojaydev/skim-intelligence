import { Hono } from "hono";
import type { Env } from "../env";
import { loadSeededBayseEvents } from "../data/bayse";

// ════════════════════════════════════════════════════════════════════════
// Bayse ingest — receives orderbook updates from apps/relay (running
// outside Cloudflare egress, where Bayse's data layer accepts subscribes).
// Forwards each frame to the Scanner Durable Object so its in-memory
// bayseState + bayseMsgs/bayseLastMsgMs counters stay authoritative.
//
// When RELAY_SECRET is set, requests must carry a matching X-Relay-Auth.
// The browser bridge in useBayseBridge.ts is supported as a fallback when
// RELAY_SECRET is unset (dev mode).
// ════════════════════════════════════════════════════════════════════════

export const bayseIngest = new Hono<{ Bindings: Env }>();

function authorize(c: { env: Env; req: { header: (k: string) => string | undefined } }): boolean {
  if (!c.env.RELAY_SECRET) return true;
  return c.req.header("X-Relay-Auth") === c.env.RELAY_SECRET;
}

bayseIngest.post("/orderbook", async (c) => {
  if (!authorize(c)) return c.json({ error: "unauthorized" }, 401);

  const id = c.env.SCANNER.idFromName("singleton");
  const stub = c.env.SCANNER.get(id);
  const res = await stub.fetch("https://internal/bayse-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await c.req.text(),
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

// ─── Read endpoint used by the browser bridge to know what to subscribe to ──
// Open by design (no auth) — only returns market IDs already in the public
// seed; no sensitive data exposed.

bayseIngest.get("/subscriptions", async (c) => {
  const events = await loadSeededBayseEvents(c.env);
  const markets: Array<{
    event_id: string;
    event_title: string;
    market_id: string;
    market_title: string;
    outcome1_id: string;
    outcome2_id: string;
  }> = [];
  for (const ev of events) {
    for (const m of ev.markets ?? []) {
      if (m.status !== "open") continue;
      markets.push({
        event_id: ev.id,
        event_title: ev.title,
        market_id: m.id,
        market_title: m.title,
        outcome1_id: m.outcome1Id,
        outcome2_id: m.outcome2Id,
      });
    }
  }
  return c.json({ markets: markets.slice(0, 20) });
});
