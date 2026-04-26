import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectScanner,
  getLatestEpoch,
  getMarkets,
  getPortfolio,
  getSignals,
  getStatus,
  openFeed,
  triggerAlpha,
  triggerEpochClose,
  triggerTestExecute,
  type AlphaSignal,
  type ConnectionState,
  type FeedEvent,
  type MarketSnapshot,
} from "./api";
import { ClerkHeaderSlot, WalletPanel } from "./Wallet";
import { useBayseBridge } from "./useBayseBridge";

const CLERK_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

type StatusShape = {
  ok?: boolean;
  mode?: string;
  scanner?: {
    polymarket?: {
      connected?: boolean;
      markets?: number;
      tokens?: number;
      messageCount?: number;
      lastMessageAt?: number | null;
    };
    bayse?: {
      connected?: boolean;
      via_relay?: boolean;
      markets?: number;
      messageCount?: number;
      lastMessageAt?: number | null;
      probe?: {
        authenticated?: boolean;
        events_count?: number;
        markets_count?: number;
        seed_age_ms?: number | null;
        seed_stored_at_ms?: number | null;
        error?: string;
      } | null;
    };
    bootstrapAt?: number | null;
  };
};

type SignalRow = Awaited<ReturnType<typeof getSignals>>["signals"][number];
type PortfolioShape = Awaited<ReturnType<typeof getPortfolio>>;
type LatestEpoch = Awaited<ReturnType<typeof getLatestEpoch>>["epoch"];

type FeedItem = FeedEvent & { _ts: number; _id: string };

const MAX_FEED = 40;

