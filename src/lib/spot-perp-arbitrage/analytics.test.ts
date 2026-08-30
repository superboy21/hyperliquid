import { describe, expect, test } from "bun:test";
import type { ComboCandleResult } from "../combo";
import type { MixedCombinationResult, SpotSpotCombinationResult } from "./combine";
import {
  dashboardAnalytics, distributionAnalytics, filterAlignedRange, filterLegacyComboRange, pairDashboardAnalytics,
  relativeGapPercent, visibleDashboardAnalytics, visiblePairDashboardAnalytics, type TailTrimPercent,
} from "./analytics";
import { asPerpMarket, asSpotMarket } from "./model";
import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";
import { calculateVolatilityParity } from "../combo-weighting";

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
const secondSpot = asSpotMarket({
  exchange: "Binance", exchangeColor: "yellow", pair: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT",
  rawSymbol: "ETHUSDT", marketKey: "ETHUSDT", midPrice: 1, change24h: 0,
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
      dashboardFundingRates: [
        { time: 1_000, rate: 1, annualizedRate: 1 },
        { time: 1_000 + 2 * day, rate: 2, annualizedRate: 2 },
      ],
      firstQuoteTurnover: [
        { time: 1_000, value: 10 },
        { time: 1_010 + day, value: 20 },
        { time: 1_000 + 2 * day, value: 30 },
      ],
      secondQuoteTurnover: [
        { time: 1_000, value: 40 },
        { time: 1_000 + 2 * day, value: 60 },
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
    expect(visible.dashboardFundingRates?.map((point) => point.time)).toEqual([1_000 + 2 * day]);
    expect(visible.firstQuoteTurnover?.map((point) => point.value)).toEqual([20, 30]);
    expect(visible.secondQuoteTurnover?.map((point) => point.value)).toEqual([60]);
    expect(filterAlignedRange(legacy, "1d")).toEqual(visible);
    expect(filterLegacyComboRange(legacy, "all").fundingRates).toEqual(legacy.fundingRates);
  });

  test("trims retained raw legs with the finite preset used by the legacy chart", () => {
    const hour = 3_600_000;
    const day = 86_400_000;
    const start = Date.UTC(2026, 0, 10);
    const make = (openTime: number, close: number) => ({
      openTime, closeTime: openTime + hour, open: String(close), high: String(close), low: String(close), close: String(close), volume: "1",
    });
    const rawFirst = [make(start - 2 * day, 20), make(start, 100), make(start + hour, 101), make(start + 2 * hour, 140)];
    const rawSecond = [make(start - 2 * day, 20), make(start, 100), make(start + hour, 101), make(start + 2 * hour, 102)];
    const legacy: ComboCandleResult = {
      candles: rawFirst.map((point, index) => ({ ...point, open: String(Number(point.open) - Number(rawSecond[index].open)), close: String(Number(point.close) - Number(rawSecond[index].close)) })),
      fundingRates: [],
      leg1Points: rawFirst.map((point) => ({ ...point, open: Number(point.open), high: Number(point.high), low: Number(point.low), close: Number(point.close) })),
      leg2Points: rawSecond.map((point) => ({ ...point, open: Number(point.open), high: Number(point.high), low: Number(point.low), close: Number(point.close) })),
      interval: "1h", exchange: "Binance", symbol: "BTC-ETH", mode: "spread",
      firstSymbol: "BTC", firstExchange: "Binance", secondSymbol: "ETH", secondExchange: "OKX",
      legProvenance: [] as never,
    };
    const visible = filterLegacyComboRange(legacy, "1d");
    expect(visible.leg1Points?.map((point) => point.openTime)).toEqual([start, start + hour, start + 2 * hour]);
    expect(visible.leg2Points?.map((point) => point.openTime)).toEqual([start, start + hour, start + 2 * hour]);
    const parity = calculateVolatilityParity(visible.leg1Points ?? [], visible.leg2Points ?? []);
    const all = calculateVolatilityParity(legacy.leg1Points ?? [], legacy.leg2Points ?? []);
    expect(parity.ok).toBe(true);
    expect(all.ok).toBe(true);
    expect(parity.first.percent).not.toBe(all.first.percent);
  });
});

