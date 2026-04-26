import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

interface Tile {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}

const TILES: Tile[] = [
  { label: "Polymarket markets", value: "15", sub: "min volume $50k · WS" },
  { label: "Bayse markets", value: "10", sub: "via apps/relay · 5s poll" },
  { label: "Cycles run", value: "9,822", sub: "every 30 seconds" },
  { label: "Cache hit rate", value: "92%", sub: "ephemeral cache_control" },
];

export const AutoCycle = () => {
  const frame = useCurrentFrame();
  const counterProgress = interpolate(frame, [0, 100], [0, 1], {
    extrapolateRight: "clamp",
  });

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
          Auto-cycle · two venues · constantly running
        </div>
      </AppearText>

      <AppearText delay={10}>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 72,
            fontWeight: 300,
            color: colors.text,
            lineHeight: 1.1,
          }}
        >
          Always thinking.
        </div>
      </AppearText>

      <div
        style={{
          marginTop: 40,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: 14,
        }}
      >
        {TILES.map((tile, i) => (
          <AppearText key={tile.label} delay={40 + i * 12}>
            <div
              style={{
                padding: "28px 26px",
                background: colors.bg2,
                border: `1px solid ${colors.border}`,
                minHeight: 180,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  fontFamily: fonts.body,
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: colors.textDim,
                }}
              >
                {tile.label}
              </div>
              <div
                style={{
                  fontFamily: fonts.display,
                  fontSize: 76,
                  fontWeight: 300,
                  color: colors.cyan,
                  lineHeight: 1,
                  marginTop: 16,
                }}
              >
                {animateNumber(tile.value, counterProgress)}
              </div>
              <div
                style={{
                  fontFamily: fonts.body,
                  fontSize: 13,
                  color: colors.textFaint,
                  letterSpacing: "0.06em",
                  marginTop: 8,
                  textTransform: "uppercase",
                }}
              >
                {tile.sub}
              </div>
            </div>
          </AppearText>
        ))}
      </div>

      <AppearText delay={120}>
        <div
          style={{
            marginTop: 32,
            fontFamily: fonts.body,
            fontSize: 22,
            color: colors.textDim,
            lineHeight: 1.55,
            maxWidth: 1500,
          }}
        >
          Every 30s the Orchestrator picks fresh markets and runs the full
          Alpha → Risk → Execution chain in parallel — rate-limited per
          market, gated by exposure caps.
        </div>
      </AppearText>
    </AbsoluteFill>
  );
};

// Slot-machine-style count up to the target.
function animateNumber(value: string, progress: number): string {
  // Strip non-digits, animate, restore formatting
  const numeric = value.replace(/[^\d]/g, "");
  if (!numeric) return value;
  const target = parseInt(numeric, 10);
  const current = Math.round(target * progress);
  // If the original value had a comma (e.g. 9,822) preserve it
  const hadComma = value.includes(",");
  const hadPercent = value.includes("%");
  const formatted = hadComma
    ? current.toLocaleString("en-US")
    : String(current);
  return hadPercent ? `${formatted}%` : formatted;
}
