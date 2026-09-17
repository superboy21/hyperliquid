import { describe, expect, test } from "bun:test";
import { combineWeightedOhlc, validCombinationWeights } from "./combo-weighting";

function candle(time: number, close: number, high = close + 2, low = close - 2) {
  return { openTime: time, closeTime: time + 1000, open: close - 1, high, low, close };
}

describe("combo weighting", () => {
  test("accepts only positive finite custom weights", () => {
    expect(validCombinationWeights("", "1")).toBeNull();
    expect(validCombinationWeights("0", "1")).toBeNull();
    expect(validCombinationWeights("Infinity", "1")).toBeNull();
    expect(validCombinationWeights("0.25", "2")).toEqual({ first: 0.25, second: 2 });
  });

  test("uses weights consistently and keeps display bounds endpoint-only", () => {
    const first = candle(0, 10, 12, 8);
    const second = candle(0, 4, 6, 2);
    expect(combineWeightedOhlc(first, second, "spread", { first: 2, second: 1 })).toEqual({
      open: 15, high: 16, low: 15, close: 16,
    });
    expect(combineWeightedOhlc(first, second, "ratio", { first: 2, second: 1 })).toMatchObject({
      open: 6, close: 5,
      high: 6, low: 5,
    });
  });
});
