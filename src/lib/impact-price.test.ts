import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchImpactSpread, normalizeGatePerpOrderBook } from "./impact-price";

const gateBook = {
  bids: [{ p: "100", s: 3 }, { p: "99", s: 7 }],
  asks: [{ p: "101", s: 5 }, { p: "102", s: 11 }],
};

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
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
});
