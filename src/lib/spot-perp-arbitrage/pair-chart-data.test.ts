import { describe, expect, test } from "bun:test";
import type { ComboCandleResult, ComboLegPricePoint } from "../combo";
import type { SpotContainingCombinationResult } from "./combine";
import { alignedPairChartSamples, alignedPairDerivedCandles } from "./pair-chart-data";

const candle = (openTime: number, open: number, high: number, low: number, close: number): ComboLegPricePoint => ({
  openTime, closeTime: openTime + 1, open, high, low, close,
});

function perpResult(first: ComboLegPricePoint[], second: ComboLegPricePoint[]): ComboCandleResult {
  return { candles: [], leg1Points: first, leg2Points: second } as ComboCandleResult;
}

describe("pair chart data", () => {
  test("aligns perp raw legs in requested order and computes raw close ratio, not composite values", () => {
    const result = perpResult(
      [candle(20, 12, 15, 10, 14), candle(10, 4, 6, 3, 5)],
      [candle(10, 2, 3, 1, 2), candle(20, 7, 8, 6, 7)],
    );
    const samples = alignedPairChartSamples(result, [20, 99, 10]);
    expect(samples).toEqual([
      { time: 20, ratio: 2, firstOhlc: [12, 14, 10, 15], secondOhlc: [7, 7, 6, 8] },
      { time: 99, ratio: null, firstOhlc: null, secondOhlc: null },
      { time: 10, ratio: 2.5, firstOhlc: [4, 5, 3, 6], secondOhlc: [2, 2, 1, 3] },
    ]);
  });

  test("aligns spot-containing point legs and retains a valid ratio when one OHLC is impossible", () => {
    const result = {
      kind: "spot-containing",
      points: [
        {
          openTime: 1,
          leg1Point: { ...candle(1, 10, 11, 9, 10), baseVolume: 1, turnover: null },
          leg2Point: { ...candle(1, 2, 1, 3, 2), baseVolume: 1, turnover: null },
        },
        {
          openTime: 2,
          leg1Point: { ...candle(2, 10, 12, 9, 11), baseVolume: 1, turnover: null },
        },
      ],
    } as unknown as SpotContainingCombinationResult;
    expect(alignedPairChartSamples(result, [2, 1])).toEqual([
      { time: 2, ratio: null, firstOhlc: [10, 11, 9, 12], secondOhlc: null },
      { time: 1, ratio: 5, firstOhlc: [10, 10, 9, 11], secondOhlc: null },
    ]);
  });

  test("keeps invalid closes, overflow ratios, and missing raw legs null without mutating inputs", () => {
    const invalid = candle(3, Number.NaN, 4, 1, 0);
    const huge = candle(4, 1e308, 1e308, 1e308, 1e308);
    const tiny = candle(4, 1e-308, 1e-308, 1e-308, 1e-308);
    const result = perpResult([invalid, huge], [candle(3, 2, 3, 1, 2), tiny]);
    const before = structuredClone(result);
    expect(alignedPairChartSamples(result, [3, 4, 5])).toEqual([
      { time: 3, ratio: null, firstOhlc: null, secondOhlc: [2, 2, 1, 3] },
      { time: 4, ratio: null, firstOhlc: [1e308, 1e308, 1e308, 1e308], secondOhlc: [1e-308, 1e-308, 1e-308, 1e-308] },
      { time: 5, ratio: null, firstOhlc: null, secondOhlc: null },
    ]);
    expect(result).toEqual(before);
  });
});