describe("two-leg dashboard analytics", () => {
  test("perp pair averages actual funding differences and each leg turnover independently", () => {
    const combo: ComboCandleResult = {
      candles: [
        { openTime: 10, closeTime: 20, open: "1", high: "", low: "", close: "2", volume: "1", quoteVolume: "20" },
        { openTime: 20, closeTime: 30, open: "2", high: "", low: "", close: "3", volume: "1", quoteVolume: "30" },
      ],
      fundingRates: [],
      dashboardFundingRates: [
        { time: 10, rate: 0.01, annualizedRate: 0.1 },
        { time: 20, rate: -0.002, annualizedRate: -0.02 },
      ],
      firstQuoteTurnover: [{ time: 10, value: 0 }, { time: 20, value: 100 }],
      secondQuoteTurnover: [{ time: 10, value: 20 }],
      interval: "1h",
      exchange: "Binance",
      symbol: "BTC-ETH",
      mode: "spread",
      firstSymbol: "BTC",
      firstExchange: "Binance",
      secondSymbol: "ETH",
      secondExchange: "OKX",
    };

    const dashboard = pairDashboardAnalytics(combo, 0);
    expect(dashboard.fundingAnnualized).toEqual({ mean: 0.04, count: 2 });
    expect(dashboard.leg1Turnover).toEqual({ mean: 50, count: 2 });
    expect(dashboard.leg2Turnover).toEqual({ mean: 20, count: 1 });
  });

  test("intraday perp pairs start at the first both-actual bucket, then average each leg independently", () => {
    const combo: ComboCandleResult = {
      candles: [],
      fundingRates: [
        { time: 10, rate: 0.01, annualizedRate: 1, firstFunding: { rate: 0.01, annualizedRate: 1 }, secondFunding: null },
        { time: 20, rate: -0.02, annualizedRate: -2, firstFunding: null, secondFunding: { rate: 0.02, annualizedRate: 2 } },
        { time: 30, rate: 0, annualizedRate: 0, firstFunding: { rate: 0, annualizedRate: 0 }, secondFunding: { rate: 0, annualizedRate: 0 } },
        { time: 40, rate: 0.05, annualizedRate: 5, firstFunding: { rate: 0.05, annualizedRate: 5 }, secondFunding: null },
        { time: 50, rate: -0.06, annualizedRate: -6, firstFunding: null, secondFunding: { rate: 0.06, annualizedRate: 6 } },
        { time: 60, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
      ],
      dashboardFundingRates: [], firstQuoteTurnover: [], secondQuoteTurnover: [],
      interval: "4h", exchange: "Binance", symbol: "BTC-ETH", mode: "spread",
      firstSymbol: "BTC", firstExchange: "Binance", secondSymbol: "ETH", secondExchange: "OKX",
      legProvenance: [] as never,
    };

    const dashboard = pairDashboardAnalytics(combo, 0);
    expect(dashboard.fundingLeg1).toEqual({ mean: 2.5, count: 2 });
    expect(dashboard.fundingLeg2).toEqual({ mean: 3, count: 2 });
    expect(dashboard.fundingAnnualized).toEqual({ mean: -0.5, count: 1 });
    expect(dashboard.fundingAlignedCount).toBe(1);
  });

  test("non-intraday perp pairs use only strict both-actual funding metadata", () => {
    const combo: ComboCandleResult = {
      candles: [],
      fundingRates: [
        { time: 10, rate: 0.0075, annualizedRate: 0.75, firstFunding: { rate: 0.01, annualizedRate: 1 }, secondFunding: { rate: 0.0025, annualizedRate: 0.25 } },
        { time: 20, rate: 0.03, annualizedRate: 3, firstFunding: { rate: 0.03, annualizedRate: 3 }, secondFunding: null },
        { time: 30, rate: -0.01, annualizedRate: -1, firstFunding: null, secondFunding: { rate: 0.01, annualizedRate: 1 } },
        { time: 40, rate: 0.04, annualizedRate: 4, firstFunding: { rate: 0.05, annualizedRate: 5 }, secondFunding: { rate: 0.01, annualizedRate: 1 } },
      ],
      dashboardFundingRates: [], firstQuoteTurnover: [], secondQuoteTurnover: [],
      interval: "1d", exchange: "Binance", symbol: "BTC-ETH", mode: "spread",
      firstSymbol: "BTC", firstExchange: "Binance", secondSymbol: "ETH", secondExchange: "OKX",
      legProvenance: [] as never,
    };

    const dashboard = pairDashboardAnalytics(combo, 0);
    expect(dashboard.fundingLeg1).toEqual({ mean: 3, count: 2 });
    expect(dashboard.fundingLeg2).toEqual({ mean: 0.625, count: 2 });
    expect(dashboard.fundingAnnualized).toEqual({ mean: 2.375, count: 2 });
    expect(dashboard.fundingAnnualized.mean).toBe(
      dashboard.fundingLeg1!.mean! - dashboard.fundingLeg2!.mean!,
    );
    expect(dashboard.fundingAlignedCount).toBe(2);
  });

  test.each(["1d", "1w", "1m"] as const)("%s perp pairs retain strict aligned funding behavior", (interval) => {
    const combo: ComboCandleResult = {
      candles: [], fundingRates: [],
      dashboardFundingRates: [
        { time: 10, rate: 0.01, annualizedRate: 1 },
        { time: 20, rate: 0.02, annualizedRate: 3 },
      ],
      interval, exchange: "Binance", symbol: "BTC-ETH", mode: "spread",
      firstSymbol: "BTC", firstExchange: "Binance", secondSymbol: "ETH", secondExchange: "OKX",
      legProvenance: [] as never,
    };
    expect(pairDashboardAnalytics(combo, 0).fundingAnnualized).toEqual({ mean: 2, count: 2 });
  });

  test("spot pair has no funding metric and keeps true-zero turnover without filling missing values", () => {
    const spotPair: SpotSpotCombinationResult = {
      kind: "spot-containing",
      composition: "spot-spot",
      mode: "ratio",
      interval: "1h",
      leg1: spot,
      leg2: secondSpot,
      points: [
        {
          openTime: 10, closeTime: 20, open: 1, close: 1,
          leg1Turnover: { value: 0, provenance: "official-quote" },
          leg2Turnover: null,
          minimumTurnover: null,
        },
        {
          openTime: 20, closeTime: 30, open: 1, close: 1,
          leg1Turnover: { value: 100, provenance: "official-quote" },
          leg2Turnover: { value: 40, provenance: "official-quote" },
          minimumTurnover: 40,
        },
      ],
      funding: [],
    };

    const { dashboard } = visiblePairDashboardAnalytics(spotPair, "all", 0);
    expect(dashboard.fundingAnnualized).toBeNull();
    expect(dashboard.leg1Turnover).toEqual({ mean: 50, count: 2 });
    expect(dashboard.leg2Turnover).toEqual({ mean: 40, count: 1 });
  });
});
