import React from "react";
import { useCurrentFrame } from "remotion";

interface Props {
  text: string;
  startFrame?: number;
  charsPerFrame?: number;
  pauseAt?: number[]; // character indices to hold extra frames at (e.g. after a sentence)
  pauseFrames?: number;
  style?: React.CSSProperties;
  cursor?: boolean;
}

/**
 * Typewriter via string slicing — never per-character opacity (per the
 * Remotion text-animations rule).
 */
export const Typewriter: React.FC<Props> = ({
  text,
  startFrame = 0,
  charsPerFrame = 3,
  pauseAt = [],
  pauseFrames = 30,
  style,
  cursor = true,
}) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - startFrame);

  // Account for pauses at sentence boundaries
  let consumed = 0;
  let visible = 0;
  let used = 0;
  while (visible < text.length) {
    const remainingFrames = elapsed - used;
    if (remainingFrames <= 0) break;

    const stepsLeft = Math.floor(remainingFrames * charsPerFrame);
    if (stepsLeft <= 0) break;

    const nextPauseIdx = pauseAt.find((p) => p > visible) ?? Infinity;
    const charsUntilPause = nextPauseIdx - visible;

    if (stepsLeft >= charsUntilPause && nextPauseIdx !== Infinity) {
      // Type up to the pause boundary, then hold
      visible = nextPauseIdx;
      used += charsUntilPause / charsPerFrame + pauseFrames;
      consumed = visible;
    } else {
      visible = Math.min(text.length, visible + stepsLeft);
      consumed = visible;
      used = elapsed; // exhausted
      break;
    }
  }

  const slice = text.slice(0, consumed);
  const isDone = consumed >= text.length;

  return (
    <span style={style}>
      {slice}
      {cursor && !isDone && <Cursor />}
    </span>
  );
};

const Cursor: React.FC = () => {
  const frame = useCurrentFrame();
  // Blink at ~2Hz
  const visible = Math.floor(frame / 15) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: "0.85em",
        background: "#35e7ff",
        marginLeft: 2,
        verticalAlign: "text-bottom",
        opacity: visible ? 1 : 0,
      }}
    />
  );
};
