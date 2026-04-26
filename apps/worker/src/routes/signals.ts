import { Hono } from "hono";
import type { Env } from "../env";

export const signals = new Hono<{ Bindings: Env }>();

signals.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM signals ORDER BY created_at DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return c.json({ signals: rows.results });
});

signals.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM signals WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});
