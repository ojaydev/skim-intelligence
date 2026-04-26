# @skim/video — hackathon demo video

3-minute Remotion-rendered submission video for the Anthropic Opus 4.7
Hackathon. 1920×1080 @ 30 fps, H.264 in `out/skim-demo.mp4`.

## Structure

```
src/
  index.ts          # registers the root
  Root.tsx          # Composition declaration
  SkimDemo.tsx      # Top-level scene chain (TransitionSeries + <Audio>)
  Brand.ts          # Brand tokens — colors + fonts mirrored from apps/web
  components/
    AppearText.tsx  # Soft fade + Y-translation entrance
    Typewriter.tsx  # String-slicing typewriter with sentence pauses
  scenes/
    Title.tsx
    Problem.tsx
    Agents.tsx
    LiveReasoning.tsx     # CORE BEAT — typewriter of a real Alpha signal
    RiskRejection.tsx     # Stamp-animation REJECTED
    AutoCycle.tsx         # Counter tiles
    Reporter.tsx          # Share card mockup
    Outro.tsx
```

## Commands

```bash
pnpm --filter @skim/video studio          # interactive timeline preview
pnpm --filter @skim/video render          # render to out/skim-demo.mp4
pnpm --filter @skim/video render:1080p60  # 60fps variant
pnpm --filter @skim/video typecheck
```

## Voiceover

The narration is generated via ElevenLabs TTS with the Brian voice
(`nPczCjzI2devNBz1zQrb`, warm modern podcast-style) and the
`eleven_multilingual_v2` model. Settings dial up expressiveness
(`stability: 0.42`, `style: 0.35`) so the read doesn't feel robotic.

```bash
# Requires ELEVENLABS_API_KEY in repo-root .env
python apps/video/generate-voiceover.py
```

The generated `public/voiceover.mp3` is **gitignored** because it's a
regenerable artefact — re-run the script to recreate it on a fresh
clone. The full script lives in `voiceover-script.md` for review and
hand-edits.

## Background music

`SkimDemo.tsx` expects a 1-3 minute royalty-free instrumental track at
`public/music.mp3` (also gitignored). It is mixed under the voice at
`MUSIC_VOLUME = 0.1` (10%) with a 1-second fade-in and a 1.5-second
fade-out, looped via `loopVolumeCurveBehavior="extend"` so the fade
envelope spans the full composition rather than each loop.

Bring your own track — Pixabay Music, the YouTube Audio Library, or
Uppbeat all have suitable ambient-electronic instrumentals. Avoid
anything with vocals (it will compete with the narration).

## Pacing

| Scene | Duration |
|---|---|
| Title | 6 s |
| Problem | 22 s |
| Agents | 22 s |
| **Live Alpha reasoning** | **58 s** |
| Risk rejection | 20 s |
| Auto cycle | 22 s |
| Reporter | 22 s |
| Outro | 18 s |
| **Total** | **186 s** (≈ 185 s of audio + 1 s tail) |

The composition's `durationInFrames` (5580) is the sum of scenes minus
the cumulative TransitionSeries overlap (7 × 12 frames). Adjust scene
durations in `SkimDemo.tsx` if you re-record the voiceover and the new
audio diverges.
