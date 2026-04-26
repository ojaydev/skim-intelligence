# SKIM INTELLIGENCE
## Technical Build Brief & Full PRD
**Hackathon: Built with Opus 4.7 — Claude Code**
**Submission Deadline: Sunday April 26, 8:00 PM EST**
**Version: 1.0 — Internal**

---

## 0. TL;DR

Build a five-agent autonomous prediction market intelligence system powered by Opus 4.7. It scans live prediction market orderbooks, reasons about structural trading opportunities using Claude Managed Agents, paper-trades signals with full attribution, and surfaces the results in a real-time dashboard. No directional bets. Pure market microstructure extraction — mint/burn arbitrage, CLOB market making, liquidity reward farming.

This is the brain of the Skim product, built in public, in 5 days, open sourced under MIT.

---

## 1. Product Definition

### 1.1 One-Line

An autonomous multi-agent system that uses Opus 4.7 to reason about prediction market microstructure and extract structural yield through market making, arbitrage, and reward farming — without taking directional positions.

### 1.2 Core Insight

Prediction markets pay bots to exist. Maker rebates, liquidity rewards, and mint/burn arbitrage are structural edges baked into platform design — they are available regardless of whether markets resolve YES or NO. Most operators access these edges through hardcoded rules. Skim Intelligence uses Opus 4.7 to reason about each market situation dynamically: assessing spread quality, arb windows, inventory risk, and reward yield in real time, the way a sophisticated quantitative analyst would.

### 1.3 What It Is NOT

- It does not predict market outcomes.
- It does not take directional positions on any event.
- It does not involve user deposits, custody, or financial products in this version.
- It is not a chatbot wrapper around a trading API.

### 1.4 Hackathon Positioning

**Problem statement:** "Build From What You Know" — We built Skim, a Bayse-native liquidity engine. This is the intelligence layer that makes it work.

**Prize targets:**
- 1st/2nd/3rd place (Impact + Demo + Opus 4.7 Use + Depth)
- Best Managed Agents (primary architecture pattern)
- "Keep Thinking" (nobody else is pointing Claude at prediction market microstructure)

---

## 2. Architecture Overview

### 2.1 System Diagram

