# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Skim Intelligence** — an autonomous multi-agent prediction market intelligence system built for the Anthropic Opus 4.7 Hackathon (submission deadline: April 26, 2026). It identifies structural trading opportunities (maker rebates, liquidity rewards, mint/burn arbitrage) that are direction-neutral. The full spec lives in `skim-intelligence-build-brief.md`.

## Repo Structure (planned monorepo)

```
apps/
  worker/         # Cloudflare Workers backend (Hono + Durable Objects)
    src/
      agents/     # scanner, alpha, risk, execution, reporter
      data/       # bayse.ts, polymarket.ts (market data clients)
      db/         # schema.ts, queries.ts (D1/SQLite)
      prompts/    # alpha.ts, risk.ts, reporter.ts (system prompts)
      orchestrator.ts
      index.ts    # Hono router entry point
    migrations/   # D1 SQL migrations
    wrangler.toml
  web/            # React + Vite frontend
    src/
      components/ # ReasoningFeed, OpportunityQueue, PnLTiles, ShareCard, LiveEventFeed
      App.tsx
    vite.config.ts
packages/
  shared/
    src/types.ts  # TypeScript interfaces shared by frontend and backend
```

## Development Commands

```bash
# Backend (Cloudflare Workers)
cd apps/worker
wrangler dev              # Local dev with D1/KV bindings
wrangler deploy           # Deploy to Cloudflare
npx wrangler d1 execute skim-db --file=migrations/001_init.sql  # Run migrations

# Frontend (Vite + React)
cd apps/web
npm run dev               # Dev server (proxies /api to worker)
npm run build             # Production build
npm run lint              # ESLint + TypeScript check

# Monorepo (root)
npm install               # Install all workspace deps
npm run dev               # Run worker + web concurrently
npm run lint              # Lint all packages
npm run typecheck         # tsc --noEmit across workspaces
```

## Environment Variables

Copy `.env.example` to `.env`:

```
ANTHROPIC_API_KEY=        # Required — all three LLM agents
BAYSE_API_KEY=            # Required — primary market data (HMAC-SHA256 auth)
BAYSE_API_SECRET=         # Required — signs WebSocket auth headers
CLOUDFLARE_ACCOUNT_ID=    # Required for wrangler deploy
CLOUDFLARE_API_TOKEN=     # Required for wrangler deploy
```

In `wrangler.toml`, bind `ANTHROPIC_API_KEY` as a secret: `wrangler secret put ANTHROPIC_API_KEY`.

## Architecture: The Five Agents

The orchestrator (Cloudflare Durable Object in `orchestrator.ts`) is event-driven via WebSocket streams rather than polling. The Scanner holds persistent WebSocket connections to Bayse and Polymarket and pushes `MarketSnapshot` events into the pipeline as they arrive:

```
WS streams → Scanner → Alpha (parallel, ≤10) → Risk (parallel) → Execution → feed emit
Every 5 min: Epoch close → Reporter → Share card
```

| Agent | Model | Role |
|---|---|---|
| Scanner | none | Maintains WS connections to Bayse + Polymarket; publishes `MarketSnapshot` to KV on each orderbook event |
| Alpha | claude-opus-4-7 | Reasons across 3 strategy layers; outputs `opportunity_score` (0–1) + reasoning text |
| Risk | claude-opus-4-7 | Circuit breaker — validates against hard limits; returns `approved`/`modified`/`rejected` |
| Execution | none | Paper trading state machine — simulates fills, updates D1 ledger |
| Reporter | claude-opus-4-7 | Epoch attribution summary bucketed into spread/rebate/reward/arb |

Alpha and Risk agents are the core IP. Their full system prompts and JSON output schemas are defined in Section 3 of the build brief.

## WebSocket Data Layer

### Polymarket (public, no auth required for market channel)

Docs: https://docs.polymarket.com/market-data/websocket/overview

| Channel | Endpoint |
|---|---|
| Market (orderbook + prices) | `wss://ws-subscriptions-clob.polymarket.com/ws/market` |
| User (fills, order lifecycle) | `wss://ws-subscriptions-clob.polymarket.com/ws/user` |
| RTDS (crypto/equity prices) | `wss://ws-live-data.polymarket.com` |

**Subscribe to a market:**
```json
{ "assets_ids": ["<token_id>"], "type": "market" }
```

**Incoming event types:** `book` (incremental orderbook delta), `price_change`, `best_bid_ask`, `market_resolved`

