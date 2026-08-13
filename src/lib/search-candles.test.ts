import { describe, expect, test } from "bun:test";
import { aggregateDailyCandlesToWeekly, aggregateFundingRatesToCandles, resolvePerpCandleSource, toOkxBar } from "./search-candles";
import { createCandleSourceProvenance } from "./candle-provenance";

describe("perp weekly candle source policy", () => {
  test("maps OKX weekly candles to its official UTC week", () => {
    expect(toOkxBar("1d")).toBe("1Dutc");
    expect(toOkxBar("1w")).toBe("1Wutc");
  });

  test("uses Hyperliquid native weeks for singles and UTC daily aggregation for combos", () => {
    expect(resolvePerpCandleSource("Hyperliquid", "1w")).toEqual({ sourceInterval: "1w", aggregateWeekly: false });
    expect(resolvePerpCandleSource("Hyperliquid", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
  });

  test("aggregates Lighter single and combo weeks from official UTC days", () => {
    expect(resolvePerpCandleSource("Lighter", "1w")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
    expect(resolvePerpCandleSource("Lighter", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
  });

  test("describes UTC, native, and locally aggregated source provenance", () => {
    expect(createCandleSourceProvenance("OKX", "1d", "1d", false)).toMatchObject({ sourceKind: "official 1Dutc", quoteTurnover: "official" });
    expect(createCandleSourceProvenance("Hyperliquid", "1w", "1w", false)).toMatchObject({ sourceKind: "official native interval", quoteTurnover: "derived" });
    expect(createCandleSourceProvenance("Lighter", "1w", "1d", true)).toMatchObject({ sourceKind: "official daily aggregation to UTC Monday", quoteTurnover: "derived" });
  });

  test("aggregates daily candles into Monday UTC buckets", () => {
    const monday = Date.UTC(2026, 6, 13);
    const weekly = aggregateDailyCandlesToWeekly([
      { openTime: monday, closeTime: monday + 86_400_000, open: "1", high: "3", low: "1", close: "2", volume: "2" },
      { openTime: monday + 86_400_000, closeTime: monday + 2 * 86_400_000, open: "2", high: "4", low: "0.5", close: "3", volume: "5" },
    ]);
    expect(weekly[0]).toMatchObject({ openTime: monday, closeTime: monday + 7 * 86_400_000, open: "1", high: "4", low: "0.5", close: "3", volume: "7" });
  });

  test("groups funding against the final Monday weekly candle bucket", () => {
    const monday = Date.UTC(2026, 6, 13);
    const weekly = aggregateDailyCandlesToWeekly([
      { openTime: monday, closeTime: monday + 86_400_000, open: "1", high: "2", low: "1", close: "2", volume: "3" },
      { openTime: monday + 6 * 86_400_000, closeTime: monday + 7 * 86_400_000, open: "2", high: "4", low: "1.5", close: "3", volume: "5" },
    ]);
    const funding = aggregateFundingRatesToCandles([
      { time: monday + 60 * 60_000, rate: 0.01 },
      { time: monday + 3 * 86_400_000, rate: 0.03 },
      { time: monday + 7 * 86_400_000, rate: 0.05 }, // next weekly bucket, excluded
    ], weekly, 3600);

    expect(funding).toEqual([{
      time: monday,
      rate: 0.02,
      annualizedRate: 175.2,
      sampleCount: 2,
    }]);
  });
});
