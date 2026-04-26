import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  from?: "down" | "up" | "fade";
  className?: string;
}

/**
 * Soft entrance — fade + small Y translation. Matches the design
 * vocabulary of the dashboard (Cormorant + cyan + spring damping 200).
 */
export const AppearText: React.FC<Props> = ({
  delay = 0,
  children,
  style,
  from = "down",
  className,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
  });

  const opacity = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const y =
    from === "fade"
      ? 0
      : interpolate(progress, [0, 1], [from === "down" ? 18 : -18, 0]);

  return (
    <div
      className={className}
      style={{
        ...style,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      {children}
    </div>
  );
};
