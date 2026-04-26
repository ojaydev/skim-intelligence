import type {
  AlphaSignal,
  FeedEvent,
  MarketSnapshot,
  PortfolioState,
  RiskDecisionResult,
} from "@skim/shared";
import { runAlpha } from "./agents/alpha";
import { runExecution } from "./agents/execution";
import { runReporter, type EpochInput } from "./agents/reporter";
import { runRisk } from "./agents/risk";
import type { EpochReport } from "@skim/shared";
import type { Env } from "./env";

/**
 * Orchestrator Durable Object.
 *
 * Holds dashboard WS clients via Hibernation API, runs Alpha Agent on
 * demand, persists signals to D1, and broadcasts FeedEvents to all
 * connected clients.
 */
export class OrchestratorDO implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/ws":
        return this.acceptClient(request);
      case "/broadcast":
        return this.broadcast(await request.json<FeedEvent>());
      case "/run-alpha":
        return this.runAlphaOnMarket(
          await request.json<{ market_id: string }>(),
        );
      case "/run-risk":
        return this.runRiskOnSignal(
          await request.json<{ signal_id: string }>(),
        );
      case "/test-execute":
        return this.testExecute(
          await request.json<{ signal_id: string }>(),
        );
      case "/epoch-close":
        return this.runEpochClose();
      case "/process-batch":
        return this.processBatch(await request.json<unknown>());
      case "/start-cycle":
        return this.startCycle();
      case "/stop-cycle":
        return this.stopCycle();
      case "/cycle-status":
        return this.cycleStatus();
      default:
        return new Response("not_found", { status: 404 });
    }
  }

  // ─── Auto-orchestration cycle ───────────────────────────────────────
  // Alarm-driven loop: every CYCLE_INTERVAL_MS, pick up to MAX_PARALLEL_ALPHA
  // fresh markets, run Alpha in parallel, chain Risk → Execution per brief.
  // Rate-limited 1 Alpha call per market per ALPHA_COOLDOWN_MS (brief §5.2).

  private static readonly CYCLE_INTERVAL_MS = 30_000;
  private static readonly MAX_PARALLEL_ALPHA = 3;
  private static readonly ALPHA_COOLDOWN_MS = 120_000;

  private async startCycle(): Promise<Response> {
    await this.ctx.storage.put("cycle:enabled", true);
    await this.ctx.storage.setAlarm(Date.now() + 1_000);
    return Response.json({ status: "started", interval_ms: OrchestratorDO.CYCLE_INTERVAL_MS });
  }

  private async stopCycle(): Promise<Response> {
    await this.ctx.storage.put("cycle:enabled", false);
    await this.ctx.storage.deleteAlarm();
    return Response.json({ status: "stopped" });
  }

  private async cycleStatus(): Promise<Response> {
    const enabled = (await this.ctx.storage.get<boolean>("cycle:enabled")) ?? false;
    const cyclesRun =
      (await this.ctx.storage.get<number>("cycle:count")) ?? 0;
    const lastRunAt =
      (await this.ctx.storage.get<number>("cycle:last")) ?? null;
    return Response.json({ enabled, cyclesRun, lastRunAt });
  }

  async alarm(): Promise<void> {
    const enabled = (await this.ctx.storage.get<boolean>("cycle:enabled")) ?? false;
    if (!enabled) return;

    const cycleCount =
      ((await this.ctx.storage.get<number>("cycle:count")) ?? 0) + 1;

    try {
      await this.runOrchestrationCycle();
    } catch (err) {
      console.error("orchestrator: cycle failed", err);
    }

    await this.ctx.storage.put("cycle:count", cycleCount);
    await this.ctx.storage.put("cycle:last", Date.now());
    // Epoch close is driven exclusively by the `scheduled()` cron in index.ts;
    // running it here as well would race (two inserts for the same period).
    await this.ctx.storage.setAlarm(
      Date.now() + OrchestratorDO.CYCLE_INTERVAL_MS,
    );
  }

  private async runOrchestrationCycle(): Promise<void> {
    // 1. Pull all market snapshots from KV
    const list = await this.env.CACHE.list({ prefix: "market:" });
    const snapshots: MarketSnapshot[] = [];
    for (const k of list.keys) {
      if (!k.name.endsWith(":snapshot")) continue;
      const snap = await this.env.CACHE.get<MarketSnapshot>(k.name, "json");
      if (snap) snapshots.push(snap);
    }
    if (snapshots.length === 0) return;

    // 2. Filter to actionable (fresh + real spread + real volume)
    const candidates = snapshots.filter(
      (s) =>
        s.data_quality === "fresh" &&
        s.spread_pct > 0.02 &&
        s.volume_24h_usd > 500 &&
        s.resolution_days > 3,
    );
    if (candidates.length === 0) return;

    // 3. Rate-limit via KV: drop markets we've hit inside cooldown
    const now = Date.now();
    const eligible: MarketSnapshot[] = [];
    for (const s of candidates) {
      const rateKey = `rate:alpha:${s.market_id}`;
      const last = await this.env.CACHE.get(rateKey);
      if (last && now - Number(last) < OrchestratorDO.ALPHA_COOLDOWN_MS) continue;
      eligible.push(s);
      if (eligible.length >= OrchestratorDO.MAX_PARALLEL_ALPHA) break;
    }
    if (eligible.length === 0) return;

    // 4. Mark as in-flight (write timestamp to rate key)
    for (const s of eligible) {
      await this.env.CACHE.put(`rate:alpha:${s.market_id}`, String(now), {
        expirationTtl: Math.ceil(OrchestratorDO.ALPHA_COOLDOWN_MS / 1000),
      });
    }

    const portfolio = await this.loadPortfolio();

    // 5. Run Alpha in parallel
    const runs = await Promise.allSettled(
      eligible.map((snap) =>
        this.runAlphaAndChain(snap, portfolio),
      ),
    );
    for (const r of runs) {
      if (r.status === "rejected") {
        console.error("cycle: alpha run failed", r.reason);
      }
    }
  }

  /**
   * Runs Alpha, persists signal, and chains Risk + Execution if recommendation = enter.
   * Shared between manual /run-alpha and the cycle loop.
   */
  private async runAlphaAndChain(
    snapshot: MarketSnapshot,
    portfolio: PortfolioState,
  ): Promise<{ signalId: string }> {
    // Stream the extended-thinking text to all dashboard clients as it generates.
    const alphaRun = await runAlpha(
      this.env,
      snapshot,
      portfolio,
      (chunk, phase) => {
        this.broadcastToAll({
          type: "reasoning_chunk",
          data: {
            market_id: snapshot.market_id,
            market_title: snapshot.title,
            chunk,
            phase,
          },
        });
      },
    );

    // Flag the end of this reasoning stream so the UI can close out
    this.broadcastToAll({
      type: "reasoning_chunk",
      data: {
        market_id: snapshot.market_id,
        market_title: snapshot.title,
        chunk: "",
        phase: "thinking",
        done: true,
      },
    });

    const signalId = crypto.randomUUID();

    await this.env.DB.prepare(
      `INSERT INTO signals
        (id, market_id, market_title, opportunity_score, recommendation,
         thinking, reasoning_summary, strategies_json, risk_flags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        signalId,
        snapshot.market_id,
        snapshot.title,
        alphaRun.signal.opportunity_score,
        alphaRun.signal.recommendation,
        alphaRun.signal.thinking,
        alphaRun.signal.reasoning_summary,
        JSON.stringify(alphaRun.signal.strategies),
        JSON.stringify(alphaRun.signal.risk_flags),
        new Date().toISOString(),
      )
      .run();

    this.broadcastToAll({ type: "signal", data: alphaRun.signal });
    this.broadcastToAll({
      type: "agent_usage",
      data: {
        agent: "alpha",
        model: "claude-opus-4-7",
        input_tokens: alphaRun.usage.input_tokens,
        output_tokens: alphaRun.usage.output_tokens,
        cache_read_input_tokens: alphaRun.usage.cache_read_input_tokens,
        cache_creation_input_tokens: alphaRun.usage.cache_creation_input_tokens,
        latency_ms: alphaRun.latency_ms,
      },
    });

    if (alphaRun.signal.recommendation === "enter") {
      try {
        const riskRun = await runRisk(
          this.env,
          signalId,
          alphaRun.signal,
          snapshot,
          portfolio,
          (chunk) => {
            this.broadcastToAll({
              type: "reasoning_chunk",
              data: {
                market_id: snapshot.market_id,
                market_title: snapshot.title,
                chunk,
                phase: "risk",
              },
            });
          },
        );
        const decisionId = await this.persistRiskDecision(
          signalId,
          riskRun.decision,
        );
        this.broadcastToAll({ type: "risk_decision", data: riskRun.decision });
        this.broadcastToAll({
          type: "agent_usage",
          data: {
            agent: "risk",
            model: "claude-opus-4-7",
            input_tokens: riskRun.usage.input_tokens,
            output_tokens: riskRun.usage.output_tokens,
            cache_read_input_tokens: riskRun.usage.cache_read_input_tokens,
            cache_creation_input_tokens: riskRun.usage.cache_creation_input_tokens,
            latency_ms: riskRun.latency_ms,
          },
        });

        if (riskRun.decision.decision !== "rejected") {
          const exec = await runExecution(
            this.env,
            signalId,
            decisionId,
            alphaRun.signal,
            riskRun.decision,
            snapshot,
          );
          for (const fill of exec.fill_events) {
            this.broadcastToAll({ type: "fill", data: fill });
          }
        }
      } catch (err) {
        console.error("orchestrator: risk/execution chain failed", err);
      }
    }

    return { signalId };
  }

  // ─── WebSocket clients ──────────────────────────────────────────────

  private acceptClient(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [
      WebSocket,
      WebSocket,
    ];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _msg: ArrayBuffer | string) {
    /* dashboard is read-only for now */
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string) {
    try {
      ws.close(code);
    } catch {
      /* already closed */
    }
  }

  private async broadcast(event: FeedEvent): Promise<Response> {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const client of this.ctx.getWebSockets()) {
      try {
        client.send(payload);
        delivered++;
      } catch {
        /* dead socket */
      }
    }
    return Response.json({ delivered });
  }

  private broadcastToAll(event: FeedEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.ctx.getWebSockets()) {
      try {
        client.send(payload);
      } catch {
        /* dead socket */
      }
    }
  }

  // ─── Alpha Agent invocation ─────────────────────────────────────────

  private async runAlphaOnMarket(
    body: { market_id: string },
  ): Promise<Response> {
    const marketId = body.market_id;
    if (!marketId) return Response.json({ error: "missing_market_id" }, { status: 400 });

    const snapshot = await this.env.CACHE.get<MarketSnapshot>(
      `market:${marketId}:snapshot`,
      "json",
    );
    if (!snapshot) {
      return Response.json(
        { error: "market_not_found", market_id: marketId },
        { status: 404 },
      );
    }

    const portfolio = await this.loadPortfolio();
    const { signalId } = await this.runAlphaAndChain(snapshot, portfolio);
    return Response.json({ signal_id: signalId, market_id: marketId });
  }

  // ─── Risk Agent: validate an existing signal by id ────────────────────

  private async runRiskOnSignal(body: {
    signal_id: string;
  }): Promise<Response> {
    const { signal_id } = body;
    if (!signal_id)
      return Response.json({ error: "missing_signal_id" }, { status: 400 });

    const row = await this.env.DB.prepare(
      "SELECT * FROM signals WHERE id = ?",
    )
      .bind(signal_id)
      .first<{
        id: string;
        market_id: string;
        market_title: string;
        opportunity_score: number;
        recommendation: string;
        thinking: string;
        reasoning_summary: string;
        strategies_json: string;
        risk_flags_json: string;
        created_at: string;
      }>();
    if (!row)
      return Response.json({ error: "signal_not_found" }, { status: 404 });

    const signal: AlphaSignal = {
      market_id: row.market_id,
      timestamp: row.created_at,
      thinking: row.thinking ?? "",
      opportunity_score: row.opportunity_score,
      strategies: JSON.parse(row.strategies_json),
      risk_flags: JSON.parse(row.risk_flags_json ?? "[]"),
      recommendation:
        row.recommendation as AlphaSignal["recommendation"],
      reasoning_summary: row.reasoning_summary ?? "",
    };

    const snapshot = await this.env.CACHE.get<MarketSnapshot>(
      `market:${row.market_id}:snapshot`,
      "json",
    );
    if (!snapshot)
      return Response.json(
        { error: "snapshot_missing" },
        { status: 409 },
      );

    const portfolio = await this.loadPortfolio();
    const riskRun = await runRisk(
      this.env,
      signal_id,
      signal,
      snapshot,
      portfolio,
    );
    const decisionId = await this.persistRiskDecision(
      signal_id,
      riskRun.decision,
    );
    this.broadcastToAll({ type: "risk_decision", data: riskRun.decision });

    return Response.json({
      decision_id: decisionId,
      decision: riskRun.decision,
      usage: riskRun.usage,
      latency_ms: riskRun.latency_ms,
    });
  }

  // ─── Test-only: force-execute synthesized signal against a market ───

  private async testExecute(body: {
    signal_id: string;
  }): Promise<Response> {
    const { signal_id } = body;
    const row = await this.env.DB.prepare(
      "SELECT market_id, market_title FROM signals WHERE id = ?",
    )
      .bind(signal_id)
      .first<{ market_id: string; market_title: string }>();
    if (!row)
      return Response.json({ error: "signal_not_found" }, { status: 404 });

    const snapshot = await this.env.CACHE.get<MarketSnapshot>(
      `market:${row.market_id}:snapshot`,
      "json",
    );
    if (!snapshot)
      return Response.json({ error: "snapshot_missing" }, { status: 409 });

    // Synthesize an "enter" MM signal with quotes 1¢ inside the top of book
    const mid = snapshot.mid_price;
    const syntheticSignal: AlphaSignal = {
      market_id: row.market_id,
      timestamp: new Date().toISOString(),
      thinking: "[SYNTHETIC — test-execute] forced MM signal for pipeline validation.",
      opportunity_score: 0.5,
      strategies: {
        mint_burn: {
          active: false,
          type: null,
          gross_margin_pct: 0,
          net_margin_pct: 0,
          max_notional_usd: 0,
          confidence: "none",
        },
        market_making: {
          active: true,
          bid_price: Math.max(0.01, mid - 0.01),
          ask_price: Math.min(0.99, mid + 0.01),
          target_spread_pct: 0.02,
          max_notional_per_side_usd: 50,
          confidence: "medium",
        },
        reward_farming: {
          active: false,
          incremental_yield_pct: 0,
          qualification_status: "unknown",
        },
      },
      risk_flags: ["synthetic_test"],
      recommendation: "enter",
      reasoning_summary: "Synthetic test of execution path.",
    };

    const syntheticDecision: RiskDecisionResult = {
      signal_id,
      decision: "approved",
      reason: "[SYNTHETIC] test-execute forced approval",
      modifications: null,
      hard_limit_triggered: null,
      risk_notes: ["synthetic_test"],
    };

    // Persist a fake risk_decision row so the orders have a valid FK
    const decisionId = await this.persistRiskDecision(
      signal_id,
      syntheticDecision,
    );

    const exec = await runExecution(
      this.env,
      signal_id,
      decisionId,
      syntheticSignal,
      syntheticDecision,
      snapshot,
    );

    for (const fill of exec.fill_events) {
      this.broadcastToAll({ type: "fill", data: fill });
    }

    return Response.json({
      status: "ok",
      market: row.market_title,
      ...exec,
    });
  }

  private async persistRiskDecision(
    signalId: string,
    decision: RiskDecisionResult,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await this.env.DB.prepare(
      `INSERT INTO risk_decisions
        (id, signal_id, decision, reason, modifications_json, hard_limit_triggered, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        signalId,
        decision.decision,
        decision.reason,
        decision.modifications
          ? JSON.stringify(decision.modifications)
          : null,
        decision.hard_limit_triggered ?? null,
        new Date().toISOString(),
      )
      .run();
    return id;
  }

  private async loadPortfolio(): Promise<PortfolioState> {
    const stored = await this.env.CACHE.get<PortfolioState>(
      "portfolio:state",
      "json",
    );
    if (stored) return stored;

    const cash = Number(this.env.MAX_TOTAL_EXPOSURE_USD);
    const daily = Number(this.env.DAILY_LOSS_LIMIT_USD);
    return {
      current_positions: [],
      total_exposure_usd: 0,
      cash_available_usd: cash,
      daily_pnl_usd: 0,
      daily_loss_limit_usd: daily,
      loss_limit_remaining_usd: daily,
    };
  }

  // ─── Epoch close: Reporter Agent runs, generates share card ─────────

  private async runEpochClose(): Promise<Response> {
    const epochId = crypto.randomUUID();
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 5 * 60 * 1000);

    // Gather fills that settled in the last 5 minutes
    const fillsRes = await this.env.DB.prepare(
      `SELECT f.id, f.fill_price, f.fill_notional_usd, f.fee_usd, f.filled_at,
              o.market_id, o.strategy, o.side
         FROM paper_fills f
         JOIN paper_orders o ON o.id = f.order_id
        WHERE f.filled_at >= ?
        ORDER BY f.filled_at`,
    )
      .bind(periodStart.toISOString())
      .all<{
        id: string;
        fill_price: number;
        fill_notional_usd: number;
        fee_usd: number;
        filled_at: string;
        market_id: string;
        strategy: string;
        side: string;
      }>();

    // Pull market titles for each fill
    const marketIds = Array.from(
      new Set(fillsRes.results.map((f) => f.market_id)),
    );
    const titleMap = new Map<string, string>();
    if (marketIds.length > 0) {
      const placeholders = marketIds.map(() => "?").join(",");
      const snaps = await this.env.DB.prepare(
        `SELECT DISTINCT market_id, market_title FROM signals
          WHERE market_id IN (${placeholders})`,
      )
        .bind(...marketIds)
        .all<{ market_id: string; market_title: string }>();
      for (const s of snaps.results) titleMap.set(s.market_id, s.market_title);
    }

    const positionsRes = await this.env.DB.prepare(
      "SELECT * FROM paper_positions",
    ).all<{
      market_id: string;
      yes_notional_usd: number;
      no_notional_usd: number;
      realized_pnl_usd: number;
    }>();

    const riskRes = await this.env.DB.prepare(
      `SELECT decision, COUNT(*) AS c FROM risk_decisions
        WHERE created_at >= ?
        GROUP BY decision`,
    )
      .bind(periodStart.toISOString())
      .all<{ decision: string; c: number }>();
    const riskCounts = { approved: 0, modified: 0, rejected: 0 };
    for (const r of riskRes.results) {
      if (r.decision === "approved") riskCounts.approved = r.c;
      else if (r.decision === "modified") riskCounts.modified = r.c;
      else if (r.decision === "rejected") riskCounts.rejected = r.c;
    }

    const epochInput: EpochInput = {
      epoch_id: epochId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      fills: fillsRes.results.map((f) => ({
        market_id: f.market_id,
        market_title: titleMap.get(f.market_id) ?? f.market_id,
        strategy: f.strategy,
        side: f.side as "yes" | "no",
        fill_price: f.fill_price,
        fill_notional_usd: f.fill_notional_usd,
        fee_usd: f.fee_usd,
        filled_at: f.filled_at,
      })),
      positions: positionsRes.results.map((p) => ({
        market_id: p.market_id,
        market_title: titleMap.get(p.market_id) ?? p.market_id,
        yes_notional_usd: p.yes_notional_usd,
        no_notional_usd: p.no_notional_usd,
        realized_pnl_usd: p.realized_pnl_usd,
      })),
      risk_summary: riskCounts,
    };

    // Skip Reporter if absolutely no activity this epoch — cheap guard
    if (epochInput.fills.length === 0 && riskCounts.approved === 0 && riskCounts.rejected === 0) {
      return Response.json({
        status: "skipped",
        reason: "no_activity",
        epoch_id: epochId,
      });
    }

    const run = await runReporter(this.env, epochInput);
    const report = run.report ?? ({} as EpochReport);
    report.epoch_id = epochId;
    const attribution = report.attribution ?? {
      spread_capture_usd: 0,
      reward_income_usd: 0,
      arb_profit_usd: 0,
      fees_paid_usd: 0,
      net_usd: 0,
      net_pct_of_deployed: 0,
    };
    const shareCard = report.share_card_data ?? {
      headline_number: `$${attribution.net_usd.toFixed(2)}`,
      subline: `${epochInput.fills.length} fills`,
      period_label: `Epoch · ${periodStart.toISOString().slice(11, 16)}`,
    };
    report.attribution = attribution;
    report.share_card_data = shareCard;

    await this.env.DB.prepare(
      `INSERT INTO epoch_reports
        (id, epoch_start, epoch_end, headline, attribution_json,
         top_markets_json, narrative, share_card_json, net_pnl_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        epochId,
        periodStart.toISOString(),
        periodEnd.toISOString(),
        report.headline ?? "",
        JSON.stringify(attribution),
        JSON.stringify(report.top_markets ?? []),
        report.narrative ?? "",
        JSON.stringify(shareCard),
        attribution.net_usd,
        new Date().toISOString(),
      )
      .run();

    this.broadcastToAll({ type: "epoch_close", data: report });

    return Response.json({
      epoch_id: epochId,
      report,
      usage: run.usage,
      latency_ms: run.latency_ms,
      fills_counted: epochInput.fills.length,
    });
  }

  private async processBatch(_payload: unknown): Promise<Response> {
    // Reserved for Queue consumer — not used yet (cron drives epoch close).
    return Response.json({ status: "not_implemented" });
  }
}
