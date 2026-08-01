import { describe, expect, test } from "bun:test";
import {
  computeOrderBookImpactSpread,
  computeQuoteNotionalVwap,
  MAX_PERP_IMPACT_DEPTH_LIMITS,
  MAX_SPOT_IMPACT_DEPTH_LIMITS,
  normalizeSpotOrderBook,
  PERP_IMPACT_DEPTH_LIMITS,
  resolvePerpImpactDepth,
  resolveSpotImpactDepth,
  STANDARD_PERP_IMPACT_DEPTH_LIMITS,
  STANDARD_SPOT_IMPACT_DEPTH_LIMITS,
} from "./order-book-impact";

describe("spot quote-notional VWAP", () => {
  test("publishes standard and maximum Spot/Perp depth policies", () => {
    const standard = {
      Hyperliquid: 20,
      "Gate.io": 100,
      Binance: 100,
      OKX: 100,
      Lighter: 100,
      Bitget: 100,
    };
    expect(STANDARD_SPOT_IMPACT_DEPTH_LIMITS).toEqual(standard);
    expect(STANDARD_PERP_IMPACT_DEPTH_LIMITS).toEqual(standard);
    expect(PERP_IMPACT_DEPTH_LIMITS).toBe(STANDARD_PERP_IMPACT_DEPTH_LIMITS);
    expect(MAX_SPOT_IMPACT_DEPTH_LIMITS).toEqual({
      Hyperliquid: 20, "Gate.io": 100, Binance: 5000, OKX: 5000, Lighter: 250, Bitget: 150,
    });
    expect(MAX_PERP_IMPACT_DEPTH_LIMITS).toEqual({
      Hyperliquid: 20, "Gate.io": 100, Binance: 1000, OKX: 5000, Lighter: 250, Bitget: 1000,
    });
  });

  test("resolves standard by default and max independently for Spot and Perp", () => {
    expect(resolveSpotImpactDepth("Binance")).toBe(100);
    expect(resolvePerpImpactDepth("Binance")).toBe(100);
    expect(resolveSpotImpactDepth("Binance", "max")).toBe(5000);
    expect(resolvePerpImpactDepth("Binance", "max")).toBe(1000);
    expect(resolveSpotImpactDepth("Bitget", "max")).toBe(150);
    expect(resolvePerpImpactDepth("Bitget", "max")).toBe(1000);
    expect(resolveSpotImpactDepth("Hyperliquid", "max")).toBe(20);
    expect(resolvePerpImpactDepth("Hyperliquid", "max")).toBe(20);
  });

  test("allows an exact fill and a partial final base-quantity level", () => {
    expect(computeQuoteNotionalVwap([{ price: 100, quantity: 1 }, { price: 80, quantity: 2 }], 180)).toBe(90);
    expect(computeQuoteNotionalVwap([{ price: 100, quantity: 1 }, { price: 200, quantity: 1 }], 200)).toBeCloseTo(200 / 1.5, 12);
  });

  test("distinguishes insufficient depth from invalid targets", () => {
    expect(computeQuoteNotionalVwap([{ price: 100, quantity: 1 }], 101)).toBe("insufficient");
    expect(computeQuoteNotionalVwap([], 0)).toBeNull();
  });

  test("normalizes and sorts public book shapes before spread calculation", () => {
    const book = normalizeSpotOrderBook("OKX", { data: [{ bids: [["99", "2"], ["100", "2"]], asks: [["102", "2"], ["101", "2"]] }] });
    expect(book?.bids[0].price).toBe(100);
    expect(book?.asks[0].price).toBe(101);
    expect(book && computeOrderBookImpactSpread(book, 100)).toBeCloseTo((1 / 100.5) * 100, 12);
  });

  test("sorts unsorted book copies best-to-worst without mutating caller input", () => {
    const book = {
      bids: [{ price: 99, quantity: 10 }, { price: 100, quantity: 1 }],
      asks: [{ price: 102, quantity: 10 }, { price: 101, quantity: 1 }],
    };
    const original = structuredClone(book);
    const spread = computeOrderBookImpactSpread(book, 150);
    const bid = computeQuoteNotionalVwap([{ price: 100, quantity: 1 }, { price: 99, quantity: 10 }], 150);
    const ask = computeQuoteNotionalVwap([{ price: 101, quantity: 1 }, { price: 102, quantity: 10 }], 150);

    expect(typeof bid).toBe("number");
    expect(typeof ask).toBe("number");
    expect(spread).toBeCloseTo((((ask as number) - (bid as number)) / (((ask as number) + (bid as number)) / 2)) * 100, 12);
    expect(book).toEqual(original);
  });
});
