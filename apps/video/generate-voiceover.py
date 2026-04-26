#!/usr/bin/env python3
"""Generate voiceover.mp3 from the demo script via ElevenLabs TTS.

Usage:  python generate-voiceover.py
Reads ELEVENLABS_API_KEY from the project root .env. Writes the audio
to apps/video/public/voiceover.mp3.

Voice: Adam (pNInz6obpgDQGcFmaJgB) — documentary narrator tone.
Model: eleven_multilingual_v2 — highest quality, slow but worth it for
a one-shot render.
"""

import os
import sys
import urllib.request
from pathlib import Path

VOICE_ID = "nPczCjzI2devNBz1zQrb"  # Brian — warm, modern, podcast-grade narration
MODEL_ID = "eleven_multilingual_v2"

# Single-string narration. Em-dashes and full stops give the TTS natural
# pauses. Two newlines between sections create longer breaths.
NARRATION = """Skim Intelligence. Five Claude Opus 4.7 agents reasoning over prediction-market microstructure.

Prediction markets pay bots to exist. Maker rebates, liquidity rewards, mint-and-burn arbitrage — these are structural edges, available no matter how a market resolves. But surfacing them takes quant analysis most operators can't afford. So they leave the yield on the table. Skim closes that gap with reasoning, not rules.

Five agents. Three of them powered by Claude Opus 4.7. Scanner ingests live order books. Alpha reasons about every market it sees, streaming its thinking token-by-token. Risk acts as a circuit breaker. Execution simulates fills with realistic slippage. And every five minutes, Reporter writes a P-and-L attribution.

This is the Alpha Agent live, streaming directly from the Anthropic API. Every word you see appearing on screen is Opus 4.7's thinking in real time, as the model walks through the orderbook for a near-resolution tail-event market. Watch the layered reasoning. Layer one — mint-and-burn arbitrage. The model computes the complement sum: zero point nine nine nine, plus zero point nine nine nine. Buying both sides costs almost two dollars to redeem one. Dead. Layer two — market making. Quoted spread is ninety-six percent. Standing in front of informed sellers in a tail event would be catastrophic adverse selection. Layer three — reward farming. No pool. Nothing to redeem. Verdict — skip. Three risk flags cited. The pipeline refuses to fire orders.

Risk Agent sees the same data and reaches the same conclusion through an independent prompt. One-sided book. Longshot market. No reward pool. Degenerate spread. Four flags. Rejected. Independent prompts catch what single-prompt systems miss. Defence-in-depth applied to L L M reasoning.

Every thirty seconds, the orchestrator picks fresh markets and runs the full pipeline. Fifteen on Polymarket. Ten on Bayse. Nine thousand cycles already run. Cache hit rate ninety-two percent. This is what autonomous trading looks like when the model can reason — not just pattern-match. A workflow that didn't exist before Opus.

Every five minutes, Reporter writes an honest attribution. Spread capture. Rewards. Mint-and-burn. Fees. Even when P-and-L is flat or negative, the narrative reflects reality. Eighteen of twenty-two markets rejected. No further bleed since the negative-E-V guards shipped. Honest accounting matters when real capital is at stake.

Skim Intelligence. Open source under M I T. Built with Claude Opus 4.7 for the Anthropic Hackathon, April twenty-twenty-six."""


def load_api_key() -> str:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        print(f"error: .env not found at {env_path}", file=sys.stderr)
        sys.exit(1)
    for line in env_path.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    print("error: ELEVENLABS_API_KEY not in .env", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    api_key = load_api_key()
    out_dir = Path(__file__).resolve().parent / "public"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / "voiceover.mp3"

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    payload = {
        "text": NARRATION,
        "model_id": MODEL_ID,
        "voice_settings": {
            # Lower stability gives more emotional range / natural pacing.
            # Style adds subtle expressiveness so it doesn't feel like a
            # robotic documentary read.
            "stability": 0.42,
            "similarity_boost": 0.85,
            "style": 0.35,
            "use_speaker_boost": True,
        },
    }
    import json as _json
    req = urllib.request.Request(
        url,
        data=_json.dumps(payload).encode("utf-8"),
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        print(f"http error {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)

    out_path.write_bytes(audio)
    size_mb = len(audio) / (1024 * 1024)
    print(f"wrote {out_path} ({size_mb:.2f} MB, {len(NARRATION)} chars input)")


if __name__ == "__main__":
    main()
