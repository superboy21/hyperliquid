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
});
