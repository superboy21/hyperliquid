import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { computePremiumIndex, fetchImpactSpread, fetchImpactSpreadDetail, normalizeGatePerpOrderBook } from "./impact-price";
import type { BybitRequest } from "./adapters/bybit";

const gateBook = {
  bids: [{ p: "100", s: 3 }, { p: "99", s: 7 }],
  asks: [{ p: "101", s: 5 }, { p: "102", s: 11 }],
};

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
});

describe("computePremiumIndex", () => {
  test("computes the Binance-style premium index from impact bid/ask and index price", () => {
    // bid 102 / ask 101 / index 100 → [2 - 0] / 100 = 0.02
    expect(computePremiumIndex(102, 101, 100)).toBeCloseTo(0.02, 12);
    // bid 99 / ask 98 / index 100 → [0 - 2] / 100 = -0.02
    expect(computePremiumIndex(99, 98, 100)).toBeCloseTo(-0.02, 12);
    // symmetric around index → 0
    expect(computePremiumIndex(101, 99, 100)).toBeCloseTo(0, 12);
  });

  test.each([
    ["non-finite bid", Number.NaN, 101, 100],
    ["non-finite ask", 102, Number.NaN, 100],
    ["non-finite index", 102, 101, Number.NaN],
    ["zero index", 102, 101, 0],
    ["negative index", 102, 101, -100],
  ] as const)("returns null for %s", (_label, bid, ask, index) => {
    expect(computePremiumIndex(bid, ask, index)).toBeNull();
  });
});

describe("normalizeGatePerpOrderBook", () => {
  test("converts Gate contract sizes to base quantities using the exact multiplier", () => {
    expect(normalizeGatePerpOrderBook(gateBook, 0.001)).toEqual({
      bids: [{ price: 100, quantity: 0.003 }, { price: 99, quantity: 0.007 }],
      asks: [{ price: 101, quantity: 0.005 }, { price: 102, quantity: 0.011 }],
    });
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -0.001],
  ] as const)("fails closed as no_multiplier for %s multiplier", (_label, multiplier) => {
    const result = normalizeGatePerpOrderBook(gateBook, multiplier);

    expect(result).toBe("no_multiplier");
    expect(typeof result).not.toBe("number");
  });
});

describe("Perp impact depth mode", () => {
  test("defaults Binance to standard depth and selects maximum depth", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return Response.json({ bids: [["99", "20"]], asks: [["101", "20"]] });
    });

    await fetchImpactSpread("Binance", "BTCUSDT", undefined, 1000);
    await fetchImpactSpread("Binance", "BTCUSDT", undefined, 1000, "max");

    expect(new URL(urls[0]).searchParams.get("limit")).toBe("100");
    expect(new URL(urls[1]).searchParams.get("limit")).toBe("1000");
  });

  test("Bybit perp impact uses the core linear adapter book at shared resolved depths, never polling tickers", async () => {
    const calls: Array<{ action: string; limit?: string }> = [];
    const request: BybitRequest = async (action, params) => {
      calls.push({ action, limit: params.limit });
      return { s: "BTCUSDT", b: [["99", "20"]], a: [["101", "20"]] };
    };

    const standard = await fetchImpactSpread("Bybit", "BTCUSDT", undefined, 1000, "standard", request);
    const max = await fetchImpactSpread("Bybit", "BTCUSDT", undefined, 1000, "max", request);

    expect(calls).toEqual([
      { action: "orderbook", limit: "100" },
      { action: "orderbook", limit: "500" },
    ]);
    expect(standard).toBeCloseTo(2, 10);
    expect(max).toBeCloseTo(2, 10);
  });

  test("Bybit perp impact fails as insufficient instead of fabricating values on thin books", async () => {
    const request: BybitRequest = async () => ({ s: "BTCUSDT", b: [["99", "1"]], a: [["101", "1"]] });
    expect(await fetchImpactSpread("Bybit", "BTCUSDT", undefined, 10000, "max", request)).toBe("insufficient");
  });

  test("detail fetch resolves bid/ask VWAP prices and sub-spreads for Binance", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ bids: [["99", "20"]], asks: [["101", "20"]] }),
    );

    const detail = await fetchImpactSpreadDetail("Binance", "BTCUSDT", undefined, 1000);
    expect(detail).not.toBeNull();
    expect(typeof detail).not.toBe("string");
    if (detail === null || detail === "insufficient") throw new Error("expected detail object");
    expect(detail.bidPrice).toBeCloseTo(99, 12);
    expect(detail.askPrice).toBeCloseTo(101, 12);
    expect(detail.spread).toBeCloseTo(2, 12);
    expect(detail.buyImpactSpread).toBeCloseTo(1, 12);
    expect(detail.sellImpactSpread).toBeCloseTo(1, 12);
  });

  test("Bybit detail fetch uses the core adapter book and resolves sub-spreads", async () => {
    const request: BybitRequest = async () => ({ s: "BTCUSDT", b: [["99", "20"]], a: [["101", "20"]] });

    const detail = await fetchImpactSpreadDetail("Bybit", "BTCUSDT", undefined, 1000, "standard", request);
    expect(detail).not.toBeNull();
    expect(typeof detail).not.toBe("string");
    if (detail === null || detail === "insufficient") throw new Error("expected detail object");
    expect(detail.spread).toBeCloseTo(2, 10);
    expect(detail.buyImpactSpread).toBeCloseTo(1, 10);
    expect(detail.sellImpactSpread).toBeCloseTo(1, 10);
  });
});
