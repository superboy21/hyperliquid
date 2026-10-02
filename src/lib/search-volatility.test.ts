import { describe, expect, test } from "bun:test";
import { calculateSearchHistoricalVolatility } from "./search";

const vol = (closes: readonly (number | string)[]) => calculateSearchHistoricalVolatility(closes.map((close) => ({ close: String(close) })));

describe("search-table historical volatility", () => {
  test("uses sample standard deviation of simple close-to-close returns for large moves", () => {
    const simpleReturns = [1, -0.5];
    const mean = (simpleReturns[0] + simpleReturns[1]) / 2;
    const sampleStdDev = Math.sqrt(
      ((simpleReturns[0] - mean) ** 2 + (simpleReturns[1] - mean) ** 2) / (simpleReturns.length - 1),
    );
    const expected = sampleStdDev * Math.sqrt(365) * 100;
    const priorLogReturnValue = Math.sqrt(2) * Math.log(2) * Math.sqrt(365) * 100;
    const actual = vol([100, 200, 100]);
    expect(actual).toBeCloseTo(expected, 10);
    expect(actual).not.toBeCloseTo(priorLogReturnValue, 5);
  });

  test("returns null below the two-return minimum and zero for constant returns", () => {
    expect(vol([100, 110])).toBeNull();
    expect(vol([100, 110, 121])).toBeCloseTo(0, 10);
  });

  test("skips invalid-price transitions without filtering or bridging the close sequence", () => {
    for (const invalidClose of [0, -1, "", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(vol([100, invalidClose, 121])).toBeNull();
      expect(vol([100, 110, invalidClose])).toBeNull();
    }
    expect(vol([Number.POSITIVE_INFINITY, 110, 121])).toBeNull();

    // The valid 10% return before zero is the only valid transition; removing
    // the invalid close first would incorrectly bridge 110 directly to 132.
    expect(vol([100, 110, 0, 132])).toBeNull();
    expect(vol([100, 110, -1, 132])).toBeNull();
  });

  test("fails closed when valid simple returns overflow", () => {
    expect(vol([Number.MIN_VALUE, Number.MAX_VALUE, Number.MIN_VALUE])).toBeNull();
  });
});
