import { describe, expect, spyOn, test } from "bun:test";
import { fetchDetailForSymbol, type SearchExchangeRate } from "./search";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("Binance detail funding coverage", () => {
  test("a three-day listing exposes 2d but not 7d or 30d", async () => {
    const nowMs = 100 * DAY;
    const originalFetch = globalThis.fetch;
    const clock = spyOn(Date, "now").mockReturnValue(nowMs);
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/klines?")) {
        return Response.json([
          [nowMs - 3 * DAY, "1", "1", "1", "1", "1", nowMs - 2 * DAY],
          [nowMs - 2 * DAY, "1", "1", "1", "1", "1", nowMs - DAY],
          [nowMs - DAY, "1", "1", "1", "1", "1", nowMs - HOUR],
        ]);
      }
      if (url.includes("/fundingRate?")) {
        return Response.json([
          { fundingTime: nowMs - 3 * DAY, fundingRate: "0.01" },
          { fundingTime: nowMs - HOUR, fundingRate: "0.01" },
        ]);
      }
      throw new Error(`Unexpected Binance request: ${url}`);
    }) as typeof fetch;

    const rate: SearchExchangeRate = {
      exchange: "Binance",
      exchangeColor: "yellow",
      symbol: "BTCUSDT",
      rawSymbol: "BTCUSDT",
      fundingRate: 0,
      markPrice: 100,
      indexPrice: 100,
      lastPrice: 100,
      change24h: 0,
      quoteVolume: 1,
      openInterest: 1,
      notionalValue: 100,
      fundingInterval: 8 * 3600,
      assetCategory: "Crypto",
    };

    try {
      const result = await fetchDetailForSymbol(rate);
      expect(result.avgFundingRate2d).not.toBeNull();
      expect(result.avgFundingRate7d).toBeNull();
      expect(result.avgFundingRate30d).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      clock.mockRestore();
    }
  });
});
