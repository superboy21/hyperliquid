import {
  computeOrderBookImpactDetail,
  computeOrderBookImpactSpread,
  normalizeBookLevels,
  normalizeSpotOrderBook,
  resolveSpotImpactDepth,
  type ImpactDepthMode,
  type NormalizedOrderBook,
  type OrderBookImpactDetailResult,
} from "./order-book-impact";
import { clampRpiDepth, normalizeSpotRpiOrderBook, type BookMode } from "./rpi-book";
import { spotFetch } from "./spot-fetch";
import { isBitgetRealityWeekend, type SpotExchangeName, type SpotMarketRow } from "./spot-search";

export const SPOT_IMPACT_PRESETS = [200, 1000, 5000, 10000] as const;
export type SpotImpactResult = number | "insufficient" | null;

/**
 * Bitget rToken 现货工作日的 BBO 假想流动性（USD）。
 * UTC 周末改用公共 V3 SPOT orderbook；该假想盘口只保留工作日兼容行为。
 */
export const REALITY_BBO_NOTIONAL_USD = 10000;

function positive(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * rToken 现货按 ticker BBO 构造假想盘口：bid/ask 各挂 REALITY_BBO_NOTIONAL_USD 名义。
 * 名义金额 ≤ 上限时冲击价就是 BBO 价本身；超过上限由 impact 计算返回 "insufficient"。
 */
export function buildRealityTickerBboBook(row: Pick<SpotMarketRow, "bestBid" | "bestAsk">): NormalizedOrderBook | null {
  const bid = positive(row.bestBid);
  const ask = positive(row.bestAsk);
  if (bid === undefined || ask === undefined) return null;
  return {
    bids: [{ price: bid, quantity: REALITY_BBO_NOTIONAL_USD / bid }],
    asks: [{ price: ask, quantity: REALITY_BBO_NOTIONAL_USD / ask }],
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Bitget public V3 Reality weekend book: data.b/data.a, with both usable sides required. */
export function normalizeBitgetRealityV3OrderBook(payload: unknown): NormalizedOrderBook | null {
  const data = object(object(payload)?.data);
  if (!data || !Array.isArray(data.b) || !Array.isArray(data.a)) return null;
  const bids = normalizeBookLevels(data.b, "bid");
  const asks = normalizeBookLevels(data.a, "ask");
  return bids.length > 0 && asks.length > 0 ? { bids, asks } : null;
}

async function fetchSpotBook(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  mode: ImpactDepthMode,
  bookMode: BookMode = "normal",
  now: Date | number = new Date(),
): Promise<NormalizedOrderBook | null> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  const rawDepth = resolveSpotImpactDepth(row.exchange, mode);
  const realityWeekend = isBitgetRealityWeekend(row, now);
  const depth = bookMode === "rpi" && !realityWeekend ? clampRpiDepth(row.exchange, "spot", rawDepth) : rawDepth;
  const params = new URLSearchParams({ action: realityWeekend ? "realityBook" : "book", limit: String(depth) });
  if (bookMode === "rpi" && !realityWeekend) params.set("rpi", "1");
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  try {
    const response = await spotFetch(row.exchange, params, { signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return realityWeekend
      ? normalizeBitgetRealityV3OrderBook(payload)
      : bookMode === "rpi"
      ? normalizeSpotRpiOrderBook(row.exchange, payload)
      : normalizeSpotOrderBook(row.exchange, payload);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function fetchSpotImpactSpread(
  row: SpotMarketRow,
  quoteNotional: number,
  signal?: AbortSignal,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
  now?: Date | number,
): Promise<SpotImpactResult>;
/** Compatibility overload for existing consumers using the perp-style argument order. */
export function fetchSpotImpactSpread(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  quoteNotional?: number,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
  now?: Date | number,
): Promise<SpotImpactResult>;
export async function fetchSpotImpactSpread(
  row: SpotMarketRow,
  quoteNotionalOrSignal: number | AbortSignal | undefined,
  signalOrNotional?: AbortSignal | number,
  mode: ImpactDepthMode = "standard",
  bookMode: BookMode = "normal",
  now: Date | number = new Date(),
): Promise<SpotImpactResult> {
  const quoteNotional = typeof quoteNotionalOrSignal === "number"
    ? quoteNotionalOrSignal
    : typeof signalOrNotional === "number" ? signalOrNotional : 1000;
  const signal = typeof quoteNotionalOrSignal === "number"
    ? signalOrNotional as AbortSignal | undefined
    : quoteNotionalOrSignal;
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  // Weekends use public V3 Reality depth exclusively. Weekdays retain the
  // established ticker-BBO synthetic book and V2/RPI fallback behavior.
  if (row.isRealityToken && !isBitgetRealityWeekend(row, now)) {
    const realityBook = buildRealityTickerBboBook(row);
    if (realityBook !== null) return computeOrderBookImpactSpread(realityBook, quoteNotional);
  }
  const book = await fetchSpotBook(row, signal, mode, bookMode, now);
  return book ? computeOrderBookImpactSpread(book, quoteNotional) : null;
}

export function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  quoteNotional: number,
  signal?: AbortSignal,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
  now?: Date | number,
): Promise<OrderBookImpactDetailResult>;
/** Compatibility overload for existing consumers using the perp-style argument order. */
export function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  quoteNotional?: number,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
  now?: Date | number,
): Promise<OrderBookImpactDetailResult>;
export async function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  quoteNotionalOrSignal: number | AbortSignal | undefined,
  signalOrNotional?: AbortSignal | number,
  mode: ImpactDepthMode = "standard",
  bookMode: BookMode = "normal",
  now: Date | number = new Date(),
): Promise<OrderBookImpactDetailResult> {
  const quoteNotional = typeof quoteNotionalOrSignal === "number"
    ? quoteNotionalOrSignal
    : typeof signalOrNotional === "number" ? signalOrNotional : 1000;
  const signal = typeof quoteNotionalOrSignal === "number"
    ? signalOrNotional as AbortSignal | undefined
    : quoteNotionalOrSignal;
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  // See fetchSpotImpactSpread: Reality ticker-BBO pricing is weekday-only.
  if (row.isRealityToken && !isBitgetRealityWeekend(row, now)) {
    const realityBook = buildRealityTickerBboBook(row);
    if (realityBook !== null) return computeOrderBookImpactDetail(realityBook, quoteNotional);
  }
  const book = await fetchSpotBook(row, signal, mode, bookMode, now);
  return book ? computeOrderBookImpactDetail(book, quoteNotional) : null;
}
