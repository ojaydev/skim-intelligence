import type {
  AlphaSignal,
  FillEvent,
  MarketSnapshot,
  RiskDecisionResult,
} from "@skim/shared";
import type { Env } from "../env";

/**
 * Execution Agent — deterministic paper trading state machine.
 *
 * Reads approved Risk decisions, simulates orders + fills against the live
 * orderbook snapshot, persists to D1, returns fill events for broadcast.
 *
 * Fill model (brief §3.5):
 *   - Market making (resting, maker): p_fill = min(volume_24h / (depth*48), 0.85)
 *   - Arb (aggressive, taker):        p_fill = 0.95 at top-of-book, 0.60 at level 2
 *   - Maker fee = 0, taker fee = taker_fee_rate × notional
 *   - Taker slippage = ±0.2%
 *
 * Negative-EV guards (defence-in-depth — independent of Alpha/Risk):
 *   - Mint/burn skipped unless gross edge clears 2× taker fee + 2× slippage
 *     plus a 50bp safety margin.
 *   - Market making skipped unless quoted spread is ≥ 50bp of mid (one-sided
 *     fills bleed inventory below this threshold).
 */
const MIN_ARB_NET_EDGE = 0.005; // 50bp safety margin above fees+slippage
const MIN_MM_SPREAD_FRAC = 0.005; // 50bp minimum quoted spread
const TAKER_SLIPPAGE_RATE = 0.002;

export interface ExecutionRunResult {
  orders_created: number;
  fills_created: number;
  net_pnl_delta_usd: number;
  fill_events: FillEvent[];
}

interface CreatedOrder {
  id: string;
  market_id: string;
  strategy: "market_making" | "mint_burn" | "reward_farming";
  side: "yes_bid" | "yes_ask" | "no_bid" | "no_ask";
  price: number;
  notional_usd: number;
  status: "open" | "filled" | "cancelled";
}

interface CreatedFill {
  id: string;
  order_id: string;
  market_id: string;
  side: "yes" | "no";
  strategy: CreatedOrder["strategy"];
  fill_price: number;
  fill_notional_usd: number;
  fee_usd: number;
  slippage_usd: number;
  filled_at: string;
}

function marketMakingFillProbability(
  volumeUsd24h: number,
  depthUsd: number,
): number {
  if (depthUsd <= 0) return 0;
  return Math.min(volumeUsd24h / (depthUsd * 48), 0.85);
}

