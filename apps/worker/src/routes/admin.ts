import { Hono } from "hono";
import type { Env } from "../env";
import {
  loadSeededBayseEvents,
  saveBayseEventsSeed,
  type BayseEvent,
} from "../data/bayse";

export const admin = new Hono<{ Bindings: Env }>();

admin.post("/mode", async (c) => {
  const body = await c.req.json<{ mode: string }>();
  const allowed = ["observe", "paper", "live_limited"];
  if (!allowed.includes(body.mode)) {
    return c.json({ error: "invalid_mode", allowed }, 400);
  }
  await c.env.CACHE.put("orchestrator:mode", body.mode);
  return c.json({ mode: body.mode });
});

admin.post("/cycle", async (c) => {
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/process-batch", {
    method: "POST",
    body: JSON.stringify([]),
  });
  return c.json({ triggered: true, orchestratorStatus: res.status });
});

admin.post("/scanner/connect", async (c) => {
  const id = c.env.SCANNER.idFromName("singleton");
  const stub = c.env.SCANNER.get(id);
  const res = await stub.fetch("https://internal/connect", { method: "POST" });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/scanner/disconnect", async (c) => {
  const id = c.env.SCANNER.idFromName("singleton");
  const stub = c.env.SCANNER.get(id);
  const res = await stub.fetch("https://internal/disconnect", {
    method: "POST",
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/alpha/:marketId", async (c) => {
  const marketId = c.req.param("marketId");
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/run-alpha", {
    method: "POST",
    body: JSON.stringify({ market_id: marketId }),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/risk/:signalId", async (c) => {
  const signalId = c.req.param("signalId");
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/run-risk", {
    method: "POST",
    body: JSON.stringify({ signal_id: signalId }),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/test-execute/:signalId", async (c) => {
  const signalId = c.req.param("signalId");
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/test-execute", {
    method: "POST",
    body: JSON.stringify({ signal_id: signalId }),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

// ─── Bayse event seed ───────────────────────────────────────────────
// CF Workers are WAF-blocked from Bayse's REST relay. apps/relay (running
// outside Cloudflare) calls this endpoint with the trimmed event list.
// When RELAY_SECRET is set, requests must carry a matching X-Relay-Auth.

admin.post("/bayse/seed", async (c) => {
  if (c.env.RELAY_SECRET) {
    const provided = c.req.header("X-Relay-Auth") ?? "";
    if (provided !== c.env.RELAY_SECRET) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  const body = await c.req.json<{ events: BayseEvent[] }>();
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return c.json({ error: "missing_events" }, 400);
  }
  // Strip to essentials to keep KV payload small
  const trimmed: BayseEvent[] = body.events.map((e) => ({
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
  await saveBayseEventsSeed(c.env, trimmed);
  return c.json({
    stored: trimmed.length,
    markets: trimmed.reduce((a, e) => a + (e.markets?.length ?? 0), 0),
  });
});

admin.get("/bayse/seed", async (c) => {
  const events = await loadSeededBayseEvents(c.env);
  return c.json({
    events_count: events.length,
    markets_count: events.reduce((a, e) => a + (e.markets?.length ?? 0), 0),
    sample: events[0]?.title ?? null,
  });
});

// ─── Auto-orchestration cycle control ───────────────────────────────

admin.post("/cycle/start", async (c) => {
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/start-cycle", { method: "POST" });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/cycle/stop", async (c) => {
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/stop-cycle", { method: "POST" });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.get("/cycle/status", async (c) => {
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/cycle-status");
  return new Response(res.body, { status: res.status, headers: res.headers });
});

admin.post("/epoch-close", async (c) => {
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  const res = await stub.fetch("https://internal/epoch-close", {
    method: "POST",
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});
