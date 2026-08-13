"use client";

import { useMemo, useState } from "react";
import {
  marketDisplaySymbol,
  visibleDashboardAnalytics,
  visiblePairDashboardAnalytics,
  type ArbitrageChartRange,
  type MixedCombinationResult,
  type SpotSpotCombinationResult,
  type TailTrimPercent,
} from "@/lib/spot-perp-arbitrage";
import type { ComboCandleResult } from "@/lib/combo";
import { formatChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";

interface Props {
  result: MixedCombinationResult | SpotSpotCombinationResult | ComboCandleResult;
  range: ArbitrageChartRange;
  initialTailTrim?: TailTrimPercent;
  exactSelection?: ChartTimeSelection | null;
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

function isLegacyPerpPair(result: Props["result"]): result is ComboCandleResult {
  return "candles" in result;
}

function isMixedResult(result: Props["result"]): result is MixedCombinationResult {
  return "kind" in result && result.composition === "mixed";
}

function legIdentity(result: Props["result"], leg: 1 | 2): string {
  if (isLegacyPerpPair(result)) {
    return leg === 1
      ? `${result.firstExchange} ${result.firstSymbol}`
      : `${result.secondExchange} ${result.secondSymbol}`;
  }
  const market = leg === 1 ? result.leg1 : result.leg2;
  return `${market.source.exchange} ${marketDisplaySymbol(market)}`;
}

export default function MixedAnalyticsDashboard({ result, range, initialTailTrim = 1, exactSelection = null }: Props) {
  const [tailTrim, setTailTrim] = useState<TailTrimPercent>(initialTailTrim);
  const mixedResult = isMixedResult(result) ? result : null;
  const analysis = useMemo(() => {
    if (isMixedResult(result)) {
      return { kind: "mixed" as const, dashboard: visibleDashboardAnalytics(result, range, tailTrim).dashboard };
    }
    return { kind: "pair" as const, dashboard: visiblePairDashboardAnalytics(result, range, tailTrim).dashboard };
  }, [range, result, tailTrim]);
  const { dashboard } = analysis;
  const distribution = dashboard.derivedClose;
  const totalDerived = distribution.retainedCount + distribution.removedCount;
  const mode = result.mode === "ratio" ? "ratio" : "spread";
  const leg1 = legIdentity(result, 1);
  const leg2 = legIdentity(result, 2);
  const composition = analysis.kind === "mixed"
    ? "mixed"
    : isLegacyPerpPair(result) ? "perp-perp" : "spot-spot";

  const cards: PrimaryMetricCard[] = [
    {
      label: mode === "spread" ? "价差当前值" : "比值当前值",
      value: derivedLabel(dashboard.currentDerivedClose.value, mode),
      gapPercent: dashboard.currentDerivedClose.gapPercent,
      note: "最新可见组合收盘值",
      tone: "text-cyan-300",
      featured: true,
    },
    {
      label: mode === "spread" ? "价差均值" : "比值均值",
      value: derivedLabel(distribution.mean, mode),
      note: `${distribution.retainedCount}/${totalDerived} 个保留样本`,
      tone: "text-violet-300",
    },
  ];

  if (analysis.kind === "mixed") {
    const funding = analysis.dashboard.fundingAnnualized;
    const perpIdentity = mixedResult?.leg1.kind === "perp" ? leg1 : leg2;
    const spotIdentity = mixedResult?.leg1.kind === "spot" ? leg1 : leg2;
    cards.push(
      {
        label: "年化资金费率均值",
        value: funding.mean === null ? "--" : `${funding.mean >= 0 ? "+" : ""}${(funding.mean * 100).toFixed(2)}%`,
        note: `${funding.count} 个可用样本`,
        tone: funding.mean === null ? "text-gray-500" : funding.mean >= 0 ? "text-emerald-300" : "text-red-300",
      },
      {
        label: "平均 Perp 成交额",
        value: compact(analysis.dashboard.perpTurnover.mean),
        note: `${perpIdentity} · ${analysis.dashboard.perpTurnover.count} 个样本`,
        tone: "text-indigo-300",
      },
      {
        label: "平均 Spot 成交额",
        value: compact(analysis.dashboard.spotTurnover.mean),
        note: `${spotIdentity} · ${analysis.dashboard.spotTurnover.count} 个样本`,
        tone: "text-emerald-300",
      },
    );
  } else {
    const funding = analysis.dashboard.fundingAnnualized;
    if (funding) {
      cards.push({
        label: "年化资金费率差均值",
        value: funding.mean === null ? "--" : `${funding.mean >= 0 ? "+" : ""}${(funding.mean * 100).toFixed(2)}%`,
        note: `腿1 ${leg1}（${analysis.dashboard.fundingLeg1?.count ?? 0}个）− 腿2 ${leg2}（${analysis.dashboard.fundingLeg2?.count ?? 0}个）`,
        tone: funding.mean === null ? "text-gray-500" : funding.mean >= 0 ? "text-emerald-300" : "text-red-300",
      });
    }
    const marketKind = composition === "perp-perp" ? "Perp" : "Spot";
    cards.push(
      {
        label: `腿1平均 ${marketKind} 成交额`,
        value: compact(analysis.dashboard.leg1Turnover.mean),
        note: `${leg1} · ${analysis.dashboard.leg1Turnover.count} 个样本`,
        tone: "text-indigo-300",
      },
      {
        label: `腿2平均 ${marketKind} 成交额`,
        value: compact(analysis.dashboard.leg2Turnover.mean),
        note: `${leg2} · ${analysis.dashboard.leg2Turnover.count} 个样本`,
        tone: "text-emerald-300",
      },
    );
  }

  const bands = [
    { label: "均值 − 2σ", result: distribution.bands.minus2Sigma },
    { label: "均值 − 1σ", result: distribution.bands.minus1Sigma },
    { label: "均值 + 1σ", result: distribution.bands.plus1Sigma },
    { label: "均值 + 2σ", result: distribution.bands.plus2Sigma },
  ];
  const turnoverSourceNote = composition === "mixed"
    ? "Spot 缺少官方 quote volume 时可能使用 base volume × close 估算；Perp 使用加载结果中的 quote turnover。"
    : composition === "spot-spot"
      ? "Spot 缺少官方 quote volume 时可能使用 base volume × close 估算。"
      : "Perp 使用加载结果中的 quote turnover。";

  return (
    <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">
            {exactSelection ? "精确区间" : "当前可见区间"} · {composition === "mixed" ? "Mixed" : composition === "perp-perp" ? "Perp / Perp" : "Spot / Spot"} 统计
          </h3>
          {exactSelection && <p className="mt-1 font-mono text-xs text-violet-200">UTC：{formatChartTimeSelection(exactSelection)}</p>}
          <p className="mt-1 text-xs text-gray-500">
            {composition === "mixed"
              ? "资金费率不剔尾；分布统计仅对组合收盘值做对称剔尾。"
              : composition === "perp-perp"
                ? "4h/1h/5m 从首个双腿真实结算桶开始，分别平均两腿实际结算；1d/1w/1m 保持双腿对齐口径，不剔尾；分布统计仅对组合收盘值做对称剔尾。"
                : "分布统计仅对组合收盘值做对称剔尾；现货组合不含资金费率。"}
          </p>
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

      <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 ${cards.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
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
              {derivedLabel(band.result.value, mode)}
              <span className="ml-1 whitespace-nowrap text-[10px] font-normal text-gray-500">（较均值 {gapLabel(band.result.gapPercent)}）</span>
            </p>
          </div>
        ))}
      </div>

      <aside className="mt-3 rounded bg-gray-900/50 px-3 py-2.5 text-[11px] text-gray-500 sm:px-4 sm:text-xs" aria-labelledby="analytics-methodology-title">
        <h4 id="analytics-methodology-title" className="mb-1 font-medium text-gray-400">🧾 数据口径：</h4>
        <ul className="grid gap-x-5 gap-y-0.5 leading-5 md:grid-cols-2" role="list">
          <li><span aria-hidden="true">🗓️</span> <span className="font-medium text-gray-400">{exactSelection ? "精确区间：" : "可见区间："}</span>{exactSelection ? "只使用图表精确选择的 UTC 时间桶，双腿保留对齐后的共同 K 线。" : "只使用图表当前选择的可见区间；有限区间以数据末端为锚点，双腿只保留时间戳对齐后的共同 K 线。"}</li>
          <li><span aria-hidden="true">📍</span> <span className="font-medium text-gray-400">当前值：</span>取最新一根可见共同 K 线的组合收盘值；价差＝腿1−腿2，比值＝腿1÷腿2。</li>
          <li><span aria-hidden="true">📊</span> <span className="font-medium text-gray-400">均值与 σ：</span>将可见组合收盘值排序，按“每侧剔除”比例从两端各剔除后计算算术均值和总体标准差。当前值始终取最新值，只有分布样本参与剔尾；±1σ、±2σ 均由剔尾后的均值与总体标准差得到。</li>
          <li><span aria-hidden="true">🧮</span> <span className="font-medium text-gray-400">较均值百分比：</span>（指标值 − 均值）÷ |均值| × 100%；均值为 0 或不可用时显示“--”。</li>
          {composition === "mixed" && (
            <li><span aria-hidden="true">💰</span> <span className="font-medium text-gray-400">资金费率：</span>只统计真实观测样本；Perp 在腿1时保持正号，在腿2时取负号，再对年化值做算术平均，不参与剔尾。</li>
          )}
          {composition === "perp-perp" && (
            <li><span aria-hidden="true">💰</span> <span className="font-medium text-gray-400">资金费率：</span>{result.interval === "4h" || result.interval === "1h" || result.interval === "5m" ? "从首个双腿真实结算桶起，腿1与腿2分别纳入之后各自真实结算桶，年化均值为腿1均值 − 腿2均值；卡片显示各腿样本数与双腿起始后对齐样本数。" : "仅在两腿同一时间桶都有真实样本时，计算“腿1年化资金费率 − 腿2年化资金费率”，再做算术平均；方向与价差或比值操作符无关。"}</li>
          )}
          <li className="md:col-span-2"><span aria-hidden="true">💹</span> <span className="font-medium text-gray-400">平均成交额：</span>每条腿分别对可见、对齐 K 线中的 quote turnover 做算术平均；缺失值不按 0，真实 0 参与。这是当前 K 线周期下平均每根 K 线成交额，不是统一折算的日均成交额。{turnoverSourceNote}</li>
          <li><span aria-hidden="true">🔢</span> <span className="font-medium text-gray-400">样本数：</span>卡片显示该指标实际参与计算的有效样本数；不同指标因缺失值或真实样本条件不同，样本数可能不一致。</li>
        </ul>
      </aside>
    </section>
  );
}
