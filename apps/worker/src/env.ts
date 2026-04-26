export interface Env {
  // Durable Objects
  SCANNER: DurableObjectNamespace;
  ORCHESTRATOR: DurableObjectNamespace;

  // Storage
  DB: D1Database;
  CACHE: KVNamespace;

  // Static assets (built React dashboard)
  ASSETS: Fetcher;

  // Vars
  EXECUTION_MODE: "observe" | "paper" | "live_limited" | "live";
  POLYMARKET_WS_URL: string;
  BAYSE_WS_URL: string;
  MAX_TOTAL_EXPOSURE_USD: string;
  MAX_NOTIONAL_PER_MARKET_USD: string;
  DAILY_LOSS_LIMIT_USD: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  BAYSE_PUBLIC_API_KEY?: string;
  BAYSE_API_SECRET?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_PUBLIC_KEY?: string;
  /**
   * HTTP-CONNECT proxy URL for egress that bypasses Bayse's IP block on CF.
   * Format: http://user:pass@host:port
   */
  PROXY_URL?: string;
  /**
   * Shared secret with apps/relay. When set, the seed endpoint and the
   * orderbook ingest endpoint require an X-Relay-Auth header to match.
   * Generate with: openssl rand -hex 32
   */
  RELAY_SECRET?: string;
}
