import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";
import { Typewriter } from "../components/Typewriter";

// Real Alpha reasoning produced by claude-opus-4-7 on a live market in
// production (Iranian regime tail event). Verbatim from /api/signals.
const REASONING_TEXT = `Book shape (from chart): almost entirely one-sided.
Ask-side depth $2.5M / $4.4M.  Bid-side $1.1k / $2.5k — >1000:1 imbalance.

Layer 1 — Mint/Burn arbitrage:
  YES ask 0.999, implied NO ask ≈ 0.999 → complement_sum = 1.998
  BURN: buy YES + NO at asks = 1.998, redeem $1 → −$0.998 net. Dead.
  MINT: sell YES + NO at bids = 0.039, mint cost $1 → −$0.961 net. Dead.

Layer 2 — Market making:
  True quoted spread is 0.999 − 0.038 = 96.1%.
  Quoting a bid here means standing in front of informed sellers in a
  near-resolution tail-event market. Severe adverse selection risk.

Layer 3 — Reward farming:
  two_sided_eligible = false, pool = $0. Ineligible.

Verdict: skip.`;

// Sentence boundaries (\\n\\n) — pause briefly so the layered structure
// reads naturally.
const PAUSES: number[] = (() => {
  const indices: number[] = [];
  for (let i = 0; i < REASONING_TEXT.length; i++) {
    if (REASONING_TEXT[i] === "\n" && REASONING_TEXT[i + 1] === "\n") {
      indices.push(i + 1);
    }
  }
  return indices;
})();

export const LiveReasoning = () => {
  const frame = useCurrentFrame();

  // Score forms up at the end of the reasoning
  const scoreReveal = interpolate(frame, [1300, 1380], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        padding: "70px 100px",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <AppearText delay={0}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: fonts.body,
                fontSize: 13,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: colors.cyan,
              }}
            >
              Live Alpha reasoning · streaming from Anthropic API
            </div>
            <div
              style={{
                fontFamily: fonts.display,
                fontSize: 44,
                fontWeight: 400,
                color: colors.text,
                marginTop: 10,
                fontStyle: "italic",
              }}
            >
              "Will the Iranian regime fall by May 31?"
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 13,
                color: colors.textFaint,
                marginTop: 6,
              }}
            >
              market_id 0x789c…  ·  vol_24h $845,815  ·  resolution_days 35
            </div>
          </div>

          <ModelBadge />
        </div>
      </AppearText>

      {/* Streaming reasoning panel */}
      <div
        style={{
          flex: 1,
          background: "#050505",
          border: `1px solid ${colors.border}`,
          padding: "26px 32px",
          fontFamily: fonts.mono,
          fontSize: 18,
          lineHeight: 1.65,
          color: "rgba(53, 231, 255, 0.85)",
          whiteSpace: "pre-wrap",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontFamily: fonts.body,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: colors.textFaint,
            marginBottom: 14,
          }}
        >
          input_json_delta · alpha_signal
        </div>
        <Typewriter
          text={REASONING_TEXT}
          startFrame={20}
          charsPerFrame={5.2}
          pauseAt={PAUSES}
          pauseFrames={18}
        />
      </div>

      {/* Bottom row — structured signal materialising */}
      <div style={{ display: "flex", gap: 16 }}>
        <div
          style={{
            flex: 1,
            padding: "14px 20px",
            background: colors.bg2,
            border: `1px solid ${colors.border}`,
          }}
        >
          <Label>Opportunity score</Label>
          <ScoreBar value={0.03 * scoreReveal} />
        </div>
        <div
          style={{
            flex: 1,
            padding: "14px 20px",
            background: colors.bg2,
            border: `1px solid ${
              scoreReveal > 0.5 ? colors.red : colors.border
            }`,
            opacity: scoreReveal,
          }}
        >
          <Label>recommendation</Label>
          <div
            style={{
              fontFamily: fonts.display,
              fontSize: 32,
              color: colors.red,
              marginTop: 4,
              letterSpacing: "0.02em",
              textTransform: "lowercase",
              fontStyle: "italic",
            }}
          >
            skip
          </div>
        </div>
        <div
          style={{
            flex: 2,
            padding: "14px 20px",
            background: colors.bg2,
            border: `1px solid ${colors.border}`,
            opacity: scoreReveal,
          }}
        >
          <Label>risk_flags</Label>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 14,
              color: colors.amber,
              marginTop: 6,
              lineHeight: 1.6,
            }}
          >
            one_sided_book · tail_event_adverse_selection · no_reward_pool
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: fonts.body,
      fontSize: 10,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: colors.textFaint,
    }}
  >
    {children}
  </div>
);

const ScoreBar: React.FC<{ value: number }> = ({ value }) => {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          height: 6,
          background: colors.bg3,
          width: "100%",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${value * 100}%`,
            background: value < 0.3 ? colors.textFaint : colors.cyan,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 14,
          color: colors.textFaint,
        }}
      >
        {value.toFixed(2)} / 1.0
      </div>
    </div>
  );
};

const ModelBadge: React.FC = () => (
  <div
    style={{
      padding: "8px 16px",
      border: `1px solid ${colors.cyanMid}`,
      background: colors.cyanDim,
      fontFamily: fonts.mono,
      fontSize: 13,
      color: colors.cyan,
      letterSpacing: "0.06em",
    }}
  >
    claude-opus-4-7
  </div>
);
