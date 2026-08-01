import type { SpotExchangeName } from "./spot-search";

export interface NormalizedBookLevel { price: number; quantity: number }
export interface NormalizedOrderBook { bids: NormalizedBookLevel[]; asks: NormalizedBookLevel[] }
export type BookSide = "bid" | "ask";
export type OrderBookImpactResult = number | "insufficient" | null;
export type ImpactDepthMode = "standard" | "max";

export const STANDARD_SPOT_IMPACT_DEPTH_LIMITS = {
  Hyperliquid: 20,
  "Gate.io": 100,
  Binance: 100,
  OKX: 100,
  Lighter: 100,
  Bitget: 100,
} as const;

export const MAX_SPOT_IMPACT_DEPTH_LIMITS = {
  Hyperliquid: 20,
  "Gate.io": 100,
  Binance: 5000,
  OKX: 5000,
  Lighter: 250,
  Bitget: 150,
} as const;

export const STANDARD_PERP_IMPACT_DEPTH_LIMITS = {
  Hyperliquid: 20,
  "Gate.io": 100,
  Binance: 100,
  OKX: 100,
  Lighter: 100,
  Bitget: 100,
} as const;

export const MAX_PERP_IMPACT_DEPTH_LIMITS = {
  Hyperliquid: 20,
  "Gate.io": 100,
  Binance: 1000,
  OKX: 5000,
  Lighter: 250,
  Bitget: 1000,
} as const;

/** Compatibility alias for the original standard perpetual policy. */
export const PERP_IMPACT_DEPTH_LIMITS = STANDARD_PERP_IMPACT_DEPTH_LIMITS;

type ImpactExchangeName = keyof typeof STANDARD_PERP_IMPACT_DEPTH_LIMITS;

export function resolveSpotImpactDepth(exchange: ImpactExchangeName, mode: ImpactDepthMode = "standard"): number {
  return mode === "max" ? MAX_SPOT_IMPACT_DEPTH_LIMITS[exchange] : STANDARD_SPOT_IMPACT_DEPTH_LIMITS[exchange];
}

export function resolvePerpImpactDepth(exchange: ImpactExchangeName, mode: ImpactDepthMode = "standard"): number {
  return mode === "max" ? MAX_PERP_IMPACT_DEPTH_LIMITS[exchange] : STANDARD_PERP_IMPACT_DEPTH_LIMITS[exchange];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeBookLevels(levels: unknown, side: BookSide): NormalizedBookLevel[] {
  if (!Array.isArray(levels)) return [];
  const parsed = levels.flatMap((value): NormalizedBookLevel[] => {
    const row = object(value);
    const price = Number(Array.isArray(value) ? value[0] : row?.price ?? row?.px ?? row?.p);
    const quantity = Number(Array.isArray(value) ? value[1] : row?.remaining_base_amount ?? row?.quantity ?? row?.qty ?? row?.size ?? row?.sz ?? row?.s);
    return Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0 ? [{ price, quantity }] : [];
  });
  return parsed.sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
}

export function normalizeSpotOrderBook(exchange: SpotExchangeName, payload: unknown): NormalizedOrderBook | null {
  const root = object(payload);
  if (!root) return null;
  let bids: unknown = root.bids;
  let asks: unknown = root.asks;
  if (exchange === "Hyperliquid" && Array.isArray(root.levels)) [bids, asks] = root.levels;
  if (exchange === "OKX" && Array.isArray(root.data)) {
    const book = object(root.data[0]); bids = book?.bids; asks = book?.asks;
  }
  if (exchange === "Bitget" && root.data) {
    const book = object(root.data); bids = book?.bids; asks = book?.asks;
  }
  if (!Array.isArray(bids) || !Array.isArray(asks)) return null;
  return { bids: normalizeBookLevels(bids, "bid"), asks: normalizeBookLevels(asks, "ask") };
}

/** VWAP for selling base on bids or acquiring base on asks for a quote-notional target. */
export function computeQuoteNotionalVwap(
  levels: readonly NormalizedBookLevel[],
  quoteNotional: number,
): OrderBookImpactResult {
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  let quote = 0;
  let base = 0;
  for (const level of levels) {
    if (!(level.price > 0 && level.quantity > 0)) continue;
    const availableQuote = level.price * level.quantity;
    const consumedQuote = Math.min(availableQuote, quoteNotional - quote);
    quote += consumedQuote;
    base += consumedQuote / level.price;
    if (quote >= quoteNotional) return quoteNotional / base;
  }
  return "insufficient";
}

export const computeSpotVwap = computeQuoteNotionalVwap;

export function computeOrderBookImpactSpread(
  book: NormalizedOrderBook,
  quoteNotional: number,
): OrderBookImpactResult {
  // Every caller gets best-to-worst execution regardless of transport order.
  // Sorting copies is intentional: cached/normalized source books stay untouched.
  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bid = computeQuoteNotionalVwap(bids, quoteNotional);
  const ask = computeQuoteNotionalVwap(asks, quoteNotional);
  if (bid === null || ask === null) return null;
  if (bid === "insufficient" || ask === "insufficient") return "insufficient";
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : null;
}
