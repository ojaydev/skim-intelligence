import { AbsoluteFill } from "remotion";
import { colors, fonts } from "../Brand";
import { AppearText } from "../components/AppearText";

interface AgentRow {
  name: string;
  model: string;
  role: string;
  isLLM: boolean;
}

const AGENTS: AgentRow[] = [
  {
    name: "Scanner",
    model: "deterministic",
    role: "Holds Polymarket WS + Bayse relay; persists MarketSnapshots",
    isLLM: false,
  },
  {
    name: "Alpha",
    model: "claude-opus-4-7",
    role: "Reasons across 3 strategy layers; streams tool-use JSON live",
    isLLM: true,
  },
  {
    name: "Risk",
    model: "claude-opus-4-7",
    role: "Circuit breaker — hard limits on exposure, freshness, inventory",
    isLLM: true,
  },
  {
    name: "Execution",
    model: "deterministic",
    role: "Paper trading state machine with negative-EV guards",
    isLLM: false,
  },
  {
    name: "Reporter",
    model: "claude-opus-4-7",
    role: "Epoch-close P&L attribution across spread / rewards / arb / fees",
    isLLM: true,
  },
];

export const Agents = () => {
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
          Five agents · three powered by Opus 4.7
        </div>
      </AppearText>

      <AppearText delay={10}>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 64,
            fontWeight: 300,
            color: colors.text,
            lineHeight: 1.1,
          }}
        >
          The pipeline.
        </div>
      </AppearText>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        {AGENTS.map((agent, i) => (
          <AppearText key={agent.name} delay={40 + i * 18}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "200px 280px 1fr",
                alignItems: "center",
                gap: 24,
                padding: "16px 22px",
                background: colors.bg2,
                border: `1px solid ${agent.isLLM ? colors.cyanMid : colors.border}`,
              }}
            >
              <div
                style={{
                  fontFamily: fonts.display,
                  fontSize: 28,
                  fontWeight: 400,
                  color: colors.text,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {agent.name}
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 14,
                  color: agent.isLLM ? colors.cyan : colors.textFaint,
                }}
              >
                {agent.model}
              </div>
              <div
                style={{
                  fontFamily: fonts.body,
                  fontSize: 17,
                  color: colors.textDim,
                  lineHeight: 1.5,
                }}
              >
                {agent.role}
              </div>
            </div>
          </AppearText>
        ))}
      </div>
    </AbsoluteFill>
  );
};
