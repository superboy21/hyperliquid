import { describe, expect, test } from "bun:test";
import { alignComboData } from "../combo";
import type { SearchExchangeRate } from "../search";
import type { SearchCandleResult, SearchChartInterval } from "../search-candles";
import type { SpotMarketRow } from "../spot-search";
import type { SpotCandleResult } from "../spot-search-candles";
import { combineLoadedLegs, type SpotContainingCombinationResult } from "./combine";
import type { LoadedLeg, LoadedPerpLeg, LoadedSpotLeg } from "./load";
import { asPerpMarket, asSpotMarket } from "./model";
import { normalizePerpSeries, normalizeSpotSeries } from "./series";
import { createCandleSourceProvenance } from "../candle-provenance";

const perpSource = {
  exchange: "Binance", exchangeColor: "yellow", symbol: "BTC", fundingRate: 0, markPrice: 1,
  indexPrice: 1, lastPrice: 1, change24h: 0, quoteVolume: 0, openInterest: 0,
  notionalValue: 0, fundingInterval: 8, assetCategory: "crypto",
} satisfies SearchExchangeRate;
const spotSource = {
  exchange: "OKX", exchangeColor: "green", pair: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT",
  rawSymbol: "ETH-USDT", marketKey: "ETH-USDT", midPrice: 1, change24h: 0,
  quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
} satisfies SpotMarketRow;

function rawCandle(openTime: number, open: number, close: number, quoteVolume?: number, closeTime = openTime + 10) {
  return {
    openTime, closeTime, open: String(open), high: String(Math.max(open, close)),
    low: String(Math.min(open, close)), close: String(close), volume: "2",
    ...(quoteVolume === undefined ? {} : { quoteVolume: String(quoteVolume) }),
  };
}

function perpLeg(
  candles: SearchCandleResult["candles"],
  fundingRates: SearchCandleResult["fundingRates"] = [],
  interval: SearchChartInterval = "1h",
  source: SearchExchangeRate = perpSource,
): LoadedPerpLeg {
  const market = asPerpMarket(source);
  const original: SearchCandleResult = { candles, fundingRates, interval, exchange: source.exchange, symbol: source.symbol, provenance: createCandleSourceProvenance(source.exchange, interval, interval, false) };
  return { kind: "perp", market, original, series: normalizePerpSeries(market, original) };
}

function spotLeg(
  candles: SpotCandleResult["candles"],
  interval: SearchChartInterval = "1h",
  source: SpotMarketRow = spotSource,
): LoadedSpotLeg {
  const market = asSpotMarket(source);
  const original: SpotCandleResult = { candles, interval, exchange: source.exchange, symbol: source.pair, provenance: createCandleSourceProvenance(source.exchange, interval, interval, false) };
  return { kind: "spot", market, original, series: normalizeSpotSeries(market, original) };
}

function spotResult(result: ReturnType<typeof combineLoadedLegs>): SpotContainingCombinationResult {
  if (!("kind" in result) || result.kind !== "spot-containing") throw new Error("expected spot-containing result");
  return result;
}