export function App() {
  const [status, setStatus] = useState<StatusShape | null>(null);
  const [markets, setMarkets] = useState<MarketSnapshot[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioShape | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [busyMarket, setBusyMarket] = useState<string | null>(null);
  const [latestEpoch, setLatestEpoch] = useState<LatestEpoch>(null);
  const [busyEpoch, setBusyEpoch] = useState(false);
  // Browser-side bridge is fallback for dev when apps/relay isn't running.
  // Once a RELAY_SECRET is set on the worker, /api/bayse/orderbook 401s the
  // bridge anyway — the relay is the authoritative source.
  const bayseBridge = useBayseBridge(false);

  // Live token stream from Opus 4.7 extended thinking — keyed by market_id.
  const [liveReasoning, setLiveReasoning] = useState<{
    market_id: string | null;
    market_title: string | null;
    text: string;
    done: boolean;
    phase: "thinking" | "risk" | "summary";
  }>({ market_id: null, market_title: null, text: "", done: false, phase: "thinking" });

  // Running totals for the token-economics tile
  const [usageTotals, setUsageTotals] = useState<{
    calls: number;
    cache_read: number;
    cache_create: number;
    input: number;
    output: number;
    latency_sum_ms: number;
    last_call: { agent: string; latency_ms: number } | null;
  }>({
    calls: 0,
    cache_read: 0,
    cache_create: 0,
    input: 0,
    output: 0,
    latency_sum_ms: 0,
    last_call: null,
  });

  // ─── Poll-fetchers (REST) ───
  const refreshAll = useCallback(async () => {
    const [s, m, sig, p, e] = await Promise.allSettled([
      getStatus(),
      getMarkets(),
      getSignals(20),
      getPortfolio(),
      getLatestEpoch(),
    ]);
    if (s.status === "fulfilled") setStatus(s.value);
    if (m.status === "fulfilled") setMarkets(m.value.snapshots ?? []);
    if (sig.status === "fulfilled") setSignals(sig.value.signals ?? []);
    if (p.status === "fulfilled") setPortfolio(p.value);
    if (e.status === "fulfilled") setLatestEpoch(e.value.epoch);
  }, []);

  useEffect(() => {
    refreshAll();
    const id = setInterval(refreshAll, 5_000);
    return () => clearInterval(id);
  }, [refreshAll]);

  // ─── WebSocket feed ───
  useEffect(() => {
    const feedConn = openFeed(
      (ev) => {
        setFeed((prev) => {
          const next: FeedItem = {
            ...ev,
            _ts: Date.now(),
            _id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          };
          return [next, ...prev].slice(0, MAX_FEED);
        });
        // Refresh portfolio on fill events
        if (ev.type === "fill") getPortfolio().then(setPortfolio).catch(() => {});
        // Refresh epoch on close event
        if (ev.type === "epoch_close") getLatestEpoch().then((r) => setLatestEpoch(r.epoch)).catch(() => {});
        // Accumulate streamed Alpha/Risk reasoning (live Opus 4.7 thinking)
        if (ev.type === "reasoning_chunk") {
          const d = ev.data;
          setLiveReasoning((prev) => {
            // New market OR new phase = reset the visible pane
            if (
              prev.market_id !== d.market_id ||
              prev.phase !== d.phase ||
              prev.done
            ) {
              return {
                market_id: d.market_id,
                market_title: d.market_title,
                text: d.chunk,
                done: Boolean(d.done),
                phase: d.phase,
              };
            }
            return {
              ...prev,
              text: prev.text + d.chunk,
              done: Boolean(d.done),
            };
          });
          if (!d.done) setSelectedMarket(d.market_id);
        }
        // Token usage telemetry
        if (ev.type === "agent_usage") {
          const u = ev.data;
          setUsageTotals((t) => ({
            calls: t.calls + 1,
            cache_read: t.cache_read + u.cache_read_input_tokens,
            cache_create: t.cache_create + u.cache_creation_input_tokens,
            input: t.input + u.input_tokens,
            output: t.output + u.output_tokens,
            latency_sum_ms: t.latency_sum_ms + u.latency_ms,
            last_call: { agent: u.agent, latency_ms: u.latency_ms },
          }));
        }
      },
      setConnState,
    );
    return () => feedConn.close();
  }, []);

  // ─── Auto-select top-scored market when signals arrive ───
  useEffect(() => {
    if (!selectedMarket && signals.length > 0) {
      setSelectedMarket(signals[0]?.market_id ?? null);
    }
  }, [signals, selectedMarket]);

  const latestSignalsByMarket = useMemo(() => {
    const m = new Map<string, SignalRow>();
    for (const s of signals) {
      if (!m.has(s.market_id)) m.set(s.market_id, s);
    }
    return m;
  }, [signals]);

  const opportunityList = useMemo(() => {
    return markets
      .map((mk) => {
        const sig = latestSignalsByMarket.get(mk.market_id);
        return {
          market: mk,
          score: sig?.opportunity_score ?? null,
          rec: sig?.recommendation ?? null,
          summary: sig?.reasoning_summary ?? null,
        };
      })
      .sort((a, b) => {
        const sa = a.score ?? -1;
        const sb = b.score ?? -1;
        if (sb !== sa) return sb - sa;
        return b.market.volume_24h_usd - a.market.volume_24h_usd;
      });
  }, [markets, latestSignalsByMarket]);

  const currentSignal = useMemo(() => {
    if (!selectedMarket) return null;
    return latestSignalsByMarket.get(selectedMarket) ?? null;
  }, [selectedMarket, latestSignalsByMarket]);

  // ─── Admin actions ───
  const onRunAlpha = useCallback(
    async (marketId: string) => {
      setBusyMarket(marketId);
      try {
        await triggerAlpha(marketId);
        await refreshAll();
      } finally {
        setBusyMarket(null);
      }
    },
    [refreshAll],
  );

  const onTestExecute = useCallback(
    async (signalId: string) => {
      await triggerTestExecute(signalId);
      await refreshAll();
    },
    [refreshAll],
  );

  const onConnectScanner = useCallback(async () => {
    await connectScanner();
    await refreshAll();
  }, [refreshAll]);

  const onEpochClose = useCallback(async () => {
    setBusyEpoch(true);
    try {
      await triggerEpochClose();
      await refreshAll();
    } finally {
      setBusyEpoch(false);
    }
  }, [refreshAll]);

  const selectedMarketSnap = markets.find((m) => m.market_id === selectedMarket) ?? null;

  return (
    <div className="shell">
      <Header connState={connState} mode={status?.mode} />
      <main className="main">
        <BayseSeedBanner status={status} />
        <WsStatusBar
          connState={connState}
          scanner={status?.scanner}
          feedCount={feed.length}
          bayseBridge={bayseBridge}
        />
        <MetricTiles
          markets={markets.length}
          portfolio={portfolio}
          usage={usageTotals}
        />
        <OpportunityQueue
          items={opportunityList}
          selected={selectedMarket}
          onSelect={setSelectedMarket}
          onRunAlpha={onRunAlpha}
          busyMarket={busyMarket}
        />
        <ReasoningPanel
          signal={currentSignal}
          market={selectedMarketSnap}
          onTestExecute={onTestExecute}
          liveReasoning={liveReasoning}
        />
        <EventFeed feed={feed} />
        <AgentStatus status={status} signals={signals} feed={feed} />
        <ShareCard epoch={latestEpoch} onTrigger={onEpochClose} busy={busyEpoch} />
        {CLERK_ENABLED ? <WalletPanel /> : <WalletConfigStub />}
        <Footer onConnectScanner={onConnectScanner} />
      </main>
    </div>
  );
}

// ───────────────────────────── Header ─────────────────────────────

function Header({ connState, mode }: { connState: ConnectionState; mode?: string }) {
  return (
    <header className="header">
      <div className="logo">
        Skim<span>.</span>Intelligence
      </div>
      <div className="header-right">
        <div className="status-row">
          <div className="status-item">
            <div className={`status-dot ${connState === "open" ? "ok" : connState === "connecting" ? "warn" : "err"}`} />
            Feed {connState}
          </div>
        </div>
        <div className="mode-badge">
          <div className="dot" />
          {mode ?? "paper"} mode
        </div>
        {CLERK_ENABLED && <ClerkHeaderSlot />}
      </div>
    </header>
  );
}

// ───────────────────────────── Bayse seed banner ─────────────────────────────
// Surfaces stale or missing Bayse seed so silent failures aren't silent.

function BayseSeedBanner({ status }: { status: StatusShape | null }) {
  const probe = status?.scanner?.bayse?.probe;
  if (!probe) return null;
  if (probe.error === "no_credentials") return null; // Bayse not configured — banner irrelevant
  const ageMs = probe.seed_age_ms ?? null;
  const STALE_MS = 23 * 60 * 60 * 1000;
  const missing = ageMs === null;
  const stale = ageMs !== null && ageMs > STALE_MS;
  if (!missing && !stale) return null;
  return (
    <div
      className="span4"
      style={{
        background: "rgba(255, 184, 0, 0.08)",
        border: "1px solid rgba(255, 184, 0, 0.4)",
        color: "#ffb800",
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <strong>Bayse seed {missing ? "missing" : "stale"}.</strong>{" "}
      {missing
        ? "No events seeded — start apps/relay or POST /api/admin/bayse/seed."
        : `Last seeded ${Math.round((ageMs ?? 0) / 60_000)} min ago (TTL 24h). Restart apps/relay or reseed.`}
    </div>
  );
}

function WalletConfigStub() {
  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Wallet · Paystack</div>
        <div className="panel-meta">config needed</div>
      </div>
      <div className="panel-body">
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.75 }}>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in web env and run{" "}
          <code>wrangler secret put CLERK_SECRET_KEY</code> + <code>PAYSTACK_SECRET_KEY</code>.
          <br />
          <br />
          Frontend: Clerk modal sign-in + Paystack hosted checkout redirect.
          Backend: <code>/api/wallet/deposits/init</code> →{" "}
          <code>/api/webhooks/paystack</code> credits balance on{" "}
          <code>charge.success</code>.
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── WS Status ─────────────────────────────

function WsStatusBar({
  connState,
  scanner,
  feedCount,
  bayseBridge,
}: {
  connState: ConnectionState;
  scanner: StatusShape["scanner"];
  feedCount: number;
  bayseBridge: {
    connected: boolean;
    markets_subscribed: number;
    updates_received: number;
    updates_forwarded: number;
    last_error: string | null;
  };
}) {
  const poly = scanner?.polymarket;
  const bayse = scanner?.bayse;
  const polyDotClass = poly?.connected ? "live" : poly ? "connecting" : "off";

  const now = Date.now();
  const bayseLastAgoMs = bayse?.lastMessageAt ? now - bayse.lastMessageAt : null;
  const bayseDotClass =
    bayseLastAgoMs !== null && bayseLastAgoMs < 60_000
      ? "live"
      : bayse?.probe?.error
        ? "off"
        : "connecting";

  const feedDotClass =
    connState === "open" ? "live" : connState === "connecting" ? "connecting" : "off";

  // Dev fallback: only show bridge stats if it's actively forwarding
  const bridgeActive = bayseBridge.updates_forwarded > 0 || bayseBridge.connected;

  return (
    <div className="ws-bar">
      <div className="ws-conn">
        <div className={`ws-conn-dot ${polyDotClass}`} />
        <span className="ws-conn-label">Polymarket</span>
        <span className="ws-conn-value">
          {poly?.messageCount ?? 0} msgs · {poly?.markets ?? 0} markets
        </span>
      </div>
      <div className="ws-sep" />
      <div className="ws-conn">
        <div className={`ws-conn-dot ${bayseDotClass}`} />
        <span className="ws-conn-label">Bayse (relay)</span>
        <span className="ws-conn-value">
          {bayse?.messageCount ?? 0} msgs · {bayse?.markets ?? 0} markets
          {bayseLastAgoMs !== null
            ? ` · ${Math.round(bayseLastAgoMs / 1000)}s ago`
            : ""}
          {bridgeActive ? ` · bridge: ${bayseBridge.updates_forwarded} fwd` : ""}
        </span>
      </div>
      <div className="ws-sep" />
      <div className="ws-conn">
        <div className={`ws-conn-dot ${feedDotClass}`} />
        <span className="ws-conn-label">Dashboard feed</span>
        <span className="ws-conn-value">{feedCount} events received</span>
      </div>
    </div>
  );
}

// ───────────────────────────── Metric Tiles ─────────────────────────────

function MetricTiles({
  markets,
  portfolio,
  usage,
}: {
  markets: number;
  portfolio: PortfolioShape | null;
  usage: {
    calls: number;
    cache_read: number;
    cache_create: number;
    input: number;
    output: number;
    latency_sum_ms: number;
    last_call: { agent: string; latency_ms: number } | null;
  };
}) {
  const netPnl = portfolio?.daily_pnl_usd ?? 0;
  const fills = portfolio?.total_fills ?? 0;

  // Opus 4.7 pricing (approximate): $15 / $75 per 1M tokens for input/output,
  // $18.75 cache-write, $1.50 cache-read.
  const cost =
    (usage.input * 15 +
      usage.output * 75 +
      usage.cache_create * 18.75 +
      usage.cache_read * 1.5) /
    1_000_000;
  const cachedPct = usage.cache_read + usage.input > 0
    ? Math.round(
        (usage.cache_read / (usage.cache_read + usage.input)) * 100,
      )
    : 0;
  const avgLatency = usage.calls > 0 ? Math.round(usage.latency_sum_ms / usage.calls) : 0;

  return (
    <>
      <div className="tile">
        <div className="tile-label">Markets Active</div>
        <div className="tile-value cyan">{markets}</div>
        <div className="tile-sub">scanned via WS</div>
      </div>
      <div className="tile">
        <div className="tile-label">Net Paper P&amp;L</div>
        <div className={`tile-value ${netPnl >= 0 ? "positive" : "negative"}`}>
          {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}
        </div>
        <div className="tile-sub">{fills} paper fills</div>
      </div>
      <div className="tile">
        <div className="tile-label">Opus 4.7 · Cache Hit</div>
        <div className="tile-value cyan">{cachedPct}%</div>
        <div className="tile-sub">
          {(usage.cache_read / 1000).toFixed(1)}k cached · {(usage.input / 1000).toFixed(1)}k fresh
        </div>
      </div>
      <div className="tile">
        <div className="tile-label">Total Cost · {usage.calls} calls</div>
        <div className="tile-value">${cost.toFixed(4)}</div>
        <div className="tile-sub">
          {avgLatency}ms avg
          {usage.last_call ? ` · last: ${usage.last_call.agent}` : ""}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Opportunity Queue ─────────────────────────────

function OpportunityQueue({
  items,
  selected,
  onSelect,
  onRunAlpha,
  busyMarket,
}: {
  items: Array<{
    market: MarketSnapshot;
    score: number | null;
    rec: string | null;
    summary: string | null;
  }>;
  selected: string | null;
  onSelect: (id: string) => void;
  onRunAlpha: (id: string) => void;
  busyMarket: string | null;
}) {
  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Opportunity Queue</div>
        <div className="panel-meta">{items.length} markets</div>
      </div>
      <div className="panel-body">
        {items.length === 0 && (
          <div style={{ color: "var(--text-faint)", padding: "20px 0", textAlign: "center" }}>
            waiting for scanner…
          </div>
        )}
        {items.map((it, i) => {
          const scoreCls =
            it.score === null
              ? "low"
              : it.score >= 0.5
                ? "high"
                : it.score >= 0.3
                  ? "med"
                  : "low";
          return (
            <div
              key={it.market.market_id}
              className={`opp-item ${selected === it.market.market_id ? "active" : ""}`}
              onClick={() => onSelect(it.market.market_id)}
            >
              <div className="opp-rank">{i + 1}</div>
              <div className="opp-main">
                <div className="opp-name">{it.market.title}</div>
                <div className="opp-sub">
                  mid {it.market.mid_price.toFixed(3)} · spread{" "}
                  {(it.market.spread_pct * 100).toFixed(2)}% · vol24 $
                  {Math.round(it.market.volume_24h_usd).toLocaleString()}
                  {it.rec && ` · rec=${it.rec}`}
                </div>
              </div>
              <div className="opp-bar-wrap">
                <div
                  className={`opp-bar ${scoreCls}`}
                  style={{ width: `${Math.max(4, (it.score ?? 0) * 100)}%` }}
                />
              </div>
              <div className={`opp-score ${scoreCls}`}>
                {it.score !== null ? it.score.toFixed(2) : "—"}
              </div>
              <button
                className="btn"
                style={{ marginLeft: 8, fontSize: 9, padding: "4px 8px" }}
                disabled={busyMarket === it.market.market_id}
                onClick={(e) => {
                  e.stopPropagation();
                  onRunAlpha(it.market.market_id);
                }}
              >
                {busyMarket === it.market.market_id ? "…" : "α"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Reasoning Panel ─────────────────────────────

function ReasoningPanel({
  signal,
  market,
  onTestExecute,
  liveReasoning,
}: {
  signal: SignalRow | null;
  market: MarketSnapshot | null;
  onTestExecute: (signalId: string) => void;
  liveReasoning: {
    market_id: string | null;
    market_title: string | null;
    text: string;
    done: boolean;
  };
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");

  // Prefer live streaming reasoning when active (matches selected market)
  const isLive =
    liveReasoning.market_id &&
    (!market || liveReasoning.market_id === market.market_id) &&
    !liveReasoning.done &&
    liveReasoning.text.length > 0;

  // Typewriter replay for stored signals (non-live)
  useEffect(() => {
    if (isLive) {
      setTyped("");
      return;
    }
    setTyped("");
    if (!signal?.thinking) return;
    const text = signal.thinking;
    let i = 0;
    const id = setInterval(() => {
      i += Math.max(4, Math.floor(text.length / 600));
      setTyped(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
      if (bodyRef.current) {
        bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }
    }, 16);
    return () => clearInterval(id);
  }, [signal?.id, isLive]);

  // Auto-scroll during live stream
  useEffect(() => {
    if (isLive && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [liveReasoning.text, isLive]);

  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">
          Agent Reasoning · Opus 4.7
          {isLive && (
            <span style={{ color: "var(--cyan)", marginLeft: 10, fontSize: 10 }}>
              ● LIVE
            </span>
          )}
        </div>
        <div className="panel-meta">
          {signal
            ? `score ${signal.opportunity_score.toFixed(2)} · ${signal.recommendation}`
            : isLive
              ? "streaming…"
              : "no signal"}
        </div>
      </div>
      <div className="reasoning-body" ref={bodyRef}>
        <span className="label">
          // {isLive ? "streaming extended-thinking" : "live thinking"} · claude-opus-4-7 ·{" "}
          {isLive && liveReasoning.market_title
            ? `market: ${liveReasoning.market_title.slice(0, 50)}`
            : market?.title
              ? `market: ${market.title.slice(0, 50)}`
              : "select a market"}
        </span>
        {isLive ? liveReasoning.text : typed}
        {isLive && <span className="cursor" />}
        {!isLive && signal && typed.length < signal.thinking.length && (
          <span className="cursor" />
        )}
        {!signal && !isLive && (
          <span style={{ color: "var(--text-faint)" }}>
            {"\n\n"}Auto-cycle runs Alpha on fresh markets every 30s, or click α on any market.{"\n"}
            Opus 4.7 reasons through three strategy layers — mint/burn arb, CLOB market making,{"\n"}
            and reward farming — streaming its extended-thinking chain-of-thought live.
          </span>
        )}
      </div>
      {signal && (
        <div className="reasoning-summary">{signal.reasoning_summary}</div>
      )}
      {market && (
        <div className="depth-viewer">
          <div className="depth-viewer-header">
            <span>
              input to <span className="cyan">Opus 4.7</span> · orderbook depth chart
            </span>
            <span>
              {market.market_id} · {market.data_quality}
            </span>
          </div>
          {/* SVG is fast + scales crisply. The PNG version is what Alpha actually
              sees (both share the same generator so they look identical). */}
          <img
            src={`/api/markets/${encodeURIComponent(market.market_id)}/depth.svg`}
            alt="YES/NO orderbook depth"
          />
        </div>
      )}
      {signal && (
        <div className="admin-row">
          <button className="btn primary" onClick={() => onTestExecute(signal.id)}>
            test-execute (forced MM)
          </button>
          <span style={{ fontSize: 10, color: "var(--text-faint)", alignSelf: "center" }}>
            synthesises an approved MM order to validate the paper trading pipeline
          </span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Event Feed ─────────────────────────────

function EventFeed({ feed }: { feed: FeedItem[] }) {
  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Live Event Feed</div>
        <div className="panel-meta">WebSocket · /api/ws</div>
      </div>
      <div className="panel-body" style={{ padding: "8px 16px" }}>
        <div className="event-list">
          {feed.length === 0 && (
            <div style={{ color: "var(--text-faint)", padding: "16px 0", textAlign: "center", fontSize: 11 }}>
              no events yet — trigger an Alpha run or wait for scanner activity
            </div>
          )}
          {feed.map((ev) => (
            <EventRow key={ev._id} ev={ev} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: FeedItem }) {
  const time = new Date(ev._ts);
  const timeStr = time.toLocaleTimeString("en-US", { hour12: false });
  let body: string;
  let dotCls: string = ev.type;

  switch (ev.type) {
    case "signal": {
      const sig = ev.data as AlphaSignal;
      body = `score ${sig.opportunity_score.toFixed(2)} · ${sig.recommendation} · ${sig.reasoning_summary?.slice(0, 80) ?? ""}`;
      break;
    }
    case "risk_decision": {
      body = `${ev.data.decision} · ${ev.data.reason?.slice(0, 80) ?? ""}`;
      if (ev.data.decision === "rejected") dotCls = "risk_decision rejected";
      break;
    }
    case "fill": {
      const f = ev.data;
      body = `${f.side.toUpperCase()} @ ${f.fill_price.toFixed(3)} · $${f.fill_notional_usd.toFixed(2)} · ${f.strategy}`;
      break;
    }
    case "epoch_close":
      body = `epoch closed · net $${ev.data.attribution.net_usd.toFixed(2)}`;
      break;
    case "agent_status":
      body = `${ev.data.agent} → ${ev.data.state} · ${ev.data.last_action?.slice(0, 60) ?? ""}`;
      break;
    default:
      body = JSON.stringify(ev).slice(0, 120);
  }

  return (
    <div className="event-item">
      <div className={`event-dot ${dotCls}`} />
      <div className="event-text">
        <div className="event-type">{ev.type.replace("_", " ")}</div>
        <div className="event-body">{body}</div>
      </div>
      <div className="event-time">{timeStr}</div>
    </div>
  );
}

// ───────────────────────────── Agent Status ─────────────────────────────

function AgentStatus({
  status,
  signals,
  feed,
}: {
  status: StatusShape | null;
  signals: SignalRow[];
  feed: FeedItem[];
}) {
  const lastSignal = signals[0];
  const lastFill = feed.find((e) => e.type === "fill");
  const lastRisk = feed.find((e) => e.type === "risk_decision");

  const scannerState =
    status?.scanner?.polymarket?.connected || status?.scanner?.bayse?.connected
      ? "running"
      : "idle";

  // Compute activity state from recent feed events (last ~15s)
  const now = Date.now();
  const recent = (type: FeedItem["type"], withinMs: number) =>
    feed.some((e) => e.type === type && now - e._ts < withinMs);
  const reasoningActive = feed.some(
    (e) => e.type === "reasoning_chunk" && !e.data.done && now - e._ts < 10_000,
  );
  const alphaState = reasoningActive
    ? "busy"
    : recent("signal", 15_000)
      ? "running"
      : "idle";
  const riskState = recent("risk_decision", 10_000)
    ? "running"
    : lastRisk
      ? "idle"
      : "idle";
  const executionState = recent("fill", 10_000) ? "running" : "idle";
  const reporterState = recent("epoch_close", 30_000) ? "running" : "idle";

  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Agent Status</div>
        <div className="panel-meta">5-agent pipeline</div>
      </div>
      <div className="panel-body">
        <div className="agent-grid">
          <AgentTile
            name="Scanner"
            indicator={scannerState}
            model="WS · Polymarket + Bayse"
            last={(() => {
              const pLast = status?.scanner?.polymarket?.lastMessageAt ?? 0;
              const bLast = status?.scanner?.bayse?.lastMessageAt ?? 0;
              const last = Math.max(pLast, bLast);
              return last
                ? `last msg ${Math.max(0, Math.round((Date.now() - last) / 1000))}s ago`
                : "idle";
            })()}
          />
          <AgentTile
            name="Alpha"
            indicator={alphaState}
            model="claude-opus-4-7"
            last={
              lastSignal
                ? `${lastSignal.recommendation} · score ${lastSignal.opportunity_score.toFixed(2)}`
                : "no signals yet"
            }
          />
          <AgentTile
            name="Risk"
            indicator={riskState}
            model="claude-opus-4-7"
            last={
              lastRisk
                ? `${(lastRisk.data as { decision: string }).decision}`
                : "no decisions yet"
            }
          />
          <AgentTile
            name="Execution"
            indicator={executionState}
            model="paper engine"
            last={
              lastFill
                ? `fill @ ${(lastFill.data as { fill_price: number }).fill_price.toFixed(3)}`
                : "no fills yet"
            }
          />
          <AgentTile
            name="Reporter"
            indicator={reporterState}
            model="claude-opus-4-7"
            last="next epoch close via cron (5m)"
            span
          />
        </div>
      </div>
    </div>
  );
}

function AgentTile({
  name,
  indicator,
  model,
  last,
  span,
}: {
  name: string;
  indicator: string;
  model: string;
  last: string;
  span?: boolean;
}) {
  return (
    <div className="agent-item" style={span ? { gridColumn: "span 2" } : undefined}>
      <div className={`agent-indicator ${indicator}`} />
      <div>
        <div className="agent-name">{name}</div>
        <div className="agent-model">{model}</div>
        <div className="agent-last">{last}</div>
      </div>
    </div>
  );
}

// ───────────────────────────── Share Card ─────────────────────────────

function ShareCard({
  epoch,
  onTrigger,
  busy,
}: {
  epoch: LatestEpoch;
  onTrigger: () => void;
  busy: boolean;
}) {
  if (!epoch) {
    return (
      <div className="panel span2">
        <div className="panel-header">
          <div className="panel-title">Epoch Share Card</div>
          <div className="panel-meta">no epochs yet</div>
        </div>
        <div className="panel-body">
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.7 }}>
            Reporter Agent runs every 5 minutes via cron, aggregating fills + risk
            decisions into a share card with attribution across spread capture,
            liquidity rewards, and arb profit.
          </div>
          <button className="btn primary" onClick={onTrigger} disabled={busy}>
            {busy ? "running…" : "trigger epoch close"}
          </button>
        </div>
      </div>
    );
  }

  const card = epoch.share_card;
  const attr = epoch.attribution;
  const net = epoch.net_pnl_usd ?? attr?.net_usd ?? 0;
  const isNeg = net < 0;
  const period = new Date(epoch.epoch_end).toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });

  const copyCard = () => {
    const text = [
      "Skim Intelligence",
      card?.headline_number ?? `${net >= 0 ? "+" : ""}$${net.toFixed(2)}`,
      card?.subline ?? "",
      attr
        ? `Spread: ${fmtUsd(attr.spread_capture_usd)} · Rewards: ${fmtUsd(attr.reward_income_usd)} · Arb: ${fmtUsd(attr.arb_profit_usd)}`
        : "",
      `${card?.period_label ?? "Epoch"} · Paper only`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="panel span2">
      <div className="panel-header">
        <div className="panel-title">Epoch Share Card</div>
        <div className="panel-meta">{card?.period_label ?? "epoch"}</div>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        <div className="share-card">
          <div className="share-logo">Skim Intelligence</div>
          <div className={`share-headline ${isNeg ? "negative" : ""}`}>
            {card?.headline_number ?? `${net >= 0 ? "+" : ""}$${net.toFixed(2)}`}
          </div>
          <div className="share-subline">
            {card?.subline ?? "paper net · epoch"}
          </div>
          {attr && (
            <div className="share-breakdown">
              <div className="share-bucket">
                <div className="share-bucket-label">Spread</div>
                <div className="share-bucket-value">
                  {fmtUsd(attr.spread_capture_usd)}
                </div>
              </div>
              <div className="share-bucket">
                <div className="share-bucket-label">Rewards</div>
                <div className="share-bucket-value">
                  {fmtUsd(attr.reward_income_usd)}
                </div>
              </div>
              <div className="share-bucket">
                <div className="share-bucket-label">Arb</div>
                <div className="share-bucket-value">
                  {fmtUsd(attr.arb_profit_usd)}
                </div>
              </div>
            </div>
          )}
          {epoch.narrative && (
            <div className="share-narrative">{epoch.narrative}</div>
          )}
          <div className="share-footer">
            <div className="share-period">{period} · Paper only</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" onClick={copyCard}>copy</button>
              <button className="btn primary" onClick={onTrigger} disabled={busy}>
                {busy ? "…" : "refresh epoch"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtUsd(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

// ───────────────────────────── Footer ─────────────────────────────

function Footer({ onConnectScanner }: { onConnectScanner: () => void }) {
  return (
    <div className="span4" style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 10, color: "var(--text-faint)" }}>
      <button className="btn" onClick={onConnectScanner}>reconnect scanner</button>
      <div style={{ flex: 1 }} />
      <div>
        built with <span style={{ color: "var(--cyan)" }}>claude-opus-4-7</span> · anthropic hackathon
      </div>
    </div>
  );
}
