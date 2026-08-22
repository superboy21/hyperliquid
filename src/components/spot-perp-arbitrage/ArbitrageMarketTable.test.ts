import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { annualizedFundingValue, sortRowsByImpactPrice } from "./ArbitrageMarketTable";
import ArbitrageMarketTable from "./ArbitrageMarketTable";
import type { ImpactSpreadDetailResult } from "@/lib/impact-price";
import { asPerpMarket, asSpotMarket, toTableRow, type ArbitrageTableRow } from "@/lib/spot-perp-arbitrage";

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

describe("Arbitrage market table impact prices", () => {
  function spotRow(exchange: "Binance" | "OKX", marketKey: string): ArbitrageTableRow {
    return toTableRow(asSpotMarket({
      exchange, exchangeColor: "yellow", pair: `${marketKey}/USDT`, baseAsset: marketKey, quoteAsset: "USDT",
      rawSymbol: marketKey, marketKey, midPrice: 1, change24h: 0,
      quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
    }));
  }

  function impact(askPrice: number, bidPrice: number): ImpactSpreadDetailResult {
    return { askPrice, bidPrice, mid: 1, bboMid: 1, spread: 0, buyImpactSpread: 0, sellImpactSpread: 0 };
  }

  test("sorts by the lowest ask execution price", () => {
    const binance = spotRow("Binance", "BINANCE");
    const okx = spotRow("OKX", "OKX");
    const results = new Map([
      [String(binance.id), impact(110, 100)],
      [String(okx.id), impact(90, 80)],
    ]);

    expect(sortRowsByImpactPrice([binance, okx], results, { field: "exchange", descending: false }, "askPrice"))
      .toEqual([okx, binance]);
  });

  test("sorts by the highest bid execution price", () => {
    const binance = spotRow("Binance", "BINANCE");
    const okx = spotRow("OKX", "OKX");
    const results = new Map([
      [String(binance.id), impact(110, 100)],
      [String(okx.id), impact(90, 120)],
    ]);

    expect(sortRowsByImpactPrice([binance, okx], results, { field: "exchange", descending: false }, "bidPrice"))
      .toEqual([okx, binance]);
  });

  test("puts missing, error, and non-finite impact prices at the end", () => {
    const valid = spotRow("Binance", "VALID");
    const missing = spotRow("OKX", "MISSING");
    const error = spotRow("Binance", "ERROR");
    const nonFinite = spotRow("OKX", "NAN");
    const results = new Map<string, ImpactSpreadDetailResult>([
      [String(valid.id), impact(100, 100)],
      [String(missing.id), null],
      [String(error.id), "insufficient"],
      [String(nonFinite.id), impact(Number.NaN, Number.POSITIVE_INFINITY)],
    ]);

    expect(sortRowsByImpactPrice([missing, valid, error, nonFinite], results, { field: "exchange", descending: false }, "askPrice"))
      .toEqual([valid, error, missing, nonFinite]);
  });

  test("uses the existing header order to break equal impact prices", () => {
    const okx = spotRow("OKX", "OKX");
    const binance = spotRow("Binance", "BINANCE");
    const results = new Map([
      [String(okx.id), impact(100, 100)],
      [String(binance.id), impact(100, 100)],
    ]);

    expect(sortRowsByImpactPrice([okx, binance], results, { field: "exchange", descending: false }, "askPrice"))
      .toEqual([binance, okx]);
  });

  test("shows formatted ask after buy spread and bid after sell spread", () => {
    const row = toTableRow(asSpotMarket({
      exchange: "Binance", exchangeColor: "yellow", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
      rawSymbol: "BTCUSDT", marketKey: "BTC/USDT", midPrice: 1234.5, change24h: 0,
      quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
    }), { impactSpread: 2.2222 });
    const impact: ImpactSpreadDetailResult = {
      bidPrice: 1234.123,
      askPrice: 1234.567,
      mid: 1234.345,
      bboMid: 1234.345,
      spread: 2.2222,
      buyImpactSpread: 1.2345,
      sellImpactSpread: -0.9876,
    };

    const markup = renderToStaticMarkup(createElement(ArbitrageMarketTable, {
      rows: [row],
      selectedLeg1Id: null,
      selectedLeg2Id: null,
      comboMode: false,
      detailLoading: new Set(),
      detailErrors: new Set(),
      impactLoading: new Set(),
      impactErrors: new Set(),
      impactResults: new Map([[String(row.id), impact]]),
      spreadMode: "impact",
      onSpreadModeChange: () => {},
      impactNotional: 1000,
      impactNotionalPresets: [1000],
      customNotional: "",
      editingCustomNotional: false,
      onPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      premiumIndexNotional: 5000,
      premiumIndexNotionalPresets: [5000],
      premiumIndexCustomNotional: "",
      editingPremiumIndexCustom: false,
      onPremiumIndexPresetChange: () => {},
      onPremiumIndexCustomNotionalChange: () => {},
      onApplyPremiumIndexCustomNotional: () => {},
      premiumIndexMode: "adaptive",
      onPremiumIndexModeChange: () => {},
      premiumIndexLoading: new Set(),
      premiumIndexErrors: new Set(),
      onSelect: () => {},
    }));

    expect(markup).toContain("买入 +1.2345% · 执行价 1234.57");
    expect(markup).toContain("卖出 -0.9876% · 执行价 1234.12");
    expect(markup).not.toContain("买入 +1.2345% · 执行价 1234.12");
    expect(markup).not.toContain("卖出 -0.9876% · 执行价 1234.57");
    expect(markup).toContain("最优买价");
    expect(markup).toContain("最优卖价");
    expect(markup).toContain('aria-label="按最低买入执行价排序"');
    expect(markup).toContain('aria-label="按最高卖出执行价排序"');
    expect(markup).toContain('aria-pressed="false"');

    const topMarkup = renderToStaticMarkup(createElement(ArbitrageMarketTable, {
      rows: [row],
      selectedLeg1Id: null,
      selectedLeg2Id: null,
      comboMode: false,
      detailLoading: new Set(),
      detailErrors: new Set(),
      impactLoading: new Set(),
      impactErrors: new Set(),
      impactResults: new Map([[String(row.id), impact]]),
      spreadMode: "top",
      onSpreadModeChange: () => {},
      impactNotional: 1000,
      impactNotionalPresets: [1000],
      customNotional: "",
      editingCustomNotional: false,
      onPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      premiumIndexNotional: 5000,
      premiumIndexNotionalPresets: [5000],
      premiumIndexCustomNotional: "",
      editingPremiumIndexCustom: false,
      onPremiumIndexPresetChange: () => {},
      onPremiumIndexCustomNotionalChange: () => {},
      onApplyPremiumIndexCustomNotional: () => {},
      premiumIndexMode: "adaptive",
      onPremiumIndexModeChange: () => {},
      premiumIndexLoading: new Set(),
      premiumIndexErrors: new Set(),
      onSelect: () => {},
    }));
    expect(topMarkup).not.toContain("最优买价");
    expect(topMarkup).not.toContain("最优卖价");
  });
});
