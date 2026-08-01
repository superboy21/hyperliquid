import {
  computeOrderBookImpactSpread,
  normalizeSpotOrderBook,
  resolveSpotImpactDepth,
  type ImpactDepthMode,
} from "./order-book-impact";
import type { SpotExchangeName, SpotMarketRow } from "./spot-search";

export const SPOT_IMPACT_PRESETS = [200, 1000, 5000, 10000] as const;
export type SpotImpactResult = number | "insufficient" | null;

const SLUG: Record<SpotExchangeName, string> = {
  Binance: "binance", OKX: "okx", "Gate.io": "gateio", Bitget: "bitget", Hyperliquid: "hyperliquid", Lighter: "lighter",
};

export function fetchSpotImpactSpread(
  row: SpotMarketRow,
  quoteNotional: number,
  signal?: AbortSignal,
  mode?: ImpactDepthMode,
): Promise<SpotImpactResult>;
/** Compatibility overload for existing consumers using the perp-style argument order. */
export function fetchSpotImpactSpread(
  row: SpotMarketRow,
  signal: AbortSignal | undefined,
  quoteNotional?: number,
  mode?: ImpactDepthMode,
): Promise<SpotImpactResult>;
export async function fetchSpotImpactSpread(
  row: SpotMarketRow,
  quoteNotionalOrSignal: number | AbortSignal | undefined,
  signalOrNotional?: AbortSignal | number,
  mode: ImpactDepthMode = "standard",
): Promise<SpotImpactResult> {
  const quoteNotional = typeof quoteNotionalOrSignal === "number"
    ? quoteNotionalOrSignal
    : typeof signalOrNotional === "number" ? signalOrNotional : 1000;
  const signal = typeof quoteNotionalOrSignal === "number"
    ? signalOrNotional as AbortSignal | undefined
    : quoteNotionalOrSignal;
  if (!Number.isFinite(quoteNotional) || quoteNotional <= 0) return null;
  const params = new URLSearchParams({ action: "book", limit: String(resolveSpotImpactDepth(row.exchange, mode)) });
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  try {
    const response = await fetch(`/api/spot/${SLUG[row.exchange]}?${params}`, { cache: "no-store", signal });
    if (!response.ok) return null;
    const book = normalizeSpotOrderBook(row.exchange, await response.json());
    return book ? computeOrderBookImpactSpread(book, quoteNotional) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
