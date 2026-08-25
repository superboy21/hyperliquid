import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { buildRealityTickerBboBook, fetchSpotImpactSpread, fetchSpotImpactSpreadDetail, REALITY_BBO_NOTIONAL_USD } from "./spot-impact-price";
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

describe("Bitget Reality token impact pricing", () => {
  const realityRow: SpotMarketRow = {
    ...row, exchange: "Bitget", exchangeColor: "teal", rawSymbol: "RAAPLUSDT", marketKey: "RAAPLUSDT",
    bestBid: 309.79, bestAsk: 309.8, isRealityToken: true,
  };

  test("builds the ticker BBO book with 10000 USD per side", () => {
    const book = buildRealityTickerBboBook({ bestBid: 309.79, bestAsk: 309.8 });
    expect(book).toEqual({
      bids: [{ price: 309.79, quantity: REALITY_BBO_NOTIONAL_USD / 309.79 }],
      asks: [{ price: 309.8, quantity: REALITY_BBO_NOTIONAL_USD / 309.8 }],
    });
    expect(buildRealityTickerBboBook({})).toBeNull();
  });

  test("uses the ticker BBO spread as the impact spread within the 10000 USD cap, without network requests", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return Response.json({ data: [] });
    });
    const detail = await fetchSpotImpactSpreadDetail(realityRow, 1000);
    expect(detail !== null && typeof detail === "object").toBe(true);
    if (detail !== null && typeof detail === "object") {
      expect(detail.bidPrice).toBe(309.79);
      expect(detail.askPrice).toBe(309.8);
      expect(detail.spread).toBeCloseTo(((309.8 - 309.79) / ((309.79 + 309.8) / 2)) * 100, 6);
    }
    expect(urls).toHaveLength(0);
    expect(await fetchSpotImpactSpread(realityRow, 1000)).toBeCloseTo(((309.8 - 309.79) / ((309.79 + 309.8) / 2)) * 100, 6);
  });

  test("returns insufficient when the notional exceeds the 10000 USD Reality BBO cap", async () => {
    expect(await fetchSpotImpactSpreadDetail(realityRow, 20000)).toBe("insufficient");
    expect(await fetchSpotImpactSpread(realityRow, 20000)).toBe("insufficient");
  });

  test("falls back to the order book when a Reality token has no ticker BBO", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      return Response.json({ data: { bids: [["99", "20"]], asks: [["101", "20"]] } });
    });
    const noBboRow: SpotMarketRow = { ...realityRow, bestBid: undefined, bestAsk: undefined };
    const detail = await fetchSpotImpactSpreadDetail(noBboRow, 1000);
    expect(detail !== null && typeof detail === "object").toBe(true);
    if (detail !== null && typeof detail === "object") {
      expect(detail.bidPrice).toBe(99);
      expect(detail.askPrice).toBe(101);
    }
    expect(urls.length).toBeGreaterThan(0);
  });
});
