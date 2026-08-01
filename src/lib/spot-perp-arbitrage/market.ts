import type { SearchExchangeRate } from "../search";
import type { ArbitrageMarket } from "./model";

export const SPOT_QUOTE_FILTERS = ["USDT", "USDC", "U", "USD1", "USD", "all"] as const;
export type SpotQuoteFilter = (typeof SPOT_QUOTE_FILTERS)[number];
export const DEFAULT_SPOT_QUOTE_FILTER: SpotQuoteFilter = "USDT";

/** Quote selection deliberately leaves every perp row untouched. */
export function applySpotQuoteFilter(
  markets: readonly ArbitrageMarket[],
  quote: SpotQuoteFilter = DEFAULT_SPOT_QUOTE_FILTER,
): ArbitrageMarket[] {
  if (quote === "all") return [...markets];
  return markets.filter((market) => market.kind === "perp" || market.source.quoteAsset.toUpperCase() === quote);
}

export type BinanceOpenInterestHydration = ReadonlyMap<
  string,
  { openInterest: number; notionalValue: number }
>;

/** Select only unresolved Binance perps from the already-matched result set. */
export function selectPendingBinanceOpenInterestTargets(
  matchedMarkets: readonly ArbitrageMarket[],
): SearchExchangeRate[] {
  return matchedMarkets.flatMap((market) => (
    market.kind === "perp" && market.source.exchange === "Binance" && !market.source.oiLoaded
      ? [market.source]
      : []
  ));
}

/** Apply successful symbol entries without changing market wrappers or unrelated source objects. */
export function applyBinanceOpenInterestHydration(
  universe: ArbitrageMarket[],
  hydration: BinanceOpenInterestHydration,
): ArbitrageMarket[] {
  if (hydration.size === 0) return universe;
  let changed = false;
  const next = universe.map((market) => {
    if (market.kind !== "perp" || market.source.exchange !== "Binance" || market.source.oiLoaded) {
      return market;
    }
    const hydrated = hydration.get(market.source.symbol);
    if (!hydrated) return market;
    changed = true;
    return {
      ...market,
      source: {
        ...market.source,
        openInterest: hydrated.openInterest,
        notionalValue: hydrated.notionalValue,
        oiLoaded: true,
      },
    };
  });
  return changed ? next : universe;
}
