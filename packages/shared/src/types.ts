// ═════════════════════════════════════════════════════════════════════════
// Skim Intelligence — shared types (worker + web)
// ═════════════════════════════════════════════════════════════════════════

export type ExecutionMode = "observe" | "paper" | "live_limited" | "live";
export type DataQuality = "fresh" | "stale" | "dead";
export type Recommendation = "enter" | "observe" | "skip" | "pause_all";
export type RiskDecision = "approved" | "modified" | "rejected";
export type Confidence = "high" | "medium" | "low" | "none";

// ─── Market snapshot (Scanner output) ───

export interface MarketSnapshot {
  market_id: string;
  title: string;
  category: string;

  // Orderbook state (YES side prices; NO prices derivable as 1 - YES)
  best_bid: number;
  best_ask: number;
  yes_bid_depth_usd: number;
  yes_ask_depth_usd: number;
  no_bid_depth_usd: number;
  no_ask_depth_usd: number;

  // Derived metrics
  mid_price: number;
  spread_pct: number;
  complement_sum: number;   // best_yes_ask + best_no_ask (arb check)
  complement_diff: number;  // 1.00 - (best_yes_bid + best_no_bid)

  // Market context
  resolution_days: number;
  volume_24h_usd: number;
  taker_fee_rate: number;

  // Reward state
  reward_pool_remaining_usd: number;
  reward_epoch_end: string;
  two_sided_eligible: boolean;
  estimated_reward_yield: number;

  // Data quality
  snapshot_age_ms: number;
  data_quality: DataQuality;
  fetched_at: string;
}

// ─── Alpha Agent signal ───

export interface AlphaSignal {
  market_id: string;
  timestamp: string;
  thinking: string;
  opportunity_score: number;
  strategies: {
    mint_burn: {
      active: boolean;
      type: "mint" | "burn" | null;
      gross_margin_pct: number;
      net_margin_pct: number;
      max_notional_usd: number;
      confidence: Confidence;
    };
    market_making: {
      active: boolean;
      bid_price: number | null;
      ask_price: number | null;
      target_spread_pct: number;
      max_notional_per_side_usd: number;
      confidence: Confidence;
    };
    reward_farming: {
      active: boolean;
      incremental_yield_pct: number;
      qualification_status: "eligible" | "ineligible" | "unknown";
    };
  };
  risk_flags: string[];
  recommendation: Recommendation;
  reasoning_summary: string;
}

// ─── Risk Agent decision ───

export interface RiskDecisionResult {
  signal_id: string;
  decision: RiskDecision;
  reason: string;
  modifications: {
    max_notional_usd: number | null;
    bid_price: number | null;
    ask_price: number | null;
  } | null;
  hard_limit_triggered: string | null;
  risk_notes: string[];
}

// ─── Portfolio state ───

export interface Position {
  market_id: string;
  yes_notional_usd: number;
  no_notional_usd: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number;
  updated_at: string;
}

export interface PortfolioState {
  current_positions: Position[];
  total_exposure_usd: number;
  cash_available_usd: number;
  daily_pnl_usd: number;
  daily_loss_limit_usd: number;
  loss_limit_remaining_usd: number;
}

// ─── Epoch report (Reporter output) ───

export interface EpochReport {
  epoch_id: string;
  period_start: string;
  period_end: string;
  headline: string;
  attribution: {
    spread_capture_usd: number;
    reward_income_usd: number;
    arb_profit_usd: number;
    fees_paid_usd: number;
    net_usd: number;
    net_pct_of_deployed: number;
  };
  top_markets: Array<{
    market_id: string;
    title: string;
    strategy: string;
    contribution_usd: number;
  }>;
  risk_events: string[];
  narrative: string;
  share_card_data: {
    headline_number: string;
    subline: string;
    period_label: string;
  };
}

// ─── Real-time feed events (WS /api/ws) ───

export type FeedEvent =
  | { type: "signal"; data: AlphaSignal }
  | { type: "risk_decision"; data: RiskDecisionResult }
  | { type: "fill"; data: FillEvent }
  | { type: "epoch_close"; data: EpochReport }
  | { type: "agent_status"; data: AgentStatusEvent }
  | { type: "heartbeat"; data: { ts: string } }
  | {
      type: "reasoning_chunk";
      data: {
        market_id: string;
        market_title: string;
        chunk: string;
        phase: "thinking" | "risk" | "summary";
        done?: boolean;
      };
    }
  | {
      type: "agent_usage";
      data: {
        agent: "alpha" | "risk" | "reporter";
        model: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number;
        cache_creation_input_tokens: number;
        latency_ms: number;
      };
    };

export interface FillEvent {
  fill_id: string;
  market_id: string;
  side: "yes" | "no";
  strategy: "mint_burn" | "market_making" | "reward_farming";
  fill_price: number;
  fill_notional_usd: number;
  fee_usd: number;
  filled_at: string;
}

export interface AgentStatusEvent {
  agent: "scanner" | "alpha" | "risk" | "execution" | "reporter";
  state: "running" | "idle" | "busy" | "paused" | "error";
  last_action: string;
  at: string;
}
