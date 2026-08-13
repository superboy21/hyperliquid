/** Shared source lineage for fetched candle series. */
export type CandleSourceKind =
  | "official UTC"
  | "official 1Dutc"
  | "official 1Wutc"
  | "official native interval"
  | "official daily aggregation to UTC Monday"
  | "aggregated from 4h (UTC day)"
  | "aggregated from 4h (UTC week)";

export type QuoteTurnoverSource = "official" | "derived" | "unavailable";

export interface CandleSourceProvenance {
  exchange: string;
  requestedInterval: string;
  sourceInterval: string;
  sourceKind: CandleSourceKind;
  quoteTurnover: QuoteTurnoverSource;
}

export function candleSourceLabel(provenance: CandleSourceProvenance): CandleSourceKind {
  return provenance.sourceKind;
}

export function createCandleSourceProvenance(
  exchange: string,
  requestedInterval: string,
  sourceInterval: string,
  aggregateWeekly: boolean,
): CandleSourceProvenance {
  const quoteTurnover: QuoteTurnoverSource = exchange === "Hyperliquid" || exchange === "Lighter"
    ? "derived"
    : "official";
  if (aggregateWeekly) {
    return { exchange, requestedInterval, sourceInterval, sourceKind: "official daily aggregation to UTC Monday", quoteTurnover };
  }
  if (requestedInterval === "1d") {
    return {
      exchange,
      requestedInterval,
      sourceInterval,
      sourceKind: exchange === "Bitget" || exchange === "OKX" ? "official 1Dutc" : "official UTC",
      quoteTurnover,
    };
  }
  if (requestedInterval === "1w") {
    return {
      exchange,
      requestedInterval,
      sourceInterval,
      sourceKind: exchange === "Bitget" || exchange === "OKX"
        ? "official 1Wutc"
        : exchange === "Binance" || exchange === "Gate.io" || exchange === "Bybit"
          ? "official UTC"
          : "official native interval",
      quoteTurnover,
    };
  }
  return { exchange, requestedInterval, sourceInterval, sourceKind: "official native interval", quoteTurnover };
}

/**
 * Provenance for Bitget rToken candles, which have no official UTC day/week
 * granularity and must be rebuilt from UTC-aligned 4h buckets.
 */
export function createBitgetRTokenProvenance(
  requestedInterval: "1d" | "1w",
  sourceInterval: "4h",
): CandleSourceProvenance {
  return {
    exchange: "Bitget",
    requestedInterval,
    sourceInterval,
    sourceKind: requestedInterval === "1d" ? "aggregated from 4h (UTC day)" : "aggregated from 4h (UTC week)",
    quoteTurnover: "official",
  };
}
