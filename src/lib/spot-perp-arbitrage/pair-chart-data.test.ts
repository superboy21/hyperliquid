import { describe, expect, test } from "bun:test";
import type { ComboCandleResult, ComboLegPricePoint } from "../combo";
import type { SpotContainingCombinationResult } from "./combine";
import { alignedPairChartSamples } from "./pair-chart-data";

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
