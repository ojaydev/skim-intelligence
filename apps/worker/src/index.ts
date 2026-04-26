import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./env";
import { markets } from "./routes/markets";
import { signals } from "./routes/signals";
import { portfolio } from "./routes/portfolio";
import { admin } from "./routes/admin";
import { status } from "./routes/status";
import { ws } from "./routes/ws";
import { epochs } from "./routes/epochs";
import { wallet } from "./routes/wallet";
import { webhooks } from "./routes/webhooks";
import { diagnose } from "./routes/diagnose";
import { bayseIngest } from "./routes/bayse-ingest";

export { ScannerDO } from "./agents/scanner";
export { OrchestratorDO } from "./orchestrator";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("*", cors({ origin: "*" }));

app.get("/", (c) =>
  c.json({
    name: "skim-intelligence",
    version: "0.1.0",
    status: "ok",
    docs: "https://github.com/skim/intelligence",
  }),
);

app.route("/api/markets", markets);
app.route("/api/signals", signals);
app.route("/api/portfolio", portfolio);
app.route("/api/epochs", epochs);
app.route("/api/wallet", wallet);
app.route("/api/webhooks", webhooks);
app.route("/api/bayse", bayseIngest);
app.route("/api/admin/diagnose", diagnose);
app.route("/api/admin", admin);
app.route("/api/status", status);
app.route("/api/ws", ws);

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

export default {
  fetch: app.fetch,

  // Cron: epoch close every 5 min → triggers Reporter via Orchestrator.
  // This is the single source of truth for epoch close (the alarm-driven
  // fallback that used to race with this has been removed).
  async scheduled(_event: ScheduledController, env: Env) {
    const id = env.ORCHESTRATOR.idFromName("singleton");
    const stub = env.ORCHESTRATOR.get(id);
    await stub.fetch("https://internal/epoch-close", { method: "POST" });
  },

};
