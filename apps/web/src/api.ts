import type {
  AlphaSignal,
  FeedEvent,
  MarketSnapshot,
  RiskDecisionResult,
} from "@skim/shared";

// Use relative URLs — in dev the Vite proxy forwards /api → localhost:8787;
// in prod the dashboard is served by the Worker itself (same origin).
const BASE = "";
const WS_PATH = "/api/ws";

export async function getStatus() {
  const res = await fetch(`${BASE}/api/status`);
  return res.json();
}

export async function getMarkets(): Promise<{ count: number; snapshots: MarketSnapshot[] }> {
  const res = await fetch(`${BASE}/api/markets`);
  return res.json();
}

export async function getSignals(limit = 20): Promise<{
  signals: Array<
    Partial<AlphaSignal> & {
      id: string;
      market_id: string;
      market_title: string;
      opportunity_score: number;
      recommendation: string;
      thinking: string;
      reasoning_summary: string;
      created_at: string;
    }
  >;
}> {
  const res = await fetch(`${BASE}/api/signals?limit=${limit}`);
  return res.json();
}

export async function getPortfolio() {
  const res = await fetch(`${BASE}/api/portfolio`);
  return res.json();
}

export async function triggerAlpha(marketId: string) {
  const res = await fetch(`${BASE}/api/admin/alpha/${marketId}`, {
    method: "POST",
  });
  return res.json();
}

export async function triggerTestExecute(signalId: string) {
  const res = await fetch(`${BASE}/api/admin/test-execute/${signalId}`, {
    method: "POST",
  });
  return res.json();
}

export async function connectScanner() {
  const res = await fetch(`${BASE}/api/admin/scanner/connect`, {
    method: "POST",
  });
  return res.json();
}

export async function triggerEpochClose() {
  const res = await fetch(`${BASE}/api/admin/epoch-close`, {
    method: "POST",
  });
  return res.json();
}

// ─── Wallet (Clerk-authenticated) ─────────────────────────────────

export interface WalletState {
  balance_usd: number;
  pending_usd: number;
  deposits: Array<{
    id: string;
    amount_usd: number;
    currency: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>;
  withdrawals: Array<{
    id: string;
    amount_usd: number;
    status: string;
    created_at: string;
  }>;
  ledger: Array<{
    id: number;
    entry_type: string;
    amount_usd: number;
    description: string;
    created_at: string;
  }>;
}

export async function getWallet(token: string): Promise<WalletState> {
  const res = await fetch(`${BASE}/api/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`wallet_${res.status}`);
  return res.json();
}

export async function initDeposit(
  token: string,
  amountUsd: number,
  email: string,
): Promise<{ authorization_url: string; deposit_id: string; amount_ngn: number }> {
  const res = await fetch(`${BASE}/api/wallet/deposits/init`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount_usd: amountUsd, email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `http_${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `http_${res.status}`);
  }
  return res.json();
}

export async function getLatestEpoch(): Promise<{
  epoch: {
    id: string;
    epoch_start: string;
    epoch_end: string;
    headline: string;
    narrative: string;
    net_pnl_usd: number;
    attribution: {
      spread_capture_usd: number;
      reward_income_usd: number;
      arb_profit_usd: number;
      fees_paid_usd: number;
      net_usd: number;
      net_pct_of_deployed: number;
    } | null;
    top_markets: Array<{
      market_id: string;
      title: string;
      strategy: string;
      contribution_usd: number;
    }> | null;
    share_card: {
      headline_number: string;
      subline: string;
      period_label: string;
    } | null;
  } | null;
}> {
  const res = await fetch(`${BASE}/api/epochs/latest`);
  return res.json();
}

/**
 * Open a WebSocket to /api/ws with auto-reconnect and backoff.
 * The returned object exposes event callbacks and a close method.
 */
export type ConnectionState = "connecting" | "open" | "closed";

export function openFeed(
  onEvent: (event: FeedEvent) => void,
  onState: (state: ConnectionState) => void,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    onState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}${WS_PATH}`;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      attempt = 0;
      onState("open");
    });
    ws.addEventListener("message", (e) => {
      try {
        const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
        const event = JSON.parse(text) as FeedEvent;
        onEvent(event);
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => {
      onState("closed");
      ws = null;
      if (!closed) scheduleReconnect();
    });
    ws.addEventListener("error", () => { /* close will follow */ });
  }

  function scheduleReconnect() {
    attempt++;
    const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 5)));
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

// ─── signature-style re-exports for typing consumer components ───
export type { AlphaSignal, FeedEvent, MarketSnapshot, RiskDecisionResult };
