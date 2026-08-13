import { describe, expect, test } from "bun:test";
import { annualizedFundingValue } from "./ArbitrageMarketTable";
import { asPerpMarket, asSpotMarket, toTableRow } from "@/lib/spot-perp-arbitrage";

function perp(exchange: "Binance" | "Lighter", fundingInterval: number, fundingRate: number) {
  return asPerpMarket({
    exchange, exchangeColor: "yellow", symbol: "BTC", fundingRate, markPrice: 1,
    indexPrice: 1, lastPrice: 1, change24h: 0, quoteVolume: 0, openInterest: 0,
    notionalValue: 0, fundingInterval, assetCategory: "Crypto",
  });
}

describe("Arbitrage funding sort values", () => {
  test("uses annualized values so mixed intervals sort by the displayed metric", () => {
    const oneHour = toTableRow(perp("Binance", 3600, 0.01));
    const eightHour = toTableRow(perp("Binance", 8 * 3600, 0.02));
    expect(annualizedFundingValue(oneHour, oneHour.predictedFundingRate!)).toBe(8760);
    expect(annualizedFundingValue(eightHour, eightHour.predictedFundingRate!)).toBe(2190);
    expect(annualizedFundingValue(oneHour, oneHour.predictedFundingRate!)).toBeGreaterThan(
      annualizedFundingValue(eightHour, eightHour.predictedFundingRate!)!,
    );
  });

  test("preserves Lighter current/latest versus average conversion rules", () => {
    const row = toTableRow(perp("Lighter", 3600, 0.08));
    expect(annualizedFundingValue(row, 0.08)).toBeCloseTo(8760);
    expect(annualizedFundingValue(row, 0.08, true)).toBeCloseTo(700.8);
  });

  test("returns null for Spot funding values", () => {
    const row = toTableRow(asSpotMarket({
      exchange: "OKX", exchangeColor: "green", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
      rawSymbol: "BTC-USDT", marketKey: "BTC-USDT", midPrice: 1, change24h: 0,
      quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
    }));
    expect(annualizedFundingValue(row, 0.1)).toBeNull();
  });
});
