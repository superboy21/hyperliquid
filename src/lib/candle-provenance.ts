/** Shared source lineage for fetched candle series. */
export type CandleSourceKind =
  | "official UTC"
  | "official 1Dutc"
  | "official 1Wutc"
  | "official native interval"
  | "official daily aggregation to UTC Monday";

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
