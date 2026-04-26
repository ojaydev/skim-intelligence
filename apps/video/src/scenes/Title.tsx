import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

export const Title = () => {
  const frame = useCurrentFrame();

  // Subtle horizontal cyan line that draws across the centre
  const lineWidth = interpolate(frame, [10, 50], [0, 800], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <AppearText delay={0} from="fade">
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 14,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: colors.cyan,
          }}
        >
          Anthropic · Opus 4.7 Hackathon
        </div>
      </AppearText>

      <div
        style={{
          height: 1,
          width: lineWidth,
          background: `linear-gradient(90deg, transparent, ${colors.cyan}, transparent)`,
        }}
      />

      <AppearText delay={20} from="down">
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 140,
            fontWeight: 300,
            color: colors.text,
            letterSpacing: "0.04em",
            lineHeight: 1,
          }}
        >
          Skim <span style={{ color: colors.cyan }}>Intelligence</span>
        </div>
      </AppearText>

      <AppearText delay={50} from="down">
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 22,
            color: colors.textDim,
            letterSpacing: "0.06em",
            marginTop: 12,
          }}
        >
          Five Claude Opus 4.7 agents reasoning over prediction-market microstructure
        </div>
      </AppearText>
    </AbsoluteFill>
  );
};
