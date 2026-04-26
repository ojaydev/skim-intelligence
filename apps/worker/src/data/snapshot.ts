import type { MarketSnapshot } from "@skim/shared";
import type { Book, BookLevel, ParsedMarket } from "./polymarket";

/**
 * Taker fee estimate from YES mid-price. Polymarket zero-fee; Bayse tiered.
 * Source: skim-intelligence-build-brief.md §3.3.
 */
export function takerFeeRate(yesMidPrice: number): number {
  if (yesMidPrice >= 0.7 || yesMidPrice <= 0.3) return 0.03;
  if (yesMidPrice >= 0.5 || yesMidPrice <= 0.5) return 0.04;
  return 0.06;
}

/**
 * Top-of-book USD depth for the top N levels on one side.
 * `levels` must be passed in descending-priority order
 *   (best bid first, best ask first).
 */
function topDepthUsd(levels: BookLevel[], top = 5): number {
  let sum = 0;
  for (let i = 0; i < Math.min(top, levels.length); i++) {
    const lv = levels[i];
    if (!lv) continue;
    sum += Number(lv.price) * Number(lv.size);
  }
  return sum;
}

/**
 * Compute derived MarketSnapshot metrics from the two-sided CLOB state.
 * Books come in ascending-price order — we reverse bids to process descending.
 */
export function computeSnapshot(
  market: ParsedMarket,
  yesBook: Book,
  noBook: Book,
): MarketSnapshot {
  // Best bid = highest price in bids array (last entry when ascending)
  // Best ask = lowest price in asks array (first entry when ascending)
  const yesBestBid = Number(yesBook.bids.at(-1)?.price ?? 0);
  const yesBestAsk = Number(yesBook.asks[0]?.price ?? 1);
  const noBestBid = Number(noBook.bids.at(-1)?.price ?? 0);
  const noBestAsk = Number(noBook.asks[0]?.price ?? 1);

  const midPrice = yesBestBid + yesBestAsk > 0 ? (yesBestBid + yesBestAsk) / 2 : 0;
  const spreadPct = midPrice > 0 ? (yesBestAsk - yesBestBid) / midPrice : 0;

  const yesBidDepth = topDepthUsd(yesBook.bids.slice().reverse(), 5);
  const yesAskDepth = topDepthUsd(yesBook.asks, 5);
  const noBidDepth = topDepthUsd(noBook.bids.slice().reverse(), 5);
  const noAskDepth = topDepthUsd(noBook.asks, 5);

  const resolutionDays = market.end_date
    ? Math.max(
        0,
        (new Date(market.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : 999;

  const timestampMs = Math.max(
    Number(yesBook.timestamp) || 0,
    Number(noBook.timestamp) || 0,
  );
  const ageMs = timestampMs ? Date.now() - timestampMs : 0;

  const dataQuality: MarketSnapshot["data_quality"] =
    ageMs < 60_000 ? "fresh" : ageMs < 300_000 ? "stale" : "dead";

  return {
    market_id: market.conditionId,
    title: market.title,
    category: market.category,

    best_bid: yesBestBid,
    best_ask: yesBestAsk,
    yes_bid_depth_usd: yesBidDepth,
    yes_ask_depth_usd: yesAskDepth,
    no_bid_depth_usd: noBidDepth,
    no_ask_depth_usd: noAskDepth,

    mid_price: midPrice,
    spread_pct: spreadPct,
    // mint-arb check: complement_sum > 1 + fees → sell both sides profitable
    complement_sum: yesBestAsk + noBestAsk,
    // burn-arb check: complement_diff > fees → buy both sides profitable
    complement_diff: 1 - (yesBestBid + noBestBid),

    resolution_days: resolutionDays,
    volume_24h_usd: market.volume_24h_usd,
    taker_fee_rate: takerFeeRate(midPrice),

    // Polymarket doesn't expose reward-pool metadata — will populate from Bayse.
    reward_pool_remaining_usd: 0,
    reward_epoch_end: "",
    two_sided_eligible: false,
    estimated_reward_yield: 0,

    snapshot_age_ms: ageMs,
    data_quality: dataQuality,
    fetched_at: new Date(timestampMs || Date.now()).toISOString(),
  };
}
