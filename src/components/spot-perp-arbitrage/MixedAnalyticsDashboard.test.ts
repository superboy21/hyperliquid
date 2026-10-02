import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComboCandleResult } from "@/lib/combo";
import type { MixedCombinationResult } from "@/lib/spot-perp-arbitrage/combine";
import type { PairHistoricalVolatility } from "@/lib/spot-perp-arbitrage/pair-risk";
import { asPerpMarket, asSpotMarket } from "@/lib/spot-perp-arbitrage/model";
import type { SearchExchangeRate } from "@/lib/search";
import type { SpotMarketRow } from "@/lib/spot-search";
import MixedAnalyticsDashboard from "./MixedAnalyticsDashboard";

const HOUR_MS = 60 * 60 * 1000;

function mixedResult(): MixedCombinationResult {
  return {
    kind: "spot-containing",
    composition: "mixed",
    mode: "spread",
    interval: "1h",
    leg1: asPerpMarket({
      exchange: "Binance", exchangeColor: "yellow", symbol: "BTC",
      fundingRate: 0, markPrice: 100, indexPrice: 100, lastPrice: 100, change24h: 0,
      quoteVolume: 0, openInterest: 0, notionalValue: 0, fundingInterval: 8, assetCategory: "crypto",
    } satisfies SearchExchangeRate),
    leg2: asSpotMarket({
      exchange: "OKX", exchangeColor: "green", pair: "ETH/USDT", baseAsset: "ETH",
      quoteAsset: "USDT", rawSymbol: "ETH-USDT", marketKey: "ETH-USDT", midPrice: 100,
      change24h: 0, quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
    } satisfies SpotMarketRow),
    points: [0, 1, 2].map((index) => ({
      openTime: index * HOUR_MS,
      closeTime: (index + 1) * HOUR_MS,
      open: 10 + index,
      close: 10 + index,
      leg1Turnover: null,
      leg2Turnover: null,
      minimumTurnover: null,
    })),
    funding: [],
    legProvenance: [] as never,
  };
}

function legacyResult(): ComboCandleResult {
  return {
    mode: "spread",
    firstSymbol: "BTC",
    firstExchange: "Binance",
    secondSymbol: "ETH",
    secondExchange: "Bybit",
    candles: [0, 1, 2].map((index) => ({
      openTime: index * HOUR_MS,
      closeTime: (index + 1) * HOUR_MS,
      open: String(10 + index),
      high: String(10 + index),
      low: String(10 + index),
      close: String(10 + index),
      volume: "1",
      quoteVolume: "10",
    })),
    fundingRates: [],
    legProvenance: [] as never,
  } as ComboCandleResult;
}

const unavailableVolatility: PairHistoricalVolatility = {
  sampleCount: 0,
  annualizedPercent: { available: false, value: null, reason: "insufficient-returns" },
};

function render(view: "pair-trade" | "ols", result = mixedResult(), volatility?: PairHistoricalVolatility) {
  return renderToStaticMarkup(createElement(MixedAnalyticsDashboard, {
    result,
    pairTrade: null,
    pairTradeReason: "invalid-beta",
    pairHistoricalVolatility: volatility,
    dailyVar: {
      sampleCount: 100,
      var95: { available: true, value: 2.5, reason: null },
      var99: { available: true, value: 4.5, reason: null },
    },
    riskBeta: 1.25,
    view,
    range: "all",
    timeZone: "UTC",
  }));
}

describe("MixedAnalyticsDashboard historical risk cards", () => {
  test("renders the pair-trade annualized volatility card for mixed and legacy perp pairs", () => {
    const volatility: PairHistoricalVolatility = {
      sampleCount: 17,
      annualizedPercent: { available: true, value: 12.345, reason: null },
    };

    for (const result of [mixedResult(), legacyResult()]) {
      const markup = render("pair-trade", result, volatility);
      expect(markup).toContain("历史年化组合波动率（占腿1名义本金 %）");
      expect(markup).toContain("12.35%");
      expect(markup).toContain("17 个相邻有效收益样本");
      expect(markup).toContain("(r1 − β×r2)/1");
      expect(markup).toContain("腿1名义本金为基准");
      expect(markup).toContain("每期重设 1:β 名义暴露");
      expect(markup).not.toContain("(1+β)");
      expect(markup).not.toContain("占组合总名义本金");
      expect(markup).toContain("所选拟合窗口内");
    }
  });

  test("preserves exact zero and shows unavailable reason with a placeholder", () => {
    const zeroMarkup = render("pair-trade", mixedResult(), {
      sampleCount: 2,
      annualizedPercent: { available: true, value: 0, reason: null },
    });
    expect(zeroMarkup).toContain("0.00%");

    const unavailableMarkup = render("pair-trade", mixedResult(), unavailableVolatility);
    expect(unavailableMarkup).toContain("历史年化组合波动率（占腿1名义本金 %）");
    expect(unavailableMarkup).toContain(">--</span>");
    expect(unavailableMarkup).toContain("有效相邻收益不足 2 个（当前 0 个）。");
  });

  test("describes VaR fit-window scope in pair-trade and full-preset scope in OLS only", () => {
    const pairMarkup = render("pair-trade");
    expect(pairMarkup).toContain("历史日线 VaR（占腿1名义本金 %）");
    expect(pairMarkup).toContain("收益代理 = (r1 − β×r2)/1");
    expect(pairMarkup).toContain("分母为腿1参考名义本金（腿1=1）");
    expect(pairMarkup).not.toContain("组合总名义本金");
    expect(pairMarkup).toContain("仅取所选拟合窗口内的 UTC 日线");
    expect(pairMarkup).not.toContain("独立于拟合窗口与图表视窗");

    const olsMarkup = render("ols");
    expect(olsMarkup).toContain("历史日线 VaR（占腿1名义本金 %）");
    expect(olsMarkup).toContain("收益代理 = (r1 − β×r2)/1");
    expect(olsMarkup).toContain("分母为腿1参考名义本金（腿1=1）");
    expect(olsMarkup).not.toContain("组合总名义本金");
    expect(olsMarkup).toContain("取自完整预设范围的 UTC 日线");
    expect(olsMarkup).toContain("日线 VaR 使用完整预设范围的 UTC 日线");
    expect(olsMarkup).not.toContain("历史年化组合波动率（占腿1名义本金 %）");
  });
});
