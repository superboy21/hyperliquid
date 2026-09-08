import { describe, expect, test } from "bun:test";
import { fetchAllRates, type SearchExchangeRate, type SearchRateDependencies } from "./search";

function canonical(
  exchange: SearchExchangeRate["exchange"],
  symbol: string,
  rawSymbol: string,
  predictedFundingRate: number | null = null,
): SearchExchangeRate {
  const exchangeColors: Record<SearchExchangeRate["exchange"], string> = {
    Hyperliquid: "blue",
    "Gate.io": "yellow",
    Binance: "amber",
    Lighter: "purple",
    OKX: "emerald",
    Bitget: "teal",
    Bybit: "orange",
  };
  return {
    exchange,
    exchangeColor: exchangeColors[exchange],
    symbol,
    rawSymbol,
    fundingRate: 0.0001,
    predictedFundingRate,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 100,
    fundingInterval: 28800,
    assetCategory: "Crypto",
  };
}

let bybitFails = false;
let lighterFundingRate: string | number | undefined = "0.001408";
let gatePredictedFundingRate: number | null = 0.0002;
let okxPredictedFundingRate: number | null = 0.0003286308411615;
let binancePredictedFundingRate: number | null = 0.00040108;
let bitgetPredictedFundingRate: number | null = -0.0004;
let bybitPredictedFundingRate: number | null = 0.0005;

const lighterPonsFixture = [
  { exchange: "binance", symbol: "BTC", market_id: 1, rate: "0.0001" },
  { exchange: "bybit", symbol: "BTC", market_id: 1, rate: "0.0002" },
  { exchange: "hyperliquid", symbol: "BTC", market_id: 1, rate: "0.0003" },
  { exchange: "lighter", symbol: "BTC", market_id: 1, rate: "0.001408" },
];

const testDependencies = (): SearchRateDependencies => ({
  fetchHyperliquidRates: async () => [canonical("Hyperliquid", "BTC", "BTC")],
  fetchGateioRates: async () => [{ ...canonical("Gate.io", "BTC_USDT", "BTC_USDT"), predictedFundingRate: gatePredictedFundingRate }],
  fetchBinanceRates: async () => [{ ...canonical("Binance", "BTC", "BTCUSDT"), predictedFundingRate: binancePredictedFundingRate }],
  fetchOkxRates: async () => [{ ...canonical("OKX", "BTC", "BTC-USDT-SWAP"), predictedFundingRate: okxPredictedFundingRate }],
  fetchBitgetRates: async () => [{ ...canonical("Bitget", "BTC", "BTCUSDT"), predictedFundingRate: bitgetPredictedFundingRate }],
  fetchBybitRates: async () => {
    if (bybitFails) throw new Error("bybit down");
    return [{ ...canonical("Bybit", "BTC", "BTCUSDT"), predictedFundingRate: bybitPredictedFundingRate }];
  },
  lighterFetch: async (path: string): Promise<Response> => {
    if (path === "funding-rates") {
      return Response.json({
        funding_rates: lighterPonsFixture.map((entry) =>
          entry.exchange === "lighter" ? { ...entry, rate: lighterFundingRate } : entry,
        ),
      });
    }
    if (path === "exchangeStats") return Response.json({ order_book_stats: [] });
    return Response.json({ order_book_details: [] });
  },
});

describe("fetchAllRates integration", () => {
  test("aggregates all seven exchanges into a single rate list", async () => {
    const rates = await fetchAllRates(testDependencies());
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

  test("uses only the Lighter PONS row for the live upcoming funding prediction", async () => {
    const lighterRates = (await fetchAllRates(testDependencies())).filter((rate) => rate.exchange === "Lighter");

    expect(lighterRates).toHaveLength(1);
    expect(lighterRates[0]).toMatchObject({
      symbol: "BTC",
      fundingRate: 0.001408,
      predictedFundingRate: 0.001408,
    });
  });

  test("isolates a Bybit failure without losing the other exchanges", async () => {
    const originalError = console.error;
    console.error = () => {};
    bybitFails = true;
    try {
      const rates = await fetchAllRates(testDependencies());
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

  test("drops a Lighter market when its live funding rate is unavailable", async () => {
    lighterFundingRate = "";
    try {
      const rates = await fetchAllRates(testDependencies());
      expect(rates.some((rate) => rate.exchange === "Lighter")).toBe(false);
    } finally {
      lighterFundingRate = "0.001408";
    }
  });

  test.each([0, "0"] as const)("preserves a zero Lighter live rate (%s)", async (liveRate) => {
    lighterFundingRate = liveRate;
    try {
      const lighter = (await fetchAllRates(testDependencies())).find((rate) => rate.exchange === "Lighter");
      expect(lighter).toMatchObject({ fundingRate: 0, predictedFundingRate: 0 });
    } finally {
      lighterFundingRate = "0.001408";
    }
  });

  test.each(["not-a-number", "Infinity", undefined])(
    "drops a Lighter market for an invalid or missing live rate (%s)",
    async (liveRate) => {
      lighterFundingRate = liveRate;
      try {
        const rates = await fetchAllRates(testDependencies());
        expect(rates.some((rate) => rate.exchange === "Lighter")).toBe(false);
      } finally {
        lighterFundingRate = "0.001408";
      }
    },
  );

  test("threads Gate and OKX predicted funding through Search and preserves null", async () => {
    const rates = await fetchAllRates(testDependencies());
    expect(rates.find((rate) => rate.exchange === "Gate.io")?.predictedFundingRate).toBe(0.0002);
    expect(rates.find((rate) => rate.exchange === "OKX")?.predictedFundingRate).toBe(0.0003286308411615);
    expect(rates.find((rate) => rate.exchange === "Binance")?.predictedFundingRate).toBe(0.00040108);

    gatePredictedFundingRate = null;
    okxPredictedFundingRate = null;
    try {
      const unavailable = await fetchAllRates(testDependencies());
      expect(unavailable.find((rate) => rate.exchange === "Gate.io")?.predictedFundingRate).toBeNull();
      expect(unavailable.find((rate) => rate.exchange === "OKX")?.predictedFundingRate).toBeNull();
    } finally {
      gatePredictedFundingRate = 0.0002;
      okxPredictedFundingRate = 0.0003286308411615;
    }
  });

  test("threads Bybit and Bitget predicted funding through Search without fallback", async () => {
    const rates = await fetchAllRates(testDependencies());
    expect(rates.find((rate) => rate.exchange === "Bybit")?.predictedFundingRate).toBe(0.0005);
    expect(rates.find((rate) => rate.exchange === "Bitget")?.predictedFundingRate).toBe(-0.0004);

    bybitPredictedFundingRate = null;
    bitgetPredictedFundingRate = null;
    try {
      const unavailable = await fetchAllRates(testDependencies());
      expect(unavailable.find((rate) => rate.exchange === "Bybit")?.predictedFundingRate).toBeNull();
      expect(unavailable.find((rate) => rate.exchange === "Bitget")?.predictedFundingRate).toBeNull();
    } finally {
      bybitPredictedFundingRate = 0.0005;
      bitgetPredictedFundingRate = -0.0004;
    }
  });
});
