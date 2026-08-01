"use client";

import { useMemo, useState } from "react";
import {
  visibleDashboardAnalytics,
  type ArbitrageChartRange,
  type MixedCombinationResult,
  type TailTrimPercent,
} from "@/lib/spot-perp-arbitrage";

interface Props {
  result: MixedCombinationResult;
  range: ArbitrageChartRange;
}

const TAIL_OPTIONS: TailTrimPercent[] = [0, 1, 2.5, 5, 10];

function derivedLabel(value: number | null, mode: "spread" | "ratio"): string {
  if (value === null) return "--";
  if (mode === "spread") return `${value >= 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
  return value.toFixed(Math.abs(value) >= 1 ? 4 : 6);
}

function compact(value: number | null): string {
  if (value === null) return "--";
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

function gapLabel(value: number | null): string {
  if (value === null) return "--";
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

interface PrimaryMetricCard {
  label: string;
  value: string;
  note: string;
  tone: string;
  gapPercent?: number | null;
  featured?: boolean;
}

export default function MixedAnalyticsDashboard({ result, range }: Props) {
  const [tailTrim, setTailTrim] = useState<TailTrimPercent>(1);
  const { dashboard } = useMemo(
    () => visibleDashboardAnalytics(result, range, tailTrim),
    [range, result, tailTrim],
  );
  const distribution = dashboard.derivedClose;
  const funding = dashboard.fundingAnnualized;
  const totalDerived = distribution.retainedCount + distribution.removedCount;

  const cards: PrimaryMetricCard[] = [
    {
      label: result.mode === "spread" ? "价差当前值" : "比值当前值",
      value: derivedLabel(dashboard.currentDerivedClose.value, result.mode),
      gapPercent: dashboard.currentDerivedClose.gapPercent,
      note: "最新可见组合收盘值",
      tone: "text-cyan-300",
      featured: true,
    },
    {
      label: result.mode === "spread" ? "价差均值" : "比值均值",
      value: derivedLabel(distribution.mean, result.mode),
      note: `${distribution.retainedCount}/${totalDerived} 个保留样本`,
      tone: "text-violet-300",
    },
    {
      label: "年化资金费率均值",
      value: funding.mean === null ? "--" : `${funding.mean >= 0 ? "+" : ""}${(funding.mean * 100).toFixed(2)}%`,
      note: `${funding.count} 个可用样本`,
      tone: funding.mean === null ? "text-gray-500" : funding.mean >= 0 ? "text-emerald-300" : "text-red-300",
    },
    {
      label: "平均 Perp 成交额",
      value: compact(dashboard.perpTurnover.mean),
      note: `${dashboard.perpTurnover.count} 个可用样本`,
      tone: "text-indigo-300",
    },
    {
      label: "平均 Spot 成交额",
      value: compact(dashboard.spotTurnover.mean),
      note: `${dashboard.spotTurnover.count} 个可用样本`,
      tone: "text-emerald-300",
    },
  ];

  const bands = [
    { label: "均值 − 2σ", result: distribution.bands.minus2Sigma },
    { label: "均值 − 1σ", result: distribution.bands.minus1Sigma },
    { label: "均值 + 1σ", result: distribution.bands.plus1Sigma },
    { label: "均值 + 2σ", result: distribution.bands.plus2Sigma },
  ];

  return (
    <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">当前可见区间 · Mixed 统计</h3>
          <p className="mt-1 text-xs text-gray-500">资金费率不剔尾；分布统计仅对组合收盘值做对称剔尾。</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          每侧剔除
          <select
            value={tailTrim}
            onChange={(event) => setTailTrim(Number(event.target.value) as TailTrimPercent)}
            className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
          >
            {TAIL_OPTIONS.map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className={`rounded-md border bg-gray-900/65 p-3 ${card.featured ? "border-cyan-700/60 sm:col-span-2 lg:col-span-1" : "border-gray-700"}`}>
            <p className="text-[11px] text-gray-500">{card.label}</p>
            <p className={`mt-1 font-mono text-base font-semibold ${card.tone}`}>
              {card.value}
              {card.gapPercent !== undefined && (
                <span className="ml-1 whitespace-nowrap text-[11px] font-normal text-gray-400">（较均值 {gapLabel(card.gapPercent)}）</span>
              )}
            </p>
            <p className="mt-1 text-[10px] text-gray-600">{card.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {bands.map((band) => (
          <div key={band.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2">
            <p className="text-[10px] text-gray-500">{band.label}</p>
            <p className="mt-1 font-mono text-sm text-gray-300">
              {derivedLabel(band.result.value, result.mode)}
              <span className="ml-1 whitespace-nowrap text-[10px] font-normal text-gray-500">（较均值 {gapLabel(band.result.gapPercent)}）</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
