import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

import { colors } from "./Brand";
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

// Beats — match submission-draft.md's 3-min script.
const SCENE_DURATIONS = {
  title: sceneFrames(6),
  problem: sceneFrames(22),
  agents: sceneFrames(22),
  liveReasoning: sceneFrames(58), // CORE BEAT
  riskRejection: sceneFrames(20),
  autoCycle: sceneFrames(22),
  reporter: sceneFrames(20),
  outro: sceneFrames(14),
};

export const SkimDemo = () => {
  return (
    <AbsoluteFill style={{ background: colors.bg }}>
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
