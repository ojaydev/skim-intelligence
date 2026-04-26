import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

import { colors, VIDEO } from "./Brand";
import { Title } from "./scenes/Title";
import { Problem } from "./scenes/Problem";
import { Agents } from "./scenes/Agents";
import { LiveReasoning } from "./scenes/LiveReasoning";
import { RiskRejection } from "./scenes/RiskRejection";
import { AutoCycle } from "./scenes/AutoCycle";
import { Reporter } from "./scenes/Reporter";
import { Outro } from "./scenes/Outro";

// Scene budget (seconds → frames @ 30fps). Total ≈ 180s = 5400f.
// Transitions consume 12 frames each (overlap) so we add a small buffer
// per scene to keep the visual rhythm even after the timing is subtracted.
const FPS = 30;
const TRANSITION_FRAMES = 12;
const transitionTiming = linearTiming({ durationInFrames: TRANSITION_FRAMES });

const sceneFrames = (seconds: number) => Math.round(seconds * FPS);

// Beats — match the recorded voiceover pacing (177.6s). The outro is
// trimmed because Brian's delivery is faster than Adam's; the closing
// "Hackathon, April 2026" line lands ~1.5s before the final cut.
const SCENE_DURATIONS = {
  title: sceneFrames(6),
  problem: sceneFrames(22),
  agents: sceneFrames(22),
  liveReasoning: sceneFrames(58), // CORE BEAT
  riskRejection: sceneFrames(20),
  autoCycle: sceneFrames(22),
  reporter: sceneFrames(20),
  outro: sceneFrames(13),
};

// Music fade envelope — sits under the voiceover at ~10% volume with a
// soft fade-in over the first second and a 1.5s fade-out at the end.
const MUSIC_VOLUME = 0.1;
const FADE_IN_FRAMES = 30;
const FADE_OUT_FRAMES = 45;

const musicVolume = (f: number): number => {
  if (f <= FADE_IN_FRAMES) {
    return interpolate(f, [0, FADE_IN_FRAMES], [0, MUSIC_VOLUME], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  const fadeOutStart = VIDEO.durationFrames - FADE_OUT_FRAMES;
  if (f >= fadeOutStart) {
    return interpolate(
      f,
      [fadeOutStart, VIDEO.durationFrames],
      [MUSIC_VOLUME, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  }
  return MUSIC_VOLUME;
};

export const SkimDemo = () => {
  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      <Audio src={staticFile("voiceover.mp3")} />
      <Audio
        src={staticFile("music.mp3")}
        loop
        loopVolumeCurveBehavior="extend"
        volume={musicVolume}
      />
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.title}>
          <Title />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.problem}>
          <Problem />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.agents}>
          <Agents />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence
          durationInFrames={SCENE_DURATIONS.liveReasoning}
        >
          <LiveReasoning />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence
          durationInFrames={SCENE_DURATIONS.riskRejection}
        >
          <RiskRejection />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.autoCycle}>
          <AutoCycle />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.reporter}>
          <Reporter />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={transitionTiming} />

        <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS.outro}>
          <Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
