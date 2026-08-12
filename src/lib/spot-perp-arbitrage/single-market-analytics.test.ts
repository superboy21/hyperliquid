import { describe, expect, test } from "bun:test";
import {
  ANALYTICS_YEAR_MS, filterCandlesInTimeRange, filterFundingInTimeRange, singleMarketAnalytics,
} from "./single-market-analytics";

const candle = (openTime: number, closeTime: number, close: number | string, volume: number | string, quoteVolume?: number | string) => ({
  openTime, closeTime, close, volume, ...(quoteVolume === undefined ? {} : { quoteVolume }),
});

describe("single-market analytics", () => {
  test("calculates untrimmed volume, turnover, VWAP, TWAP, and weighted population bands", () => {
    const result = singleMarketAnalytics([
      candle(0, 1_000, 10, 2, 0),
      candle(1_000, 2_000, 20, 1),
      candle(2_000, 4_000, 30, 3, 90),
    ], undefined, { estimateMissingQuoteTurnover: true });

    expect(result.latestClose).toBe(30);
    expect(result.baseVolume).toEqual({ mean: 2, count: 3 });
    expect(result.quoteTurnover).toEqual({ mean: 110 / 3, count: 3, officialCount: 2, estimatedCount: 1 });
    expect(result.candleCloseVwap.mean).toBeCloseTo(130 / 6);
    expect(result.candleCloseVwap.populationSigma).toBeCloseTo(Math.sqrt(80.55555555555556));
    expect(result.candleCloseVwap.minus2Sigma).toBeCloseTo(130 / 6 - 2 * Math.sqrt(80.55555555555556));
    expect(result.candleCloseTwap.mean).toBeCloseTo(22.5);
    expect(result.candleCloseTwap.populationSigma).toBeCloseTo(Math.sqrt(68.75));
    expect(result.candleCloseTwap.plus2Sigma).toBeCloseTo(22.5 + 2 * Math.sqrt(68.75));
  });

  test("preserves official zero turnover and only estimates when the caller opts in", () => {
    const candles = [
      candle(0, 1, 5, 2, 0),
      candle(1, 2, 5, 2, "not-a-number"),
    ];

    expect(singleMarketAnalytics(candles).quoteTurnover).toEqual({ mean: 0, count: 1, officialCount: 1, estimatedCount: 0 });
    expect(singleMarketAnalytics(candles, undefined, { estimateMissingQuoteTurnover: true }).quoteTurnover)
      .toEqual({ mean: 5, count: 2, officialCount: 1, estimatedCount: 1 });
  });

  test("omits invalid fields per metric and finds the latest valid close independent of array order", () => {
    const result = singleMarketAnalytics([
      candle(20, 30, "bad", 4, 40),
      candle(0, 10, 10, -1, 20),
      candle(10, 20, 20, "bad", undefined),
      candle(30, 40, 30, 2, -5),
    ]);

    expect(result.latestClose).toBe(30);
    expect(result.baseVolume).toEqual({ mean: 3, count: 2 });
    expect(result.quoteTurnover).toEqual({ mean: 30, count: 2, officialCount: 2, estimatedCount: 0 });
    expect(result.candleCloseVwap).toMatchObject({ mean: 30, count: 1, totalWeight: 2 });
    expect(result.candleCloseTwap.mean).toBeCloseTo(20);
  });

  test("uses actual funding observations, retaining observed zero but excluding sampleCount zero gaps", () => {
    const result = singleMarketAnalytics([], [
      { time: 1, rate: 0, annualizedRate: 0, sampleCount: 1 },
      { time: 2, rate: 1, annualizedRate: 100, sampleCount: 0 },
      { time: 3, rate: "0.002", annualizedRate: "0.2", sampleCount: 3 },
      { time: 4, rate: "bad", annualizedRate: "bad", sampleCount: 1 },
      { time: 5, rate: 1, annualizedRate: 50, sampleCount: null },
      { time: 6, annualizedRate: 0.3, sampleCount: 1 },
    ]);

    expect(result.fundingRate).toEqual({ mean: 0.001, count: 2 });
    expect(result.fundingAnnualized).toEqual({ mean: 1 / 6, count: 3 });
    // sampleCount: 3 remains one time bucket rather than three observations.
    expect(singleMarketAnalytics([], []).fundingAnnualized).toEqual({ mean: null, count: 0 });
    expect(singleMarketAnalytics([], []).fundingRate).toEqual({ mean: null, count: 0 });
    expect(singleMarketAnalytics([]).fundingAnnualized).toBeNull();
    expect(singleMarketAnalytics([]).fundingRate).toBeNull();
  });

  test("rejects non-positive or blank closes from price metrics and turnover estimates", () => {
    const result = singleMarketAnalytics([
      candle(0, 1, " ", 2, undefined),
      candle(1, 2, 0, 3, undefined),
      candle(2, 3, -1, 4, undefined),
    ], undefined, { estimateMissingQuoteTurnover: true });

    expect(result.latestClose).toBeNull();
    expect(result.candleCloseVwap.mean).toBeNull();
    expect(result.candleCloseTwap.mean).toBeNull();
    expect(result.quoteTurnover).toEqual({ mean: null, count: 0, officialCount: 0, estimatedCount: 0 });
  });

  test("does not retain a non-finite overflowed turnover estimate", () => {
    const result = singleMarketAnalytics([
      candle(0, 1, Number.MAX_VALUE, Number.MAX_VALUE),
    ], undefined, { estimateMissingQuoteTurnover: true });

    expect(result.quoteTurnover).toEqual({ mean: null, count: 0, officialCount: 0, estimatedCount: 0 });
  });

  test("uses chronological log returns with sample variance and needs at least two returns", () => {
    const result = singleMarketAnalytics([
      candle(2_000, 3_000, 8, 1),
      candle(0, 1_000, 1, 1),
      candle(1_000, 2_000, 2, 1),
    ]);
    const log2 = Math.log(2);
    const expected = Math.sqrt(ANALYTICS_YEAR_MS / 1_000) * Math.abs(log2 - 2 * log2) / Math.sqrt(2) * 100;

    expect(result.annualizedVolatility.returnCount).toBe(2);
    expect(result.annualizedVolatility.averageIntervalMs).toBe(1_000);
    expect(result.annualizedVolatility.percent).toBeCloseTo(expected);
    expect(singleMarketAnalytics([candle(0, 1_000, 1, 1), candle(1_000, 2_000, 2, 1)]).annualizedVolatility)
      .toEqual({ percent: null, returnCount: 1, averageIntervalMs: 1_000 });
  });

  test("filters candle and funding timestamps with exact inclusive bounds", () => {
    const candles = [candle(9, 10, 1, 1), candle(10, 11, 1, 1), candle(20, 21, 1, 1), candle(21, 22, 1, 1)];
    const funding = [{ time: 9, annualizedRate: 1 }, { time: "10", annualizedRate: 1 }, { time: 20, annualizedRate: 1 }, { time: 21, annualizedRate: 1 }];

    expect(filterCandlesInTimeRange(candles, 10, 20).map((point) => point.openTime)).toEqual([10, 20]);
    expect(filterFundingInTimeRange(funding, 10, 20).map((point) => point.time)).toEqual(["10", 20]);
  });
});