```
┌─────────────────────────────────────────────────────┐
│                   SKIM INTELLIGENCE                  │
│                                                     │
│  ┌─────────────┐    ┌──────────────────────────────┐ │
│  │   Scanner   │───▶│     Claude Managed Agents    │ │
│  │    Agent    │    │                              │ │
│  │  (polling)  │    │  ┌──────────┐ ┌───────────┐  │ │
│  └─────────────┘    │  │  Alpha   │ │   Risk    │  │ │
│                     │  │  Agent   │ │  Agent    │  │ │
│  ┌─────────────┐    │  │(Opus 4.7)│ │(Opus 4.7) │  │ │
│  │   Market    │    │  └────┬─────┘ └─────┬─────┘  │ │
│  │    Data     │    │       │              │        │ │
│  │  (Bayse /   │    │  ┌────▼─────────────▼─────┐  │ │
│  │  Polymarket)│    │  │    Execution Agent      │  │ │
│  └─────────────┘    │  │    (paper trading)      │  │ │
│                     │  └────────────┬────────────┘  │ │
│  ┌─────────────┐    │               │               │ │
│  │  Reporter   │◀───│  ┌────────────▼────────────┐  │ │
│  │   Agent     │    │  │   State Store (KV/D1)   │  │ │
│  │ (summaries) │    │  └─────────────────────────┘  │ │
│  └─────────────┘    └──────────────────────────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │              React Dashboard                  │   │
│  │  Market Scores | Reasoning Feed | P&L Tiles  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 2.2 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Agent runtime | Claude Managed Agents (Anthropic SDK) | Prize target, native orchestration |
| Model | claude-opus-4-7 | Extended reasoning on market state |
| API backend | Cloudflare Workers + Hono | Fast deploy, familiar stack |
| Database | Cloudflare D1 (SQLite) | Persistent paper trading ledger |
| KV / cache | Cloudflare KV | Market state snapshots, rate limits |
| Queues | Cloudflare Queues | Async agent job dispatch |
| Frontend | Vite + React + Tailwind | Fast build, clean deploy |
| Hosting | Cloudflare Pages | Same org as Workers |
| Market data | Bayse API (primary) / Polymarket public API (fallback) | Live CLOB data |

### 2.3 Repo Structure

```
skim-intelligence/
├── apps/
│   ├── web/                    # React dashboard (Vite)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── MarketGrid.tsx
│   │   │   │   ├── ReasoningFeed.tsx
│   │   │   │   ├── PnLTiles.tsx
│   │   │   │   ├── OpportunityQueue.tsx
│   │   │   │   ├── AgentStatus.tsx
│   │   │   │   └── ShareCard.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useMarkets.ts
│   │   │   │   ├── useReasoningFeed.ts
│   │   │   │   └── usePnL.ts
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   └── Market.tsx
│   │   │   └── App.tsx
│   │   └── package.json
│   └── worker/                 # Cloudflare Worker API
│       ├── src/
│       │   ├── index.ts        # Hono router
│       │   ├── agents/
│       │   │   ├── scanner.ts
│       │   │   ├── alpha.ts
│       │   │   ├── risk.ts
│       │   │   ├── execution.ts
│       │   │   └── reporter.ts
│       │   ├── orchestrator.ts # Managed Agents coordinator
│       │   ├── data/
│       │   │   ├── bayse.ts    # Bayse API client
│       │   │   └── polymarket.ts # Fallback data client
│       │   ├── db/
│       │   │   ├── schema.ts
│       │   │   └── queries.ts
│       │   └── prompts/
│       │       ├── alpha.ts
│       │       ├── risk.ts
│       │       └── reporter.ts
│       ├── migrations/
│       └── wrangler.toml
├── packages/
│   └── shared/                 # Shared types
│       └── src/types.ts
└── README.md
```

---

## 3. The Five Agents

### 3.1 Agent Roles

| Agent | Model | Trigger | Input | Output |
|---|---|---|---|---|
| Scanner | Deterministic (no LLM) | Cron / 30s poll | Bayse/Polymarket API | Structured market snapshots |
| Alpha | claude-opus-4-7 | Per market snapshot | Market state JSON | Signal + full reasoning |
| Risk | claude-opus-4-7 | Per Alpha signal | Signal + portfolio state | Approved / modified / rejected signal |
| Execution | Deterministic | Per approved signal | Approved signal | Paper order, fill, position update |
| Reporter | claude-opus-4-7 | Per epoch close (5 min) | All fills + P&L | Attribution summary, share card data |

### 3.2 Scanner Agent

No LLM. Pure data ingestion.

**Responsibilities:**
- Poll Bayse orderbook endpoints every 30 seconds for all active markets
- Compute derived metrics: mid price, best bid/ask spread, bid depth, ask depth, spread_pct, time_to_resolution, reward_pool_remaining, two_sided_reward_eligible
- Check data freshness — flag stale if last update > 60s
- Write snapshot to KV: `market:{id}:snapshot`
- Push market IDs to Queues for Alpha processing

**Market state schema:**
```typescript
interface MarketSnapshot {
  market_id: string;
  title: string;
  category: string;

  // Orderbook state
  best_bid: number;        // YES price
  best_ask: number;        // YES price
  yes_bid_depth_usd: number;
  yes_ask_depth_usd: number;
  no_bid_depth_usd: number;
  no_ask_depth_usd: number;

  // Derived metrics
  mid_price: number;
  spread_pct: number;      // (ask - bid) / mid
  complement_sum: number;  // best_yes_ask + best_no_ask (arb check: < 1.00 = burn opp)
  complement_diff: number; // 1.00 - (best_yes_bid + best_no_bid) (mint opp if < 0)

  // Market context
  resolution_days: number;
  volume_24h_usd: number;
  taker_fee_rate: number;  // Derived from price tier

  // Reward state
  reward_pool_remaining_usd: number;
  reward_epoch_end: string;
  two_sided_eligible: boolean;
  estimated_reward_yield: number;

