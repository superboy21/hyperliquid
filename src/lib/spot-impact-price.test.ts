import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchSpotImpactSpread } from "./spot-impact-price";
import type { SpotMarketRow } from "./spot-search";

const row: SpotMarketRow = {
  exchange: "Binance", exchangeColor: "yellow", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTCUSDT", marketKey: "BTCUSDT", midPrice: 100, change24h: 0, quoteVolume: 0,
  baseVolume: 0, fetchedAt: 1,
};

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
});

describe("Spot impact depth mode", () => {
  test("defaults to standard depth and selects max without changing either overload", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return Response.json({ bids: [["99", "20"]], asks: [["101", "20"]] });
    });

    await fetchSpotImpactSpread(row, 1000);
    await fetchSpotImpactSpread(row, 1000, undefined, "max");
    await fetchSpotImpactSpread(row, undefined, 1000, "max");

    expect(new URL(urls[0], "http://localhost").searchParams.get("limit")).toBe("100");
    expect(new URL(urls[1], "http://localhost").searchParams.get("limit")).toBe("5000");
    expect(new URL(urls[2], "http://localhost").searchParams.get("limit")).toBe("5000");
  });
});
