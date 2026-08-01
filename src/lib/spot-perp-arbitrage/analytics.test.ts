import { describe, expect, test } from "bun:test";
import type { ComboCandleResult } from "../combo";
import type { MixedCombinationResult } from "./combine";
import {
  dashboardAnalytics, distributionAnalytics, filterAlignedRange, filterLegacyComboRange,
  relativeGapPercent, visibleDashboardAnalytics, type TailTrimPercent,
} from "./analytics";
import { asPerpMarket, asSpotMarket } from "./model";
import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";

const perp = asPerpMarket({
  exchange: "Binance", exchangeColor: "yellow", symbol: "BTC", fundingRate: 0, markPrice: 1,
  indexPrice: 1, lastPrice: 1, change24h: 0, quoteVolume: 0, openInterest: 0,
  notionalValue: 0, fundingInterval: 8, assetCategory: "crypto",
} satisfies SearchExchangeRate);
const spot = asSpotMarket({
  exchange: "OKX", exchangeColor: "green", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTC-USDT", marketKey: "BTC-USDT", midPrice: 1, change24h: 0,
  quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
} satisfies SpotMarketRow);

function result(times: number[], closes = times): MixedCombinationResult {
  return {
    kind: "spot-containing", composition: "mixed", mode: "spread", interval: "1h", leg1: perp, leg2: spot,
    points: times.map((time, index) => ({
      openTime: time, closeTime: time + 10, open: closes[index], close: closes[index],
      leg1Turnover: index === 0 ? null : { value: index * 10, provenance: "official-quote" },
      leg2Turnover: { value: index * 20, provenance: index === 0 ? "estimated-base-close" : "official-quote" },
      minimumTurnover: null,
    })),
    funding: times.map((time, index) => ({
      time, rate: index / 100, annualizedRate: index === 0 ? 0 : index / 10,
      sampleCount: 1, perpLeg: 1,
    })),
  };
}

describe("tail statistics", () => {
  test("relative gap uses absolute mean and returns null for unavailable inputs or zero mean", () => {
    expect(relativeGapPercent(0.9, 1)).toBeCloseTo(-10);
    expect(relativeGapPercent(1.1, -1)).toBeCloseTo(210);
    expect(relativeGapPercent(null, 1)).toBeNull();
    expect(relativeGapPercent(1, undefined)).toBeNull();
    expect(relativeGapPercent(Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(relativeGapPercent(1, 0)).toBeNull();
  });

  test("all trim options remove floor(n*pct/100) from each tail", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const expected = new Map<TailTrimPercent, number>([[0, 100], [1, 98], [2.5, 96], [5, 90], [10, 80]]);
    for (const [trim, retained] of expected) {
      const stats = distributionAnalytics(values, trim);
      expect(stats.retainedCount).toBe(retained);
      expect(stats.removedCount).toBe(100 - retained);
      expect(stats.mean).toBe(50.5);
    }
  });

  test("small N floors to no trim and sigma is population sigma", () => {
    const stats = distributionAnalytics([1, 2, 3, Number.NaN], 10);
    expect(stats.retainedCount).toBe(3);
    expect(stats.removedCount).toBe(0);
    expect(stats.mean).toBe(2);
    expect(stats.populationSigma).toBeCloseTo(Math.sqrt(2 / 3));
    expect(stats.minus1Sigma).toBeCloseTo(2 - Math.sqrt(2 / 3));
    expect(stats.plus2Sigma).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3));
    expect(distributionAnalytics([], 1).mean).toBeNull();
  });

  test("all four sigma bands expose gaps relative to the same trimmed mean", () => {
    const stats = distributionAnalytics([0, 2], 0);
    expect(stats).toMatchObject({ mean: 1, populationSigma: 1 });
    expect(stats.bands).toEqual({
      minus2Sigma: { value: -1, gapPercent: -200 },
      minus1Sigma: { value: 0, gapPercent: -100 },
      plus1Sigma: { value: 2, gapPercent: 100 },
      plus2Sigma: { value: 3, gapPercent: 200 },
    });
  });

  test("zero or unavailable means produce null band gaps", () => {
    const zeroMean = distributionAnalytics([-1, 0, 1], 0);
    expect(Object.values(zeroMean.bands).every((band) => band.gapPercent === null)).toBeTrue();
    const unavailable = distributionAnalytics([], 0);
    expect(Object.values(unavailable.bands).every((band) => band.value === null && band.gapPercent === null)).toBeTrue();
  });
});

