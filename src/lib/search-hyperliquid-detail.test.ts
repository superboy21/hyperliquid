import { describe, expect, spyOn, test } from "bun:test";
import { fetchDetailForSymbol, type SearchExchangeRate } from "./search";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const simpleReturnVolatility = Math.sqrt(1.125) * Math.sqrt(365) * 100;

function rate(): SearchExchangeRate {
  return {
    exchange: "Hyperliquid",
    exchangeColor: "blue",
    symbol: "BTC",
    rawSymbol: "BTC",
    fundingRate: 0,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 100,
    fundingInterval: HOUR / 1000,
    assetCategory: "Crypto",
  };
}

describe("Hyperliquid detail funding coverage", () => {
  test("requests a one-hour pre-cutoff buffer and uses it for 30d coverage", async () => {
    const nowMs = 100 * DAY;
    const preCutoff = nowMs - 30 * DAY - HOUR;
    const fundingRequests: Array<{ startTime: number; endTime: number }> = [];
    const originalFetch = globalThis.fetch;
    const clock = spyOn(Date, "now").mockReturnValue(nowMs);
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { type: string; startTime?: number; endTime?: number };
      if (body.type === "fundingHistory") {
        fundingRequests.push({ startTime: body.startTime!, endTime: body.endTime! });
        const history = [{ time: nowMs - HOUR, coin: "BTC", fundingRate: "0.01" }];
        if (body.startTime! <= preCutoff) {
          history.unshift({ time: preCutoff, coin: "BTC", fundingRate: "0.01" });
        }
        return Response.json(history);
      }
      if (body.type === "candleSnapshot") {
        return Response.json([
          { t: 0, T: DAY - 1, s: "BTC", i: "1d", o: "100", h: "200", l: "100", c: "100", v: "1", n: 1 },
          { t: DAY, T: 2 * DAY - 1, s: "BTC", i: "1d", o: "100", h: "200", l: "100", c: "200", v: "1", n: 1 },
          { t: 2 * DAY, T: 3 * DAY - 1, s: "BTC", i: "1d", o: "200", h: "200", l: "100", c: "100", v: "1", n: 1 },
        ]);
      }
      if (body.type === "l2Book") {
        return Response.json({ levels: [[{ px: "99", sz: "1", n: 1 }], [{ px: "101", sz: "1", n: 1 }]] });
      }
      throw new Error(`Unexpected Hyperliquid request: ${body.type}`);
    }) as typeof fetch;

    try {
      const result = await fetchDetailForSymbol(rate());
      expect(fundingRequests).toHaveLength(2);
      expect(fundingRequests[0].endTime).toBe(nowMs - 1);
      expect(fundingRequests[1].startTime).toBe(preCutoff);
      expect(fundingRequests[1].endTime).toBe(fundingRequests[0].startTime - 1);
      expect(result.avgFundingRate2d).not.toBeNull();
      expect(result.avgFundingRate7d).not.toBeNull();
      expect(result.avgFundingRate30d).not.toBeNull();
      expect(result.historicalVolatility).toBeCloseTo(simpleReturnVolatility, 10);
    } finally {
      globalThis.fetch = originalFetch;
      clock.mockRestore();
    }
  });
});
