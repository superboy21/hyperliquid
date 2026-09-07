import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SingleMarketAnalyticsDashboard from "./SingleMarketAnalyticsDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

function candle(openTime: number, closeTime: number) {
  return { openTime, closeTime, close: 100, volume: 1, quoteVolume: 100 };
}

function renderDashboard(
  candles: ReturnType<typeof candle>[],
  funding: Array<{ time: number; rate: number; annualizedRate: number; sampleCount?: number }>,
  selection: { startTime: number; endTime: number } | null = null,
) {
  return renderToStaticMarkup(createElement(SingleMarketAnalyticsDashboard, {
    candles,
    funding,
    selection,
    marketLabel: "Binance BTC Perp",
    marketKind: "perp",
    timeZone: "UTC",
  }));
}

describe("SingleMarketAnalyticsDashboard funding card", () => {
  test("hides empty funding coverage and preserves a real zero", () => {
    const candles = [candle(0, DAY_MS), candle(DAY_MS, 2 * DAY_MS)];

    const emptyMarkup = renderDashboard(candles, [{ time: 0, rate: 0, annualizedRate: 0, sampleCount: 0 }]);
    expect(emptyMarkup).not.toContain("区间累计资金费率");

    const zeroMarkup = renderDashboard(candles, [{ time: 0, rate: 0, annualizedRate: 0 }]);
    expect(zeroMarkup).toContain("区间累计资金费率");
    expect(zeroMarkup).toContain(">0.0000%</p>");
  });

  test("uses selected candles for exact-selection coverage disclosure", () => {
    const candles = Array.from({ length: 5 }, (_, index) => candle(index * DAY_MS, (index + 1) * DAY_MS));
    const markup = renderDashboard(candles, [{ time: 2 * DAY_MS, rate: 0.01, annualizedRate: 1 }], {
      startTime: DAY_MS,
      endTime: 3 * DAY_MS,
    });

    expect(markup).toContain("资金费率数据仅覆盖最近 2 天");
    expect(markup).not.toContain("资金费率数据仅覆盖最近 3 天");
  });
});
