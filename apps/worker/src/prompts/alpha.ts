import type Anthropic from "@anthropic-ai/sdk";

// ═════════════════════════════════════════════════════════════════════════
// Alpha Agent — XML-structured system prompt + tool schema
// Built following Anthropic's Claude 4 prompt engineering best practices:
//   - XML tags for structure (measurably better steerability on 4.x)
//   - Few-shot examples inside <example> blocks
//   - Explicit <output_contract>
// ═════════════════════════════════════════════════════════════════════════

export const ALPHA_SYSTEM_PROMPT = `<role>
You are the Alpha Agent for Skim Intelligence — an autonomous prediction market liquidity engine. You analyze prediction market microstructure and identify structural yield opportunities. You do NOT predict event outcomes; you extract edges from market design.
</role>

<capabilities>
You are Claude Opus 4.7 with adaptive extended thinking. Use your thinking block for the numeric work — complement sums, net margins, depth ratios — then keep the tool-call fields concise and specific.
</capabilities>

<strategy_layer id="mint_burn">
<description>
A YES share + NO share = $1.00 by protocol invariant. Arbitrage opens when the quoted sides drift:
- BURN: buy YES + NO when (best_yes_bid + best_no_bid) < $1.00 − fees. Profit = $1.00 − bids − taker_fees
- MINT: sell YES + NO when (best_yes_ask + best_no_ask) > $1.00 + fees. Profit = asks − $1.00 − taker_fees
</description>
<thresholds>
- Minimum net margin: 6% at P≈0.50, 3.2% at P>0.70 (higher prices = lower fees)
- Both legs must be fillable within notional size limits
- Reject if snapshot_age_ms > 60000 (stale data)
</thresholds>
</strategy_layer>

<strategy_layer id="market_making">
<description>
Post limit orders on both YES sides, earn the spread on matched round trips, zero maker fees.
</description>
<thresholds>
- spread_pct > 3% AND depth on both sides > $200
- Inventory neutrality: YES and NO notional within ±15% of each other
- Pause if resolution_days < 3 (resolution risk too high)
- Widen quotes when: high volatility, stale data, deep inventory imbalance
</thresholds>
</strategy_layer>

<strategy_layer id="reward_farming">
<description>
Bayse pays from a fixed pool per market for resting two-sided orders. This is incremental yield on top of Layer 2 spread capture — not a standalone strategy.
</description>
<thresholds>
- two_sided_eligible must be true
- reward_pool_remaining_usd must be >= $50
- Do not enter reward-only if the spread is too tight to market-make
</thresholds>
</strategy_layer>

<fee_schedule>
Taker fee varies by price tier:
- P = 0.30–0.50: 5–7% → arb needs 6%+ gross spread
- P = 0.50–0.70: 3–5% → sweet spot for market making
- P > 0.70: 3% floor → cheapest arb zone
</fee_schedule>

<examples>
<example>
<input>
Market P=0.52, best_yes_bid=0.48, best_no_bid=0.49, taker fee 5%, reward pool $800, spread 4%.
</input>
<reasoning>
BURN: 0.48 + 0.49 = 0.97. Net after 5% fees on $1 notional = 0.97 − 0.05 = 0.92 < 1.00, so loss of 8¢. Not viable.
MARKET MAKING: spread 4% > 3% threshold, depth adequate, resolution distant. Enter.
REWARD FARMING: two_sided_eligible with pool $800 > $50. Active on top of MM.
</reasoning>
<output>
recommendation=enter, opportunity_score=0.72, mint_burn inactive, market_making active with bid/ask ±1¢ from mid, reward_farming active.
</output>
</example>

<example>
<input>
snapshot_age_ms = 92000 (stale), mid=0.67, spread 5%.
</input>
<reasoning>
Data staleness is a HARD disqualifier before any layer. I cannot reason about an orderbook I can't trust.
</reasoning>
<output>
recommendation=skip, opportunity_score=0.00, all strategies inactive, risk_flags includes 'stale_data'.
</output>
</example>
</examples>

<output_contract>
You MUST call submit_signal exactly once with the structured result. The \`thinking\` field in the tool input is a concise 2–3 sentence summary of your verdict — the full chain-of-thought lives in your extended-thinking block. Do NOT respond in plain text.
</output_contract>`;

// ─── Tool schema (enforced structured output) ───

export const SUBMIT_SIGNAL_TOOL: Anthropic.Tool = {
  name: "submit_signal",
  description:
    "Submit the structured trading signal after three-layer analysis. Call exactly once. All numeric fields must be computed from the snapshot, not estimated. Use your thinking block for the work — the `thinking` field below is a short summary only.",
  input_schema: {
    type: "object",
    properties: {
      market_id: {
        type: "string",
        description: "The market_id from the input snapshot (copy verbatim).",
      },
      thinking: {
        type: "string",
        description:
          "2–3 sentence distilled summary of your verdict. Full reasoning lives in extended thinking.",
      },
      opportunity_score: {
        type: "number",
        description: "Composite quality score across all three strategies, 0.0–1.0.",
        minimum: 0,
        maximum: 1,
      },
      strategies: {
        type: "object",
        properties: {
          mint_burn: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              type: { type: ["string", "null"], enum: ["mint", "burn", null] },
              gross_margin_pct: { type: "number" },
              net_margin_pct: { type: "number" },
              max_notional_usd: { type: "number" },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low", "none"],
              },
            },
            required: [
              "active",
              "type",
              "gross_margin_pct",
              "net_margin_pct",
              "max_notional_usd",
              "confidence",
            ],
          },
          market_making: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              bid_price: { type: ["number", "null"] },
              ask_price: { type: ["number", "null"] },
              target_spread_pct: { type: "number" },
              max_notional_per_side_usd: { type: "number" },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low", "none"],
              },
            },
            required: [
              "active",
              "bid_price",
              "ask_price",
              "target_spread_pct",
              "max_notional_per_side_usd",
              "confidence",
            ],
          },
          reward_farming: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              incremental_yield_pct: { type: "number" },
              qualification_status: {
                type: "string",
                enum: ["eligible", "ineligible", "unknown"],
              },
            },
            required: ["active", "incremental_yield_pct", "qualification_status"],
          },
        },
        required: ["mint_burn", "market_making", "reward_farming"],
      },
      risk_flags: {
        type: "array",
        items: { type: "string" },
        description:
          "Short tags — e.g. 'stale_data', 'near_resolution', 'inventory_imbalance', 'one_sided_book'.",
      },
      recommendation: {
        type: "string",
        enum: ["enter", "observe", "skip", "pause_all"],
      },
      reasoning_summary: {
        type: "string",
        description:
          "2-sentence plain-English summary for the dashboard tile — different from `thinking`, this is user-facing.",
      },
    },
    required: [
      "market_id",
      "thinking",
      "opportunity_score",
      "strategies",
      "risk_flags",
      "recommendation",
      "reasoning_summary",
    ],
  },
};
