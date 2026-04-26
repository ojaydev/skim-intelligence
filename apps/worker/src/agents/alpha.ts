import Anthropic from "@anthropic-ai/sdk";
import type {
  AlphaSignal,
  MarketSnapshot,
  PortfolioState,
} from "@skim/shared";
import type { Env } from "../env";
import { ALPHA_SYSTEM_PROMPT, SUBMIT_SIGNAL_TOOL } from "../prompts/alpha";
import { renderDepthPng } from "../data/depth-chart";

const ALPHA_MODEL = "claude-opus-4-7";

function strategyConfig(env: Env) {
  return {
    max_notional_per_market_usd: Number(env.MAX_NOTIONAL_PER_MARKET_USD),
    max_total_exposure_usd: Number(env.MAX_TOTAL_EXPOSURE_USD),
    max_open_positions: 10,
    min_arb_margin_pct: 0.032,
    execution_mode: env.EXECUTION_MODE,
  };
}

function buildUserMessageText(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  env: Env,
): string {
  return [
    "Analyze this prediction market for structural yield opportunities.",
    "",
    "The attached image shows the current YES/NO orderbook depth (green = YES, red = NO, cyan dashed line = mid). Use it to visually assess book shape and imbalance, then combine with the numeric snapshot below.",
    "",
    "<market_snapshot>",
    JSON.stringify(snapshot, null, 2),
    "</market_snapshot>",
    "",
    "<portfolio_state>",
    JSON.stringify(portfolio, null, 2),
    "</portfolio_state>",
    "",
    "<strategy_config>",
    JSON.stringify(strategyConfig(env), null, 2),
    "</strategy_config>",
    "",
    "Use your thinking block to work through all three strategy layers with explicit numbers. You MUST always call submit_signal with the structured result — do not respond with plain text.",
  ].join("\n");
}

export interface AlphaRunResult {
  signal: AlphaSignal;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  latency_ms: number;
  thinking_text: string;
}

/**
 * Run the Alpha Agent with native Opus 4.7 extended thinking (adaptive).
 * Streams `thinking_delta` events as Opus reasons, then calls submit_signal.
 *
 * Constraints (verified 2026-04-22):
 *   - Opus 4.7 requires `thinking.type: "adaptive"` (not "enabled")
 *   - Thinking is INCOMPATIBLE with forced tool_choice — must use "auto"
 *   - Our system prompt + user message instruct the model to always call
 *     submit_signal, which it reliably does
 */
export async function runAlpha(
  env: Env,
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  onReasoningChunk?: (
    chunk: string,
    phase: "thinking" | "summary",
  ) => void | Promise<void>,
): Promise<AlphaRunResult> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const start = Date.now();

  // Render the orderbook depth chart as a PNG and attach to the user turn.
  // This gives Opus 4.7 a visual affordance alongside the numeric snapshot,
  // so it can reason about book shape and imbalance directly.
  let imageBlock: Anthropic.ImageBlockParam | null = null;
  try {
    const png = await renderDepthPng(snapshot);
    imageBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: png.mime,
        data: png.base64,
      },
    };
  } catch (err) {
    console.warn("alpha: depth chart render failed, proceeding text-only", err);
  }

  const userText = buildUserMessageText(snapshot, portfolio, env);
  const userContent: Anthropic.ContentBlockParam[] = imageBlock
    ? [imageBlock, { type: "text", text: userText }]
    : [{ type: "text", text: userText }];

  const stream = anthropic.messages.stream({
    model: ALPHA_MODEL,
    max_tokens: 8192,
    // Opus 4.7: adaptive thinking (duration auto-decided by model based on task difficulty)
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [
      {
        type: "text",
        text: ALPHA_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SUBMIT_SIGNAL_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: userContent }],
  } as unknown as Anthropic.MessageStreamParams);

  // Opus 4.7 adaptive thinking emits three content blocks:
  //   1. `thinking` — redacted; only `signature_delta` streams (extended-
  //      thinking content is only in final.content.thinking)
  //   2. `text` — the model's visible reasoning, streams as `text_delta`
  //   3. `tool_use` — submit_signal call, streams as `input_json_delta`
  // We stream the text_delta block live (this IS the live reasoning).
  let visibleReasoning = "";

  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    const delta = event.delta as { type: string; text?: string };
    if (delta.type === "text_delta" && delta.text) {
      visibleReasoning += delta.text;
      if (onReasoningChunk) {
        try {
          await onReasoningChunk(delta.text, "thinking");
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
      `alpha_no_tool_use: stop_reason=${final.stop_reason} content_types=${final.content.map((c) => c.type).join(",")}`,
    );
  }

  // The private `thinking` block (internal chain-of-thought) is redacted but
  // available post-completion. Combine: visible reasoning + brief internal peek.
  const thinkingBlock = final.content.find((b) => b.type === "thinking") as
    | { thinking?: string }
    | undefined;
  const internalThinking = thinkingBlock?.thinking ?? "";

  const input = toolUse.input as Omit<AlphaSignal, "timestamp">;
  const signal: AlphaSignal = {
    ...input,
    timestamp: new Date().toISOString(),
    // Prefer visible reasoning (what streamed live); fall back to internal
    // thinking block; then to tool-field thinking.
    thinking:
      visibleReasoning || internalThinking || input.thinking,
  };

  return {
    signal,
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
