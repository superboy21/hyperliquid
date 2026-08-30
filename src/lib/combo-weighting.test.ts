import { describe, expect, test } from "bun:test";
import {
  calculateVolatilityParity,
  combineWeightedOhlc,
  validCombinationWeights,
} from "./combo-weighting";

function candle(time: number, close: number, high = close + 2, low = close - 2) {
  return { openTime: time, closeTime: time + 1000, open: close - 1, high, low, close };
}

describe("combo weighting", () => {
  test("uses weights consistently for spread, ratio, and display bounds", () => {
    const first = candle(0, 10, 12, 8);
    const second = candle(0, 4, 6, 2);
    expect(combineWeightedOhlc(first, second, "spread", { first: 2, second: 1 })).toEqual({
      open: 15, high: 22, low: 10, close: 16,
    });
    expect(combineWeightedOhlc(first, second, "ratio", { first: 2, second: 1 })).toMatchObject({
      open: 6, close: 5,
      high: 12, low: 8 / 3,
    });
  });

  test("normalizes inverse volatility to the smallest positive weight", () => {
    const first = [candle(0, 100), candle(1000, 110), candle(2000, 100)];
    const second = [candle(0, 100), candle(1000, 120), candle(2000, 100)];
    const result = calculateVolatilityParity(first, second);
    expect(result.ok).toBe(true);
    expect(result.weights?.second).toBe(1);
    expect(result.weights?.first).toBeGreaterThan(1);
    expect(result.first.percent).toBeLessThan(result.second.percent!);
  });

  test("uses only the requested visible timestamp window", () => {
    const first = [candle(0, 100), candle(1000, 101), candle(2000, 102), candle(3000, 140)];
    const second = [candle(0, 100), candle(1000, 101), candle(2000, 102), candle(3000, 103)];
    const all = calculateVolatilityParity(first, second);
    const visible = calculateVolatilityParity(first, second, 0, 2000);
    expect(all.ok).toBe(true);
    expect(visible.ok).toBe(true);
    expect(all.first.percent).not.toBe(visible.first.percent);
  });

  test("rejects insufficient, zero-volatility, and invalid custom weights", () => {
    expect(calculateVolatilityParity([candle(0, 1), candle(1000, 1)], [candle(0, 1), candle(1000, 2)]).ok).toBe(false);
    expect(calculateVolatilityParity([candle(0, 1), candle(1000, 2), candle(2000, 1)], [candle(0, 1), candle(1000, 1), candle(2000, 1)]).ok).toBe(false);
    expect(validCombinationWeights("", "1")).toBeNull();
    expect(validCombinationWeights("0", "1")).toBeNull();
    expect(validCombinationWeights("Infinity", "1")).toBeNull();
    expect(validCombinationWeights("0.25", "2")).toEqual({ first: 0.25, second: 2 });
  });
});
