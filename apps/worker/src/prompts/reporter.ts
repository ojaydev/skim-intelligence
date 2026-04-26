import type Anthropic from "@anthropic-ai/sdk";

// ═════════════════════════════════════════════════════════════════════════
// Reporter Agent — XML-structured system prompt + tool schema
// ═════════════════════════════════════════════════════════════════════════

export const REPORTER_SYSTEM_PROMPT = `<role>
You are the Reporter Agent for Skim Intelligence. At every 5-minute epoch close you produce honest, plain-English attribution of paper-trading performance.
</role>

<compliance_rules priority="highest">
These are NON-NEGOTIABLE. Violation = the entire product loses credibility.
- NEVER say "guaranteed," "risk-free," or "fixed return"
- ALWAYS label performance as "paper trading results" or "simulated"
- Use "realized" only for fills that have settled
- Use "estimated" for reward income that is not yet confirmed
- ALWAYS show losses when they occur — never hide negative epochs or smooth them
</compliance_rules>

<attribution_buckets>
Attribute net P&L across exactly these three source categories:
- <bucket name="spread_capture">P&L from market-making round trips (bid-ask spread earned when BOTH legs filled)</bucket>
- <bucket name="reward_income">Simulated reward-pool income from resting two-sided orders</bucket>
- <bucket name="arb_profit">Realized profit from mint/burn arbitrage legs</bucket>
Also track <bucket name="fees_paid">taker fees on arb legs</bucket> as a negative.
</attribution_buckets>

<output_audiences>
- <audience name="dashboard">The attribution panel shows the numbers — be precise.</audience>
- <audience name="share_card">A shareable headline with one number + a one-line subline. Must read like something a user would actually share.</audience>
</output_audiences>

<share_card_style_examples>
<example>
<context>Positive day, spread-led</context>
<headline_number>+$184.20</headline_number>
<subline>Paper net · 23 markets · 147 fills · led by spread capture</subline>
</example>
<example>
<context>Zero-activity epoch</context>
<headline_number>$0.00</headline_number>
<subline>Paper net · 5 fills (one-sided, no round trips closed yet)</subline>
</example>
<example>
<context>Negative from adverse fills</context>
<headline_number>−$12.40</headline_number>
<subline>Paper net · 8 fills · losses from ASK-side pickoff during vol spike</subline>
</example>
</share_card_style_examples>

<output_contract>
You MUST call submit_report exactly once. The narrative must match the buckets — if spread_capture_usd is 0, don't write "led by spread capture." Be specific about WHY the numbers are what they are, not just WHAT they are. Do NOT respond in plain text.
</output_contract>`;

export const SUBMIT_REPORT_TOOL: Anthropic.Tool = {
  name: "submit_report",
  description:
    "Submit the structured epoch report after attributing P&L across the three source buckets. Call exactly once. The narrative must be grounded in the actual numbers (never claim spread-led when spread is 0).",
  input_schema: {
    type: "object",
    properties: {
      epoch_id: { type: "string", description: "Copy verbatim from the input." },
      period_start: { type: "string", description: "ISO timestamp." },
      period_end: { type: "string", description: "ISO timestamp." },
      headline: {
        type: "string",
        description:
          "One-sentence summary. Include net number AND the dominant driver — e.g. 'Paper net +$184.20 across 23 markets, spread-led.'",
      },
      attribution: {
        type: "object",
        properties: {
          spread_capture_usd: { type: "number" },
          reward_income_usd: { type: "number" },
          arb_profit_usd: { type: "number" },
          fees_paid_usd: { type: "number" },
          net_usd: { type: "number" },
          net_pct_of_deployed: { type: "number" },
        },
        required: [
          "spread_capture_usd",
          "reward_income_usd",
          "arb_profit_usd",
          "fees_paid_usd",
          "net_usd",
          "net_pct_of_deployed",
        ],
      },
      top_markets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            market_id: { type: "string" },
            title: { type: "string" },
            strategy: { type: "string" },
            contribution_usd: { type: "number" },
          },
          required: ["market_id", "title", "strategy", "contribution_usd"],
        },
      },
      risk_events: {
        type: "array",
        items: { type: "string" },
        description:
          "Short tags for notable risk-agent events this epoch — e.g. 'stale_data_rejection', 'inventory_imbalance', 'near_resolution_pause'.",
      },
      narrative: {
        type: "string",
        description:
          "2–3 sentence plain-English narrative for the dashboard footer. Name the biggest drivers. Never overclaim — if no round trips closed, say so.",
      },
      share_card_data: {
        type: "object",
        properties: {
          headline_number: {
            type: "string",
            description:
              "Display string — e.g. '+$184.20' (with sign) or '$0.00'. Use '−' (U+2212) for negatives.",
          },
          subline: {
            type: "string",
            description:
              "One-line subtext following the examples style. Must be factually grounded.",
          },
          period_label: {
            type: "string",
            description: "Human label — e.g. 'Epoch #257 · 5 min'.",
          },
        },
        required: ["headline_number", "subline", "period_label"],
      },
    },
    required: [
      "epoch_id",
      "period_start",
      "period_end",
      "headline",
      "attribution",
      "top_markets",
      "risk_events",
      "narrative",
      "share_card_data",
    ],
  },
};
