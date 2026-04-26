import Anthropic from "@anthropic-ai/sdk";
import type {
  AlphaSignal,
  MarketSnapshot,
  PortfolioState,
  RiskDecisionResult,
} from "@skim/shared";
import type { Env } from "../env";
import { RISK_SYSTEM_PROMPT, SUBMIT_DECISION_TOOL } from "../prompts/risk";

const RISK_MODEL = "claude-opus-4-7";

function strategyConfig(env: Env) {
  return {
    max_notional_per_market_usd: Number(env.MAX_NOTIONAL_PER_MARKET_USD),
    max_total_exposure_usd: Number(env.MAX_TOTAL_EXPOSURE_USD),
    max_open_positions: 10,
    min_arb_margin_pct: 0.032,
    execution_mode: env.EXECUTION_MODE,
  };
}

function buildUserMessage(
  signalId: string,
  signal: AlphaSignal,
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  env: Env,
): string {
  return [
    "Validate this Alpha signal against hard limits and soft checks.",
    "",
    `<signal_id>${signalId}</signal_id>`,
    "",
    "<alpha_signal>",
    JSON.stringify(signal, null, 2),
    "</alpha_signal>",
    "",
    "<source_snapshot>",
    JSON.stringify(snapshot, null, 2),
    "</source_snapshot>",
    "",
    "<portfolio_state>",
    JSON.stringify(portfolio, null, 2),
    "</portfolio_state>",
    "",
    "<strategy_config>",
    JSON.stringify(strategyConfig(env), null, 2),
    "</strategy_config>",
    "",
    "Use your thinking block to apply hard limits first, then soft checks, with numeric work. You MUST always call submit_decision with your verdict — do not respond in plain text.",
  ].join("\n");
}

export interface RiskRunResult {
  decision: RiskDecisionResult;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  latency_ms: number;
  thinking_text: string;
}

export async function runRisk(
  env: Env,
  signalId: string,
  signal: AlphaSignal,
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  onReasoningChunk?: (chunk: string) => void | Promise<void>,
): Promise<RiskRunResult> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const start = Date.now();

  const stream = anthropic.messages.stream({
    model: RISK_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: RISK_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SUBMIT_DECISION_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: buildUserMessage(signalId, signal, snapshot, portfolio, env),
      },
    ],
  } as unknown as Anthropic.MessageStreamParams);

  // Opus 4.7: thinking block is redacted; stream `text_delta` for visible reasoning.
  let visibleReasoning = "";

  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    const delta = event.delta as { type: string; text?: string };
    if (delta.type === "text_delta" && delta.text) {
      visibleReasoning += delta.text;
      if (onReasoningChunk) {
        try {
          await onReasoningChunk(delta.text);
        } catch {
          /* broadcast errors shouldn't kill the run */
        }
      }
    }
  }

  const final = await stream.finalMessage();
  const toolUse = final.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `risk_no_tool_use: stop_reason=${final.stop_reason} content=${final.content.map((c) => c.type).join(",")}`,
    );
  }

  return {
    decision: toolUse.input as RiskDecisionResult,
    usage: {
      input_tokens: final.usage.input_tokens,
      output_tokens: final.usage.output_tokens,
      cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
    },
    latency_ms: Date.now() - start,
    thinking_text: visibleReasoning,
  };
}
