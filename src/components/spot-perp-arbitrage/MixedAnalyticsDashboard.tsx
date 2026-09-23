"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import type { CombinationViewMode, CombinationWeights } from "@/lib/combo-weighting";
import { formatChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { formatChartDateTime, type ChartTimeZone } from "@/lib/chart-timezone";
import type { PairAnalysis } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { postEntryPairFundingAnalytics } from "@/lib/spot-perp-arbitrage/analytics";
import { pairTradeUnavailableReason } from "./CombinationWeightControls";

interface Props {
  result: MixedCombinationResult | SpotSpotCombinationResult | ComboCandleResult;
  /** The same pair-statistics result rendered by the chart. Used by the OLS view. */
  pairAnalysis?: PairAnalysis | null;
  /** The same pair-trade scenario rendered by the chart. Used by the pair-trade view. */
  pairTrade?: PairTradeSeries | null;
  /** Honest reason copy when the scenario cannot be built (null when available). */
  pairTradeReason?: string | null;
  /** Whether the applied β is a user-supplied custom value or the automatic OLS fit. */
  pairTradeBetaSource?: "custom" | "auto";
  /** Whether the entry candle was explicitly selected rather than defaulted to the first preset candle. */
  pairTradeEntryCustom?: boolean;
  pairTradeEntryCloseTime?: number | null;
  pairViewport?: ChartTimeSelection | null;
  fitWindowMode?: string;
  fitWindowStart?: string | null;
  fitWindowEnd?: string | null;
  fitWindowCount?: number;
  fitWindowUnavailable?: string | null;
  pairTradeLookahead?: boolean;
  view: CombinationViewMode;
  range: ArbitrageChartRange;
  initialTailTrim?: TailTrimPercent;
  exactSelection?: ChartTimeSelection | null;
  weights?: CombinationWeights;
  timeZone: ChartTimeZone;
}

const TAIL_OPTIONS: TailTrimPercent[] = [0, 1, 2.5, 5, 10];
const DEFAULT_WEIGHTS: CombinationWeights = { first: 1, second: 1 };

function payload<T>(stat: unknown): T | null {
  if (stat && typeof stat === "object" && "value" in stat) return (stat as { value?: T | null }).value ?? null;
  return stat as T | null;
}
function pickNumber(source: unknown, names: readonly string[]): number | null {
  if (typeof source === "number" && Number.isFinite(source)) return source;
  const record = payload<Record<string, unknown>>(source);
  if (!record || typeof record !== "object") return null;
  for (const name of names) { const value = record[name]; if (typeof value === "number" && Number.isFinite(value)) return value; }
  return null;
}
function pickBoolean(source: unknown, names: readonly string[]): boolean | null {
  const record = payload<Record<string, unknown>>(source);
  if (!record || typeof record !== "object") return null;
  for (const name of names) if (typeof record[name] === "boolean") return record[name] as boolean;
  return null;
}
function decimal(value: number | null, digits = 4): string { return value === null ? "--" : value.toFixed(digits); }
function signedPercent(value: number | null, digits = 2): string { return value === null ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`; }
function compact(value: number | null): string {
  if (value === null) return "--";
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}
function isMixed(result: Props["result"]): result is MixedCombinationResult { return "kind" in result && result.composition === "mixed"; }
function isLegacy(result: Props["result"]): result is ComboCandleResult { return "candles" in result; }
function legLabel(result: Props["result"], leg: 1 | 2): string {
  if (isLegacy(result)) return leg === 1 ? `${result.firstExchange} ${result.firstSymbol}` : `${result.secondExchange} ${result.secondSymbol}`;
  const market = leg === 1 ? result.leg1 : result.leg2;
  return `${market.source.exchange} ${marketDisplaySymbol(market)}`;
}

/* ------------------------------------------------------------------ *
 * Plain (classic spread/ratio) helpers
 * ------------------------------------------------------------------ */

function derivedLabel(value: number | null, mode: "spread" | "ratio"): string {
  if (value === null) return "--";
  if (mode === "spread") return `${value >= 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
  return value.toFixed(Math.abs(value) >= 1 ? 4 : 6);
}

function gapLabel(value: number | null): string {
  if (value === null) return "--";
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function annualizedFundingLabel(value: number | null): string {
  if (value === null) return "--";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function fundingMeanTone(value: number | null): string {
  if (value === null || value === 0) return "bg-gray-800/80 text-gray-300";
  return value > 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Partial-coverage disclosure for combo dashboards. Both legs of a combo can
 * retain different amounts of funding history; the funded difference is only
 * meaningful from the shared coverage start onward, and the card should tell
 * the user where retained funding actually begins.
 */
function fundingPartialNote(
  coverageStartTime: number | null,
  windowStartTime: number | null,
  windowEndTime: number | null,
): string | null {
  if (
    coverageStartTime === null || windowStartTime === null || windowEndTime === null
    || coverageStartTime <= windowStartTime || windowEndTime <= coverageStartTime
  ) return null;
  const coveredDays = Math.ceil((windowEndTime - coverageStartTime) / DAY_MS);
  return `资金费率仅覆盖最近 ${coveredDays} 天（自 ${utcDate(coverageStartTime)} UTC 起）`;
}

function visibleFundingWindow(result: Props["result"]): { startTime: number; endTime: number } | null {
  const rows = "candles" in result
    ? result.candles.map((point) => ({ openTime: Number(point.openTime), closeTime: Number(point.closeTime) }))
    : result.points.map((point) => ({ openTime: point.openTime, closeTime: point.closeTime }));
  const valid = rows.filter((row) => Number.isFinite(row.openTime) && Number.isFinite(row.closeTime) && row.closeTime > row.openTime);
  if (valid.length === 0) return null;
  return {
    startTime: Math.min(...valid.map((row) => row.openTime)),
    endTime: Math.max(...valid.map((row) => row.closeTime)),
  };
}

interface PrimaryMetricCard {
  label: string;
  value: string;
  note: ReactNode;
  tone: string;
  gapPercent?: number | null;
  featured?: boolean;
}

/* ------------------------------------------------------------------ */

function PlainDashboard({ result, range, initialTailTrim, exactSelection, weights, timeZone }: {
  result: Props["result"];
  range: ArbitrageChartRange;
  initialTailTrim: TailTrimPercent;
  exactSelection: ChartTimeSelection | null;
  weights: CombinationWeights;
  timeZone: ChartTimeZone;
}) {
  const [tailTrim, setTailTrim] = useState<TailTrimPercent>(initialTailTrim);
  const mixedResult = isMixed(result) ? result : null;
  const analysis = useMemo(() => {
    if (isMixed(result)) {
      return { kind: "mixed" as const, dashboard: visibleDashboardAnalytics(result, range, tailTrim, weights).dashboard };
    }
    return { kind: "pair" as const, dashboard: visiblePairDashboardAnalytics(result, range, tailTrim, weights).dashboard };
  }, [range, result, tailTrim, weights]);
  const { dashboard } = analysis;
  const fundingVisibleWindow = visibleFundingWindow(result);
  const fundingPartial = fundingPartialNote(
    dashboard.fundingCoverageStartTime,
    fundingVisibleWindow?.startTime ?? null,
    fundingVisibleWindow?.endTime ?? null,
  );
  const distribution = dashboard.derivedClose;
  const totalDerived = distribution.retainedCount + distribution.removedCount;
  const mode = result.mode === "ratio" ? "ratio" : "spread";
  const leg1 = legLabel(result, 1);
  const leg2 = legLabel(result, 2);
  const composition = analysis.kind === "mixed"
    ? "mixed"
    : isLegacy(result) ? "perp-perp" : "spot-spot";

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
        note: `${funding.count} 个可用样本${fundingPartial ? ` · ${fundingPartial}` : ""}`,
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
        label: "年化资金费率差",
        value: annualizedFundingLabel(funding.mean),
        note: (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {fundingPartial && <span className="rounded-sm bg-amber-400/10 px-1 text-amber-200">{fundingPartial}</span>}
            <span className="rounded-sm bg-violet-400/10 px-1 text-violet-200">腿1加权 {leg1}</span>
            <span className={`rounded-sm px-1 font-mono font-medium ${fundingMeanTone(analysis.dashboard.fundingLeg1?.mean ?? null)}`}>
              {annualizedFundingLabel(analysis.dashboard.fundingLeg1?.mean ?? null)}
            </span>
            <span className="text-gray-600">（{analysis.dashboard.fundingLeg1?.count ?? 0}个）</span>
            <span aria-hidden="true" className="text-gray-700">·</span>
            <span className="rounded-sm bg-violet-400/10 px-1 text-violet-200">腿2加权 {leg2}</span>
            <span className={`rounded-sm px-1 font-mono font-medium ${fundingMeanTone(analysis.dashboard.fundingLeg2?.mean ?? null)}`}>
              {annualizedFundingLabel(analysis.dashboard.fundingLeg2?.mean ?? null)}
            </span>
            <span className="text-gray-600">（{analysis.dashboard.fundingLeg2?.count ?? 0}个）</span>
          </span>
        ),
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
          {exactSelection && <p className="mt-1 font-mono text-xs text-violet-200">{timeZone}：{formatChartTimeSelection(exactSelection, timeZone)}</p>}
          <p className="mt-1 text-xs text-gray-500">
            {composition === "mixed"
              ? "资金费率不剔尾；分布统计仅对组合收盘值做对称剔尾。"
              : composition === "perp-perp"
                ? "按可见 K 线实际窗口累计两腿各自真实结算费率，并以 365 天 ÷ 窗口时长年化后以 腿1 − 腿2 相减；两腿无需同桶结算，不剔尾；分布统计仅对组合收盘值做对称剔尾。"
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
          <li><span aria-hidden="true">🗓️</span> <span className="font-medium text-gray-400">{exactSelection ? "精确区间：" : "可见区间："}</span>{exactSelection ? `只使用图表精确选择的 ${timeZone} 时间桶，双腿保留对齐后的共同 K 线。` : "只使用图表当前选择的可见区间；有限区间以数据末端为锚点，双腿只保留时间戳对齐后的共同 K 线。"}</li>
          <li><span aria-hidden="true">📍</span> <span className="font-medium text-gray-400">当前值：</span>取最新一根可见共同 K 线的组合收盘值；价差＝腿1−腿2，比值＝腿1÷腿2，即原始 1:1 价格组合，不含回归或自定义配比。</li>
          <li><span aria-hidden="true">📊</span> <span className="font-medium text-gray-400">均值与 σ：</span>将可见组合收盘值排序，按“每侧剔除”比例从两端各剔除后计算算术均值和总体标准差。当前值始终取最新值，只有分布样本参与剔尾；±1σ、±2σ 均由剔尾后的均值与总体标准差得到。</li>
          <li><span aria-hidden="true">🧮</span> <span className="font-medium text-gray-400">较均值百分比：</span>（指标值 − 均值）÷ |均值| × 100%；均值为 0 或不可用时显示“--”。</li>
          {composition === "mixed" && (
            <li><span aria-hidden="true">💰</span> <span className="font-medium text-gray-400">资金费率：</span>只统计真实观测样本；Perp 在腿1时保持正号，在腿2时取负号，再对年化值做算术平均，不参与剔尾。</li>
          )}
          {composition === "perp-perp" && (
            <li><span aria-hidden="true">💰</span> <span className="font-medium text-gray-400">资金费率：</span>按可见 K 线的实际窗口 [最早开盘，最晚收盘) 累计两腿各自真实结算的 bucket rate，再按窗口时长年化；结果为“腿1 − 腿2”，两腿无需同一时间桶结算。卡片显示各腿实际结算样本数与对齐桶数；方向与价差或比值操作符无关。</li>
          )}
          <li className="md:col-span-2"><span aria-hidden="true">💹</span> <span className="font-medium text-gray-400">平均成交额：</span>每条腿分别对可见、对齐 K 线中的 quote turnover 做算术平均；缺失值不按 0，真实 0 参与。这是当前 K 线周期下平均每根 K 线成交额，不是统一折算的日均成交额。{turnoverSourceNote}</li>
          <li><span aria-hidden="true">🔢</span> <span className="font-medium text-gray-400">样本数：</span>卡片显示该指标实际参与计算的有效样本数；不同指标因缺失值或真实样本条件不同，样本数可能不一致。</li>
        </ul>
      </aside>
    </section>
  );
}

function OlsDiagnostics({ result, pairAnalysis, range, exactSelection, weights, timeZone }: {
  result: Props["result"];
  pairAnalysis: PairAnalysis | null | undefined;
  range: ArbitrageChartRange;
  exactSelection: ChartTimeSelection | null;
  weights: CombinationWeights;
  timeZone: ChartTimeZone;
}) {
  // Funding and turnover are market observations, not a second regression.
  const marketAnalytics = useMemo(() => isMixed(result)
    ? { kind: "mixed" as const, data: visibleDashboardAnalytics(result, range, 0, weights).dashboard }
    : { kind: "pair" as const, data: visiblePairDashboardAnalytics(result, range, 0, weights).dashboard }, [range, result, weights]);
  const { coreCards } = pairDiagnosticCards(pairAnalysis);
  const { cards: liquidityCards } = marketCards(result, marketAnalytics, weights);

  return <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">{exactSelection ? "精确区间" : "当前预设范围"} · 配对诊断</h3>{exactSelection && <p className="mt-1 font-mono text-xs text-violet-200">{timeZone}：{formatChartTimeSelection(exactSelection, timeZone)}</p>}<p className="mt-1 text-xs text-gray-500">默认模型：ln(腿1)=α+β·ln(腿2)+ε</p></div><span className={`w-fit rounded-full border px-2 py-1 text-[11px] ${pairAnalysis ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-gray-700 bg-gray-900 text-gray-500"}`}>{pairAnalysis ? "统计结果已载入" : pairAnalysis === undefined ? "统计计算中" : "统计结果不可用"}</span></div>
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{coreCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] text-gray-500">{card.label}</p><p className={`mt-1 font-mono text-sm font-semibold ${card.tone}`}>{card.value}</p><p className="mt-1 text-[10px] leading-4 text-gray-600">{card.note}</p></div>)}</div>
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">资金费率与流动性</h4><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{liquidityCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label}</p><p className="mt-1 font-mono text-sm text-gray-300">{card.value}</p><p className="mt-1 text-[10px] text-gray-600">{card.note}</p></div>)}</div></div>
    <aside className="mt-3 rounded border border-violet-500/15 bg-gray-900/50 px-3 py-2.5 text-[11px] leading-5 text-gray-500"><p className="font-medium text-gray-400">口径说明</p><p>全预设范围一次拟合，历史残差包含全样本参数，不构成无前视交易回测。</p><p>ADF(0) 仅报告通过/未通过5%近似阈值；它不是交易信号。半衰期仅在通过5%近似阈值时显示。资金费率按 1:β 权重构成历史统计指标，非无权重市场报价，也不代表固定数量仓位的精确 carry；成交额是未按 β 加权的原始市场观测。它们均不计入 PnL 曲线。</p></aside>
  </section>;
}

function pairDiagnosticCards(pairAnalysis: PairAnalysis | null | undefined) {
  const model = payload<{ kind?: string; alpha?: number; beta?: number }>(pairAnalysis?.model);
  const isCustom = model?.kind === "custom";
  const latest = pairAnalysis?.points.length ? pairAnalysis.points[pairAnalysis.points.length - 1] : null;
  const stationarityPassed = pickBoolean(pairAnalysis?.stationarity, ["stationary", "passes5Percent", "passed5Percent", "pass5Percent", "passed"]);
  const adf = pickNumber(pairAnalysis?.stationarity, ["adf", "adfStatistic", "statistic", "value"]);
  const halfLife = pickNumber(pairAnalysis?.halfLife, ["halfLifePeriods", "periods", "halfLife", "value"]);
  const betaDispersion = pickNumber(pairAnalysis?.hedgeStability, ["relativeDispersion", "betaRelativeDispersion", "coefficientOfVariation", "value"]);
  const remainingBtcBeta = pickNumber(pairAnalysis?.btcBeta, ["remainingBtcBeta", "residualBtcBeta", "beta", "value"]);
  const coreCards = [
    { label: "当前残差 ε", value: decimal(latest?.residual ?? null, 6), note: `模型偏离 ${signedPercent(latest?.modelDeviationPercent ?? null)}${isCustom ? "（按自定义 β）" : ""}`, tone: "text-violet-200" },
    { label: "当前 Rolling Z", value: decimal(latest?.zScore ?? null, 2), note: "以统计接口提供的滚动窗口计算", tone: "text-cyan-300" },
    { label: isCustom ? "诊断 β（自定义）" : "OLS β", value: decimal(model?.beta ?? null, 6), note: isCustom ? "残差与 ADF 由该 β 与截距重建" : `α ${decimal(model?.alpha ?? null, 6)}`, tone: "text-fuchsia-300" },
    { label: "ADF(0) 近似", value: stationarityPassed === null ? "--" : stationarityPassed ? "通过5%近似阈值" : "未通过5%近似阈值", note: adf === null ? "统计量不可用" : `ADF(0) ${decimal(adf, 3)}`, tone: stationarityPassed ? "text-emerald-300" : stationarityPassed === false ? "text-amber-300" : "text-gray-500" },
    ...(stationarityPassed === true ? [{ label: "半衰期", value: halfLife === null ? "--" : `${decimal(halfLife, 1)} 根`, note: "仅在通过5%近似阈值时展示", tone: "text-sky-300" }] : []),
    { label: "滚动 β 相对离散度", value: betaDispersion === null ? "--" : `${decimal(betaDispersion * (Math.abs(betaDispersion) <= 1 ? 100 : 1), 2)}%`, note: "越低表示对冲比例越稳定", tone: "text-indigo-300" },
    { label: "剩余 BTC Beta", value: decimal(remainingBtcBeta, 4), note: "组合残余的 BTC 暴露", tone: "text-rose-300" },
  ];
  return { coreCards, model };
}

function marketCards(result: Props["result"], marketAnalytics: { kind: "mixed"; data: ReturnType<typeof visibleDashboardAnalytics>["dashboard"] } | { kind: "pair"; data: ReturnType<typeof visiblePairDashboardAnalytics>["dashboard"] }, weights: CombinationWeights, fundingUnavailable = false) {
  const leg1 = legLabel(result, 1); const leg2 = legLabel(result, 2);
  const beta = weights.first > 0 ? weights.second / weights.first : Number.NaN;
  const ratio = Number.isFinite(beta) ? `1:${decimal(beta, 4)}` : "1:β";
  const weightedFundingNote = marketAnalytics.kind === "mixed"
    ? `按 Perp 所在腿的 ${ratio} 名义权重缩放观测费率；未按多空方向调整。它是历史资金费率指标，不代表交易 PnL，也不是固定数量仓位的精确 carry。`
    : isLegacy(result)
      ? `按 ${ratio} 口径计算腿1费率 − β×腿2费率并年化；这是历史费率指标，不代表交易 PnL，也不是固定数量仓位的精确 carry。`
      : "现货组合没有资金费率。";
  const rawTurnoverNote = "原始市场成交额观测，未按 β 加权。";
  const cards = marketAnalytics.kind === "mixed"
    ? [
        { label: "1:β 加权历史资金费率指标", value: fundingUnavailable ? "--" : signedPercent(marketAnalytics.data.fundingAnnualized.mean === null ? null : marketAnalytics.data.fundingAnnualized.mean * 100), note: fundingUnavailable ? "配对交易情景不可用或 β 无效；不显示加权费率。" : `${marketAnalytics.data.fundingAnnualized.count} 个可用样本 · ${weightedFundingNote}` },
        { label: "平均 Perp 成交额", value: compact(marketAnalytics.data.perpTurnover.mean), note: `${marketAnalytics.data.perpTurnover.count} 个样本 · ${rawTurnoverNote}` },
        { label: "平均 Spot 成交额", value: compact(marketAnalytics.data.spotTurnover.mean), note: `${marketAnalytics.data.spotTurnover.count} 个样本 · ${rawTurnoverNote}` },
      ]
    : [
        ...(marketAnalytics.data.fundingAnnualized ? [{ label: "1:β 加权历史资金费率指标", value: fundingUnavailable ? "--" : signedPercent(marketAnalytics.data.fundingAnnualized.mean === null ? null : marketAnalytics.data.fundingAnnualized.mean * 100), note: fundingUnavailable ? "配对交易情景不可用或 β 无效；不显示加权费率。" : `${marketAnalytics.data.fundingAnnualized.count} 个可用样本 · ${weightedFundingNote}` }] : []),
        { label: "腿1平均成交额", value: compact(marketAnalytics.data.leg1Turnover.mean), note: `${leg1} · ${marketAnalytics.data.leg1Turnover.count} 个样本 · ${rawTurnoverNote}` },
        { label: "腿2平均成交额", value: compact(marketAnalytics.data.leg2Turnover.mean), note: `${leg2} · ${marketAnalytics.data.leg2Turnover.count} 个样本 · ${rawTurnoverNote}` },
      ];
  return { cards, leg1, leg2 };
}

function PairTradeDiagnostics({ result, pairAnalysis, pairTrade, pairTradeReason, betaSource, entryCustom, entryCloseTime, pairViewport, range, weights, timeZone, fitWindowMode, fitWindowStart, fitWindowEnd, fitWindowCount, fitWindowUnavailable, pairTradeLookahead }: {
  result: Props["result"];
  pairAnalysis: PairAnalysis | null | undefined;
  pairTrade: PairTradeSeries | null | undefined;
  pairTradeReason: string | null | undefined;
  betaSource: "custom" | "auto";
  entryCustom: boolean;
  entryCloseTime: number | null;
  pairViewport: ChartTimeSelection | null;
  range: ArbitrageChartRange;
  weights: CombinationWeights;
  timeZone: ChartTimeZone;
  fitWindowMode: string;
  fitWindowStart: string | null;
  fitWindowEnd: string | null;
  fitWindowCount: number;
  fitWindowUnavailable: string | null;
  pairTradeLookahead: boolean;
}) {
  // Same zero-trim market-derived metrics as the OLS view. Funding is scaled by
  // the supplied 1:β notionals; turnover stays raw. Neither feeds the PnL curve.
  const marketAnalytics = useMemo(() => isMixed(result)
    ? { kind: "mixed" as const, data: visibleDashboardAnalytics(result, range, 0, weights).dashboard }
    : { kind: "pair" as const, data: visiblePairDashboardAnalytics(result, range, 0, weights).dashboard }, [range, result, weights]);
  const { coreCards, model } = pairDiagnosticCards(pairAnalysis);
  const pairTradeFundingUnavailable = pairTrade == null || !Number.isFinite(pairTrade.beta) || pairTrade.beta <= 0;
  const { cards: liquidityCards, leg1, leg2 } = marketCards(result, marketAnalytics, weights, pairTradeFundingUnavailable);
  const viewportPoints = pairTrade?.points.filter((point) => (
    point.time > (pairTrade?.entryTime ?? Number.POSITIVE_INFINITY)
    && (pairViewport === null || (point.time >= pairViewport.startTime && point.time <= pairViewport.endTime))
  )) ?? [];
  const latest = viewportPoints[viewportPoints.length - 1] ?? null;
  const hasPostEntryCandle = latest !== null;
  const postEntryFunding = entryCloseTime === null
    ? null
    : postEntryPairFundingAnalytics(result, entryCloseTime, weights);
  const isSpotSpot = "kind" in result && result.composition === "spot-spot";
  const postEntryFundingValue = pairTradeFundingUnavailable || isSpotSpot || !postEntryFunding?.available
    ? "--"
    : annualizedFundingLabel(postEntryFunding.mean);
  const postEntryFundingReason = pairTradeFundingUnavailable
    ? "β 无效或配对交易情景不可用，不计算加权费率。"
    : isSpotSpot
      ? "现货-现货组合没有资金费率。"
      : entryCloseTime === null
        ? "当前预设范围内未找到入场 K 线。"
        : postEntryFunding?.available
          ? `${postEntryFunding.count} 个实际结算观测；覆盖起点 ${postEntryFunding.coverageStartTime === null ? "--" : formatChartDateTime(postEntryFunding.coverageStartTime, timeZone)}；统计窗口 ${postEntryFunding.windowStartTime === null ? "--" : formatChartDateTime(postEntryFunding.windowStartTime, timeZone)} → ${postEntryFunding.windowEndTime === null ? "--" : formatChartDateTime(postEntryFunding.windowEndTime, timeZone)}。这是年化费率差指标，不是收益、carry 或 PnL。`
          : postEntryFunding?.reason === "no-post-entry-window"
            ? "当前可视窗口内入场后没有后续时间区间。"
            : "当前可视窗口没有足够的真实资金费率观测。";
  const betaText = pairTrade ? decimal(pairTrade.beta, 6) : decimal(model?.beta ?? null, 6);
  const scenarioCards = pairTrade ? [
    { label: "β（腿1 对腿2）", value: betaText, note: betaSource === "custom" ? "来源：自定义输入" : "来源：自动 OLS 拟合", tone: "text-fuchsia-300" },
    { label: "腿位（多/空）", value: `多 腿1 · 空 腿2`, note: `腿1 = ${leg1}；腿2 = ${leg2}`, tone: "text-indigo-200" },
    { label: "USDT 名义本金", value: `$${pairTrade.firstNotionalUsd.toLocaleString("en-US")} / $${pairTrade.secondNotionalUsd.toLocaleString("en-US")}`, note: `腿2 = β × 腿1（β=${decimal(pairTrade.beta, 4)}），入场后数量固定`, tone: "text-emerald-200" },
    { label: "入场 K 线时间标记", value: formatChartDateTime(pairTrade.entryTime, timeZone), note: `${entryCustom ? "自选 K 线" : "预设范围首根 K 线"}；时间戳标记开盘，入场价格取收盘：腿1 ${decimal(pairTrade.entryFirstClose, 6)} · 腿2 ${decimal(pairTrade.entrySecondClose, 6)}`, tone: "text-cyan-200" },
    { label: "最新 PnL（%）", value: latest?.returnPercent === null || latest?.returnPercent === undefined ? "--" : signedPercent(latest.returnPercent), note: hasPostEntryCandle ? `相对腿1名义本金 $${pairTrade.firstNotionalUsd.toLocaleString("en-US")}` : "入场后尚无后续 K 线", tone: latest?.returnPercent === null || latest?.returnPercent === undefined ? "text-gray-500" : latest.returnPercent >= 0 ? "text-emerald-300" : "text-red-300" },
    { label: "最新 PnL（USDT）", value: latest?.pnlUsd === null || latest?.pnlUsd === undefined ? "--" : `${latest.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(latest.pnlUsd).toFixed(2)}`, note: hasPostEntryCandle ? "绝对盈亏，不含资金费率、手续费与滑点" : "入场后尚无后续 K 线", tone: latest?.pnlUsd === null || latest?.pnlUsd === undefined ? "text-gray-500" : latest.pnlUsd >= 0 ? "text-emerald-300" : "text-red-300" },
  ] : [];

  return <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">配对交易 · 诊断</h3><p className="mt-1 font-mono text-xs text-violet-200">可视范围：{pairViewport ? `${timeZone}：${formatChartTimeSelection(pairViewport, timeZone)}` : "当前预设全范围"}</p><p className="mt-1 text-xs text-gray-500">PnL、可视区诊断与入场使用当前预设范围及图表视窗；模型 β 固定来自拟合窗口。缩放不会改变 β 或入场，点击/键盘候选 K 线也不会改变视窗。拟合窗口晚于入场可能含前视信息。</p><p className="mt-1 font-mono text-[11px] text-cyan-200">拟合：{fitWindowMode} · {fitWindowStart ?? "--"} → {fitWindowEnd ?? "--"} · {fitWindowCount} 个匹配点</p>{fitWindowUnavailable && <p className="mt-1 text-xs text-amber-300" role="status">{fitWindowUnavailable}</p>}{pairTradeLookahead && <p className="mt-1 text-xs text-amber-300" role="status">拟合结束晚于入场：情景含前视信息，不是回测。</p>}</div><span className={`w-fit rounded-full border px-2 py-1 text-[11px] ${pairTrade ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>{pairTrade ? "情景可用" : "情景不可用"}</span></div>
    {pairTrade ? (
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{scenarioCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] text-gray-500">{card.label}</p><p className={`mt-1 font-mono text-sm font-semibold ${card.tone}`}>{card.value}</p><p className="mt-1 text-[10px] leading-4 text-gray-600">{card.note}</p></div>)}</div>
    ) : (
      <p className="mt-3 rounded border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-200" role="status">{pairTradeUnavailableReason(pairTradeReason)}</p>
    )}
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">配对诊断</h4><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{coreCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label}</p><p className={`mt-1 font-mono text-sm ${card.tone}`}>{card.value}</p><p className="mt-1 text-[10px] text-gray-600">{card.note}</p></div>)}</div></div>
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">资金费率与流动性</h4><div className="mt-2 rounded-md border border-cyan-500/35 bg-cyan-950/20 p-3"><p className="text-xs font-semibold text-cyan-200">入场后 1:β 加权年化资金费率差</p><p className="mt-1 font-mono text-lg font-semibold text-cyan-100">{postEntryFundingValue}</p><p className="mt-1 text-[10px] leading-4 text-gray-400">{postEntryFundingReason}</p></div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{liquidityCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label.includes("历史资金费率") ? card.label.replace("历史", "视窗历史") : card.label}</p><p className="mt-1 font-mono text-sm text-gray-300">{card.value}</p><p className="mt-1 text-[10px] text-gray-600">当前可视窗口历史统计。{card.note}</p></div>)}</div></div>
    <aside className="mt-3 rounded border border-amber-500/20 bg-gray-900/50 px-3 py-2.5 text-[11px] leading-5 text-gray-500"><p className="font-medium text-amber-300">样本内情景模拟{pairTradeLookahead ? "／含前视信息，非回测" : "／非回测"}</p><p>β 固定来自拟合窗口，PnL 曲线由完整显示预设范围的行情独立计算；卡片中的最新 PnL 仅取当前图表视窗内入场后的最后一根 K 线。入场默认是预设范围首根，也可独立指定。缩放只改变可视诊断，不改变入场或拟合。持仓数量固定，不含资金费率、手续费与滑点，不能视为回测。</p><p>残差、ADF、半衰期、滚动 β 与 BTC β 按当前可视窗口诊断；资金费率历史摘要也按当前视窗筛选。单独的入场后费率差为年化历史费率指标，不是收益或 PnL。</p></aside>
  </section>;
}

export default function MixedAnalyticsDashboard({ result, pairAnalysis, pairTrade = null, pairTradeReason = null, pairTradeBetaSource = "auto", pairTradeEntryCustom = false, pairTradeEntryCloseTime = null, pairViewport = null, fitWindowMode = "all", fitWindowStart = null, fitWindowEnd = null, fitWindowCount = 0, fitWindowUnavailable = null, pairTradeLookahead = false, view, range, initialTailTrim = 1, exactSelection = null, weights = DEFAULT_WEIGHTS, timeZone }: Props) {
  if (view === "pair-trade") {
    return <PairTradeDiagnostics result={result} pairAnalysis={pairAnalysis} pairTrade={pairTrade} pairTradeReason={pairTradeReason} betaSource={pairTradeBetaSource} entryCustom={pairTradeEntryCustom} entryCloseTime={pairTradeEntryCloseTime} pairViewport={pairViewport} range={range} weights={weights} timeZone={timeZone} fitWindowMode={fitWindowMode} fitWindowStart={fitWindowStart} fitWindowEnd={fitWindowEnd} fitWindowCount={fitWindowCount} fitWindowUnavailable={fitWindowUnavailable} pairTradeLookahead={pairTradeLookahead} />;
  }
  if (view === "ols") {
    return <OlsDiagnostics result={result} pairAnalysis={pairAnalysis} range={range} exactSelection={exactSelection} weights={weights} timeZone={timeZone} />;
  }
  return <PlainDashboard result={result} range={range} initialTailTrim={initialTailTrim} exactSelection={exactSelection} weights={weights} timeZone={timeZone} />;
}
