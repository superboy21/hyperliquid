import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STRATEGY_SETTINGS,
  applyStrategyDraft,
  comboFundingRate,
  comboImpactCost,
  computeStrategyRecommendations,
  legAnnualizedFundingPercent,
  legFundingRateValue,
  normalizeConvergenceDays,
  type StrategyLegFunding,
} from "./strategy";
import { asPerpMarket, asSpotMarket, marketId } from "./model";
import type { ArbitrageMarket } from "./model";
import type { ImpactSpreadDetailResult } from "../impact-price";

function perp(
  exchange: "Binance" | "OKX" | "Bybit" | "Gate.io" | "Lighter",
  symbol: string,
  funding: Partial<StrategyLegFunding> & { fundingInterval?: number } = {},
): ArbitrageMarket {
  return asPerpMarket({
    exchange, exchangeColor: "yellow", symbol, rawSymbol: symbol, fundingRate: 0, markPrice: 100,
    indexPrice: 100, lastPrice: 100, change24h: 0, quoteVolume: 0, openInterest: 0,
    notionalValue: 0, fundingInterval: 8 * 3600, assetCategory: "Crypto",
    ...funding,
  });
}

function spot(exchange: "Binance" | "OKX", symbol: string, quoteAsset = "USDT"): ArbitrageMarket {
  return asSpotMarket({
    exchange, exchangeColor: "green", pair: `${symbol}/${quoteAsset}`, baseAsset: symbol, quoteAsset,
    rawSymbol: `${symbol}${quoteAsset}`, marketKey: `${symbol}/${quoteAsset}`, midPrice: 100, change24h: 0,
    quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
  });
}

function detail(askPrice: number, bidPrice: number): ImpactSpreadDetailResult {
  return { askPrice, bidPrice, mid: 100, bboMid: 100, spread: 0, buyImpactSpread: 0, sellImpactSpread: 0 };
}

function results(markets: readonly ArbitrageMarket[], prices: readonly [number, number][]): Map<string, ImpactSpreadDetailResult> {
  return new Map(markets.map((market, index) => [String(marketId(market)), detail(...prices[index])]));
}