describe("spot-containing combination", () => {
  test("uses exact intersection, shorter close, and reports no overlap", () => {
    const first = spotLeg([rawCandle(10, 10, 12, 100, 25), rawCandle(20, 12, 13, 120)]);
    const second = spotLeg([rawCandle(10, 4, 5, 80, 20), rawCandle(30, 5, 6, 90)]);
    const combined = spotResult(combineLoadedLegs(first, second, "spread"));
    expect(combined.composition).toBe("spot-spot");
    expect(combined.points).toHaveLength(1);
    expect(combined.points[0]).toMatchObject({ openTime: 10, closeTime: 20, open: 6, close: 7 });
    expect(combined.legProvenance).toHaveLength(2);
    expect(spotResult(combineLoadedLegs(spotLeg([rawCandle(1, 1, 1)]), spotLeg([rawCandle(2, 1, 1)]), "spread")).points).toEqual([]);
  });

  test("rejects interval mismatch", () => {
    expect(() => combineLoadedLegs(spotLeg([], "1h"), perpLeg([], [], "4h"), "spread")).toThrow(RangeError);
  });

  test("leg order controls spread/ratio and invalid spot-containing prices are dropped", () => {
    const perp = perpLeg([rawCandle(10, 10, 20), rawCandle(20, 10, 20)]);
    const spot = spotLeg([rawCandle(10, 2, 4), rawCandle(20, 0, 4)]);
    const forward = spotResult(combineLoadedLegs(perp, spot, "ratio"));
    const reverse = spotResult(combineLoadedLegs(spot, perp, "spread"));
    expect(forward.points.map((point) => [point.open, point.close])).toEqual([[5, 5]]);
    expect(reverse.points.map((point) => [point.open, point.close])).toEqual([[-8, -16]]);
  });

  test("keeps separate turnover provenance and only computes minimum when both exist", () => {
    const officialSpot = spotLeg([rawCandle(10, 5, 5, 0), rawCandle(20, 5, 5)]);
    const perp = perpLeg([rawCandle(10, 10, 10, 50), rawCandle(20, 10, 10)]);
    const points = spotResult(combineLoadedLegs(officialSpot, perp, "spread")).points;
    expect(points[0]).toMatchObject({
      leg1Turnover: { value: 0, provenance: "official-quote" },
      leg2Turnover: { value: 50, provenance: "official-quote" },
      minimumTurnover: 0,
    });
    expect(points[1]).toMatchObject({
      leg1Turnover: { value: 10, provenance: "estimated-base-close" },
      leg2Turnover: null,
      minimumTurnover: null,
    });
  });

  test("mixed funding is actual-only and signed by perp leg, retaining observed zero", () => {
    const candles = [rawCandle(10, 10, 10), rawCandle(20, 10, 10), rawCandle(30, 10, 10)];
    const funding = [
      { time: 10, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
      { time: 20, rate: 0, annualizedRate: 0, sampleCount: 2 },
      { time: 30, rate: 0, annualizedRate: 0, sampleCount: 0 },
    ];
    const perp = perpLeg(candles, funding);
    const spot = spotLeg(candles);
    const perpFirst = spotResult(combineLoadedLegs(perp, spot, "spread"));
    const spotFirst = spotResult(combineLoadedLegs(spot, perp, "spread"));
    expect(perpFirst.composition).toBe("mixed");
    expect(spotFirst.composition).toBe("mixed");
    expect(perpFirst.funding.map((point) => point.annualizedRate)).toEqual([0.1, 0]);
    expect(spotFirst.funding.map((point) => point.annualizedRate)).toEqual([-0.1, -0]);
  });
});

describe("perp legacy delegation", () => {
  test("matches alignComboData golden output for valid fixtures", () => {
    const first = perpLeg(
      [rawCandle(10, 10, 12, 100), rawCandle(20, 12, 14, 120)],
      [{ time: 10, rate: 0.01, annualizedRate: 0.1 }],
    );
    const secondSource = { ...perpSource, exchange: "OKX" as const, symbol: "ETH" };
    const second = perpLeg(
      [rawCandle(10, 5, 6, 80), rawCandle(20, 6, 7, 90)],
      [{ time: 10, rate: 0.005, annualizedRate: 0.04 }],
      "1h",
      secondSource,
    );
    expect(combineLoadedLegs(first, second, "spread")).toEqual(alignComboData(first.original, second.original, "spread"));
  });

  test("retains finite sampleCount:0 funding for legacy parity", () => {
    const zeroFilled = { time: 10, rate: 0, annualizedRate: 0, sampleCount: 0 };
    const first = perpLeg([rawCandle(10, 10, 11)], [zeroFilled]);
    const second = perpLeg([rawCandle(10, 5, 6)], [zeroFilled], "1h", {
      ...perpSource,
      exchange: "OKX",
      symbol: "ETH",
    });
    const expected = alignComboData(first.original, second.original, "spread");
    expect(expected.fundingRates).toHaveLength(1);
    expect(combineLoadedLegs(first, second, "spread")).toEqual(expected);
  });

  test("perp ratio rejects non-positive open/close on either numerator or denominator", () => {
    const first = perpLeg([
      rawCandle(10, 0, 2),
      rawCandle(20, 2, -1),
      rawCandle(30, 2, 2),
      rawCandle(40, 2, 2),
      rawCandle(50, 10, 20),
    ]);
    const second = perpLeg([
      rawCandle(10, 1, 1),
      rawCandle(20, 1, 1),
      rawCandle(30, 0, 1),
      rawCandle(40, 1, -1),
      rawCandle(50, 2, 4),
    ], [], "1h", { ...perpSource, exchange: "OKX", symbol: "ETH" });
    const combined = combineLoadedLegs(first, second, "ratio");
    expect("candles" in combined ? combined.candles.map((point) => point.openTime) : []).toEqual([50]);
    expect("candles" in combined ? [combined.candles[0].open, combined.candles[0].close] : []).toEqual(["5", "5"]);
  });
});
