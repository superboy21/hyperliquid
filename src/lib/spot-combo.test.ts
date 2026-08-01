import { describe, expect, test } from "bun:test";
import { combineSpotCandles, parseSpotComboSearch } from "./spot-combo";
import type { SpotCandleResult } from "./spot-search-candles";

const result = (symbol: string, values: [number, number, number, number]): SpotCandleResult => ({
  interval: "1h", exchange: "Binance", symbol,
  candles: [{ openTime: 1, closeTime: 2, open: String(values[0]), high: String(values[1]), low: String(values[2]), close: String(values[3]), volume: "10" }],
});

describe("spot combo", () => {
  test("does not interpret normal quoted pairs as ratios", () => {
    expect(parseSpotComboSearch("BTC/USDT").mode).toBeNull();
    expect(parseSpotComboSearch("BTC-USDC").mode).toBeNull();
    expect(parseSpotComboSearch("BTC/ETH").mode).toBeNull();
    expect(parseSpotComboSearch("BTC/SOL")).toEqual({ keyword1: "btc", keyword2: "sol", mode: "ratio" });
  });

  test("pairs only matching timestamps and derives valid OHLC bounds", () => {
    const spread = combineSpotCandles(result("BTC", [100, 120, 90, 110]), result("SOL", [50, 60, 40, 55]), "spread");
    expect(spread.candles[0]).toMatchObject({ open: "50", high: "80", low: "30", close: "55" });
    const ratio = combineSpotCandles(result("BTC", [100, 120, 90, 110]), result("SOL", [50, 60, 40, 55]), "ratio");
    expect(ratio.candles[0]).toMatchObject({ open: "2", high: "3", low: "1.5", close: "2" });
  });
});
