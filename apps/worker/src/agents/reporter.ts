import Anthropic from "@anthropic-ai/sdk";
import type { EpochReport } from "@skim/shared";
import type { Env } from "../env";
import { REPORTER_SYSTEM_PROMPT, SUBMIT_REPORT_TOOL } from "../prompts/reporter";

const REPORTER_MODEL = "claude-opus-4-7";

export interface EpochInput {
  epoch_id: string;
  period_start: string;
  period_end: string;
  fills: Array<{
    market_id: string;
    market_title: string;
    strategy: string;
    side: "yes" | "no";
    fill_price: number;
    fill_notional_usd: number;
    fee_usd: number;
    filled_at: string;
  }>;
  positions: Array<{
    market_id: string;
    market_title: string;
    yes_notional_usd: number;
    no_notional_usd: number;
    realized_pnl_usd: number;
  }>;
  risk_summary: {
    rejected: number;
    approved: number;
    modified: number;
  };
}

export interface ReporterRunResult {
  report: EpochReport;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  latency_ms: number;
}

export async function runReporter(
  env: Env,
  input: EpochInput,
): Promise<ReporterRunResult> {
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const start = Date.now();

  const userMessage = [
    `Generate the epoch attribution report for Skim Intelligence.`,
    ``,
    `EPOCH_ID: ${input.epoch_id}`,
    `PERIOD: ${input.period_start} → ${input.period_end}`,
    ``,
    `FILLS (${input.fills.length}):`,
    "```json",
    JSON.stringify(input.fills, null, 2),
    "```",
    ``,
    `POSITIONS (${input.positions.length} markets):`,
    "```json",
    JSON.stringify(input.positions, null, 2),
    "```",
    ``,
    `RISK_SUMMARY: approved=${input.risk_summary.approved} modified=${input.risk_summary.modified} rejected=${input.risk_summary.rejected}`,
    ``,
    `Attribute total P&L across spread capture, liquidity rewards, arb profit, and fees paid. Honest accounting — show losses if they exist. Call submit_report.`,
  ].join("\n");

  const response = await anthropic.messages.create({
    model: REPORTER_MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: REPORTER_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SUBMIT_REPORT_TOOL],
    tool_choice: { type: "tool", name: "submit_report" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `reporter_no_tool_use: stop=${response.stop_reason}`,
    );
  }

  // Opus occasionally double-wraps the tool input in a `report` key.
  // Unwrap if the inner object matches the EpochReport shape.
  const rawInput = toolUse.input as
    | EpochReport
    | { report?: EpochReport };
  const report: EpochReport =
    "report" in rawInput && rawInput.report && "attribution" in rawInput.report
      ? rawInput.report
      : (rawInput as EpochReport);

  return {
    report,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
    },
    latency_ms: Date.now() - start,
  };
}