describe("aligned pair derived candles", () => {
  test("derives ratio candles from raw open/close for perp results with no wicks", () => {
    const result = perpResult(
      [candle(20, 12, 99, 1, 14), candle(10, 4, 4, 4, 5)],
      [candle(20, 7, 80, 2, 7), candle(10, 2, 2, 2, 2)],
    );
    expect(alignedPairDerivedCandles(result, [20, 10], "ratio")).toEqual([
      [12 / 7, 2, 12 / 7, 2],
      [2, 2.5, 2, 2.5],
    ]);
  });

  test("derives spread candles allowing zero and negative results for perp results", () => {
    const result = perpResult(
      [candle(1, 5, 50, -50, 5), candle(2, 2, 3, 1, 4)],
      [candle(1, 5, 5, 5, 5), candle(2, 6, 6, 6, 1)],
    );
    expect(alignedPairDerivedCandles(result, [1, 2], "spread")).toEqual([
      [0, 0, 0, 0],
      [-4, 3, -4, 3],
    ]);
  });

  test("keeps missing and invalid raw endpoints as null gaps without touching unused high/low", () => {
    const result = perpResult(
      [candle(1, 10, 11, 9, 12), candle(2, Number.NaN, 4, 1, 5), candle(3, 0, 4, -1, 6)],
      [candle(1, 2, 3, 1, 3), candle(2, 2, 3, 1, 4), candle(3, 2, 3, 1, 2)],
    );
    expect(alignedPairDerivedCandles(result, [1, 2, 3, 4], "ratio")).toEqual([
      [5, 4, 4, 5],
      null,
      null,
      null,
    ]);
  });

  test("tolerates missing/invalid raw highs and lows because only open/close are used", () => {
    const result = perpResult(
      [candle(1, 10, Number.NaN, Number.NaN, 12)],
      [candle(1, 2, Number.POSITIVE_INFINITY, -1, 4)],
    );
    expect(alignedPairDerivedCandles(result, [1], "ratio")).toEqual([[5, 3, 3, 5]]);
  });

  test("collapses ratio endpoints with a non-positive or non-finite denominator to null", () => {
    const result = perpResult(
      [candle(1, 10, 11, 9, 12), candle(2, 10, 11, 9, 12)],
      [candle(1, 0, 1, -1, 2), candle(2, 1e-308, 1, 1e-308, 1e-308)],
    );
    expect(alignedPairDerivedCandles(result, [1, 2], "ratio")).toEqual([null, null]);
  });

  test("keeps ratio endpoints that overflow to infinity as null gaps", () => {
    const result = perpResult(
      [candle(1, 1e308, 1e308, 1e308, 1e308)],
      [candle(1, 1e-308, 1e-308, 1e-308, 1e-308)],
    );
    expect(alignedPairDerivedCandles(result, [1], "ratio")).toEqual([null]);
  });

  test("derives ratio and spread candles for spot-containing point legs in requested order", () => {
    const result = {
      kind: "spot-containing",
      points: [
        {
          openTime: 1,
          leg1Point: { ...candle(1, 10, 11, 9, 20), baseVolume: 1, turnover: null },
          leg2Point: { ...candle(1, 4, 5, 3, 8), baseVolume: 1, turnover: null },
        },
        {
          openTime: 2,
          leg1Point: { ...candle(2, 6, 7, 5, 9), baseVolume: 1, turnover: null },
        },
      ],
    } as unknown as SpotContainingCombinationResult;
    expect(alignedPairDerivedCandles(result, [2, 1], "ratio")).toEqual([
      null,
      [2.5, 2.5, 2.5, 2.5],
    ]);
    expect(alignedPairDerivedCandles(result, [2, 1], "spread")).toEqual([
      null,
      [6, 12, 6, 12],
    ]);
  });

  test("orders output strictly by the requested aligned times and does not mutate inputs", () => {
    const result = perpResult(
      [candle(3, 30, 31, 29, 31), candle(1, 10, 11, 9, 11)],
      [candle(3, 3, 4, 2, 4), candle(1, 1, 2, 0.5, 2)],
    );
    const before = structuredClone(result);
    const out = alignedPairDerivedCandles(result, [3, 1, 3], "spread");
    expect(out).toEqual([
      [27, 27, 27, 27],
      [9, 9, 9, 9],
      [27, 27, 27, 27],
    ]);
    expect(result).toEqual(before);
  });

  test("keeps body low/high from the derived body even when raw extremes differ", () => {
    const result = perpResult(
      [candle(1, 5, 1000, 0.001, 5)],
      [candle(1, 2, 999, 0.002, 2)],
    );
    expect(alignedPairDerivedCandles(result, [1], "ratio")).toEqual([[2.5, 2.5, 2.5, 2.5]]);
    expect(alignedPairDerivedCandles(result, [1], "spread")).toEqual([[3, 3, 3, 3]]);
  });
});
