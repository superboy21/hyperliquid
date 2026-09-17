import { describe, expect, test } from "bun:test";
import { mapHyperliquidSearchRate } from "./search";
import type { FundingRate } from "./hyperliquid";

function rate(predictedFundingRate?: string | number): FundingRate {
  return {
    coin: "BTC",
    fundingRate: "0.0001",
    predictedFundingRate,
    markPrice: "100",
    indexPrice: "99",
    premium: "0",
    openInterest: "10",
    dayVolume: "1000",
    prevDayPx: "98",
    isSpot: false,
  };
}

describe("Hyperliquid search row prediction mapping", () => {
  test("propagates a finite prediction, including numeric zero", () => {
    expect(mapHyperliquidSearchRate(rate(0)).predictedFundingRate).toBe(0);
    expect(mapHyperliquidSearchRate(rate("0")).predictedFundingRate).toBe(0);
  });

  test("rejects blank and non-finite predictions", () => {
    expect(mapHyperliquidSearchRate(rate("")).predictedFundingRate).toBeNull();
    expect(mapHyperliquidSearchRate(rate("NaN")).predictedFundingRate).toBeNull();
    expect(mapHyperliquidSearchRate(rate("Infinity")).predictedFundingRate).toBeNull();
  });

  test("keeps the prediction on a HIP-3 row instead of dropping it", () => {
    const row = mapHyperliquidSearchRate({ ...rate("0.00000625"), coin: "xyz:NVDA", isSpot: true });
    expect(row.predictedFundingRate).toBe(0.00000625);
    expect(row.rawSymbol).toBe("xyz:NVDA");
  });
});
