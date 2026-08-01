import { describe, expect, test } from "bun:test";
import {
  aggregateFundingRatesToCandles,
  type SearchCandlePoint,
} from "./search-candles";

const HOUR_MS = 60 * 60 * 1000;

function candle(openTime: number): SearchCandlePoint {
  return {
    openTime,
    closeTime: openTime + HOUR_MS,
    open: "1",
    high: "1",
    low: "1",
    close: "1",
    volume: "0",
  };
}

describe("funding observation availability", () => {
  test("distinguishes missing, observed zero, and multi-sample candle buckets", () => {
    const candles = [candle(0), candle(HOUR_MS), candle(2 * HOUR_MS)];
    const fundingRates = aggregateFundingRatesToCandles(
      [
        { time: 30 * 60 * 1000, rate: 0 },
        { time: 2 * HOUR_MS + 10 * 60 * 1000, rate: 0.0001 },
        { time: 2 * HOUR_MS + 50 * 60 * 1000, rate: 0.0003 },
      ],
      candles,
      8 * 60 * 60,
    );

    expect(fundingRates).toHaveLength(3);
    expect(fundingRates[0]).toEqual({ time: 0, rate: 0, annualizedRate: 0, sampleCount: 1 });
    expect(fundingRates[1]).toEqual({ time: HOUR_MS, rate: 0, annualizedRate: 0, sampleCount: 0 });
    expect(fundingRates[2]).toMatchObject({ time: 2 * HOUR_MS, sampleCount: 2 });
    expect(fundingRates[2].rate).toBeCloseTo(0.0002, 12);
    expect(fundingRates[2].annualizedRate).toBeCloseTo(0.219, 12);
  });
});
