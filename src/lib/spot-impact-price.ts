import {
  computeOrderBookImpactDetail,
  computeOrderBookImpactSpread,
  normalizeSpotOrderBook,
  resolveSpotImpactDepth,
  type ImpactDepthMode,
  type NormalizedOrderBook,
  type OrderBookImpactDetailResult,
} from "./order-book-impact";
import { clampRpiDepth, normalizeSpotRpiOrderBook, type BookMode } from "./rpi-book";
import { spotFetch } from "./spot-fetch";
import type { SpotExchangeName, SpotMarketRow } from "./spot-search";

export const SPOT_IMPACT_PRESETS = [200, 1000, 5000, 10000] as const;
export type SpotImpactResult = number | "insufficient" | null;

/**
 * Bitget rToken 现货的 BBO 假想流动性（USD）。
 * rToken 的真实可成交报价在 ticker BBO（锚定美股盘口），公开 orderbook 只是本地薄簿。
 * 策略计算中假设 BBO 的 bid/ask 各提供该名义金额的流动性。
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

async function fetchSpotBook(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  mode: ImpactDepthMode,
  bookMode: BookMode = "normal",
): Promise<NormalizedOrderBook | null> {
  const rawDepth = resolveSpotImpactDepth(row.exchange, mode);
  const depth = bookMode === "rpi" ? clampRpiDepth(row.exchange, "spot", rawDepth) : rawDepth;
  const params = new URLSearchParams({ action: "book", limit: String(depth) });
  if (bookMode === "rpi") params.set("rpi", "1");
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  try {
    const response = await spotFetch(row.exchange, params, { signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return bookMode === "rpi"
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
): Promise<SpotImpactResult>;
/** Compatibility overload for existing consumers using the perp-style argument order. */
export function fetchSpotImpactSpread(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  quoteNotional?: number,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
): Promise<SpotImpactResult>;
export async function fetchSpotImpactSpread(
  row: SpotMarketRow,
  quoteNotionalOrSignal: number | AbortSignal | undefined,
  signalOrNotional?: AbortSignal | number,
  mode: ImpactDepthMode = "standard",
  bookMode: BookMode = "normal",
): Promise<SpotImpactResult> {
  const quoteNotional = typeof quoteNotionalOrSignal === "number"
    ? quoteNotionalOrSignal
    : typeof signalOrNotional === "number" ? signalOrNotional : 1000;
  const signal = typeof quoteNotionalOrSignal === "number"
    ? signalOrNotional as AbortSignal | undefined
    : quoteNotionalOrSignal;
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  // rToken 现货：真实成本在 ticker BBO（假想 10000 USD 深度），orderbook 仅作 fallback。
  if (row.isRealityToken) {
    const realityBook = buildRealityTickerBboBook(row);
    if (realityBook !== null) return computeOrderBookImpactSpread(realityBook, quoteNotional);
  }
  const book = await fetchSpotBook(row, signal, mode, bookMode);
  return book ? computeOrderBookImpactSpread(book, quoteNotional) : null;
}

export function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  quoteNotional: number,
  signal?: AbortSignal,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
): Promise<OrderBookImpactDetailResult>;
/** Compatibility overload for existing consumers using the perp-style argument order. */
export function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  quoteNotional?: number,
  mode?: ImpactDepthMode,
  bookMode?: BookMode,
): Promise<OrderBookImpactDetailResult>;
export async function fetchSpotImpactSpreadDetail(
  row: SpotMarketRow,
  quoteNotionalOrSignal: number | AbortSignal | undefined,
  signalOrNotional?: AbortSignal | number,
  mode: ImpactDepthMode = "standard",
  bookMode: BookMode = "normal",
): Promise<OrderBookImpactDetailResult> {
  const quoteNotional = typeof quoteNotionalOrSignal === "number"
    ? quoteNotionalOrSignal
    : typeof signalOrNotional === "number" ? signalOrNotional : 1000;
  const signal = typeof quoteNotionalOrSignal === "number"
    ? signalOrNotional as AbortSignal | undefined
    : quoteNotionalOrSignal;
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  // rToken 现货：真实成本在 ticker BBO（假想 10000 USD 深度），orderbook 仅作 fallback。
  if (row.isRealityToken) {
    const realityBook = buildRealityTickerBboBook(row);
    if (realityBook !== null) return computeOrderBookImpactDetail(realityBook, quoteNotional);
  }
  const book = await fetchSpotBook(row, signal, mode, bookMode);
  return book ? computeOrderBookImpactDetail(book, quoteNotional) : null;
}
