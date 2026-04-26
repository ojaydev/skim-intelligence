import { Hono } from "hono";
import type { Env } from "../env";

export const status = new Hono<{ Bindings: Env }>();

status.get("/", async (c) => {
  const id = c.env.SCANNER.idFromName("singleton");
  const scanner = await c.env.SCANNER.get(id)
    .fetch("https://internal/health")
    .then((r) => r.json())
    .catch(() => ({}));

  const mode =
    (await c.env.CACHE.get("orchestrator:mode")) ?? c.env.EXECUTION_MODE;

  return c.json({
    ok: true,
    mode,
    scanner,
    features: {
      clerk: Boolean(c.env.CLERK_SECRET_KEY),
      paystack: Boolean(c.env.PAYSTACK_SECRET_KEY),
      bayse: Boolean(c.env.BAYSE_PUBLIC_API_KEY),
    },
  });
});
