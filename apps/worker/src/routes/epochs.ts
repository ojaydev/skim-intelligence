import { Hono } from "hono";
import type { Env } from "../env";

export const epochs = new Hono<{ Bindings: Env }>();

epochs.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, epoch_start, epoch_end, headline, narrative,
            net_pnl_usd, attribution_json, top_markets_json, share_card_json, created_at
       FROM epoch_reports ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({
    epochs: rows.results.map((r) => ({
      ...r,
      attribution: tryParse(r.attribution_json as string),
      top_markets: tryParse(r.top_markets_json as string),
      share_card: tryParse(r.share_card_json as string),
    })),
  });
});

epochs.get("/latest", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM epoch_reports ORDER BY created_at DESC LIMIT 1`,
  ).first();
  if (!row) return c.json({ epoch: null });
  return c.json({
    epoch: {
      ...row,
      attribution: tryParse(row.attribution_json as string),
      top_markets: tryParse(row.top_markets_json as string),
      share_card: tryParse(row.share_card_json as string),
    },
  });
});

function tryParse(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
