import { describe, expect, test } from "bun:test";
import type { ComboCandleResult, ComboLegPricePoint } from "../combo";
import type { SpotContainingCombinationResult } from "./combine";
import { alignedPairCloses, pairEntryFundingCloseTime } from "./pair-adapter";

test("pair adapter fails closed when legacy raw legs are missing", () => {
  expect(alignedPairCloses({ candles: [], fundingRates: [], interval: "1h" } as never)).toEqual([]);
});

describe("pairEntryFundingCloseTime", () => {
  const raw = (openTime: number, closeTime: number): ComboLegPricePoint => ({
    openTime, closeTime, open: 1, high: 1, low: 1, close: 1,
  });

  const perpResult = (
    first: ComboLegPricePoint[],
    second: ComboLegPricePoint[],
  ): ComboCandleResult => ({ candles: [], leg1Points: first, leg2Points: second } as ComboCandleResult);

  test("returns the later close of exact-open perp legs and preserves aligned pair close behavior", () => {
    const result = perpResult([raw(100, 200)], [raw(100, 300)]);
    expect(pairEntryFundingCloseTime(result, 100)).toBe(300);
    expect(alignedPairCloses(result)).toEqual([{ closeTime: 100, firstClose: 1, secondClose: 1 }]);
  });

  test("accepts equal valid closes and fails closed for missing or invalid endpoints", () => {
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 200)], [raw(100, 200)]), 100)).toBe(200);
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 200)], []), 100)).toBeNull();
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 100)], [raw(100, 200)]), 100)).toBeNull();
    expect(pairEntryFundingCloseTime(perpResult([raw(100, Number.NaN)], [raw(100, 200)]), 100)).toBeNull();
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 200)], [raw(101, 300)]), 100)).toBeNull();
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 200)], [raw(100, 300)]), null)).toBeNull();
    expect(pairEntryFundingCloseTime(perpResult([raw(100, 200)], [raw(100, 300)]), Number.NaN)).toBeNull();
  });

  test("uses each spot-containing raw leg's own close time", () => {
    const result = {
      kind: "spot-containing",
      points: [{
        openTime: 5,
        leg1Point: { ...raw(5, 9), baseVolume: 1, turnover: null },
        leg2Point: { ...raw(5, 12), baseVolume: 1, turnover: null },
      }],
    } as unknown as SpotContainingCombinationResult;
    expect(pairEntryFundingCloseTime(result, 5)).toBe(12);
    const missing = { ...result, points: [{ ...result.points[0], leg2Point: undefined }] } as SpotContainingCombinationResult;
    expect(pairEntryFundingCloseTime(missing, 5)).toBeNull();
  });
});
