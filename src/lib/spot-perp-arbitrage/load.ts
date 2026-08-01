import { fetchSearchCandles, type SearchCandleResult, type SearchChartInterval } from "../search-candles";
import { fetchSpotCandles, type SpotCandleResult } from "../spot-search-candles";
import type { ArbitrageMarket, PerpMarket, SpotMarket } from "./model";
import { normalizePerpSeries, normalizeSpotSeries, type LegSeries } from "./series";

export interface LoadedPerpLeg {
  kind: "perp";
  market: PerpMarket;
  original: SearchCandleResult;
  series: LegSeries;
}

export interface LoadedSpotLeg {
  kind: "spot";
  market: SpotMarket;
  original: SpotCandleResult;
  series: LegSeries;
}

export type LoadedLeg = LoadedPerpLeg | LoadedSpotLeg;

/** Impure source dispatcher. The untouched source result is retained for legacy perp combos. */
export async function loadMarketCandles(
  market: ArbitrageMarket,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<LoadedLeg> {
  if (market.kind === "perp") {
    const original = await fetchSearchCandles(market.source, interval, signal);
    return { kind: "perp", market, original, series: normalizePerpSeries(market, original) };
  }
  const original = await fetchSpotCandles(market.source, interval, signal);
  return { kind: "spot", market, original, series: normalizeSpotSeries(market, original) };
}
