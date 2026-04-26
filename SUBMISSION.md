# Skim Intelligence — 150-word submission

**Title:** Skim Intelligence — Autonomous Prediction Market Liquidity Engine

**Demo video:** https://youtu.be/YaIPCAKgAr4 ·
**Live demo:** https://skim-intelligence.round-wildflower-4414.workers.dev ·
**Repo:** https://github.com/ojaydev/skim-intelligence

Prediction markets pay bots to exist — through maker rebates, liquidity
rewards, and mint/burn arbitrage. These edges are structural and
direction-neutral, but accessing them requires quant infrastructure retail
users and most operators don't have.

Skim Intelligence is a five-agent pipeline powered by **Claude Opus 4.7**
that autonomously scans, reasons about, and paper-trades prediction market
microstructure. The Scanner ingests live CLOB data over WebSocket. The
**Alpha Agent streams its tool-use JSON fragments token-by-token to the
dashboard** — assessing spread, arb windows, inventory risk, and reward
yield in real time. The **Risk Agent** enforces hard limits as the circuit
breaker. **Execution** runs a paper trading engine with realistic fill
simulation. **Reporter** attributes P&L across three source buckets at
every epoch close.

Built on the Anthropic Messages API (tool use + streaming + prompt
caching), Cloudflare Workers + Durable Objects, D1, and Clerk/Paystack.
Fully open source under MIT.

---

## Demo talking points (3 minutes)

### 0:00–0:25 — The problem
Prediction markets pay bots to exist. Maker rebates, liquidity rewards, and
mint/burn arbitrage are structural edges available regardless of outcome.
Most operators access them through hardcoded rules; Skim uses Opus 4.7 to
reason dynamically.

### 0:25–1:15 — Live Alpha reasoning (CORE BEAT)
Watch the ReasoningFeed as Opus 4.7 analyses a market live. Not a replay —
actual token-by-token extended-thinking streamed from the API. The model
walks through the orderbook, computes the complement sum, checks arb
thresholds, evaluates MM viability, and emits a structured signal. When it
hits `recommendation: "enter"`, Risk validates instantly and Execution fires
paper orders. You see the full chain in the dashboard in ~15 seconds.

### 1:15–1:50 — The auto-cycle
Every 30s the Orchestrator Durable Object picks 3 fresh markets and runs the
full Alpha → Risk → Execution chain in parallel, rate-limited per market.
The dashboard is constantly thinking without intervention.

### 1:50–2:20 — Risk Agent rejecting bad data
Show a `snapshot_age_ms > 60000` rejection. The Risk Agent hard-refuses
any signal built on stale data. Daily loss limits, inventory imbalance,
resolution proximity — every edge case is codified.

### 2:20–2:50 — Reporter + share card
Every 5 min the cron fires Reporter. Opus 4.7 writes an honest
plain-English attribution across spread capture, rewards, arb, fees. Even
when P&L is $0 ("7 one-sided fills, no round trips closed yet"), the
narrative is accurate. The share card is one-tap copyable.

### 2:50–3:00 — Close
Skim Intelligence is open source under MIT. The agent prompts, paper trading
engine, and orchestration are all in the public repo. The production Skim
builds on this brain with live Bayse execution, Clerk auth, Paystack
on/off-ramps.

---

## Prize targets
- **Keep Thinking** — nobody else is pointing Claude at prediction market microstructure
- **1st/2nd/3rd (Impact + Demo + Opus 4.7 Use + Depth)** — live streaming reasoning is the demo centrepiece; three Opus-4.7 agents with prompt caching + streaming tool-use JSON

---

## Open source checklist (brief §11)

- [x] MIT LICENSE in repo root
- [x] `.env.example` with all required vars, no real keys
- [x] `wrangler.toml` configured with placeholder D1/KV IDs
- [x] `README.md`:
  - [x] What it is
  - [x] Architecture diagram
  - [x] Deploy instructions (`wrangler deploy`)
  - [x] Agent prompt customization (via `apps/worker/src/prompts/`)
  - [x] Data source setup (Polymarket direct, Bayse via browser relay)
- [x] All API keys loaded from environment only
- [x] No hardcoded secrets anywhere

## Required env vars
```bash
ANTHROPIC_API_KEY=
BAYSE_PUBLIC_API_KEY=
BAYSE_API_SECRET=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=

# Optional (consumer layer)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
PAYSTACK_SECRET_KEY=
PAYSTACK_PUBLIC_KEY=
```