  // Data quality
  snapshot_age_ms: number;
  data_quality: 'fresh' | 'stale' | 'dead';
  fetched_at: string;
}
```

### 3.3 Alpha Agent

**Model:** claude-opus-4-7
**Purpose:** Reason about each market and output structured trading signals.

This is the core intelligence. Opus 4.7 receives the full market snapshot and reasons through all three strategy layers simultaneously. The reasoning is exposed in the UI — it IS the demo.

**System prompt:**

```
You are the Alpha Agent for Skim Intelligence — an autonomous prediction market liquidity engine.

Your job is to analyze prediction market microstructure and identify structural yield opportunities
across three strategy layers. You do NOT predict event outcomes. You extract edges from market design.

STRATEGY LAYER 1 — MINT/BURN ARBITRAGE
A YES share + NO share = $1.00 by protocol invariant.
- BURN opportunity: If (best_yes_bid + best_no_bid) < $1.00 - fees, buy both sides and burn.
  Profit = $1.00 - best_yes_bid - best_no_bid - taker_fees
- MINT opportunity: If (best_yes_ask + best_no_ask) > $1.00 + fees, mint and sell both.
  Profit = best_yes_ask + best_no_ask - $1.00 - taker_fees
- Minimum net margin required: 6% at P=0.50, 3.2% at P>0.70 (lower fees at higher prices)
- Only execute if both legs are fillable under size limits
- Reject if data is stale (snapshot_age_ms > 60000)

STRATEGY LAYER 2 — CLOB MARKET MAKING
Post limit orders on both sides. Earn spread on fills. Zero maker fees.
- Quote width: target spread capture of at least 2% per round trip
- Inventory neutrality: YES and NO positions must stay within ±15% of each other by notional
- Quote only if spread_pct > 3% and depth on both sides > $200
- Pause if resolution_days < 3 (resolution risk too high)
- Wider quotes when: high volatility, stale data, deep inventory imbalance

STRATEGY LAYER 3 — LIQUIDITY REWARD FARMING
Bayse pays from a fixed pool per market for resting two-sided orders.
- Layer 2 market-making orders automatically qualify if two_sided_eligible = true
- Incremental return = estimated_reward_yield on top of spread capture
- Do not enter reward-only if spread is too tight for market making
- Stop if reward_pool_remaining_usd < $50

TAKER FEE SCHEDULE (affects arb thresholds):
- P = 0.30-0.50: 5-7% taker fee → arb needs 6%+ gross spread
- P = 0.50-0.70: 3-5% taker fee → sweet spot for market making
- P > 0.70: 3% floor → cheapest arb zone

RESPONSE FORMAT — Always respond with a valid JSON object:

{
  "market_id": string,
  "timestamp": ISO string,
  "thinking": string,           // Full step-by-step reasoning (shown in UI)
  "opportunity_score": number,  // 0.0-1.0 composite quality
  "strategies": {
    "mint_burn": {
      "active": boolean,
      "type": "mint" | "burn" | null,
      "gross_margin_pct": number,
      "net_margin_pct": number,
      "max_notional_usd": number,
      "confidence": "high" | "medium" | "low" | "none"
    },
    "market_making": {
      "active": boolean,
      "bid_price": number | null,
      "ask_price": number | null,
      "target_spread_pct": number,
      "max_notional_per_side_usd": number,
      "confidence": "high" | "medium" | "low" | "none"
    },
    "reward_farming": {
      "active": boolean,
      "incremental_yield_pct": number,
      "qualification_status": "eligible" | "ineligible" | "unknown"
    }
  },
  "risk_flags": string[],
  "recommendation": "enter" | "observe" | "skip" | "pause_all",
  "reasoning_summary": string   // 2-sentence plain English for UI
}
```

**Input to Alpha Agent:**

```typescript
const alphaInput = {
  market_snapshot: MarketSnapshot,
  portfolio_state: {
    current_positions: Position[],
    total_exposure_usd: number,
    cash_available_usd: number,
    daily_pnl_usd: number,
    daily_loss_limit_usd: number,
    loss_limit_remaining_usd: number
  },
  strategy_config: {
    max_notional_per_market_usd: number,
    max_total_exposure_usd: number,
    max_open_positions: number,
    min_arb_margin_pct: number,
    execution_mode: 'observe' | 'paper' | 'live_limited' | 'live'
  }
}
```

### 3.4 Risk Agent

**Model:** claude-opus-4-7
**Purpose:** Validate Alpha signals against hard limits and portfolio state before execution.

The Risk Agent is the circuit breaker. It catches situations Alpha might miss and enforces hard rules that are non-negotiable.

**System prompt:**

```
You are the Risk Agent for Skim Intelligence. Your job is to validate trading signals
from the Alpha Agent before they are executed.

