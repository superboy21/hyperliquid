import { describe, expect, test } from "bun:test";
import {
  clampRpiDepth,
  hasRpiEndpoint,
  normalizeRpiSplitLevels,
  normalizeSpotRpiOrderBook,
} from "./rpi-book";

describe("hasRpiEndpoint", () => {
  test("returns true only for products with a dedicated RPI book endpoint", () => {
    expect(hasRpiEndpoint("Binance", "perp")).toBe(true); // /fapi/v1/rpiDepth
    expect(hasRpiEndpoint("Binance", "spot")).toBe(false); // 现货无 RPI
    expect(hasRpiEndpoint("Gate.io", "spot")).toBe(true);
    expect(hasRpiEndpoint("Gate.io", "perp")).toBe(true);
    expect(hasRpiEndpoint("Bitget", "spot")).toBe(true);
    expect(hasRpiEndpoint("Bitget", "perp")).toBe(true);
    expect(hasRpiEndpoint("Bybit", "spot")).toBe(true);
    expect(hasRpiEndpoint("Bybit", "perp")).toBe(true);
    expect(hasRpiEndpoint("OKX", "spot")).toBe(true);
    expect(hasRpiEndpoint("OKX", "perp")).toBe(true);
    // 无 RPI 端点：RPI 模式下直接用普通盘口，不提示。
    expect(hasRpiEndpoint("Hyperliquid", "spot")).toBe(false);
    expect(hasRpiEndpoint("Hyperliquid", "perp")).toBe(false);
    expect(hasRpiEndpoint("Lighter", "spot")).toBe(false);
    expect(hasRpiEndpoint("Lighter", "perp")).toBe(false);
  });
});

describe("clampRpiDepth", () => {
  test("caps depth at each RPI endpoint's documented maximum", () => {
    expect(clampRpiDepth("Binance", "perp", 5000)).toBe(1000);
    expect(clampRpiDepth("Bybit", "perp", 500)).toBe(50);
    expect(clampRpiDepth("Bybit", "spot", 200)).toBe(50);
    expect(clampRpiDepth("Bitget", "perp", 1000)).toBe(200);
    expect(clampRpiDepth("OKX", "perp", 5000)).toBe(400);
    // 低于上限的原样保留
    expect(clampRpiDepth("Bybit", "perp", 20)).toBe(20);
  });

  test("leaves depth untouched for products without an RPI endpoint", () => {
    expect(clampRpiDepth("Hyperliquid", "perp", 20)).toBe(20);
    expect(clampRpiDepth("Lighter", "spot", 100)).toBe(100);
    expect(clampRpiDepth("Binance", "spot", 100)).toBe(100);
  });
});

describe("normalizeRpiSplitLevels", () => {
  test("merges non-RPI and RPI quantities into the total level size", () => {
    const levels = normalizeRpiSplitLevels([[100, 10, 2], [99, 5, 0], [98, 0, 3]], "bid");
    expect(levels).toEqual([
      { price: 100, quantity: 12 },
      { price: 99, quantity: 5 },
      { price: 98, quantity: 3 },
    ]);
  });

  test("sorts asks ascending and bids descending", () => {
    const asks = normalizeRpiSplitLevels([[100, 1, 0], [101, 1, 1], [99, 1, 0]], "ask");
    expect(asks.map((level) => level.price)).toEqual([99, 100, 101]);
    const bids = normalizeRpiSplitLevels([[100, 1, 0], [99, 1, 0], [102, 1, 1]], "bid");
    expect(bids.map((level) => level.price)).toEqual([102, 100, 99]);
  });

  test("drops malformed or non-positive levels", () => {
    expect(normalizeRpiSplitLevels([[100, 0, 0], ["bad", 1, 1], [null], [101, -1, 1], [102, 1, -2]], "bid"))
      .toEqual([]);
  });
});

describe("normalizeSpotRpiOrderBook", () => {
  test("parses Gate.io spot RPI book (plain two-column levels)", () => {
    const book = normalizeSpotRpiOrderBook("Gate.io", { bids: [["100", "5"]], asks: [["101", "3"]] });
    expect(book).toEqual({
      bids: [{ price: 100, quantity: 5 }],
      asks: [{ price: 101, quantity: 3 }],
    });
  });

  test("parses OKX books-rpi with totalQty at index 1 (already includes RPI)", () => {
    const book = normalizeSpotRpiOrderBook("OKX", {
      code: "0",
      data: [{ bids: [["100", "12", "10", "3"]], asks: [["101", "8", "6", "2"]] }],
    });
    expect(book).toEqual({
      bids: [{ price: 100, quantity: 12 }],
      asks: [{ price: 101, quantity: 8 }],
    });
  });

  test("parses Bybit rpi_orderbook three-column result envelope", () => {
    const book = normalizeSpotRpiOrderBook("Bybit", {
      retCode: 0,
      result: { b: [["100", "10", "2"]], a: [["101", "7", "1"]] },
    });
    expect(book).toEqual({
      bids: [{ price: 100, quantity: 12 }],
      asks: [{ price: 101, quantity: 8 }],
    });
  });

  test("parses Bitget rpi-orderbook three-column data envelope", () => {
    const book = normalizeSpotRpiOrderBook("Bitget", {
      code: "00000",
      data: { b: [["100", "10", "2"]], a: [["101", "7", "1"]] },
    });
    expect(book).toEqual({
      bids: [{ price: 100, quantity: 12 }],
      asks: [{ price: 101, quantity: 8 }],
    });
  });

  test("returns null for malformed payloads and unsupported exchanges", () => {
    expect(normalizeSpotRpiOrderBook("Gate.io", {})).toBeNull();
    expect(normalizeSpotRpiOrderBook("Bybit", { retCode: 0, result: {} })).toBeNull();
    expect(normalizeSpotRpiOrderBook("Binance", { bids: [], asks: [] })).toBeNull();
    expect(normalizeSpotRpiOrderBook("Gate.io", null)).toBeNull();
  });
});
