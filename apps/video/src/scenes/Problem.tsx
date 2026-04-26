import { AbsoluteFill } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

export const Problem = () => {
  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        padding: "120px 140px",
        flexDirection: "column",
        gap: 32,
      }}
    >
      <AppearText delay={0}>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: colors.textDim,
          }}
        >
          The opportunity
        </div>
      </AppearText>

      <AppearText delay={10}>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 88,
            fontWeight: 300,
            color: colors.text,
            lineHeight: 1.05,
            letterSpacing: "0.01em",
          }}
        >
          Prediction markets <span style={{ fontStyle: "italic" }}>pay bots</span>
          <br />to exist.
        </div>
      </AppearText>

      <div
        style={{
          marginTop: 30,
          fontFamily: fonts.body,
          fontSize: 26,
          color: colors.textDim,
          lineHeight: 1.55,
          maxWidth: 1300,
        }}
      >
        <AppearText delay={50}>
          <div style={{ marginBottom: 12 }}>
            Maker rebates, liquidity rewards, and mint/burn arbitrage are
            <span style={{ color: colors.text }}> structural edges</span>
            <span> — available regardless of which way a market resolves.</span>
          </div>
        </AppearText>

        <AppearText delay={90}>
          <div style={{ marginTop: 24 }}>
            Most operators access them through hardcoded rules.
          </div>
        </AppearText>

        <AppearText delay={140}>
          <div
            style={{
              marginTop: 24,
              fontSize: 30,
              color: colors.cyan,
              fontFamily: fonts.body,
              letterSpacing: "0.01em",
            }}
          >
            Skim uses Opus 4.7 to reason about each market dynamically.
          </div>
        </AppearText>
      </div>
    </AbsoluteFill>
  );
};