HARD LIMITS (reject immediately if violated):
1. Daily loss limit: If loss_limit_remaining_usd <= 0, reject all non-arb signals
2. Per-market exposure: Signal notional + existing_market_exposure must not exceed cap
3. Total exposure: Signal notional + total_exposure_usd must not exceed max
4. Max open positions: Cannot exceed max_open_positions
5. Data staleness: Reject any signal where snapshot_age_ms > 60000
6. Execution mode: If mode = 'observe', reject all execution signals
7. Inventory imbalance: If existing imbalance on this market > 20%, reject new MM entries

SOFT CHECKS (may modify signal):
1. If net_margin_pct on arb is within 20% of threshold, downgrade to 'observe'
2. If confidence = 'low' on market_making, halve the max_notional
3. If risk_flags contains 'stale_data', reject regardless of age
4. If resolution_days < 5, add 'near_resolution' flag and halve notional

RESPONSE FORMAT:
{
  "signal_id": string,
  "decision": "approved" | "modified" | "rejected",
  "reason": string,
  "modifications": {
    "max_notional_usd": number | null,
    "bid_price": number | null,
    "ask_price": number | null
  } | null,
  "hard_limit_triggered": string | null,
  "risk_notes": string[]
}
```

### 3.5 Execution Agent

No LLM. Pure state machine.

**Responsibilities:**
- Receive approved/modified signals from Risk Agent
- Simulate order placement in paper trading engine
- Record orders, simulated fills, positions, and P&L in D1
- Apply realistic fill simulation: partial fills based on depth, slippage model, fee deduction
- Emit execution events to event feed
- Run inventory check every 60 seconds — pause if imbalance > 15%
- Run epoch close every 5 minutes: settle P&L, reset epoch counters, trigger Reporter

**Fill simulation model:**

For market-making orders (resting):
- Fill probability per epoch = min(volume_24h / (depth * 48), 0.85)
- Fill price = quoted price (maker, no slippage)
- Fee = 0 (maker)

For arb orders (aggressive, taker):
- Fill probability = 0.95 if within top-of-book, 0.60 if second level
- Fill price = quoted price ± 0.2% slippage
- Fee = taker_fee_rate × notional

### 3.6 Reporter Agent

**Model:** claude-opus-4-7
**Purpose:** Generate human-readable performance summaries and share card data at each epoch close.

**System prompt:**

```
You are the Reporter Agent for Skim Intelligence. At each epoch close, you receive the full
P&L breakdown and generate a plain-English summary that a non-technical user can understand.

You attribute performance across three source buckets:
1. Spread capture: P&L from market-making fills (bid-ask spread earned)
2. Maker rebates: Zero for now (noted as future income)
3. Liquidity rewards: Simulated reward income from qualifying positions

CRITICAL RULES:
- Never say "guaranteed," "risk-free," or "fixed return"
- Always label performance as "paper trading results" or "simulated"
- Use "realized" only for fills that have settled
- Use "estimated" for reward income that has not been confirmed
- Always show losses when they occur — do not hide negative epochs

RESPONSE FORMAT:
{
  "epoch_id": string,
  "period_start": ISO string,
  "period_end": ISO string,
  "headline": string,
  "attribution": {
    "spread_capture_usd": number,
    "reward_income_usd": number,
    "arb_profit_usd": number,
    "fees_paid_usd": number,
    "net_usd": number,
    "net_pct_of_deployed": number
  },
  "top_markets": [{
    "market_id": string,
    "title": string,
    "strategy": string,
    "contribution_usd": number
  }],
  "risk_events": string[],
  "narrative": string,
  "share_card_data": {
    "headline_number": string,
    "subline": string,
    "period_label": string
  }
}
```

---

## 4. Orchestrator

The orchestrator is the central coordinator. It runs as a Cloudflare Durable Object so state persists.

```typescript
// apps/worker/src/orchestrator.ts

