import { Hono } from "hono";
import type { Env } from "../env";

export const ws = new Hono<{ Bindings: Env }>();

// Dashboard clients upgrade here; the Orchestrator DO holds connections
// via the Hibernation API and broadcasts feed events.
ws.get("/", async (c) => {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ error: "expected_websocket_upgrade" }, 426);
  }
  const id = c.env.ORCHESTRATOR.idFromName("singleton");
  const stub = c.env.ORCHESTRATOR.get(id);
  return stub.fetch("https://internal/ws", {
    headers: { upgrade: "websocket" },
  });
});
