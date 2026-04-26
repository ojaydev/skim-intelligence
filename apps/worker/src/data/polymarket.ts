// Polymarket REST + WS client helpers.
//
// Gamma API (market list):     https://gamma-api.polymarket.com/markets
// CLOB API (orderbook REST):   https://clob.polymarket.com/book?token_id=...
// CLOB WS (live deltas):       wss://ws-subscriptions-clob.polymarket.com/ws/market

export interface GammaMarket {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  category?: string;
  volume24hr?: number;
  endDate?: string;
  clobTokenIds?: string; // JSON-stringified [yesTokenId, noTokenId]
  orderPriceMinTickSize?: number;
  active?: boolean;
  closed?: boolean;
}

export interface ParsedMarket {
  conditionId: string;
  title: string;
  category: string;
  yesTokenId: string;
  noTokenId: string;
  volume_24h_usd: number;
  end_date: string;
  tick_size: number;
}

export interface BookLevel {
  price: string;
  size: string;
}

export interface Book {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: BookLevel[]; // sorted ascending by price
  asks: BookLevel[]; // sorted ascending by price
  hash?: string;
}

export interface BookEvent {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: BookLevel[];
  asks: BookLevel[];
  timestamp: string;
  hash?: string;
}

export interface PriceChangeEvent {
  event_type: "price_change";
  asset_id: string;
  market: string;
  changes: Array<{ price: string; side: "BUY" | "SELL"; size: string }>;
  timestamp: string;
}

export interface BestBidAskEvent {
  event_type: "best_bid_ask";
  asset_id: string;
  market: string;
  best_bid: string;
  best_ask: string;
  timestamp: string;
}

export type MarketEvent =
  | BookEvent
  | PriceChangeEvent
  | BestBidAskEvent
  | { event_type: string; [key: string]: unknown };

/**
 * Fetch the top N active, liquid markets from Gamma, ranked by 24h volume.
 * Markets below `minVolumeUsd` are filtered out before the limit is applied;
 * we overfetch from Gamma to compensate.
 */
export async function fetchActiveMarkets(
  limit = 10,
  minVolumeUsd = 0,
): Promise<ParsedMarket[]> {
  const overfetch = minVolumeUsd > 0 ? Math.max(limit * 4, 60) : limit;
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(overfetch));
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`gamma_${res.status}`);
  const raw = (await res.json()) as GammaMarket[];

  const parsed: ParsedMarket[] = [];
  for (const m of raw) {
    if (!m.clobTokenIds) continue;
    const vol = Number(m.volume24hr ?? 0);
    if (vol < minVolumeUsd) continue;
    let tokens: unknown;
    try {
      tokens = JSON.parse(m.clobTokenIds);
    } catch {
      continue;
    }
    if (!Array.isArray(tokens) || tokens.length < 2) continue;
    const yes = String(tokens[0] ?? "");
    const no = String(tokens[1] ?? "");
    if (!yes || !no) continue;

    parsed.push({
      conditionId: m.conditionId,
      title: m.question,
      category: m.category ?? "other",
      yesTokenId: yes,
      noTokenId: no,
      volume_24h_usd: vol,
      end_date: m.endDate ?? "",
      tick_size: Number(m.orderPriceMinTickSize ?? 0.01),
    });
    if (parsed.length >= limit) break;
  }
  return parsed;
}

/**
 * Fetch the full CLOB orderbook for a single token (initial bootstrap).
 */
export async function fetchBook(tokenId: string): Promise<Book> {
  const res = await fetch(
    `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`,
  );
  if (!res.ok) throw new Error(`clob_book_${res.status}`);
  const book = (await res.json()) as Book;
  // Defensive defaults
  return {
    market: book.market ?? "",
    asset_id: book.asset_id ?? tokenId,
    timestamp: book.timestamp ?? String(Date.now()),
    bids: Array.isArray(book.bids) ? book.bids : [],
    asks: Array.isArray(book.asks) ? book.asks : [],
  };
}

/**
 * Build the subscribe message for a WS market channel connection.
 */
export function marketSubscribeMessage(assetIds: string[]): string {
  return JSON.stringify({ assets_ids: assetIds, type: "market" });
}