export class SkimOrchestrator implements DurableObject {

  async runCycle() {
    // 1. Scanner produces snapshots
    const snapshots = await this.scanner.fetchAll();

    // 2. Filter to actionable markets
    const candidates = snapshots.filter(s =>
      s.data_quality === 'fresh' &&
      s.spread_pct > 0.02 &&
      s.volume_24h_usd > 1000
    );

    // 3. Alpha Agent reasons about each (parallel, max 10 concurrent)
    const signals = await Promise.allSettled(
      candidates.map(snapshot => this.alpha.analyze(snapshot))
    );

    // 4. Risk Agent validates each signal
    const validated = await Promise.allSettled(
      signals
        .filter(s => s.status === 'fulfilled' && s.value.recommendation === 'enter')
        .map(s => this.risk.validate(s.value))
    );

    // 5. Execution Agent processes approved signals
    for (const result of validated) {
      if (result.status === 'fulfilled' && result.value.decision !== 'rejected') {
        await this.execution.process(result.value);
      }
    }

    // 6. Emit all reasoning events to SSE feed
    await this.emitToFeed(signals, validated);
  }

  async runEpochClose() {
    const epochData = await this.execution.closeEpoch();
    const report = await this.reporter.generate(epochData);
    await this.db.insertEpochReport(report);
    await this.emitEpochClose(report);
  }
}
```

---

## 5. Data Model

### 5.1 D1 Schema

```sql
CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  snapshot_data JSON NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  market_title TEXT NOT NULL,
  opportunity_score REAL,
  recommendation TEXT NOT NULL,
  thinking TEXT,
  reasoning_summary TEXT,
  strategies_json JSON,
  risk_flags_json JSON,
  created_at TEXT NOT NULL
);