export async function runExecution(
  env: Env,
  signalId: string,
  riskDecisionId: string,
  signal: AlphaSignal,
  decision: RiskDecisionResult,
  snapshot: MarketSnapshot,
): Promise<ExecutionRunResult> {
  if (decision.decision === "rejected") {
    return { orders_created: 0, fills_created: 0, net_pnl_delta_usd: 0, fill_events: [] };
  }
  if (env.EXECUTION_MODE === "observe") {
    return { orders_created: 0, fills_created: 0, net_pnl_delta_usd: 0, fill_events: [] };
  }

  const modNotional = decision.modifications?.max_notional_usd;
  const orders: CreatedOrder[] = [];
  const fills: CreatedFill[] = [];
  const fillEvents: FillEvent[] = [];
  let netPnlDelta = 0;

  // ── Strategy 1: Mint/Burn Arb (taker, two legs) ──────────────────────
  const mb = signal.strategies.mint_burn;
  if (mb.active && mb.type !== null) {
    const mbNotional = modNotional ?? mb.max_notional_usd;
    if (mbNotional > 0) {
      // BURN: buy YES at ask + NO at ask → redeem $1 on resolution.
      // MINT: mint for $1 → sell YES at bid + NO at bid.
      const yesPrice =
        mb.type === "burn" ? snapshot.best_ask : snapshot.best_bid;
      const noPrice =
        mb.type === "burn"
          ? 1 - snapshot.best_bid // approximate NO ask from complement
          : 1 - snapshot.best_ask; // approximate NO bid

      // Guard: skip when expected net edge after fees+slippage is too small
      // to be worth the execution risk. Keeps Alpha/Risk false-positives from
      // bleeding the paper P&L on marginal opportunities.
      const grossEdge =
        mb.type === "burn"
          ? 1 - (yesPrice + noPrice)
          : (yesPrice + noPrice) - 1;
      const minEdge =
        2 * snapshot.taker_fee_rate + 2 * TAKER_SLIPPAGE_RATE + MIN_ARB_NET_EDGE;
      if (grossEdge < minEdge) {
        console.log(
          `execution: skip mint_burn ${signal.market_id} — gross_edge=${grossEdge.toFixed(4)} < min=${minEdge.toFixed(4)}`,
        );
        // Fall through to MM strategy below; do not place arb orders.
      } else {
      const yesOrder = createOrder(
        signal.market_id,
        "mint_burn",
        mb.type === "burn" ? "yes_ask" : "yes_bid",
        yesPrice,
        mbNotional / 2,
      );
      const noOrder = createOrder(
        signal.market_id,
        "mint_burn",
        mb.type === "burn" ? "no_ask" : "no_bid",
        noPrice,
        mbNotional / 2,
      );
      orders.push(yesOrder, noOrder);

      // Top-of-book arb: 95% fill rate
      for (const [ord, tokenSide] of [
        [yesOrder, "yes"],
        [noOrder, "no"],
      ] as const) {
        if (Math.random() < 0.95) {
          const fee = snapshot.taker_fee_rate * ord.notional_usd;
          const slip = ord.notional_usd * 0.002;
          const f = createFill(
            ord,
            tokenSide,
            ord.price,
            fee,
            slip,
          );
          fills.push(f);
          ord.status = "filled";
          fillEvents.push(toFillEvent(f));
        }
      }

      // Arb realised P&L: 1.00 - (yes_leg + no_leg) - fees
      const yesFilled = fills.find(
        (f) => f.order_id === yesOrder.id,
      );
      const noFilled = fills.find((f) => f.order_id === noOrder.id);
      if (yesFilled && noFilled) {
        // Per-pair edge in $; multiply by number of pairs purchased (notional ÷ avg leg price)
        const avgLegPrice =
          (yesFilled.fill_price + noFilled.fill_price) / 2;
        const pairs = avgLegPrice > 0 ? (mbNotional / 2) / avgLegPrice : 0;
        const grossPnl =
          mb.type === "burn"
            ? pairs * (1 - (yesFilled.fill_price + noFilled.fill_price))
            : pairs * ((yesFilled.fill_price + noFilled.fill_price) - 1);
        const totalCost =
          yesFilled.fee_usd +
          noFilled.fee_usd +
          yesFilled.slippage_usd +
          noFilled.slippage_usd;
        netPnlDelta += grossPnl - totalCost;
      }
      } // end else (grossEdge >= minEdge)
    }
  }

  // ── Strategy 2: Market Making (maker, two legs) ──────────────────────
  const mm = signal.strategies.market_making;
  if (mm.active && mm.bid_price !== null && mm.ask_price !== null) {
    const bidPrice = decision.modifications?.bid_price ?? mm.bid_price;
    const askPrice = decision.modifications?.ask_price ?? mm.ask_price;
    const mmNotional = modNotional ?? mm.max_notional_per_side_usd;

    // Guard: skip when quoted spread is too narrow — one-sided fills bleed
    // inventory faster than spread capture can recoup at sub-50bp spreads.
    const mid = (bidPrice + askPrice) / 2;
    const spreadFrac = mid > 0 ? (askPrice - bidPrice) / mid : 0;
    const mmAllowed = spreadFrac >= MIN_MM_SPREAD_FRAC;
    if (!mmAllowed) {
      console.log(
        `execution: skip market_making ${signal.market_id} — spread_frac=${spreadFrac.toFixed(4)} < min=${MIN_MM_SPREAD_FRAC}`,
      );
    }

    if (mmAllowed && mmNotional > 0 && bidPrice !== null && askPrice !== null) {
      const bidOrder = createOrder(
        signal.market_id,
        "market_making",
        "yes_bid",
        bidPrice,
        mmNotional,
      );
      const askOrder = createOrder(
        signal.market_id,
        "market_making",
        "yes_ask",
        askPrice,
        mmNotional,
      );
      orders.push(bidOrder, askOrder);

      // Fill probability per leg from brief §3.5
      const bidFillP = marketMakingFillProbability(
        snapshot.volume_24h_usd,
        snapshot.yes_bid_depth_usd,
      );
      const askFillP = marketMakingFillProbability(
        snapshot.volume_24h_usd,
        snapshot.yes_ask_depth_usd,
      );

      if (Math.random() < bidFillP) {
        const f = createFill(bidOrder, "yes", bidPrice, 0, 0);
        fills.push(f);
        bidOrder.status = "filled";
        fillEvents.push(toFillEvent(f));
      }
      if (Math.random() < askFillP) {
        const f = createFill(askOrder, "yes", askPrice, 0, 0);
        fills.push(f);
        askOrder.status = "filled";
        fillEvents.push(toFillEvent(f));
      }

      // Spread capture when both legs filled
      const bidFilled = fills.find((f) => f.order_id === bidOrder.id);
      const askFilled = fills.find((f) => f.order_id === askOrder.id);
      if (bidFilled && askFilled) {
        netPnlDelta += (askPrice - bidPrice) * mmNotional;
      }
    }
  }

  // ── Persist everything in one batch ──────────────────────────────────
  await persistOrders(env, signalId, riskDecisionId, orders);
  await persistFills(env, fills);
  await updatePositions(env, signal.market_id, fills);

  return {
    orders_created: orders.length,
    fills_created: fills.length,
    net_pnl_delta_usd: netPnlDelta,
    fill_events: fillEvents,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function createOrder(
  marketId: string,
  strategy: CreatedOrder["strategy"],
  side: CreatedOrder["side"],
  price: number,
  notional: number,
): CreatedOrder {
  return {
    id: crypto.randomUUID(),
    market_id: marketId,
    strategy,
    side,
    price,
    notional_usd: notional,
    status: "open",
  };
}

function createFill(
  order: CreatedOrder,
  tokenSide: "yes" | "no",
  fillPrice: number,
  fee: number,
  slippage: number,
): CreatedFill {
  return {
    id: crypto.randomUUID(),
    order_id: order.id,
    market_id: order.market_id,
    side: tokenSide,
    strategy: order.strategy,
    fill_price: fillPrice,
    fill_notional_usd: order.notional_usd,
    fee_usd: fee,
    slippage_usd: slippage,
    filled_at: new Date().toISOString(),
  };
}

function toFillEvent(f: CreatedFill): FillEvent {
  return {
    fill_id: f.id,
    market_id: f.market_id,
    side: f.side,
    strategy: f.strategy,
    fill_price: f.fill_price,
    fill_notional_usd: f.fill_notional_usd,
    fee_usd: f.fee_usd,
    filled_at: f.filled_at,
  };
}

async function persistOrders(
  env: Env,
  signalId: string,
  riskDecisionId: string,
  orders: CreatedOrder[],
): Promise<void> {
  if (orders.length === 0) return;
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT INTO paper_orders
      (id, signal_id, risk_decision_id, market_id, strategy, side, price, notional_usd, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(
    orders.map((o) =>
      stmt.bind(
        o.id,
        signalId,
        riskDecisionId,
        o.market_id,
        o.strategy,
        o.side,
        o.price,
        o.notional_usd,
        o.status,
        now,
        now,
      ),
    ),
  );
}

async function persistFills(
  env: Env,
  fills: CreatedFill[],
): Promise<void> {
  if (fills.length === 0) return;
  const stmt = env.DB.prepare(
    `INSERT INTO paper_fills
      (id, order_id, fill_price, fill_notional_usd, fee_usd, slippage_usd, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(
    fills.map((f) =>
      stmt.bind(
        f.id,
        f.order_id,
        f.fill_price,
        f.fill_notional_usd,
        f.fee_usd,
        f.slippage_usd,
        f.filled_at,
      ),
    ),
  );
}

async function updatePositions(
  env: Env,
  marketId: string,
  fills: CreatedFill[],
): Promise<void> {
  if (fills.length === 0) return;
  let yesDelta = 0;
  let noDelta = 0;
  let realizedDelta = 0;
  for (const f of fills) {
    const delta = f.fill_notional_usd;
    if (f.side === "yes") yesDelta += delta;
    else noDelta += delta;
    realizedDelta -= f.fee_usd + f.slippage_usd;
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM paper_positions WHERE market_id = ?",
  )
    .bind(marketId)
    .first<{
      id: string;
      yes_notional_usd: number;
      no_notional_usd: number;
      realized_pnl_usd: number;
    }>();

  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare(
      `UPDATE paper_positions
         SET yes_notional_usd = ?, no_notional_usd = ?,
             realized_pnl_usd = ?, updated_at = ?
       WHERE market_id = ?`,
    )
      .bind(
        existing.yes_notional_usd + yesDelta,
        existing.no_notional_usd + noDelta,
        existing.realized_pnl_usd + realizedDelta,
        now,
        marketId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO paper_positions
        (id, market_id, yes_notional_usd, no_notional_usd, unrealized_pnl_usd, realized_pnl_usd, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        marketId,
        yesDelta,
        noDelta,
        realizedDelta,
        now,
      )
      .run();
  }
}
