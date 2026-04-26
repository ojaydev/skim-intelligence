import { Hono } from "hono";
import type { Env } from "../env";

export const portfolio = new Hono<{ Bindings: Env }>();

portfolio.get("/", async (c) => {
  const positionsRes = await c.env.DB.prepare(
    `SELECT market_id, yes_notional_usd, no_notional_usd,
            unrealized_pnl_usd, realized_pnl_usd, updated_at
     FROM paper_positions ORDER BY updated_at DESC`,
  ).all<{
    market_id: string;
    yes_notional_usd: number;
    no_notional_usd: number;
    unrealized_pnl_usd: number;
    realized_pnl_usd: number;
    updated_at: string;
  }>();
  const positions = positionsRes.results;

  const fillRes = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(fee_usd), 0) AS fees_total
     FROM paper_fills`,
  ).first<{ count: number; fees_total: number }>();

  let totalExposure = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  for (const p of positions) {
    totalExposure += Math.max(p.yes_notional_usd, p.no_notional_usd);
    realizedPnl += p.realized_pnl_usd;
    unrealizedPnl += p.unrealized_pnl_usd;
  }

  const cashCap = Number(c.env.MAX_TOTAL_EXPOSURE_USD);
  const lossLimit = Number(c.env.DAILY_LOSS_LIMIT_USD);
  const netPnl = realizedPnl + unrealizedPnl;

  return c.json({
    current_positions: positions.map((p) => ({
      market_id: p.market_id,
      yes_notional_usd: p.yes_notional_usd,
      no_notional_usd: p.no_notional_usd,
      unrealized_pnl_usd: p.unrealized_pnl_usd,
      realized_pnl_usd: p.realized_pnl_usd,
      updated_at: p.updated_at,
    })),
    total_exposure_usd: totalExposure,
    cash_available_usd: Math.max(0, cashCap - totalExposure),
    daily_pnl_usd: netPnl,
    daily_loss_limit_usd: lossLimit,
    loss_limit_remaining_usd: Math.max(0, lossLimit + Math.min(0, netPnl)),
    realized_pnl_usd: realizedPnl,
    unrealized_pnl_usd: unrealizedPnl,
    total_fills: fillRes?.count ?? 0,
    total_fees_usd: fillRes?.fees_total ?? 0,
  });
});
