import { describe, expect, test } from "bun:test";
import {
  calculateNotionalWeightedAnnualizedRate,
  defaultAnnualizeFundingRate,
  resolveTopBboSpread,
} from "./fundingMonitorUtils";

describe("funding monitor annualization", () => {
  test("annualizes each mixed-interval row before notional weighting", () => {
    const result = calculateNotionalWeightedAnnualizedRate([
      { fundingRate: 0.001, fundingInterval: 3600, notionalValue: 100 },
      { fundingRate: 0.001, fundingInterval: 28800, notionalValue: 100 },
    ]);

    expect(result).toBeCloseTo((876 + 109.5) / 2, 10);
  });

  test("uses an explicit exchange annualization callback", () => {
    const lighterAnnualize = (rate: number) => (rate / 8) * 24 * 365 * 100;
    const result = calculateNotionalWeightedAnnualizedRate([
      { fundingRate: 0.08, fundingInterval: 3600, notionalValue: 2 },
    ], lighterAnnualize);

    expect(result).toBe(8760);
    expect(defaultAnnualizeFundingRate(0.001, 3600)).toBe(876);
  });
});

describe("funding monitor top BBO", () => {
  test("prefers a valid current row over the detail snapshot", () => {
    expect(resolveTopBboSpread({ bestBid: 99, bestAsk: 101 }, 9)).toBe(2);
  });

  test("falls back to detail when the current row BBO is unavailable or invalid", () => {
    expect(resolveTopBboSpread({ bestBid: 101, bestAsk: 99 }, 1.25)).toBe(1.25);
    expect(resolveTopBboSpread(undefined, 0.5)).toBe(0.5);
  });
});