describe("visible mixed dashboard", () => {
  test("finite range anchors to data end rather than wall clock; all preserves all", () => {
    const day = 86_400_000;
    const stale = result([1_000, 1_010 + day, 1_000 + 2 * day]);
    expect(filterAlignedRange(stale, "1d").points.map((point) => point.openTime)).toEqual([1_010 + day, 1_000 + 2 * day]);
    expect(filterAlignedRange(stale, "all").points).toHaveLength(3);
  });

  test("dashboard consumes exactly the visible result with separate available counts and untrimmed funding", () => {
    const day = 86_400_000;
    const source = result([1_000, 1_010 + day, 1_000 + 2 * day], [1, 2, 100]);
    const { visible, dashboard } = visibleDashboardAnalytics(source, "1d", 10);
    expect(visible.points).toHaveLength(2);
    expect(dashboard).toEqual(dashboardAnalytics(visible, 10));
    expect(dashboard.derivedClose).toMatchObject({ mean: 51, retainedCount: 2, removedCount: 0 });
    expect(dashboard.fundingAnnualized.count).toBe(2);
    expect(dashboard.fundingAnnualized.mean).toBeCloseTo(0.15);
    expect(dashboard.perpTurnover).toEqual({ mean: 15, count: 2 });
    expect(dashboard.spotTurnover).toEqual({ mean: 30, count: 2 });
  });

  test("observed-zero funding participates in the mean and unavailable turnovers stay empty", () => {
    const visible = result([10]);
    visible.points[0].leg1Turnover = null;
    visible.points[0].leg2Turnover = null;
    const dashboard = dashboardAnalytics(visible, 1);
    expect(dashboard.fundingAnnualized).toEqual({ mean: 0, count: 1 });
    expect(dashboard.perpTurnover).toEqual({ mean: null, count: 0 });
    expect(dashboard.spotTurnover).toEqual({ mean: null, count: 0 });
  });

  test("current close comes from greatest finite closeTime, not array or distribution order", () => {
    const outOfOrder = result([300, 100, 200], [3, 1, 2]);
    const dashboard = dashboardAnalytics(outOfOrder, 0);
    expect(dashboard.derivedClose.mean).toBe(2);
    expect(dashboard.currentDerivedClose).toEqual({ value: 3, gapPercent: 50 });
  });

  test("current extreme is not trimmed and its gap uses the trimmed reference mean", () => {
    const closes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100];
    const visible = result(closes.map((_, index) => index * 100), closes);
    const dashboard = dashboardAnalytics(visible, 10);
    expect(dashboard.derivedClose).toMatchObject({ mean: 4.5, retainedCount: 8, removedCount: 2 });
    expect(dashboard.currentDerivedClose.value).toBe(100);
    expect(dashboard.currentDerivedClose.gapPercent).toBeCloseTo((100 - 4.5) / 4.5 * 100);
  });

  test("current gap is null when mean is zero or no visible candle is available", () => {
    const zeroMean = dashboardAnalytics(result([10, 20, 30], [-1, 0, 1]), 0);
    expect(zeroMean.currentDerivedClose).toEqual({ value: 1, gapPercent: null });
    expect(dashboardAnalytics(result([]), 0).currentDerivedClose).toEqual({ value: null, gapPercent: null });
  });
});

describe("legacy combo range", () => {
  test("anchors to latest aligned close and preserves zero-filled funding in-window", () => {
    const day = 86_400_000;
    const candle = (openTime: number) => ({
      openTime,
      closeTime: openTime + 10,
      open: "1",
      high: "",
      low: "",
      close: "1",
      volume: "1",
    });
    const legacy: ComboCandleResult = {
      candles: [candle(1_000), candle(1_010 + day), candle(1_000 + 2 * day)],
      fundingRates: [
        { time: 1_000, rate: 1, annualizedRate: 1, sampleCount: 1 },
        { time: 1_010 + day, rate: 0, annualizedRate: 0, sampleCount: 0 },
        { time: 1_000 + 2 * day, rate: 2, annualizedRate: 2, sampleCount: 1 },
      ],
      interval: "1h",
      exchange: "Binance",
      symbol: "BTC-ETH",
      mode: "spread",
      firstSymbol: "BTC",
      firstExchange: "Binance",
      secondSymbol: "ETH",
      secondExchange: "OKX",
    };
    const visible = filterLegacyComboRange(legacy, "1d");
    expect(visible.candles.map((point) => point.openTime)).toEqual([1_010 + day, 1_000 + 2 * day]);
    expect(visible.fundingRates).toHaveLength(2);
    expect((visible.fundingRates[0] as typeof visible.fundingRates[number] & { sampleCount?: number }).sampleCount).toBe(0);
    expect(filterAlignedRange(legacy, "1d")).toEqual(visible);
    expect(filterLegacyComboRange(legacy, "all").fundingRates).toEqual(legacy.fundingRates);
  });
});
