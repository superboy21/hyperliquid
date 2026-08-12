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

interface Props {
  candles: readonly SingleMarketCandleLike[];
  funding?: readonly SingleMarketFundingLike[];
  selection: ChartTimeSelection | null;
  marketLabel: string;
  marketKind: "spot" | "perp";
}

function number(value: number | null, digits = 4): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(digits);
}

function bands(title: string, metric: ReturnType<typeof singleMarketAnalytics>["candleCloseVwap"]) {
  return <div className="rounded-md border border-gray-700/80 bg-gray-900/40 p-3"><p className="text-[11px] font-medium text-gray-400">{title}</p><p className="mt-1 font-mono text-sm text-violet-200">{number(metric.mean)}</p><p className="mt-1 text-[10px] text-gray-500">n={metric.count} · σ {number(metric.populationSigma)}</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-gray-400"><span>−2σ {number(metric.minus2Sigma)}</span><span>+2σ {number(metric.plus2Sigma)}</span><span>−1σ {number(metric.minus1Sigma)}</span><span>+1σ {number(metric.plus1Sigma)}</span></div></div>;
}

export default function SingleMarketAnalyticsDashboard({ candles, funding, selection, marketLabel, marketKind }: Props) {
  const analytics = useMemo(() => {
    const selectedCandles = selection ? filterCandlesInTimeRange(candles, selection.startTime, selection.endTime) : candles;
    const selectedFunding = funding === undefined ? undefined : selection
      ? filterFundingInTimeRange(funding, selection.startTime, selection.endTime)
      : funding;
    return singleMarketAnalytics(selectedCandles, selectedFunding, { estimateMissingQuoteTurnover: marketKind === "spot" });
  }, [candles, funding, marketKind, selection]);
  const fundingMetric = analytics.fundingAnnualized;
  const fundingRateMetric = analytics.fundingRate;
  const signedPercent = (value: number | null, digits: number) => value === null || !Number.isFinite(value)
    ? "--"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
  const cards = [
    ["当前价格", number(analytics.latestClose), "所选区间最后一根有效收盘"],
    ["平均基础币成交量", number(analytics.baseVolume.mean), `${analytics.baseVolume.count} 个有效样本 / 每根 K 线`],
    ["平均报价币成交额", number(analytics.quoteTurnover.mean), `${analytics.quoteTurnover.count} 个样本：官方 ${analytics.quoteTurnover.officialCount}，估算 ${analytics.quoteTurnover.estimatedCount}`],
    ["年化波动率", analytics.annualizedVolatility.percent === null ? "--" : `${analytics.annualizedVolatility.percent.toFixed(2)}%`, `${analytics.annualizedVolatility.returnCount} 个对数收益样本`],
    ...(fundingRateMetric ? [["平均资金费率", signedPercent(fundingRateMetric.mean, 4), `${fundingRateMetric.count} 个有效时间桶 · 年化均值 ${signedPercent(fundingMetric?.mean ?? null, 2)}`]] : []),
  ];
  return <section className="mt-3 rounded-lg border border-cyan-500/25 bg-gray-800 p-4" aria-labelledby="single-analytics-title">
    <div><h3 id="single-analytics-title" className="text-sm font-semibold text-white">{marketLabel} · {selection ? "精确区间统计" : "预设可见区间统计"}</h3>{selection && <p className="mt-1 font-mono text-xs text-cyan-200">UTC：{formatChartTimeSelection(selection)}</p>}<p className="mt-1 text-xs text-gray-500">未剔尾。VWAP 以每根收盘价按基础币成交量加权；TWAP 以 K 线时长加权。{marketKind === "spot" ? "报价币成交额优先采用官方值，缺失时以基础币成交量 × 收盘价估算；官方 0 保留。" : "Perp 缺少官方报价币成交额时不估算并不计入均值；官方 0 保留。"}</p></div>
    <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 ${fundingRateMetric ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>{cards.map(([label, value, note]) => <div key={label} className="rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 font-mono text-base font-semibold text-cyan-200">{value}</p><p className="mt-1 text-[10px] text-gray-600">{note}</p></div>)}</div>
    <div className="mt-2 grid gap-2 md:grid-cols-2">{bands("收盘价 VWAP 与标准差带", analytics.candleCloseVwap)}{bands("收盘价 TWAP 与标准差带", analytics.candleCloseTwap)}</div>
  </section>;
}
