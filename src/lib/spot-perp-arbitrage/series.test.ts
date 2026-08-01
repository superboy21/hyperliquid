import { describe, expect, test } from "bun:test";
import type { SearchExchangeRate } from "../search";
import type { SearchCandleResult } from "../search-candles";
import type { SpotMarketRow } from "../spot-search";
import type { SpotCandleResult } from "../spot-search-candles";
import { asPerpMarket, asSpotMarket } from "./model";
import { normalizePerpSeries, normalizeSpotSeries } from "./series";

const perpSource = {
  exchange: "Binance", exchangeColor: "yellow", symbol: "BTC", fundingRate: 0, markPrice: 1,
  indexPrice: 1, lastPrice: 1, change24h: 0, quoteVolume: 0, openInterest: 0,
  notionalValue: 0, fundingInterval: 8, assetCategory: "crypto",
} satisfies SearchExchangeRate;

const spotSource = {
  exchange: "OKX", exchangeColor: "green", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTC-USDT", marketKey: "BTC-USDT", midPrice: 1, change24h: 0,
  quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
} satisfies SpotMarketRow;

const candle = (openTime: number, close: string, quoteVolume?: string) => ({
  openTime, closeTime: openTime + 10, open: close, high: close, low: close, close,
  volume: "2", ...(quoteVolume === undefined ? {} : { quoteVolume }),
});

describe("numeric series boundary", () => {
  test("sorts exact timestamps, deterministically keeps the last valid duplicate, and rejects non-finite points", () => {
    const raw: SpotCandleResult = {
      interval: "1h", exchange: "OKX", symbol: "BTC/USDT",
      candles: [
        candle(20, "2"), candle(10, "1"), candle(10, "3"), candle(30, "NaN"),
        { ...candle(40, "4"), closeTime: 40 },
      ],
    };
    const series = normalizeSpotSeries(asSpotMarket(spotSource), raw);
    expect(series.points.map((point) => [point.openTime, point.close])).toEqual([[10, 3], [20, 2]]);
  });

  test("official non-negative quote turnover wins including zero; spot estimates and perp stays null", () => {
    const spotRaw: SpotCandleResult = {
      interval: "1h", exchange: "OKX", symbol: "BTC/USDT",
      candles: [candle(10, "5", "0"), candle(20, "5"), candle(30, "5", "-1")],
    };
    const spotSeries = normalizeSpotSeries(asSpotMarket(spotSource), spotRaw);
    expect(spotSeries.points.map((point) => point.turnover)).toEqual([
      { value: 0, provenance: "official-quote" },
      { value: 10, provenance: "estimated-base-close" },
      { value: 10, provenance: "estimated-base-close" },
    ]);

    const perpRaw: SearchCandleResult = {
      interval: "1h", exchange: "Binance", symbol: "BTC", fundingRates: [], candles: [candle(10, "5")],
    };
    expect(normalizePerpSeries(asPerpMarket(perpSource), perpRaw).points[0].turnover).toBeNull();
  });

  test("funding keeps observed zero but removes explicit zero-count/malformed samples", () => {
    const raw: SearchCandleResult = {
      interval: "1h", exchange: "Binance", symbol: "BTC", candles: [],
      fundingRates: [
        { time: 10, rate: 0, annualizedRate: 0, sampleCount: 2 },
        { time: 20, rate: 0, annualizedRate: 0, sampleCount: 0 },
        { time: 30, rate: 0.1, annualizedRate: 0.2 },
      ],
    };
    const funding = normalizePerpSeries(asPerpMarket(perpSource), raw).funding;
    expect(funding).toEqual([
      { time: 10, rate: 0, annualizedRate: 0, sampleCount: 2 },
      { time: 30, rate: 0.1, annualizedRate: 0.2, sampleCount: null },
    ]);
  });
});
