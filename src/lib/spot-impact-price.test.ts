import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchSpotImpactSpread, fetchSpotImpactSpreadDetail } from "./spot-impact-price";
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

  test("Bybit spot impact unwraps the V5 book envelope at documented 50/200 depth", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return Response.json({ retCode: 0, retMsg: "OK", result: { s: "BTCUSDT", b: [["99", "20"]], a: [["101", "20"]] } });
    });
    const bybitRow: SpotMarketRow = {
      ...row, exchange: "Bybit", exchangeColor: "orange", rawSymbol: "BTCUSDT", marketKey: "BTCUSDT",
    };

    const standard = await fetchSpotImpactSpread(bybitRow, 1000);
    const max = await fetchSpotImpactSpread(bybitRow, 1000, undefined, "max");

    expect(new URL(urls[0], "http://localhost").searchParams.get("limit")).toBe("50");
    expect(new URL(urls[1], "http://localhost").searchParams.get("limit")).toBe("200");
    expect(new URL(urls[0], "http://localhost").searchParams.get("category")).toBe("spot");
    expect(standard).toBeCloseTo(2, 10);
    expect(max).toBeCloseTo(2, 10);
  });

  test("Bybit spot impact reports insufficient rather than bogus values on thin books", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ retCode: 0, result: { s: "BTCUSDT", b: [["99", "1"]], a: [["101", "1"]] } }),
    );
    const bybitRow: SpotMarketRow = {
      ...row, exchange: "Bybit", exchangeColor: "orange", rawSymbol: "BTCUSDT", marketKey: "BTCUSDT",
    };
    expect(await fetchSpotImpactSpread(bybitRow, 10000, undefined, "max")).toBe("insufficient");
  });

  test("detail fetch resolves bid/ask VWAP prices and sub-spreads", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ bids: [["99", "20"]], asks: [["101", "20"]] }),
    );

    const detail = await fetchSpotImpactSpreadDetail(row, 1000);
    expect(detail).not.toBeNull();
    expect(typeof detail).not.toBe("string");
    if (detail === null || detail === "insufficient") throw new Error("expected detail object");
    expect(detail.spread).toBeCloseTo(2, 12);
    expect(detail.buyImpactSpread).toBeCloseTo(1, 12);
    expect(detail.sellImpactSpread).toBeCloseTo(1, 12);
  });
});
