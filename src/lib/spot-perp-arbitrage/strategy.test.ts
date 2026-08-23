import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STRATEGY_SETTINGS,
  applyStrategyDraft,
  computeStrategyRecommendations,
  normalizeConvergenceDays,
} from "./strategy";
import { asPerpMarket, asSpotMarket, marketId } from "./model";
import type { ArbitrageMarket } from "./model";
import type { ImpactSpreadDetailResult } from "../impact-price";

function perp(exchange: "Binance" | "OKX" | "Bybit" | "Gate.io" | "Lighter", symbol: string): ArbitrageMarket {
  return asPerpMarket({
    exchange, exchangeColor: "yellow", symbol, rawSymbol: symbol, fundingRate: 0, markPrice: 100,
    indexPrice: 100, lastPrice: 100, change24h: 0, quoteVolume: 0, openInterest: 0,
    notionalValue: 0, fundingInterval: 8 * 3600, assetCategory: "Crypto",
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
});
