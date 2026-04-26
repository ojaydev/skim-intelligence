# Voiceover script — Skim Intelligence demo

Total target: 180s @ ~150 wpm = ~445 words. Per-scene budgets below.
Punctuation is intentional — long em-dashes give ElevenLabs natural
breathing pauses. Numbers are spelled out so the TTS pronounces them
correctly.

---

## Title (6s · ~12 words)
Skim Intelligence. Five Claude Opus 4.7 agents reasoning over
prediction-market microstructure.

## Problem (22s · ~58 words)
Prediction markets pay bots to exist. Maker rebates, liquidity
rewards, mint-and-burn arbitrage — these are structural edges,
available no matter how a market resolves. But accessing them takes
quant infrastructure most operators don't have. Skim uses Opus 4.7
to reason about each market dynamically, the way a sophisticated
quant analyst would.

## Agents (22s · ~52 words)
Five agents. Three of them powered by Claude Opus 4.7. Scanner
ingests live order books over WebSocket. Alpha streams its reasoning
token-by-token across every market it sees. Risk acts as a circuit
breaker. Execution simulates fills with realistic slippage. And
every five minutes, Reporter writes a P&L attribution.

## Live Alpha reasoning (58s · ~145 words) — CORE BEAT
This is the Alpha Agent live, streaming directly from the Anthropic
API. Every word you see appearing on screen is Opus 4.7's thinking
in real time, as the model walks through the orderbook for a
near-resolution tail-event market. Watch the layered reasoning.
Layer one — mint-and-burn arbitrage. The model computes the
complement sum: zero-point-nine-nine-nine plus zero-point-nine-nine-nine.
Buying both sides costs almost two dollars to redeem one. Dead.
Layer two — market making. Quoted spread is ninety-six percent.
Standing in front of informed sellers in a tail event would be
catastrophic adverse selection. Layer three — reward farming. No
pool. Nothing to redeem. Verdict — skip. Opportunity score zero
point zero three. Recommendation: skip. Three risk flags cited.
The pipeline refuses to fire orders.

## Risk rejection (20s · ~52 words)
Risk Agent sees the same data and reaches the same conclusion
through an independent prompt. One-sided book. Longshot market.
No reward pool. Degenerate spread. Four flags. Decision —
rejected. Independent prompts catch what single-prompt systems
miss. This is defence-in-depth applied to LLM reasoning.

## Auto cycle (22s · ~58 words)
Every thirty seconds the orchestrator picks fresh markets and runs
the full pipeline. Fifteen markets on Polymarket. Ten on Bayse,
polled through a residential relay. Nine thousand cycles run
already. Cache hit rate ninety-two percent. Constantly thinking,
constantly looking for structural edges across two venues without
any human in the loop.

## Reporter (20s · ~50 words)
Every five minutes, Reporter writes an honest attribution. Spread
capture. Rewards. Mint-and-burn. Fees. Even when P&L is flat or
slightly negative, the narrative reflects reality. Negative four
dollars and twenty cents. Eighteen of twenty-two markets rejected.
No further bleed since the negative-EV guards shipped.

## Outro (14s · ~32 words)
Skim Intelligence. Open source under MIT. The agent prompts, paper
trading engine, full dashboard — all in the public repo. Built with
Claude Opus 4.7 for the Anthropic Hackathon, April twenty-twenty-six.
