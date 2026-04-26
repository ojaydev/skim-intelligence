# Skim Intelligence

> Autonomous prediction market intelligence — a five-agent system powered by
> Claude Opus 4.7 that identifies structural yield opportunities (maker
> rebates, liquidity rewards, mint/burn arbitrage) and paper-trades them
> without taking directional bets.

**Built for the Anthropic Opus 4.7 Hackathon · April 2026 · MIT License**

Built on the **Anthropic Messages API with tool use**, **streaming**, and
**prompt caching** — running as a reactive pipeline on Cloudflare Workers
+ Durable Objects. Not to be confused with Claude Managed Agents (a separate
Anthropic product for container-hosted long-running sessions).

[Live demo](https://skim-intelligence.round-wildflower-4414.workers.dev) ·
[About page](./docs/about.html) ·
[Dashboard preview](./docs/skim.html) ·
[Technical brief](./skim-intelligence-build-brief.md)

---

## What it does

Prediction markets pay bots to exist. Maker rebates, liquidity rewards, and
mint/burn arbitrage are **structural edges baked into platform design** — they
are available regardless of whether markets resolve YES or NO. Most operators
access these edges through hardcoded rules. Skim uses Opus 4.7 to reason
about each market situation dynamically, the way a sophisticated quantitative
analyst would.

*See [docs/about.html](./docs/about.html) for the full architecture tour.*

## The five agents

```
Polymarket WS ──┐
                ├─→ Scanner DO ─→ KV ─→ Alpha (Opus 4.7) ─→ Risk (Opus 4.7) ─→ Execution ─→ D1
Bayse WS ───────┘       ↑                     │streams token-by-token         │
  (browser relay)       │                     ↓                               ↓
                        │              /api/ws broadcast                 paper_fills
                        │                     ↓                               │
                        │            React dashboard                          ↓
                        │                                     every 5 min → Reporter (Opus 4.7)
                    every 30s cycle picks                           ↓
                    candidates + runs Alpha                  Epoch share card
```

| Agent | Model | Role |
|---|---|---|
| **Scanner** | Deterministic | Holds persistent WS connections, writes `MarketSnapshot` to KV |
| **Alpha** | `claude-opus-4-7` | Reasons across 3 strategy layers in parallel. Streams tool-use JSON fragments token-by-token — the dashboard's ReasoningFeed renders live as Opus thinks |
| **Risk** | `claude-opus-4-7` | Circuit breaker. Enforces hard limits (daily loss, exposure cap, data freshness, inventory imbalance) |
| **Execution** | Deterministic | Paper trading state machine with realistic fill simulation (brief §3.5) |
| **Reporter** | `claude-opus-4-7` | Epoch-close attribution across spread capture / rewards / arb / fees — generates shareable card |

## Quick start

### Prerequisites

- Node.js ≥20
- `pnpm` (via `corepack enable`)
- Cloudflare account with Workers, D1, KV, Queues, Durable Objects access
- Anthropic API key

### Setup

```bash
# 1. Install
pnpm install

# 2. Copy env + fill in keys
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY, BAYSE_*, CLERK_* (optional), PAYSTACK_* (optional)

# 3. Create Cloudflare resources (one-time)
cd apps/worker
npx wrangler d1 create skim-db                     # → paste id into wrangler.toml
npx wrangler kv namespace create skim-cache        # → paste id into wrangler.toml
npx wrangler queues create skim-signals

# 4. Upload secrets
grep '^ANTHROPIC_API_KEY=' ../../.env | cut -d= -f2- | npx wrangler secret put ANTHROPIC_API_KEY
grep '^BAYSE_PUBLIC_API_KEY=' ../../.env | cut -d= -f2- | npx wrangler secret put BAYSE_PUBLIC_API_KEY
grep '^BAYSE_API_SECRET=' ../../.env | cut -d= -f2- | npx wrangler secret put BAYSE_API_SECRET
# Optional consumer layer
grep '^CLERK_SECRET_KEY=' ../../.env | cut -d= -f2- | npx wrangler secret put CLERK_SECRET_KEY
grep '^PAYSTACK_SECRET_KEY=' ../../.env | cut -d= -f2- | npx wrangler secret put PAYSTACK_SECRET_KEY

# 5. Run migrations
npx wrangler d1 migrations apply skim-db --remote
npx wrangler d1 migrations apply skim-db --local

# 6. Build web
cd ../web
pnpm build

# 7. Deploy
cd ../worker
npx wrangler deploy

# 8. Start the auto-orchestration cycle
curl -X POST https://<your-worker>/api/admin/scanner/connect
curl -X POST https://<your-worker>/api/admin/cycle/start
```

Visit `https://<your-worker>/` — the dashboard is served by the same Worker.

### Local development

```bash
pnpm dev               # runs worker (wrangler dev) + web (vite) in parallel
pnpm typecheck         # tsc --noEmit across all packages
```

## Monorepo layout

```
.
├── apps/
│   ├── worker/        # Cloudflare Workers backend (Hono)
│   │   ├── src/
│   │   │   ├── agents/          # scanner, alpha, risk, execution, reporter
│   │   │   ├── auth/            # Clerk JWT middleware
│   │   │   ├── data/            # bayse, polymarket, paystack, snapshot, proxy-fetch
│   │   │   ├── prompts/         # alpha, risk, reporter system prompts + tool schemas
│   │   │   ├── routes/          # HTTP handlers
│   │   │   ├── orchestrator.ts  # Durable Object: auto-cycle + WS broker
│   │   │   └── index.ts         # Hono router entry
│   │   ├── migrations/          # D1 SQL migrations
│   │   └── wrangler.toml
│   ├── web/           # React + Vite dashboard
│   │   ├── src/
│   │   │   ├── App.tsx              # dashboard composition
│   │   │   ├── Wallet.tsx           # Clerk-gated wallet + Paystack deposits
│   │   │   ├── useBayseBridge.ts    # browser-side Bayse WS relay (fallback)
│   │   │   ├── api.ts               # REST + WS clients
│   │   │   └── index.css            # full design tokens
│   │   └── vite.config.ts
│   └── relay/         # Standalone Node relay for Bayse data
│       ├── index.mjs              # event seed + 5s synthetic-orderbook poll
│       ├── probe.mjs              # WS protocol diagnostic
│       └── README.md              # VPS deploy + systemd / NSSM unit
└── packages/
    └── shared/        # TypeScript types shared between worker + web
        └── src/types.ts
```

## Key technical choices

- **Anthropic Messages API + `tool_choice: "tool"`** for structured JSON output on Alpha, Risk, and Reporter
- **Prompt caching** (`cache_control: ephemeral`) on all three system prompts — saves ~90% on repeat calls within the 5-min TTL
- **Streaming Alpha reasoning** via `input_json_delta` events — the dashboard renders Opus's thinking token-by-token as it generates
- **Cloudflare Durable Objects** for Scanner (holds long-lived upstream WS connections — outgoing WS can't hibernate) and Orchestrator (uses Hibernation API for dashboard WS clients)
- **Rate limiting** via KV: 1 Alpha call per market per 2 minutes (brief §5.2)
- **Bayse data via standalone relay** (`apps/relay`): Bayse's WAF blocks Cloudflare Workers egress on REST and silently drops orderbook subscribes from filtered IPs even where REST passes. The relay runs on a non-CF host (VPS, residential), refreshes the event seed every 30 min, and posts synthetic 5-level orderbook frames every 5s built from `outcome1Price` / `outcome2Price` + event `liquidity`. Real WS frames overwrite synthetic ones if a WS-permitted egress is found. The browser bridge in `useBayseBridge.ts` remains as a dev fallback when `RELAY_SECRET` is unset

## API

| Route | Purpose |
|---|---|
| `GET /api/markets` | All current MarketSnapshots from KV |
| `GET /api/signals` | Latest signals with full Alpha reasoning |
| `GET /api/portfolio` | Current paper positions + aggregated P&L |
| `GET /api/epochs/latest` | Latest epoch report (Reporter output) |
| `GET /api/ws` | Dashboard WebSocket — `signal`, `risk_decision`, `fill`, `epoch_close`, `reasoning_chunk` events |
| `GET /api/wallet` | *(Clerk auth)* Balance + ledger history |
| `POST /api/wallet/deposits/init` | *(Clerk auth)* Initialize Paystack deposit, returns `authorization_url` |
| `POST /api/webhooks/paystack` | Paystack event receiver (HMAC-SHA512 verified) |
| `POST /api/bayse/orderbook` | Ingest from `apps/relay` (or browser bridge in dev). Requires `X-Relay-Auth: $RELAY_SECRET` when the secret is set |
| `POST /api/admin/bayse/seed` | Seed `BayseEvent[]` into KV. Same auth requirement |
| `POST /api/admin/cycle/start` | Start auto-orchestration |
| `POST /api/admin/cycle/stop` | Stop auto-orchestration |
| `POST /api/admin/alpha/:marketId` | Manual Alpha trigger |
| `POST /api/admin/epoch-close` | Manual Reporter run |

## Known limitations

- **Bayse from Cloudflare Workers is partially blocked** — REST returns 403 to CF egress IPs, and orderbook WS subscribes are silently dropped from many cloud egress IPs even when REST + the WS handshake pass. The shipped fix is `apps/relay` (Node, runs on any non-CF host) which performs both the REST seed and a 5s synthetic-orderbook poll. The browser bridge in `useBayseBridge.ts` remains as a development fallback. See `apps/relay/README.md` for VPS deploy steps (systemd + Windows NSSM unit included).

- **Paystack transfers (payouts) require business-account activation** — the
  initialize/verify deposit flow works with a test key; transfers error until
  the account is fully onboarded.

## Extending Skim

The hackathon codebase is intentionally structured so each agent prompt lives
in its own file (`apps/worker/src/prompts/{alpha,risk,reporter}.ts`) — tune
them without touching orchestration logic.

To add a new venue: implement a scanner-side WS client (see
`apps/worker/src/data/polymarket.ts` as template) and a snapshot converter
that outputs the shared `MarketSnapshot` type. The agent pipeline is
venue-agnostic.

## License

MIT — see `LICENSE`.

Built with [Claude Opus 4.7](https://www.anthropic.com/claude) and
[Claude Code](https://claude.com/claude-code) for the Anthropic hackathon,
April 2026.
