import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { annualizedFundingValue } from "./ArbitrageMarketTable";
import ArbitrageMarketTable from "./ArbitrageMarketTable";
import type { ImpactSpreadDetailResult } from "@/lib/impact-price";
import { asPerpMarket, asSpotMarket, toTableRow } from "@/lib/spot-perp-arbitrage";

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
  });
});
