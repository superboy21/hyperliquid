"use client";

import { useMemo } from "react";
import {
  filterCandlesInTimeRange,
  filterFundingInTimeRange,
  singleMarketAnalytics,
  type SingleMarketCandleLike,
  type SingleMarketFundingLike,
} from "@/lib/spot-perp-arbitrage";
import type { ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { formatChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import type { ChartTimeZone } from "@/lib/chart-timezone";

interface Props {
  candles: readonly SingleMarketCandleLike[];
  funding?: readonly SingleMarketFundingLike[];
  selection: ChartTimeSelection | null;
  marketLabel: string;
  marketKind: "spot" | "perp";
  timeZone: ChartTimeZone;
}

function number(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(digits);
}

function price(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const absolute = Math.abs(value);
  if (absolute >= 1_000) return value.toFixed(2);
  if (absolute >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Partial-coverage disclosure: when the venue retains less funding history
 * than the visible candle window, the funding card should say where the
 * retained settlements actually start.
 */
function fundingPartialNote(
  fundingCoverageStartTime: number | null,
  windowStartTime: number | null,
  windowEndTime: number | null,
): string | null {
  if (
    fundingCoverageStartTime === null || windowStartTime === null || windowEndTime === null
    || fundingCoverageStartTime <= windowStartTime || windowEndTime <= fundingCoverageStartTime
  ) return null;
  const coveredDays = Math.ceil((windowEndTime - fundingCoverageStartTime) / DAY_MS);
  return `资金费率数据仅覆盖最近 ${coveredDays} 天（自 ${utcDate(fundingCoverageStartTime)} UTC 起）`;
}

function bands(title: string, metric: ReturnType<typeof singleMarketAnalytics>["candleCloseVwap"]) {
  return <div className="rounded-md border border-gray-700/80 bg-gray-900/40 p-3"><p className="text-[11px] font-medium text-gray-400">{title}</p><p className="mt-1 font-mono text-sm text-violet-200">{price(metric.mean)}</p><p className="mt-1 text-[10px] text-gray-500">n={metric.count} · σ {price(metric.populationSigma)}</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-gray-400"><span>−2σ {price(metric.minus2Sigma)}</span><span>+2σ {price(metric.plus2Sigma)}</span><span>−1σ {price(metric.minus1Sigma)}</span><span>+1σ {price(metric.plus1Sigma)}</span></div></div>;
}

export default function SingleMarketAnalyticsDashboard({ candles, funding, selection, marketLabel, marketKind, timeZone }: Props) {
  const selectedCandles = useMemo(() => selection
    ? filterCandlesInTimeRange(candles, selection.startTime, selection.endTime)
    : candles, [candles, selection]);
  const analytics = useMemo(() => {
    const selectedFunding = funding === undefined ? undefined : selection
      ? filterFundingInTimeRange(funding, selection.startTime, selection.endTime)
      : funding;
    return singleMarketAnalytics(selectedCandles, selectedFunding, { estimateMissingQuoteTurnover: marketKind === "spot" });
  }, [funding, marketKind, selectedCandles, selection]);
  const fundingMetric = analytics.fundingAnnualized;
  const fundingRateMetric = analytics.fundingRate !== null && analytics.fundingRate.count > 0
    ? analytics.fundingRate
    : null;
  const candleWindowStart = (() => {
    let earliest: number | null = null;
    for (const candle of selectedCandles) {
      const time = Number(candle.openTime);
      if (Number.isFinite(time) && (earliest === null || time < earliest)) earliest = time;
    }
    return earliest;
  })();
  const candleWindowEnd = (() => {
    let latest: number | null = null;
    for (const candle of selectedCandles) {
      const time = Number(candle.closeTime);
      if (Number.isFinite(time) && (latest === null || time > latest)) latest = time;
    }
    return latest;
  })();
  const partialNote = fundingPartialNote(analytics.fundingCoverageStartTime, candleWindowStart, candleWindowEnd);
  const hasFundingSettlements = fundingRateMetric !== null;
  const signedPercent = (value: number | null, digits: number) => value === null || !Number.isFinite(value)
    ? "--"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
  const cards = [
    ["当前价格", price(analytics.latestClose), "所选区间最后一根有效收盘"],
    ["平均基础币成交量", number(analytics.baseVolume.mean), `${analytics.baseVolume.count} 个有效样本 / 每根 K 线`],
    ["平均报价币成交额", number(analytics.quoteTurnover.mean), `${analytics.quoteTurnover.count} 个样本：官方 ${analytics.quoteTurnover.officialCount}，估算 ${analytics.quoteTurnover.estimatedCount}`],
    ["年化波动率", analytics.annualizedVolatility.percent === null ? "--" : `${analytics.annualizedVolatility.percent.toFixed(2)}%`, `${analytics.annualizedVolatility.returnCount} 个对数收益样本`],
    ...(hasFundingSettlements ? [["区间累计资金费率", signedPercent(fundingRateMetric.mean, 4), `${fundingRateMetric.count} 个实际结算样本 · 按资金费率覆盖区间时长年化 ${signedPercent(fundingMetric?.mean ?? null, 2)}${partialNote ? ` · ${partialNote}` : ""}`]] : []),
  ];
  return <section className="mt-3 rounded-lg border border-cyan-500/25 bg-gray-800 p-4" aria-labelledby="single-analytics-title">
    <div><h3 id="single-analytics-title" className="text-sm font-semibold text-white">{marketLabel} · {selection ? "精确区间统计" : "预设可见区间统计"}</h3>{selection && <p className="mt-1 font-mono text-xs text-cyan-200">{timeZone}：{formatChartTimeSelection(selection, timeZone)}</p>}<p className="mt-1 text-xs text-gray-500">未剔尾。VWAP 以每根收盘价按基础币成交量加权；TWAP 以 K 线时长加权。{marketKind === "spot" ? "报价币成交额优先采用官方值，缺失时以基础币成交量 × 收盘价估算；官方 0 保留。" : "Perp 缺少官方报价币成交额时不估算并不计入均值；官方 0 保留。"}</p></div>
    <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 ${fundingRateMetric ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>{cards.map(([label, value, note]) => <div key={label} className="rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 font-mono text-base font-semibold text-cyan-200">{value}</p><p className="mt-1 text-[10px] text-gray-600">{note}</p></div>)}</div>
    <div className="mt-2 grid gap-2 md:grid-cols-2">{bands("收盘价 VWAP 与标准差带", analytics.candleCloseVwap)}{bands("收盘价 TWAP 与标准差带", analytics.candleCloseTwap)}</div>
  </section>;
}