CREATE TABLE risk_decisions (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  decision TEXT NOT NULL,
  reason TEXT,
  modifications_json JSON,
  hard_limit_triggered TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE paper_orders (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  risk_decision_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  notional_usd REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE paper_fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES paper_orders(id),
  fill_price REAL NOT NULL,
  fill_notional_usd REAL NOT NULL,
  fee_usd REAL NOT NULL,
  slippage_usd REAL NOT NULL,
  filled_at TEXT NOT NULL
);

CREATE TABLE paper_positions (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  yes_notional_usd REAL DEFAULT 0,
  no_notional_usd REAL DEFAULT 0,
  unrealized_pnl_usd REAL DEFAULT 0,
  realized_pnl_usd REAL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE epoch_reports (
  id TEXT PRIMARY KEY,
  epoch_start TEXT NOT NULL,
  epoch_end TEXT NOT NULL,
  headline TEXT,
  attribution_json JSON,
  top_markets_json JSON,
  narrative TEXT,
  share_card_json JSON,
  net_pnl_usd REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE event_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  created_at TEXT NOT NULL
);
```

### 5.2 KV Keys

```
market:{id}:snapshot          Latest MarketSnapshot JSON
orchestrator:state            OrchestratorState (mode, caps, last run)
portfolio:state               Current P&L and positions summary
feed:cursor                   Last event ID for SSE resumption
rate:alpha:{market_id}        Rate limit counter (max 1 Alpha call per market per 2 min)
```

---

## 6. Worker API Surface

```
GET  /api/markets              All current market scores + snapshots
GET  /api/markets/:id          Single market detail + signal history
GET  /api/portfolio            Current paper portfolio state
GET  /api/signals              Latest signals across all markets (paginated)
GET  /api/signals/:id          Single signal with full reasoning
GET  /api/epochs               Epoch report history
GET  /api/epochs/latest        Latest epoch report
GET  /api/share-card/:epoch_id Share card data
GET  /api/feed                 SSE event stream (signals, fills, epoch closes)
GET  /api/status               Orchestrator status + execution mode

POST /api/admin/mode           Set execution mode (observe/paper/live_limited)
POST /api/admin/cycle          Trigger manual orchestration cycle
```

---

## 7. Frontend Spec

### 7.1 Design System

Pull directly from skim_vision.html:

| Token | Value |
|---|---|
| Background | `#080808` |
| Text primary | `#f7f4ef` |
| Cyan accent | `#35e7ff` |
| Cyan dim | `rgba(53,231,255,0.16)` |
| Green P&L | `#3dffa0` |
| Red P&L | `#ff4e4e` |
| Display font | Cormorant Garamond |
| Body font | DM Sans |

Grid-led editorial layout. Large display numbers. No rounded corners on data tiles.

### 7.2 Dashboard Layout

```
┌──────────────────────────────────────────────────────────┐
│  SKIM INTELLIGENCE           ○ PAPER MODE    [STATUS]    │
├──────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ MARKETS  │ │ NET P&L  │ │  FILLS   │ │  UPTIME  │   │
│  │    23    │ │ +$184.20 │ │   147    │ │  98.2%   │   │
│  │ ACTIVE   │ │  PAPER   │ │  TODAY   │ │  QUOTES  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                          │
│  ┌─────────────────────────┐ ┌────────────────────────┐ │
│  │   OPPORTUNITY QUEUE     │ │   AGENT REASONING      │ │
│  │                         │ │                        │ │
│  │  ██ TRUMP-2026   0.84  │ │  Alpha Agent analyzing │ │
│  │  ██ FED-MAY      0.71  │ │  TRUMP-2026...         │ │
│  │  ░░ BTC-100K     0.63  │ │                        │ │
│  │  ░░ EURO-2026    0.09  │ │  "5.8% spread at P=0.47│ │
│  │                         │ │  Two-sided reward pool │ │
│  │  [VIEW ALL 23 →]       │ │  $1,240 remaining.     │ │
│  └─────────────────────────┘ │  Entering MM sleeve." │ │
│                               └────────────────────────┘ │
│  ┌─────────────────────────┐ ┌────────────────────────┐ │
│  │   P&L ATTRIBUTION       │ │    LIVE EVENT FEED     │ │
│  │  Spread capture  +$124  │ │  ● Fill: TRUMP YES     │ │
│  │  Reward income   + $47  │ │    $48.20 @ 0.47       │ │
│  │  Arb profits     + $31  │ │  ● Signal: FED-MAY     │ │
│  │  Fees paid       - $18  │ │    Arb window 4.2%    │ │
│  │  NET             +$184  │ │  ● Risk: Approved      │ │
│  └─────────────────────────┘ └────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Key UI Components

**ReasoningFeed** — The demo centerpiece. Shows Opus 4.7's live thinking as it analyzes each market. Streams in real time via SSE. Dark card with cyan cursor blink. Monospace font. This is the raw `thinking` field from the Alpha signal — unedited.

**OpportunityQueue** — Ranked list of all markets by `opportunity_score`. Color bars showing score magnitude. Clicking opens market detail. Live updates as scores change.

**PnLTiles** — Four metric tiles: Active Markets, Net P&L, Total Fills, Quote Uptime. Cyan accent on positive P&L, red on negative. Paper mode badge always visible.

**ShareCard** — Cyan/black card showing epoch results. "Skim ran on 23 markets. Paper net: +$184.20. Spread: +$124 | Rewards: +$47 | Arb: +$31." One-tap copy. Screenshot-worthy.

**AgentStatus** — Shows all 5 agents, their current state (running / idle / paused / error), and last action timestamp.

### 7.4 SSE Event Types

```typescript
type FeedEvent =
  | { type: 'signal'; data: SignalEvent }
  | { type: 'risk_decision'; data: RiskDecisionEvent }
  | { type: 'fill'; data: FillEvent }
  | { type: 'epoch_close'; data: EpochReport }
  | { type: 'agent_status'; data: AgentStatusEvent }
  | { type: 'heartbeat'; data: { ts: string } };
```

---

## 8. Build Sequence

### Day 1 — Tuesday: Foundation

**Target:** Working scaffold with live market data flowing to a basic UI.

Tasks:
- Scaffold Cloudflare Worker with Hono + D1 + KV + Queues + Durable Objects
- `wrangler.toml` with all bindings, dev environment separation
- D1 migrations for all tables
- Bayse API client: markets list, orderbook, portfolio endpoints
- Polymarket fallback client (public API, no auth): use if Bayse unavailable during hacking
- Scanner Agent: poll loop, snapshot computation, KV write
- Basic React app: market list, live data via polling, design tokens applied from skim_vision.html

End of day gate: `wrangler dev` running, 10+ markets displaying, D1 recording snapshots.

### Day 2 — Wednesday: Intelligence Layer

**Target:** Alpha Agent reasoning live, signals appearing in UI.

Morning:
- Implement Alpha Agent prompt + JSON schema validation
- Wire market snapshot → Alpha Agent → D1 insert
- Implement `GET /api/signals` and `GET /api/signals/:id`
- Build ReasoningFeed component: SSE connection, `thinking` field streaming

Afternoon:
- Implement Risk Agent prompt + decision logic
- Wire Alpha signal → Risk Agent → D1 insert
- Add risk decision to signal display
- Add OpportunityQueue with live scores

End of day gate: Click any market, see Opus 4.7 reasoning in real time. Risk Agent approving/rejecting.

### Day 3 — Thursday: Execution & Orchestration

**Target:** Paper trading live, P&L accumulating, Managed Agents coordinating.

Morning:
- Execution Agent: fill simulation, position tracking, D1 writes
- Paper order lifecycle: open → fill/partial/cancel
- Orchestrator as Durable Object: full cycle (Scanner → Alpha → Risk → Execution)
- All agent actions emitting to `event_feed` table

Afternoon:
- SSE endpoint `/api/feed`
- LiveEventFeed component
- Epoch close: 5-minute Cron Trigger, Reporter Agent
- PnLTiles + attribution breakdown

End of day gate: Full cycle runs end-to-end. P&L accumulating across epochs. Event feed streaming.

### Day 4 — Friday: Dashboard Polish + Share Card

**Target:** Demo-ready UI. Every component works. Share card generates.

Morning:
- Final layout: match skim_vision.html energy with full cyan accent system
- Market detail view: orderbook viz + position display + signal history
- AgentStatus component
- All error states: stale data, paused agents, limit hit alerts

Afternoon:
- Share card: generate from epoch data, one-tap copy/download
- Admin panel: execution mode toggle, manual cycle trigger
- README, MIT license, .env.example
- Test demo flow end-to-end

End of day gate: Demo flow works start to finish without intervention. Share card generates.

### Day 5 — Saturday: Buffer + Submission

**Target:** Submitted by 8 PM EST.

Morning:
- Fix overnight bugs from live run
- Final visual QA
- Record 3-minute demo video

Afternoon:
- Write submission description (150 words, Section 10)
- Open source checklist (Section 11)
- Submit on CV platform

---

## 9. Demo Script (3 Minutes Exact)

### 0:00–0:25 — The Problem

Open on the dashboard. Voiceover:

> "Prediction markets pay bots to exist — maker rebates, liquidity rewards, mint/burn arbitrage. These are structural edges, available regardless of whether markets resolve YES or NO. But accessing them requires quant infrastructure most people don't have. Skim Intelligence is a five-agent system powered by Opus 4.7 that reasons about prediction market microstructure in real time."

### 0:25–1:15 — The Alpha Agent Reasoning (Core Beat)

Click into the top market. ReasoningFeed is live. Voiceover as reasoning streams:

> "This is Opus 4.7 analyzing a live market. Not a hardcoded rule — actual step-by-step reasoning. It's looking at the spread, the fee tier, the reward pool, the inventory position. Watch."

Let reasoning finish. Point to output:

> "5.8% spread at P=0.47. Two-sided reward pool: $1,200 remaining. Recommendation: enter market making with ±3¢ quotes, $120 notional cap. Then the Risk Agent validates against hard limits — exposure cap, inventory balance, data freshness. Approved. Orders placed."

### 1:15–1:50 — The System Running

Switch to full dashboard. Show:
- Opportunity queue updating
- Event feed streaming: signals, risk decisions, fills
- P&L tiles: "12 markets active. Net paper: +$184.20"
- Attribution: spread capture / rewards / arb / fees

> "Five agents. Thirty-second cycle. Scanner reads orderbooks. Alpha reasons about opportunity. Risk enforces hard limits. Execution paper-trades approved signals. Reporter attributes P&L at every epoch close. This has been running for 48 hours."

### 1:50–2:20 — The Risk Agent Blocking a Trade

Show a rejected signal:

> "This is the circuit breaker. Alpha flagged a burn arb — but data is 90 seconds stale. Risk Agent hard-rejects it. The system does not trade on bad data. Daily loss limits, inventory imbalance, resolution proximity, stale orderbook — every edge case is covered."

### 2:20–2:50 — Share Card

Show the epoch share card:

> "Every 5 minutes the Reporter generates a full attribution summary. This is what Skim will send to real users — where exactly their yield came from. Spread capture, rewards, arb. Honest accounting."

### 2:50–3:00 — Close

> "Skim Intelligence is open source under MIT. The full agent architecture, prompts, and paper trading engine are available now. The production version — real execution, user deposits, Paystack flows — is what we're building next. This is the brain, running in public."

---

## 10. Submission Write-Up (150 Words)

**Title:** Skim Intelligence — Autonomous Prediction Market Liquidity Engine

Prediction markets pay bots to exist — through maker rebates, liquidity rewards, and mint/burn arbitrage. These edges are structural and direction-neutral, but accessing them requires quant infrastructure retail users and most operators don't have.

Skim Intelligence is a five-agent system powered by Opus 4.7 and Claude Managed Agents that autonomously scans, reasons about, and paper-trades prediction market microstructure opportunities. The Scanner Agent ingests live CLOB data. The Alpha Agent uses Opus 4.7 to reason about each market — assessing spread quality, arb windows, inventory risk, and reward yield simultaneously. The Risk Agent enforces hard limits as the circuit breaker. The Execution Agent runs a paper trading engine with realistic fill simulation. The Reporter Agent attributes P&L across three strategy sources at every epoch close.

Built on Cloudflare Workers, D1, and Managed Agents. Fully open source under MIT. This is the intelligence layer of Skim — a production liquidity product for African prediction markets.

---

## 11. Open Source Checklist

```
[ ] MIT LICENSE in repo root
[ ] .env.example with all required vars, no real keys
[ ] wrangler.toml with placeholder account IDs
[ ] README.md:
    [ ] What it is (2 paragraphs)
    [ ] Architecture diagram
    [ ] Deploy instructions (wrangler deploy + pages deploy)
    [ ] Agent prompt customization guide
    [ ] Data source setup (Bayse or Polymarket fallback)
[ ] GitHub Actions: lint + type-check on push
[ ] All API keys loaded from environment only
[ ] No hardcoded secrets anywhere
[ ] Repo is public before submission deadline
```

Required env vars:
```bash
ANTHROPIC_API_KEY=
BAYSE_API_KEY=
BAYSE_API_SECRET=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

---

## 12. Post-Hackathon: Path to Production Skim

This codebase is not a throwaway. After the hackathon:

| Hackathon Component | Production Skim Use |
|---|---|
| Alpha Agent | Core reasoning engine for real execution decisions |
| Risk Agent | Production circuit breaker with real position limits |
| Execution Agent | Replace paper orders with live Bayse API calls |
| Reporter Agent | User-facing P&L statements and daily share cards |
| Orchestrator | Always-on strategy coordinator (not ephemeral) |
| D1 Schema | Extend with users, deposits, ledger, withdrawals |

The paper trading engine becomes the PAPER mode from Skim PRD v2.1 — the shadow-mode test harness for Milestone A. The open source repo becomes the public trust surface from v2.1 Section 2.3. Realized paper performance visible. Methodology explained. Strategy legible.

The demo IS the proof document.

---

*SKIM INTELLIGENCE — Technical Build Brief v1.0*
*Built with Opus 4.7 Hackathon — April 2026*
*Internal — Not for distribution*
