import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

const FLAGS = [
  { code: "one_sided_book", note: "ask depth $7.9M vs bid depth $83" },
  { code: "longshot_market", note: "best_bid 0.019, best_ask 0.999" },
  { code: "no_reward_pool", note: "two_sided_eligible = false" },
  { code: "degenerate_spread", note: "98% gap, no real two-sided book" },
];

export const RiskRejection = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stamp = spring({
    frame: frame - 130,
    fps,
    config: { damping: 9, stiffness: 200 },
  });
  const stampScale = interpolate(stamp, [0, 1], [0.4, 1]);
  const stampOpacity = interpolate(stamp, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });
  const stampRotation = interpolate(stamp, [0, 1], [-25, -8]);

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        padding: "100px 140px",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <AppearText delay={0}>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 13,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: colors.amber,
          }}
        >
          Risk Agent · circuit breaker
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
          When Alpha is wrong, Risk says no.
        </div>
      </AppearText>

      <AppearText delay={50}>
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 22,
            color: colors.textDim,
            marginTop: 4,
          }}
        >
          Independent prompt, independent failure modes. Hard limits enforced before any order is placed.
        </div>
      </AppearText>

      <div style={{ position: "relative", marginTop: 30 }}>
        <AppearText delay={70}>
          <div
            style={{
              padding: "26px 32px",
              background: colors.bg2,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div
              style={{
                fontFamily: fonts.display,
                fontSize: 28,
                fontStyle: "italic",
                color: colors.text,
                marginBottom: 20,
              }}
            >
              "Will the Minnesota Timberwolves win the 2026 NBA Finals?"
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {FLAGS.map((flag, i) => (
                <AppearText key={flag.code} delay={90 + i * 10}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "8px 360px 1fr",
                      alignItems: "center",
                      gap: 18,
                      padding: "10px 0",
                      borderBottom:
                        i < FLAGS.length - 1
                          ? `1px solid ${colors.border}`
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        background: colors.amber,
                      }}
                    />
                    <div
                      style={{
                        fontFamily: fonts.mono,
                        fontSize: 17,
                        color: colors.amber,
                      }}
                    >
                      {flag.code}
                    </div>
                    <div
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 18,
                        color: colors.textDim,
                      }}
                    >
                      {flag.note}
                    </div>
                  </div>
                </AppearText>
              ))}
            </div>
          </div>
        </AppearText>

        {/* "REJECTED" stamp */}
        <div
          style={{
            position: "absolute",
            right: 60,
            top: 110,
            fontFamily: fonts.display,
            fontSize: 88,
            fontWeight: 600,
            color: colors.red,
            letterSpacing: "0.08em",
            border: `5px solid ${colors.red}`,
            padding: "12px 32px",
            opacity: stampOpacity * 0.85,
            transform: `rotate(${stampRotation}deg) scale(${stampScale})`,
            transformOrigin: "center",
          }}
        >
          REJECTED
        </div>
      </div>
    </AbsoluteFill>
  );
};