describe("strategy recommendations", () => {
  test("calculates gross spread, sorts descending, and keeps only the top five", () => {
    const markets = [perp("Binance", "BTC"), perp("OKX", "BTC"), perp("Bybit", "BTC"), perp("Gate.io", "BTC"), perp("Lighter", "BTC")];
    const impact = results(markets, [[100, 90], [100, 101.5], [100, 100.5], [100, 102], [100, 99]]);
    const recommendations = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, spotOnlyBuy: false,
    });

    expect(recommendations).toHaveLength(5);
    expect(recommendations[0].gross).toBeGreaterThanOrEqual(recommendations[1].gross);
    expect(recommendations[1].gross).toBeGreaterThanOrEqual(recommendations[2].gross);
    expect(recommendations[2].gross).toBeGreaterThanOrEqual(recommendations[3].gross);
    expect(recommendations[3].gross).toBeGreaterThanOrEqual(recommendations[4].gross);
    expect(recommendations.every((item) => item.gross >= 0.5 && item.gross <= 1.5)).toBe(true);
    expect(recommendations.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  test("applies each configured recommendation limit, including all qualifying results", () => {
    const markets = [perp("Binance", "BTC"), perp("OKX", "BTC"), perp("Bybit", "BTC"), perp("Gate.io", "BTC"), perp("Lighter", "BTC")];
    const impact = results(markets, [[100, 90], [100, 101.5], [100, 100.5], [100, 102], [100, 99]]);
    const baseSettings = { ...DEFAULT_STRATEGY_SETTINGS, maxGross: 5, spotOnlyBuy: false };

    expect(computeStrategyRecommendations(markets, impact, { ...baseSettings, recommendationLimit: 3 })).toHaveLength(3);
    expect(computeStrategyRecommendations(markets, impact, { ...baseSettings, recommendationLimit: 5 })).toHaveLength(5);
    expect(computeStrategyRecommendations(markets, impact, { ...baseSettings, recommendationLimit: 7 })).toHaveLength(7);
    expect(computeStrategyRecommendations(markets, impact, { ...baseSettings, recommendationLimit: 10 })).toHaveLength(10);
    expect(computeStrategyRecommendations(markets, impact, { ...baseSettings, recommendationLimit: "all" })).toHaveLength(12);
  });

  test("includes both 0.5% and 1.5% boundaries", () => {
    const buy = perp("Binance", "BTC");
    const sell = perp("OKX", "BTC");
    const marketList = [buy, sell];
    const impact = results(marketList, [[100, 90], [100, 101.5]]);
    const recommendations = computeStrategyRecommendations(marketList, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0.5, maxGross: 1.5, spotOnlyBuy: false,
    });

    expect(recommendations.some((item) => item.gross === 1.5)).toBe(true);
    const halfPercent = computeStrategyRecommendations(marketList, results(marketList, [[100, 90], [100, 100.5]]), {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0.5, maxGross: 0.5, spotOnlyBuy: false,
    });
    expect(halfPercent).toHaveLength(1);
    expect(halfPercent[0].gross).toBe(0.5);
  });

  test("skips invalid prices and prevents a spot market from being the sell leg", () => {
    const spotBuy = spot("Binance", "BTC");
    const spotSell = spot("OKX", "BTC");
    const perpSell = perp("Bybit", "BTC");
    const markets = [spotBuy, spotSell, perpSell];
    const impact = results(markets, [[100, 90], [Number.NaN, 110], [100, 101]]);
    const spotOnlyBuy = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 20, spotOnlyBuy: true,
    });

    expect(spotOnlyBuy.every((item) => item.sell.kind === "perp")).toBe(true);
    expect(spotOnlyBuy.some((item) => item.sell.id === String(marketId(spotSell)))).toBe(false);
    expect(spotOnlyBuy.some((item) => item.buy.id === item.sell.id)).toBe(false);

    const allDirections = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 20, spotOnlyBuy: false,
    });
    expect(allDirections.some((item) => item.sell.id === String(marketId(spotSell)))).toBe(false);
  });

  test("applies fees only to net and annualized returns", () => {
    const markets = [perp("Binance", "BTC"), perp("OKX", "BTC")];
    const impact = results(markets, [[100, 90], [101, 101]]);
    const recommendation = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 2, totalFee: 0.1, convergenceDays: 10, spotOnlyBuy: false,
    })[0];

    expect(recommendation.gross).toBeCloseTo(1);
    expect(recommendation.netReturn).toBeCloseTo(0.9);
    expect(recommendation.usdReturn).toBeCloseTo(27);
    expect(recommendation.annualized).toBeCloseTo(32.85);
  });

  test("keeps draft values unapplied until conversion and falls back for invalid days", () => {
    const draft = { minGross: "1", maxGross: "2", totalFee: "0.2", spotOnlyBuy: false, convergenceDays: "0" };
    expect(normalizeConvergenceDays(0)).toBe(3);
    expect(applyStrategyDraft(draft, 500)).toEqual({
      impactNotional: 500, minGross: 1, maxGross: 2, totalFee: 0.2, spotOnlyBuy: false, convergenceDays: 3, recommendationLimit: 5,
    });
    expect(applyStrategyDraft(draft, 500, "all").recommendationLimit).toBe("all");
    expect(DEFAULT_STRATEGY_SETTINGS).toMatchObject({ impactNotional: 3000, minGross: 0.2, convergenceDays: 3, recommendationLimit: 5 });
  });

  test("compares every distinct search result regardless of base asset or quote currency", () => {
    const btcPerp = perp("Binance", "BTC");
    const ethBtcSpot = spot("OKX", "ETH", "BTC");
    const markets = [btcPerp, ethBtcSpot];
    const impact = results(markets, [[100, 90], [100, 101]]);
    const recommendations = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0.5, maxGross: 1.5, spotOnlyBuy: false,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].buy.id).toBe(String(marketId(btcPerp)));
    expect(recommendations[0].sell.id).toBe(String(marketId(ethBtcSpot)));
  });

  test("normalizes reversed ranges and invalid fee or convergence-day drafts", () => {
    const draft = { minGross: "2", maxGross: "1", totalFee: "-1", spotOnlyBuy: false, convergenceDays: "-3" };
    expect(applyStrategyDraft(draft, 500)).toMatchObject({
      minGross: 1,
      maxGross: 2,
      totalFee: DEFAULT_STRATEGY_SETTINGS.totalFee,
      convergenceDays: DEFAULT_STRATEGY_SETTINGS.convergenceDays,
      recommendationLimit: DEFAULT_STRATEGY_SETTINGS.recommendationLimit,
    });
  });

  test("attaches per-leg funding rates from sources and computes 组合资金费率 (buy − sell, spot = 0)", () => {
    const buy = perp("Binance", "BTC", { fundingRate: 0.0001, avgFundingRate2d: 0.0001, avgFundingRate7d: 0.00012, avgFundingRate30d: 0.00009, lastSettlementRate: 0.00008 });
    const sell = perp("OKX", "BTC", { fundingRate: -0.00005, avgFundingRate2d: -0.00005, avgFundingRate7d: -0.00004, avgFundingRate30d: -0.00006, lastSettlementRate: -0.00007 });
    const spotBuy = spot("Binance", "ETH");
    const markets = [buy, sell, spotBuy];
    const impact = results(markets, [[100, 90], [100, 101], [100, 99]]);
    const recommendations = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    });

    const combo = recommendations.find((item) => item.buy.id === String(marketId(buy)) && item.sell.id === String(marketId(sell)));
    expect(combo).toBeDefined();
    expect(combo!.buy.funding).toEqual({
      latestSettlementRate: 0.00008, predictedFundingRate: 0.0001, averageFundingRate2d: 0.0001, averageFundingRate7d: 0.00012, averageFundingRate30d: 0.00009,
    });
    expect(legFundingRateValue(combo!.buy, "average2d")).toBe(0.0001);
    expect(legFundingRateValue(combo!.sell, "average2d")).toBe(-0.00005);
    expect(comboFundingRate(combo!.buy, combo!.sell, "average2d")).toBeCloseTo(0.00015);
    expect(comboFundingRate(combo!.buy, combo!.sell, "latest")).toBeCloseTo(0.00015);
    expect(comboFundingRate(combo!.buy, combo!.sell, "average7d")).toBeCloseTo(0.00016);
    expect(comboFundingRate(combo!.buy, combo!.sell, "average30d")).toBeCloseTo(0.00015);
    expect(comboFundingRate(combo!.buy, combo!.sell, "predicted")).toBeCloseTo(0.00015);

    // spot legs always contribute 0 regardless of mode
    const spotLegCombo = recommendations.find((item) => item.buy.id === String(marketId(spotBuy)));
    expect(spotLegCombo).toBeDefined();
    expect(legFundingRateValue(spotLegCombo!.buy, "average2d")).toBe(0);
    expect(legFundingRateValue(spotLegCombo!.buy, "latest")).toBe(0);
    expect(comboFundingRate(spotLegCombo!.buy, spotLegCombo!.sell, "average2d")).toBeCloseTo(0 - (-0.00005));
  });

  test("prefers the funding map passed from table rows over source values", () => {
    const buy = perp("Binance", "BTC");
    const sell = perp("OKX", "BTC");
    const markets = [buy, sell];
    const impact = results(markets, [[100, 90], [100, 101]]);
    const fundingMap = new Map<string, StrategyLegFunding>([
      [String(marketId(buy)), { latestSettlementRate: 0.001, predictedFundingRate: 0.001, averageFundingRate2d: 0.001, averageFundingRate7d: 0.001, averageFundingRate30d: 0.001 }],
      [String(marketId(sell)), { latestSettlementRate: 0.0002, predictedFundingRate: 0.0002, averageFundingRate2d: 0.0002, averageFundingRate7d: 0.0002, averageFundingRate30d: 0.0002 }],
    ]);
    const [rec] = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    }, fundingMap);

    expect(comboFundingRate(rec.buy, rec.sell, "average2d")).toBeCloseTo(0.0008);
    expect(comboFundingRate(rec.buy, rec.sell, "predicted")).toBeCloseTo(0.0008);
    expect(rec.buy.funding!.latestSettlementRate).toBe(0.001);
  });

  test("normalizes Lighter average funding (percentage points) to the shared 8h-equivalent scale", () => {
    // Lighter 平均费率是每小时百分数（0.0123 = 0.0123%），latest/predicted 是 8h 等价小数
    const lighter = perp("Lighter", "BTC", {
      fundingRate: 0.0001,
      avgFundingRate2d: 0.0123,
      avgFundingRate7d: 0.011,
      avgFundingRate30d: 0.0105,
      lastSettlementRate: 0.0001,
    });
    const binance = perp("Binance", "BTC", {
      fundingRate: 0.0001,
      avgFundingRate2d: 0.0001,
      avgFundingRate7d: 0.0001,
      avgFundingRate30d: 0.0001,
      lastSettlementRate: 0.0001,
    });
    const markets = [lighter, binance];
    const impact = results(markets, [[100, 90], [100, 101]]);
    const [rec] = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    });
    const lighterLeg = rec.buy;
    const binanceLeg = rec.sell;

    // 平均模式：百分数 / 12.5 → 8h 等价小数；latest/predicted 原样
    expect(legFundingRateValue(lighterLeg, "average2d")).toBeCloseTo(0.0123 / 12.5);
    expect(legFundingRateValue(lighterLeg, "average7d")).toBeCloseTo(0.011 / 12.5);
    expect(legFundingRateValue(lighterLeg, "average30d")).toBeCloseTo(0.0105 / 12.5);
    expect(legFundingRateValue(lighterLeg, "latest")).toBeCloseTo(0.0001);
    expect(legFundingRateValue(lighterLeg, "predicted")).toBeCloseTo(0.0001);
    expect(legFundingRateValue(binanceLeg, "average2d")).toBeCloseTo(0.0001);

    // 组合费率在同一刻度上相减
    expect(comboFundingRate(lighterLeg, binanceLeg, "average2d")).toBeCloseTo(0.0123 / 12.5 - 0.0001);
    expect(comboFundingRate(lighterLeg, binanceLeg, "latest")).toBeCloseTo(0);

    // 年化与主表口径一致：Lighter 平均 0.0123% × 24 × 365 ≈ 107.75%
    expect(legAnnualizedFundingPercent(lighterLeg, legFundingRateValue(lighterLeg, "average2d")!)).toBeCloseTo(0.0123 * 24 * 365);
    expect(legAnnualizedFundingPercent(binanceLeg, 0.0001)).toBeCloseTo(10.95);
  });

  test("attaches impact/top spreads from the market maps and computes 冲击成本 (buy + sell, mode-switchable)", () => {
    const buy = perp("Binance", "BTC");
    const sell = perp("OKX", "BTC");
    const markets = [buy, sell];
    const impact = results(markets, [[100, 90], [100, 101]]);
    const spreadMap = new Map<string, number | null>([
      [String(marketId(buy)), 0.12],
      [String(marketId(sell)), 0.08],
    ]);
    const topSpreadMap = new Map<string, number | null>([
      [String(marketId(buy)), 0.02],
      [String(marketId(sell)), 0.03],
    ]);
    const [rec] = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    }, undefined, spreadMap, topSpreadMap);

    expect(rec.buy.impactSpread).toBe(0.12);
    expect(rec.sell.impactSpread).toBe(0.08);
    expect(rec.buy.topSpread).toBe(0.02);
    expect(rec.sell.topSpread).toBe(0.03);
    // 默认 impact 模式
    expect(comboImpactCost(rec.buy, rec.sell)).toBeCloseTo(0.2);
    expect(comboImpactCost(rec.buy, rec.sell, "impact")).toBeCloseTo(0.2);
    // 切换到 top 盘口价差
    expect(comboImpactCost(rec.buy, rec.sell, "top")).toBeCloseTo(0.05);

    // 未提供 spread map 时该腿为 null → 冲击成本 null（两种模式一致）
    const [bare] = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    });
    expect(bare.buy.impactSpread).toBeNull();
    expect(bare.buy.topSpread).toBeNull();
    expect(comboImpactCost(bare.buy, bare.sell)).toBeNull();
    expect(comboImpactCost(bare.buy, bare.sell, "top")).toBeNull();
  });

  test("annualizes a leg funding rate with its own interval and treats missing data as null", () => {
    const buy = perp("Binance", "BTC", { avgFundingRate2d: 0.0001 });
    const lighter = perp("Lighter", "BTC", { avgFundingRate2d: 0.0001 });
    const markets = [buy, lighter];
    const impact = results(markets, [[100, 90], [100, 101]]);
    const [rec] = computeStrategyRecommendations(markets, impact, {
      ...DEFAULT_STRATEGY_SETTINGS, minGross: 0, maxGross: 5, spotOnlyBuy: false,
    });

    // Binance 8h: 0.0001 * 3 settlements/day * 365 * 100
    expect(legAnnualizedFundingPercent(rec.buy, 0.0001)).toBeCloseTo(10.95);
    // Lighter feeds an 8h-equivalent rate: same annualization regardless of its 1h interval
    expect(legAnnualizedFundingPercent(rec.sell, 0.0001)).toBeCloseTo(10.95);
    // spot legs have no funding: rate value and annualized value are both 0
    const spotLeg = { ...rec.buy, kind: "spot" as const, fundingIntervalSeconds: null, funding: undefined };
    expect(legFundingRateValue(spotLeg, "average2d")).toBe(0);
    expect(legAnnualizedFundingPercent(spotLeg, 0)).toBe(0);
    // perp leg without any funding data resolves to null
    expect(legFundingRateValue({ ...rec.buy, funding: undefined }, "average2d")).toBeNull();
  });
});
