import { describe, expect, test } from "bun:test";
import { normalizeSpotCandles } from "./spot-search-candles";

describe("spot candle normalizers", () => {
  test("maps Gate's nonstandard array order and sorts/deduplicates timestamps", () => {
    const candles = normalizeSpotCandles("Gate.io", [
      ["2", "220", "11", "12", "9", "10", "20"],
      ["1", "100", "10", "11", "8", "9", "10"],
      ["2", "220", "11", "12", "9", "10", "20"],
    ], "1m");
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ openTime: 1000, open: "9", close: "10", volume: "10", quoteVolume: "100" });
  });

  test("keeps Bitget base and quote volume fields distinct", () => {
    const candles = normalizeSpotCandles("Bitget", { data: [["1000", "1", "3", "0.5", "2", "12", "24", "25"]] }, "1m");
    expect(candles[0]).toMatchObject({ volume: "12", quoteVolume: "24" });
  });

  test("converts Bybit newest-first V5 kline tuples to ascending candles with turnover as quote volume", () => {
    const candles = normalizeSpotCandles("Bybit", {
      retCode: 0,
      retMsg: "OK",
      result: { list: [
        ["3000000000000", "12", "13", "11", "12.5", "30", "360"],
        ["2000000000000", "10", "11", "9", "10", "20", "200"],
        ["1000000000000", "8", "9", "7", "8", "10", "80"],
        ["1000000000000", "8", "9", "7", "8", "10", "80"],
      ] },
    }, "1m");
    expect(candles.map((candle) => candle.openTime)).toEqual([1000000000000, 2000000000000, 3000000000000]);
    expect(candles[0]).toMatchObject({ openTime: 1000000000000, closeTime: 1000000060000, open: "8", high: "9", low: "7", close: "8", volume: "10", quoteVolume: "80" });
    expect(candles[2]).toMatchObject({ openTime: 3000000000000, closeTime: 3000000060000, close: "12.5", volume: "30", quoteVolume: "360" });
  });

  test("tolerates Bybit tuples without turnover and non-array rows", () => {
    const candles = normalizeSpotCandles("Bybit", {
      result: { list: [
        ["1000000000000", "8", "9", "7", "8", "10"],
        "garbage",
        { symbol: "BTCUSDT" },
      ] },
    }, "5m");
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ openTime: 1000000000000, volume: "10" });
    expect(candles[0].quoteVolume).toBe("0");
  });
});
