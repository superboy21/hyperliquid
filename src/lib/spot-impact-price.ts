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
  const book = await fetchSpotBook(row, signal, mode, bookMode);
  return book ? computeOrderBookImpactDetail(book, quoteNotional) : null;
}
