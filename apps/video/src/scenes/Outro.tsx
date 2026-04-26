import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

export const Outro = () => {
  const frame = useCurrentFrame();
  const lineWidth = interpolate(frame, [10, 60], [0, 900], {
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
        gap: 20,
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
          MIT licensed · open source
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
            fontSize: 88,
            fontWeight: 300,
            color: colors.text,
            letterSpacing: "0.04em",
            lineHeight: 1,
            textAlign: "center",
          }}
        >
          Skim <span style={{ color: colors.cyan }}>Intelligence</span>
        </div>
      </AppearText>

      <div
        style={{
          marginTop: 50,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          alignItems: "center",
        }}
      >
        <AppearText delay={70}>
          <Link label="github" url="github.com/ojaydev/skim-intelligence" />
        </AppearText>
        <AppearText delay={90}>
          <Link
            label="live demo"
            url="skim-intelligence.round-wildflower-4414.workers.dev"
          />
        </AppearText>
      </div>

      <AppearText delay={140} from="fade">
        <div
          style={{
            marginTop: 60,
            fontFamily: fonts.body,
            fontSize: 14,
            color: colors.textFaint,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          built with <span style={{ color: colors.cyan }}>claude-opus-4-7</span> · anthropic hackathon · april 2026
        </div>
      </AppearText>
    </AbsoluteFill>
  );
};

const Link: React.FC<{ label: string; url: string }> = ({ label, url }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      gap: 16,
      fontFamily: fonts.mono,
      fontSize: 22,
    }}
  >
    <span
      style={{
        fontFamily: fonts.body,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.2em",
        color: colors.textFaint,
        minWidth: 120,
        textAlign: "right",
      }}
    >
      {label}
    </span>
    <span style={{ color: colors.text }}>{url}</span>
  </div>
);
