import { describe, expect, test, mock } from "bun:test";
import type { CanonicalFundingRateRow } from "./types";

function canonical(exchange: CanonicalFundingRateRow["exchange"], symbol: string, rawSymbol: string): CanonicalFundingRateRow {
  return {
    exchange,
    transportMode: "native",
    symbol,
    rawSymbol,
    marketKey: rawSymbol,
    fundingRate: 0.0001,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 100,
    fundingIntervalSeconds: 28800,
    assetCategory: "Crypto",
  };
}

let bybitFails = false;

// Exchange data sources consumed by search.ts's fetchAllRates. Each is mocked
// so the integration test never touches the network; the Bybit mock doubles
// as a switchable failure for the isolation test.
mock.module("./hyperliquid", () => ({
  getAllFundingRatesWithHistory: async () => [
    { coin: "BTC", fundingRate: "0.0001", markPrice: "100", indexPrice: "100", prevDayPx: "99", dayVolume: "1000", openInterest: "10", isSpot: false, bestBid: "99", bestAsk: "101" },
  ],
}));

mock.module("@/lib/adapters/gate", () => ({
  fetchGateSearchRates: async () => [
    { exchange: "Gate.io", exchangeColor: "yellow", symbol: "BTC_USDT", rawSymbol: "BTC_USDT", fundingRate: 0.0001, markPrice: 100, indexPrice: 100, lastPrice: 100, change24h: 0, quoteVolume: 1, openInterest: 1, notionalValue: 100, fundingInterval: 28800, assetCategory: "Crypto" },
  ],
}));

mock.module("@/lib/adapters/binance", () => ({
  fetchBinanceSearchRates: async () => [
    { exchange: "Binance", exchangeColor: "amber", symbol: "BTC", rawSymbol: "BTCUSDT", fundingRate: 0.0001, markPrice: 100, indexPrice: 100, lastPrice: 100, change24h: 0, quoteVolume: 1, openInterest: 1, notionalValue: 100, fundingInterval: 28800, assetCategory: "Crypto" },
  ],
}));

mock.module("@/lib/adapters/okx", () => ({
  fetchOkxCanonicalRates: async () => [canonical("okx", "BTC", "BTC-USDT-SWAP")],
}));

mock.module("@/lib/adapters/bitget", () => ({
  fetchBitgetCanonicalRates: async () => [canonical("bitget", "BTC", "BTCUSDT")],
}));

mock.module("@/lib/adapters/bybit", () => ({
  fetchBybitCanonicalRates: async () => {
    if (bybitFails) throw new Error("bybit down");
    return [canonical("bybit", "BTC", "BTCUSDT")];
  },
}));

mock.module("./lighter", () => ({
  lighterFetch: async (path: string) => {
    if (path === "funding-rates") {
      return { ok: true, json: async () => ({ funding_rates: [{ exchange: "lighter", symbol: "BTC", market_id: 1, rate: "0.0001" }] }) };
    }
    if (path === "exchangeStats") {
      return { ok: true, json: async () => ({ order_book_stats: [] }) };
    }
    return { ok: true, json: async () => ({ order_book_details: [] }) };
  },
}));

import { fetchAllRates } from "./search";

describe("fetchAllRates integration", () => {
  test("aggregates all seven exchanges into a single rate list", async () => {
    const rates = await fetchAllRates();
    expect(rates.map((rate) => rate.exchange).sort()).toEqual([
      "Binance",
      "Bitget",
      "Bybit",
      "Gate.io",
      "Hyperliquid",
      "Lighter",
      "OKX",
    ]);
    const bybit = rates.find((rate) => rate.exchange === "Bybit");
    expect(bybit).toMatchObject({
      symbol: "BTC",
      rawSymbol: "BTCUSDT",
      exchangeColor: "orange",
      fundingInterval: 28800,
    });
  });

  test("isolates a Bybit failure without losing the other exchanges", async () => {
    const originalError = console.error;
    console.error = () => {};
    bybitFails = true;
    try {
      const rates = await fetchAllRates();
      expect(rates.some((rate) => rate.exchange === "Bybit")).toBe(false);
      expect(rates.map((rate) => rate.exchange)).toEqual(expect.arrayContaining([
        "Hyperliquid",
        "Gate.io",
        "Binance",
        "Lighter",
        "OKX",
        "Bitget",
      ]));
    } finally {
      bybitFails = false;
      console.error = originalError;
    }
  });
});