**Keepalive:** Client sends `PING` every 10 seconds; server responds `PONG`. Missing the pong closes the connection.

**Bootstrap pattern:** Fetch the initial orderbook snapshot via `GET https://clob.polymarket.com/book?token_id=<id>`, then apply incoming `book` delta messages. On reconnect, re-fetch the snapshot — there are no sequence numbers.

### Bayse (primary — auth required)

Docs: https://docs.bayse.markets  
REST + WS base: `https://relay.bayse.markets`

Bayse provides WebSocket channels for **Asset Prices**, **Market Data** (orderbook snapshots, activity feeds, price updates). Authenticate using HMAC-SHA256 with `BAYSE_API_KEY` / `BAYSE_API_SECRET`. The detailed WS subscription format requires developer credentials — refer to the private docs or contact support@bayse.markets. Fall back to Polymarket if Bayse WS is unavailable.

### Cloudflare Workers — Hosting the WS Proxy

The Scanner runs inside a **Durable Object** so it can hold long-lived outgoing WebSocket connections. Use `ctx.acceptWebSocket(server)` (Hibernation API) for incoming client connections to avoid billing duration during idle periods. Outgoing WS connections (to Bayse/Polymarket) do **not** support hibernation — the Scanner DO must stay alive while connected.

```typescript
// Outgoing WS from a Durable Object (scanner.ts)
const upstream = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
upstream.addEventListener("message", (event) => { /* push to KV */ });

// Incoming WS from the frontend dashboard (orchestrator.ts)
const [client, server] = Object.values(new WebSocketPair());
this.ctx.acceptWebSocket(server);          // hibernation-safe
return new Response(null, { status: 101, webSocket: client });
```

**Limits that matter:**
- Max message size: 32 MiB
- Idle timeout: 100 s (Free/Pro plans) — send keepalive pings within this window
- CPU per message: 30 s (extendable to 5 min via `limits.cpu_ms` in `wrangler.toml`)
- Attachment serialization for hibernation state: max 2,048 bytes — store only IDs, keep bulk state in DO Storage

### Frontend WebSocket (Dashboard → Worker)

The `ReasoningFeed` and `LiveEventFeed` components connect to `wss://<worker>/api/ws` (replace the SSE `/api/feed` endpoint with a WebSocket endpoint). The Worker Durable Object accepts these connections via the Hibernation API and broadcasts signal/fill/epoch events to all connected clients.

```typescript
// React component
const ws = new WebSocket("wss://worker.example.workers.dev/api/ws");
ws.binaryType = "arraybuffer";   // required after March 2026 binary frame change
ws.onmessage = (e) => dispatch(JSON.parse(e.data));
```

## Key Technical Decisions

- **Anthropic Messages API** (via `@anthropic-ai/sdk`) powers the LLM agents — not Claude Managed Agents. Model ID: `claude-opus-4-7`. We stream tool-use `input_json_delta` events for live reasoning; use `cache_control: { type: "ephemeral" }` on system prompts.
- **Cloudflare D1** (SQLite) is the persistent ledger. Schema: `market_snapshots`, `signals`, `risk_decisions`, `paper_orders`, `paper_fills`, `paper_positions`, `epoch_reports`, `event_feed`.
- **WebSocket** replaces both the SSE feed and polling. One WS endpoint (`/api/ws`) serves the frontend; the Scanner DO holds upstream WS connections to Bayse/Polymarket.
- **Execution mode** is toggled via `POST /api/admin/mode`: `observe` | `paper` | `live_limited`. Always default to `paper` in dev.
- Paper trading fill simulation uses realistic depth/volume assumptions — do not use instant full fills.

## Frontend Design System

Defined in `skim_vision.html` (if present). Key tokens:
- Background: `#080808`, Text: `#f7f4ef`, Accent: `#35e7ff` (cyan)
- P&L positive: `#3dffa0`, negative: `#ff4e4e`
- Fonts: Cormorant Garamond (display headings), DM Sans (body)
- Data tiles have **no rounded corners**

## Build Sequence (Day Gates)

1. **Day 1** — Bayse + Polymarket WS connections live; `MarketSnapshot` flowing into KV
2. **Day 2** — Alpha Agent reasoning streaming over `/api/ws` to `ReasoningFeed`
3. **Day 3** — Paper trading working end-to-end with orchestrator loop
4. **Day 4** — Dashboard polished + Share card generating
5. **Day 5** — Buffer, submission write-up, open source checklist
