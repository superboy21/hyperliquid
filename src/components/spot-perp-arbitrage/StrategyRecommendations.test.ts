import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import StrategyRecommendations from "./StrategyRecommendations";

describe("StrategyRecommendations", () => {
  test("renders Impact-only unapplied hint and percentage labels", () => {
    const markup = renderToStaticMarkup(createElement(StrategyRecommendations, {
      recommendations: [],
      impactLoading: false,
      impactNotional: 5000,
      convergenceDays: 3,
      impactNotionalPresets: [1000, 3000, 5000],
      customNotional: "5000",
      editingCustomNotional: false,
      onImpactPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      onRecommendationSelect: () => {},
      selectedRecommendationKey: null,
      chartMode: "ratio",
      onChartModeToggle: () => {},
      draft: { minGross: "0.3", maxGross: "1.5", totalFee: "0.1", spotOnlyBuy: true, convergenceDays: "3" },
      onDraftChange: () => {},
      hasUnappliedChanges: true,
    }));

    expect(markup).toContain('aria-label="策略 Impact value"');
    expect(markup).toContain('value="5000"');
    expect(markup).toContain("Spot 只能买");
    expect(markup).toContain("Impact value 已修改，点击上方“刷新”后生效。");
    expect(markup).toContain("$3000");
    expect(markup).toContain("最小套利空间 (%)");
    expect(markup).toContain('aria-label="套利空间最小值 (%)"');
    expect(markup).toContain("最大套利空间 (%)");
    expect(markup).toContain('aria-label="套利空间最大值 (%)"');
    expect(markup).toContain("总手续费率 (%)");
    expect(markup).toContain('aria-label="总交易手续费率 (%)"');
    expect(markup).toContain('<option value="3" selected="">3 天</option>');
    expect(markup).toContain('<option value="14">14 天</option>');
    expect(markup).toContain("手续费仅用于年化计算");

    const settingsOnlyMarkup = renderToStaticMarkup(createElement(StrategyRecommendations, {
      recommendations: [],
      impactLoading: false,
      impactNotional: 5000,
      convergenceDays: 30,
      impactNotionalPresets: [1000, 3000, 5000],
      customNotional: "5000",
      editingCustomNotional: false,
      onImpactPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      onRecommendationSelect: () => {},
      selectedRecommendationKey: null,
      draft: { minGross: "1", maxGross: "2", totalFee: "0.2", spotOnlyBuy: false, convergenceDays: "30" },
      onDraftChange: () => {},
      hasUnappliedChanges: false,
    }));
    expect(settingsOnlyMarkup).not.toContain("Impact value 已修改");
  });

  test("uses the immediately effective convergence days in the annualized heading", () => {
    const markup = renderToStaticMarkup(createElement(StrategyRecommendations, {
      recommendations: [{
        rank: 1,
        buy: { id: "buy", exchange: "Binance", symbol: "BTC", kind: "perp", price: 100 },
        sell: { id: "sell", exchange: "OKX", symbol: "BTC", kind: "perp", price: 101 },
        gross: 1,
        netReturn: 0.9,
        usdReturn: 27,
        annualized: 23.46,
      }],
      impactLoading: false,
      impactNotional: 1000,
      convergenceDays: 30,
      impactNotionalPresets: [1000],
      customNotional: "1000",
      editingCustomNotional: false,
      onImpactPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      onRecommendationSelect: () => {},
      selectedRecommendationKey: "buy:sell",
      chartMode: "ratio",
      onChartModeToggle: () => {},
      draft: { minGross: "0.5", maxGross: "1.5", totalFee: "0.1", spotOnlyBuy: true, convergenceDays: "30" },
      onDraftChange: () => {},
      hasUnappliedChanges: false,
    }));

    expect(markup).toContain("按 30 天年化");
    expect(markup).toContain("A 买入 · B 卖出 · A / B Ratio");
    expect(markup).toContain("切换为 A − B Spread");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="关闭策略图表：A 买入 Binance BTC，B 卖出 OKX BTC"');
    expect(markup).toContain("<table");
    expect(markup).toContain('aria-label="策略推荐表格"');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain(">排名</th>");
    expect(markup).toContain("买入腿");
    expect(markup).toContain("买入执行价");
    expect(markup).toContain("卖出腿");
    expect(markup).toContain("卖出执行价");
    expect(markup).toContain("套利空间");
    expect(markup).toContain("扣费后收益");
    expect(markup).toContain("美元收益");
    expect(markup).toContain("按 30 天年化收益率");
    expect(markup).toContain("$27.00");
    expect(markup).toContain("Binance");
    expect(markup).toContain("BTC");
    expect(markup).toContain("永续");
    expect(markup).toContain("OKX");
    expect(markup.indexOf("美元收益")).toBeGreaterThan(markup.indexOf("扣费后收益"));
    expect(markup.indexOf("按 30 天年化收益率")).toBeGreaterThan(markup.indexOf("美元收益"));
  });

  test("offers the A − B spread toggle only while a strategy chart is active", () => {
    const baseProps = {
      recommendations: [{
        rank: 1,
        buy: { id: "buy", exchange: "Binance", symbol: "BTC", kind: "perp" as const, price: 100 },
        sell: { id: "sell", exchange: "OKX", symbol: "BTC", kind: "perp" as const, price: 101 },
        gross: 1,
        netReturn: 0.9,
        usdReturn: 27,
        annualized: 23.46,
      }],
      impactLoading: false,
      impactNotional: 1000,
      convergenceDays: 3,
      impactNotionalPresets: [1000],
      customNotional: "1000",
      editingCustomNotional: false,
      onImpactPresetChange: () => {},
      onCustomNotionalChange: () => {},
      onApplyCustomNotional: () => {},
      onRecommendationSelect: () => {},
      draft: { minGross: "0.5", maxGross: "1.5", totalFee: "0.1", spotOnlyBuy: true, convergenceDays: "3" },
      onDraftChange: () => {},
      hasUnappliedChanges: false,
    };

    const unselected = renderToStaticMarkup(createElement(StrategyRecommendations, {
      ...baseProps,
      selectedRecommendationKey: null,
      chartMode: "ratio" as const,
      onChartModeToggle: () => {},
    }));
    expect(unselected).toContain("A 买入 · B 卖出 · A / B Ratio");
    expect(unselected).not.toContain("切换为");

    const spreadMode = renderToStaticMarkup(createElement(StrategyRecommendations, {
      ...baseProps,
      selectedRecommendationKey: "buy:sell",
      chartMode: "spread" as const,
      onChartModeToggle: () => {},
    }));
    expect(spreadMode).toContain("A 买入 · B 卖出 · A − B Spread");
    expect(spreadMode).toContain("切换为 A / B Ratio");
    expect(spreadMode).toContain('aria-pressed="true"');
  });
});
