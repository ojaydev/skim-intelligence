import { AbsoluteFill } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

const BUCKETS = [
  { label: "Spread capture", value: "+$0.00", neg: false },
  { label: "Rewards", value: "+$0.00", neg: false },
  { label: "Mint/burn", value: "−$0.00", neg: true },
  { label: "Fees", value: "−$4.20", neg: true },
];

const NARRATIVE =
  "Two arb opportunities sized below the EV guard, no fills. Existing inventory unchanged. Risk Agent rejected 18 of 22 candidate markets — most with one-sided books or near-resolution edge cases. Net: paper P&L flat at −$4.20, no further bleed since the negative-EV guards shipped.";

export const Reporter = () => {
  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        padding: "100px 140px",
        flexDirection: "column",
        gap: 28,
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
          Reporter · 5-minute epoch close · Opus 4.7
        </div>
      </AppearText>

      <AppearText delay={10}>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 60,
            fontWeight: 300,
            color: colors.text,
            lineHeight: 1.1,
          }}
        >
          Honest attribution, every five minutes.
        </div>
      </AppearText>

      {/* Share card mockup */}
      <AppearText delay={50}>
        <div
          style={{
            marginTop: 24,
            background: colors.bg,
            border: `1px solid ${colors.cyanMid}`,
            padding: "32px 36px",
            position: "relative",
            overflow: "hidden",
            maxWidth: 1500,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 1,
              background: `linear-gradient(90deg, transparent, ${colors.cyan}, transparent)`,
            }}
          />

          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 16,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: colors.cyan,
              marginBottom: 22,
            }}
          >
            Skim Intelligence
          </div>

          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 64,
              fontWeight: 300,
              color: colors.red,
              lineHeight: 1.05,
            }}
          >
            −$4.20 over 24 epochs
          </div>
          <div
            style={{
              fontFamily: fonts.body,
              fontSize: 14,
              color: colors.textDim,
              marginTop: 6,
              marginBottom: 24,
            }}
          >
            paper trading · 2 hours · 19 fills · 22 candidate markets · 9,822 cycles
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 16,
              marginBottom: 24,
            }}
          >
            {BUCKETS.map((b, i) => (
              <AppearText key={b.label} delay={70 + i * 10}>
                <div
                  style={{
                    borderLeft: `2px solid ${colors.border}`,
                    paddingLeft: 14,
                  }}
                >
                  <div
                    style={{
                      fontFamily: fonts.body,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.18em",
                      color: colors.textFaint,
                      marginBottom: 6,
                    }}
                  >
                    {b.label}
                  </div>
                  <div
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 20,
                      color: b.neg ? colors.red : colors.cyan,
                    }}
                  >
                    {b.value}
                  </div>
                </div>
              </AppearText>
            ))}
          </div>

          <AppearText delay={130}>
            <div
              style={{
                padding: "14px 18px",
                background: colors.bg2,
                borderLeft: `2px solid ${colors.borderMid}`,
                fontFamily: fonts.body,
                fontSize: 16,
                color: colors.textDim,
                lineHeight: 1.7,
              }}
            >
              {NARRATIVE}
            </div>
          </AppearText>
        </div>
      </AppearText>
    </AbsoluteFill>
  );
};
