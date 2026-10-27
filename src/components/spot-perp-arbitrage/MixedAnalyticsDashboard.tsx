"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
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
import type { PairAnalysis, PairModelEstimate, StatResult } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { DailyPairVaR, PairHistoricalVolatility, SimpleReturnRegression } from "@/lib/spot-perp-arbitrage/pair-risk";
import type { PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { postEntryPairFundingAnalytics } from "@/lib/spot-perp-arbitrage/analytics";
import { calculatePairLegReturns, type PairLegReturn } from "@/lib/spot-perp-arbitrage/pair-leg-returns";
import { pairTradeUnavailableReason, pairBetaModeLabel, type PairBetaMode } from "./CombinationWeightControls";

interface Props {
  result: MixedCombinationResult | SpotSpotCombinationResult | ComboCandleResult;
  /** The same pair-statistics result rendered by the chart. Used by the OLS view. */
  pairAnalysis?: PairAnalysis | null;
  /** The same pair-trade scenario rendered by the chart. Used by the pair-trade view. */
  pairTrade?: PairTradeSeries | null;
  /** Honest reason copy when the scenario cannot be built (null when available). */
  pairTradeReason?: string | null;
  /** Which β source the applied pair-trade scenario uses. */
  pairTradeBetaSource?: PairBetaMode;
  /**
   * A separate automatic log-price OLS fit used for the OLS β and log R² card:
   * the fit-window auto model in pair-trade, or the full-preset auto model in OLS.
   */
  olsModel?: StatResult<PairModelEstimate> | null;
  /** Simple-return OLS fit for the fit-window (pair-trade) or preset (OLS). */
  simpleReturnRegression?: StatResult<SimpleReturnRegression> | null;
  /** Historical daily VaR; scope is full preset in OLS and fit window in pair-trade. */
  dailyVar?: DailyPairVaR | null;
  /** Pair-trade only: annualized historical volatility for the selected fit window. */
  pairHistoricalVolatility?: PairHistoricalVolatility | null;
  /** The numeric β actually used by `dailyVar`; null/omitted shows `--` in the VaR note. */
  riskBeta?: number | null;
  /** Whether the entry candle was explicitly selected rather than defaulted to the first preset candle. */
  pairTradeEntryCustom?: boolean;
  pairTradeEntryCloseTime?: number | null;
  pairViewport?: ChartTimeSelection | null;
  /**
   * The full current preset result before the chart's viewport crop. Per-leg
   * entry-to-now returns must come from this series so a zoomed-in viewport does
   * not silently change the prices the legs are measured from.
   */
  pairTradeSourceResult?: MixedCombinationResult | SpotSpotCombinationResult | ComboCandleResult | null;
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

function OlsDiagnostics({ result, pairAnalysis, olsModel, simpleReturnRegression, dailyVar, riskBeta, range, exactSelection, weights, timeZone }: {
  result: Props["result"];
  pairAnalysis: PairAnalysis | null | undefined;
  olsModel: StatResult<PairModelEstimate> | null | undefined;
  simpleReturnRegression: StatResult<SimpleReturnRegression> | null | undefined;
  dailyVar: DailyPairVaR | null | undefined;
  riskBeta: number | null | undefined;
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
  // The OLS view always uses its own automatic full-preset fit, so the applied β
  // mode is always "auto" here and no separate custom-β entry is shown.
  const groupedCards = groupedDiagnosticCards({
    pairAnalysis, olsModel, simpleReturnRegression, dailyVar, riskBeta,
    appliedBeta: null, appliedBetaMode: "auto", varScope: "full-preset",
  });

  return <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">{exactSelection ? "精确区间" : "当前预设范围"} · 配对诊断</h3>{exactSelection && <p className="mt-1 font-mono text-xs text-violet-200">{timeZone}：{formatChartTimeSelection(exactSelection, timeZone)}</p>}<p className="mt-1 text-xs text-gray-500">默认模型：ln(腿1)=α+β·ln(腿2)+ε</p></div><span className={`w-fit rounded-full border px-2 py-1 text-[11px] ${pairAnalysis ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-gray-700 bg-gray-900 text-gray-500"}`}>{pairAnalysis ? "统计结果已载入" : pairAnalysis === undefined ? "统计计算中" : "统计结果不可用"}</span></div>
    <GroupedDiagnosticCards cards={groupedCards} />
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{coreCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] text-gray-500">{card.label}</p><p className={`mt-1 font-mono text-sm font-semibold ${card.tone}`}>{card.value}</p><p className="mt-1 text-[10px] leading-4 text-gray-600">{card.note}</p></div>)}</div>
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">资金费率与流动性</h4><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{liquidityCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label}</p><p className="mt-1 font-mono text-sm text-gray-300">{card.value}</p><p className="mt-1 text-[10px] text-gray-600">{card.note}</p></div>)}</div></div>
    <aside className="mt-3 rounded border border-violet-500/15 bg-gray-900/50 px-3 py-2.5 text-[11px] leading-5 text-gray-500"><p className="font-medium text-gray-400">口径说明</p><p>全预设范围一次拟合，历史残差包含全样本参数，不构成无前视交易回测。</p><p>ADF(0) 仅报告通过/未通过5%近似阈值；它不是交易信号。半衰期仅在通过5%近似阈值时显示。资金费率按 1:β 权重构成历史统计指标，非无权重市场报价，也不代表固定数量仓位的精确 carry；成交额是未按 β 加权的原始市场观测。它们均不计入 PnL 曲线。</p><p>对数价格 R² 衡量两腿价格水平的同步程度；简单收益率 R² 衡量按所选 K 线周期逐根收益的同步程度，两者含意与时框不同。日线 VaR 使用完整预设范围的 UTC 日线，与图表视窗无关。{VAR_METHOD_NOTE}</p></aside>
  </section>;
}

function pairDiagnosticCards(pairAnalysis: PairAnalysis | null | undefined, appliedBetaMode: PairBetaMode = "auto") {
  const model = payload<{ kind?: string; alpha?: number; beta?: number }>(pairAnalysis?.model);
  const latest = pairAnalysis?.points.length ? pairAnalysis.points[pairAnalysis.points.length - 1] : null;
  const stationarityPassed = pickBoolean(pairAnalysis?.stationarity, ["stationary", "passes5Percent", "passed5Percent", "pass5Percent", "passed"]);
  const adf = pickNumber(pairAnalysis?.stationarity, ["adf", "adfStatistic", "statistic", "value"]);
  const halfLife = pickNumber(pairAnalysis?.halfLife, ["halfLifePeriods", "periods", "halfLife", "value"]);
  const remainingBtcBeta = pickNumber(pairAnalysis?.btcBeta, ["remainingBtcBeta", "residualBtcBeta", "beta", "value"]);
  const btcBetaRSquared = pickNumber(pairAnalysis?.btcBeta, ["rSquared", "r2", "rSquaredValue"]);
  // The residual note must name the β actually applied by the scenario, not the
  // log-price model kind: a min-variance/unit preset is also rebuilt as a
  // "custom" model on the fit window, and calling that "自定义" is inaccurate.
  const appliedBetaNote = appliedBetaMode === "custom" ? "（按自定义 β）"
    : appliedBetaMode === "min-variance" ? "（按最小方差配比 β）"
      : appliedBetaMode === "one" ? "（按 β=1）"
        : "";
  // The standalone OLS β and rolling-β dispersion now live in the shared grouped
  // card so the OLS view and pair-trade view present the same labels; only the
  // remaining per-view diagnostics stay here.
  const coreCards = [
    { label: "当前残差 ε", value: decimal(latest?.residual ?? null, 6), note: `模型偏离 ${signedPercent(latest?.modelDeviationPercent ?? null)}${appliedBetaNote}`, tone: "text-violet-200" },
    { label: "当前 Rolling Z", value: decimal(latest?.zScore ?? null, 2), note: "以统计接口提供的滚动窗口计算", tone: "text-cyan-300" },
    { label: "ADF(0) 近似", value: stationarityPassed === null ? "--" : stationarityPassed ? "通过5%近似阈值" : "未通过5%近似阈值", note: adf === null ? "统计量不可用" : `ADF(0) ${decimal(adf, 3)}`, tone: stationarityPassed ? "text-emerald-300" : stationarityPassed === false ? "text-amber-300" : "text-gray-500" },
    ...(stationarityPassed === true ? [{ label: "半衰期", value: halfLife === null ? "--" : `${decimal(halfLife, 1)} 根`, note: "仅在通过5%近似阈值时展示", tone: "text-sky-300" }] : []),
    { label: "剩余 BTC Beta", value: decimal(remainingBtcBeta, 4), note: `组合残余的 BTC 暴露 · R² ${decimal(btcBetaRSquared, 3)}`, tone: "text-rose-300" },
  ];
  return { coreCards, model };
}

/* ------------------------------------------------------------------ *
 * Shared grouped diagnostics (OLS and pair-trade)
 * ------------------------------------------------------------------ */

/** Historical VaR methodology, shared verbatim by both views. */
const VAR_METHOD_NOTE = "收益代理 = (r1 − β×r2)/1，以腿1名义本金为基准；UTC 日线收盘到收盘 · 不含费用/资金费率 · 历史分位数，不是最大亏损。";
const VAR_GLOBAL_NOTE = "取自完整预设范围的 UTC 日线，使用当前生效 β，独立于拟合窗口与图表视窗。";
/**
 * The VaR return series resets a 1:β notional ratio on every historical day, so
 * it is a daily ratio proxy rather than the fixed-token pair-trade scenario.
 */
const VAR_DAILY_RESET_NOTE = "每个历史日重设腿1:腿2 = 1:β 名义暴露，未计调仓成本；与固定数量配对交易的 PnL 口径不同。";
const VAR_DENOM_NOTE = "分母为腿1参考名义本金（腿1=1），不是两腿总名义本金、账户保证金或权益。";
/**
 * Both percentiles need at least this many completed UTC daily returns. Below it
 * the value is unavailable (`--`); at 250 the low-sample warning is dropped,
 * without implying that the tail estimate is necessarily reliable.
 */
const VAR_MIN_DAILY_SAMPLES = 100;
const VAR99_LOW_SAMPLE_CEILING = 250;
const VAR99_LOW_SAMPLE_WARN = "恰好 100 个样本时，VaR 99% 等于样本内最差一日；低样本估计不稳定，也不代表未来最大亏损。";

interface GroupedValue {
  label: string;
  value: string;
  sub?: string;
  /** Visible, in-card low-confidence warning (never hover-only). */
  warn?: string;
  tone: string;
}

interface GroupedCard {
  title: string;
  values: GroupedValue[];
  hint?: string;
}

function statValue<T>(stat: StatResult<T> | null | undefined): T | null {
  return stat && stat.available ? stat.value : null;
}

/** Reads the auto log-price OLS model, falling back only to a non-custom model. */
function autoOlsModel(pairAnalysis: PairAnalysis | null | undefined, olsModel: StatResult<PairModelEstimate> | null | undefined): PairModelEstimate | null {
  const supplied = statValue(olsModel);
  if (supplied) return supplied;
  const fallback = pairAnalysis?.model;
  return fallback && fallback.available && fallback.value && fallback.value.kind !== "custom" ? fallback.value : null;
}

function groupedDiagnosticCards({
  pairAnalysis,
  olsModel,
  simpleReturnRegression,
  dailyVar,
  riskBeta,
  appliedBeta,
  appliedBetaMode,
  varScope = "full-preset",
}: {
  pairAnalysis: PairAnalysis | null | undefined;
  olsModel: StatResult<PairModelEstimate> | null | undefined;
  simpleReturnRegression: StatResult<SimpleReturnRegression> | null | undefined;
  dailyVar: DailyPairVaR | null | undefined;
  riskBeta: number | null | undefined;
  appliedBeta: number | null;
  appliedBetaMode: PairBetaMode;
  varScope?: "full-preset" | "fit-window";
}): GroupedCard[] {
  const autoModel = autoOlsModel(pairAnalysis, olsModel);
  const simpleModel = statValue(simpleReturnRegression);
  const betaDispersion = pickNumber(pairAnalysis?.hedgeStability, ["relativeDispersion", "betaRelativeDispersion", "coefficientOfVariation", "value"]);
  const intervalLimited = dailyVar?.var95.reason === "daily-interval-required" || dailyVar?.var99.reason === "daily-interval-required";
  const sampleCount = dailyVar?.sampleCount ?? 0;
  const var95Available = Boolean(dailyVar?.var95.available && dailyVar.var95.value !== null);
  const var99Available = Boolean(dailyVar?.var99.available && dailyVar.var99.value !== null);
  // VaR99 is available but still below the stable ceiling: show a visible
  // low-sample warning on the value itself, not just in the hint/aside.
  const var99LowSample = var99Available && sampleCount >= VAR_MIN_DAILY_SAMPLES && sampleCount < VAR99_LOW_SAMPLE_CEILING;

  const varValues: GroupedValue[] = [
    {
      label: "VaR 95%（单日）",
      value: var95Available ? `${dailyVar!.var95.value!.toFixed(2)}%` : "--",
      tone: "text-violet-200",
    },
    {
      label: "VaR 99%（单日）",
      value: var99Available ? `${dailyVar!.var99.value!.toFixed(2)}%` : "--",
      warn: var99LowSample ? VAR99_LOW_SAMPLE_WARN : undefined,
      tone: "text-violet-200",
    },
  ];
  const varCard: GroupedCard = {
    title: "历史日线 VaR（占腿1名义本金 %）",
    values: varValues,
    hint: `样本门槛：VaR 95% 与 VaR 99% 均需至少 ${VAR_MIN_DAILY_SAMPLES} 个完成的 UTC 日收益。使用 β = ${decimal(riskBeta ?? null, 4)}（-- 表示不可用）。${VAR_DAILY_RESET_NOTE}${VAR_DENOM_NOTE}${intervalLimited ? "当前图表周期不是 1d，日线 VaR 不可用；请切换到 1d 日线查看。" : `${sampleCount} 个日收益样本 · ${varScope === "fit-window" ? "仅取所选拟合窗口内的 UTC 日线收盘到收盘收益；不随图表视窗或入场变化。" : VAR_GLOBAL_NOTE}`}${VAR_METHOD_NOTE}`,
  };

  const betaValues: GroupedValue[] = [
    {
      label: "OLS β（对数价格 · 自动拟合）",
      value: decimal(autoModel?.beta ?? null, 6),
      sub: autoModel ? `${autoModel.count} 个拟合样本 · α ${decimal(autoModel.alpha, 6)}` : "自动拟合样本不足，未提供 OLS β",
      tone: "text-fuchsia-300",
    },
    {
      label: "滚动 β 相对离散度",
      // Always a percent: coefficientOfVariation (σ/|mean|) is a ratio, so 1.2 → 120%.
      value: betaDispersion === null ? "--" : `${(betaDispersion * 100).toFixed(2)}%`,
      sub: "越低表示对冲比例越稳定 · OLS 视图全预设范围 / 配对交易视图当前可视窗口",
      tone: "text-indigo-300",
    },
  ];
  // Distinguish an applied non-automatic β from the standalone OLS β so a custom
  // value is never mistaken for the fitted log-price slope.
  if (appliedBetaMode !== "auto" && appliedBeta !== null && Number.isFinite(appliedBeta)) {
    betaValues.push({
      label: `当前应用 β（${pairBetaModeLabel(appliedBetaMode)}）`,
      value: decimal(appliedBeta, 6),
      sub: appliedBetaMode === "custom" ? "手动输入；残差/ADF 按该 β 重建" : "情景按该来源 β 运行；OLS β 仍为自动拟合",
      tone: "text-amber-200",
    });
  }
  const betaCard: GroupedCard = {
    title: "OLS β 与滚动 β 离散度",
    values: betaValues,
  };

  const rSquaredCard: GroupedCard = {
    title: "拟合优度 R²",
    values: [
      {
        label: "对数价格 OLS R²",
        value: decimal(autoModel?.rSquared ?? null, 3),
        sub: "ln(腿1)=α+β·ln(腿2) · 价格水平同步程度（水平回归）",
        tone: "text-cyan-200",
      },
      {
        label: "简单收益率回归 R²",
        value: decimal(simpleModel?.rSquared ?? null, 3),
        sub: `腿1 收益率对腿2 收益率 · 按所选 K 线周期的每根收益率（收益回归）${simpleModel ? ` · ${simpleModel.returnCount} 个收益率样本` : ""}`,
        tone: "text-emerald-200",
      },
    ],
  };

  return [varCard, betaCard, rSquaredCard];
}

function GroupedDiagnosticCards({ cards }: { cards: GroupedCard[] }) {
  return (
    <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 ${cards.length === 4 ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
      {cards.map((card) => (
        <div key={card.title} className="rounded-md border border-gray-700 bg-gray-900/65 p-3">
          <p className="text-[11px] font-medium text-gray-400">{card.title}</p>
          <dl className="mt-2 space-y-1.5">
            {card.values.map((entry) => (
              <div key={entry.label}>
                <dt className="text-[10px] text-gray-500">{entry.label}</dt>
                <dd>
                  <span className={`font-mono text-sm font-semibold ${entry.tone}`}>{entry.value}</span>
                  {entry.warn && (
                    <span className="ml-1 inline-flex items-center rounded-sm border border-amber-500/50 bg-amber-500/10 px-1 text-[10px] font-medium text-amber-200" role="note">
                      低样本参考
                    </span>
                  )}
                  {entry.warn && <span className="mt-0.5 block text-[10px] leading-4 text-amber-300/90">{entry.warn}</span>}
                  {entry.sub && <span className="mt-0.5 block text-[10px] leading-4 text-gray-600">{entry.sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
          {card.hint && <p className="mt-2 border-t border-gray-700/60 pt-1.5 text-[10px] leading-4 text-gray-500">{card.hint}</p>}
        </div>
      ))}
    </div>
  );
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

interface ScenarioCard {
  key: string;
  label: string;
  content: ReactNode;
}

function returnTone(value: number | null): string {
  if (value === null) return "text-gray-500";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-red-300";
  return "text-gray-200";
}

/**
 * USDT amount of a percentage return on one leg's *own* entry notional.
 *
 * The percentage is already expressed against that leg's notional, so this is a
 * plain scaling: never multiply by β again. leg2 already carries β inside
 * `secondNotionalUsd = β × firstNotionalUsd`.
 *
 * Returns null (rendered as `--`) for an unknown/non-finite percentage, an
 * unusable notional, or a product that overflows to a non-finite value. Exact
 * zero stays 0 and renders as `$0.00`, never as a missing amount.
 */
export function legAmountUsd(percent: number | null, notionalUsd: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (notionalUsd === null || !Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  const amount = (percent / 100) * notionalUsd;
  return Number.isFinite(amount) ? amount : null;
}

/** The three amounts of one leg card, all from the same unrounded percentages. */
export function legReturnAmountsUsd(
  legReturn: PairLegReturn | null,
  notionalUsd: number | null,
): { price: number | null; funding: number | null; total: number | null } {
  return {
    price: legAmountUsd(legReturn?.priceReturnPercent ?? null, notionalUsd),
    funding: legAmountUsd(legReturn?.fundingReturnPercent ?? null, notionalUsd),
    total: legAmountUsd(legReturn?.totalReturnPercent ?? null, notionalUsd),
  };
}

/**
 * Signed USDT label: unknown stays `--`, exact zero is plain `$0.00`, and a
 * value that rounds to zero must not surface as `-$0.00`.
 */
export function signedUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  // Round the magnitude and re-apply the sign, so ±0.005 round away from zero
  // symmetrically instead of `Math.round(-0.5) === -0` swallowing the minus.
  const magnitude = Math.round(Math.abs(value) * 100) / 100;
  if (!Number.isFinite(magnitude)) return "--";
  if (magnitude === 0) return "$0.00";
  const digits = magnitude.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-" : "+"}$${digits}`;
}

/** A leg's own entry notional, for the card's verification line. */
function notionalLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "本金不可用";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The combined card states every return against this fixed reference, not the
 * β-weighted total notional: the user asked for a 10,000 USDT basis so the three
 * combined percentages stay comparable across scenarios.
 */
export const COMBINED_PNL_BASIS_USD = 10_000;

/** A proxied settlement price makes the funding figure an estimate. */
export function isProxiedFundingBasis(basis: PairLegReturn["fundingPriceBasis"]): boolean {
  return basis === "candle-proxy" || basis === "mixed" || basis === "bucket-candle";
}

function percentOfBasis(amountUsd: number | null, basisUsd: number): number | null {
  if (amountUsd === null || !Number.isFinite(amountUsd)) return null;
  if (!Number.isFinite(basisUsd) || basisUsd <= 0) return null;
  const percent = (amountUsd / basisUsd) * 100;
  return Number.isFinite(percent) ? percent : null;
}

/**
 * One leg's annualized funding weight when the combined card restates it on the
 * fixed basis: `annualPercent × notional / basis`.
 *
 * The percentage is already per-unit of this leg's own notional, so this is a
 * plain notional weight — leg2's notional already contains β. Values are guarded
 * at every step so an unusable notional or an overflowing weight is unknown,
 * never a fabricated number.
 */
export function combinedAnnualizedContribution(
  annualizedPercent: number | null,
  notionalUsd: number | null,
  basisUsd: number = COMBINED_PNL_BASIS_USD,
): number | null {
  if (annualizedPercent === null || !Number.isFinite(annualizedPercent)) return null;
  if (notionalUsd === null || !Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
  if (!Number.isFinite(basisUsd) || basisUsd <= 0) return null;
  const weight = notionalUsd / basisUsd;
  if (!Number.isFinite(weight)) return null;
  const contribution = annualizedPercent * weight;
  return Number.isFinite(contribution) ? contribution : null;
}

export interface CombinedReturnAmounts {
  priceUsd: number | null;
  fundingUsd: number | null;
  totalUsd: number | null;
  pricePercent: number | null;
  fundingPercent: number | null;
  totalPercent: number | null;
  /**
   * Combined annualized funding on the fixed basis:
   * `annual1 × N1/basis + annual2 × N2/basis`, i.e. the two legs' annualized
   * funding amounts added and expressed against the same 10,000 reference.
   */
  annualizedPercent: number | null;
  /** At least one leg priced its funding with a candle proxy, so funding is an estimate. */
  fundingEstimated: boolean;
  /** A leg's funding amount was unknown, so funding and total stay blank. */
  fundingUnavailable: boolean;
  basisUsd: number;
}

/**
 * The combined card's three amounts.
 *
 * `priceUsd` is the canonical price-only PnL of the latest viewport candle, so
 * the card's price row is the same number the price PnL curve plots. Funding is
 * the *sum of both legs' actual amounts* (each already scaled by its own notional,
 * so β is inside leg2's figure). The combined percentages divide by the fixed
 * `COMBINED_PNL_BASIS_USD`, never by the summed notionals and never by adding the
 * two legs' percentages. Unknown stays unknown: a null leg funding is not zero.
 */
export function combinedReturnAmounts({
  priceUsd,
  firstLeg,
  firstNotionalUsd,
  secondLeg,
  secondNotionalUsd,
  basisUsd = COMBINED_PNL_BASIS_USD,
}: {
  priceUsd: number | null;
  firstLeg: PairLegReturn | null;
  firstNotionalUsd: number | null;
  secondLeg: PairLegReturn | null;
  secondNotionalUsd: number | null;
  basisUsd?: number;
}): CombinedReturnAmounts {
  const price = priceUsd !== null && Number.isFinite(priceUsd) ? priceUsd : null;
  const firstFunding = legReturnAmountsUsd(firstLeg, firstNotionalUsd).funding;
  const secondFunding = legReturnAmountsUsd(secondLeg, secondNotionalUsd).funding;
  // Both legs must contribute a known, finite amount; a null is "unknown", not 0.
  const fundingKnown = firstFunding !== null && secondFunding !== null;
  const funding = fundingKnown && Number.isFinite(firstFunding + secondFunding)
    ? firstFunding + secondFunding
    : null;
  const total = price !== null && funding !== null && Number.isFinite(price + funding)
    ? price + funding
    : null;
  // Both legs must state a usable annualized rate and notional; a missing one is
  // unknown, not zero (a spot leg's 0, by contrast, is a real zero).
  const firstAnnualized = combinedAnnualizedContribution(
    firstLeg?.fundingAnnualizedPercent ?? null, firstNotionalUsd, basisUsd,
  );
  const secondAnnualized = combinedAnnualizedContribution(
    secondLeg?.fundingAnnualizedPercent ?? null, secondNotionalUsd, basisUsd,
  );
  const annualized = firstAnnualized !== null && secondAnnualized !== null
    && Number.isFinite(firstAnnualized + secondAnnualized)
    ? firstAnnualized + secondAnnualized
    : null;
  return {
    priceUsd: price,
    fundingUsd: funding,
    totalUsd: total,
    pricePercent: percentOfBasis(price, basisUsd),
    fundingPercent: percentOfBasis(funding, basisUsd),
    totalPercent: percentOfBasis(total, basisUsd),
    annualizedPercent: annualized,
    fundingEstimated: isProxiedFundingBasis(firstLeg?.fundingPriceBasis ?? null)
      || isProxiedFundingBasis(secondLeg?.fundingPriceBasis ?? null),
    fundingUnavailable: price !== null && !fundingKnown,
    basisUsd,
  };
}

/**
 * One compact three-column row of `price + funding = total`, each column showing
 * a percentage with its USDT amount underneath. Shared by the per-leg cards and
 * the combined card so both read identically.
 */
function ReturnTriplet({ rows, estimate }: {
  rows: {
    price: { percent: number | null; usd: number | null };
    funding: { percent: number | null; usd: number | null };
    total: { percent: number | null; usd: number | null };
  };
  /** Marks the funding and total columns as estimates (proxied settlement price). */
  estimate: boolean;
}) {
  const percentBadge = (value: number | null) => estimate && value !== null
    ? <span data-estimate="percent" className="ml-0.5 align-top text-[10px] font-normal text-amber-300">估算</span>
    : null;
  const amountBadge = (value: number | null) => estimate && value !== null
    ? <span data-estimate="amount" className="ml-0.5 align-top text-[9px] font-normal text-amber-300">估算</span>
    : null;
  const columns = [
    { key: "price", label: "价格收益", cell: rows.price, estimated: false },
    { key: "funding", label: "资金费率收益", cell: rows.funding, estimated: estimate },
    { key: "total", label: "总收益", cell: rows.total, estimated: estimate },
  ] as const;
  return (
    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-1">
      {columns.map((column, index) => (
        <Fragment key={column.key}>
          {index === 1 && <span className="pt-4 text-[10px] text-gray-600">+</span>}
          {index === 2 && <span className="pt-4 text-[10px] text-gray-600">=</span>}
          <div>
            <p className="text-[10px] text-gray-500">{column.label}</p>
            <p className={`font-mono text-[13px] font-semibold ${returnTone(column.cell.percent)}`}>
              {signedPercent(column.cell.percent)}{column.estimated ? percentBadge(column.cell.percent) : null}
            </p>
            <p className={`font-mono text-[10px] leading-4 ${returnTone(column.cell.usd)}`} data-leg-amount={column.key}>
              {signedUsd(column.cell.usd)}{column.estimated ? amountBadge(column.cell.usd) : null}
            </p>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One leg of the pair trade: price return, funding return and their sum, each
 * against that leg's own entry notional. Funding is
 * `Σ(rate × settlementPrice / entryPrice)`; the settlement price is the venue
 * mark when available, otherwise this leg's candle close for the containing
 * interval, which is only as precise as the chart interval.
 */
function legReturnCard(leg: 1 | 2, side: "多" | "空", market: string, legReturn: PairLegReturn | null, hasPostEntryCandle: boolean, notionalUsd: number | null): ScenarioCard {
  const price = legReturn?.priceReturnPercent ?? null;
  const funding = legReturn?.fundingReturnPercent ?? null;
  const total = legReturn?.totalReturnPercent ?? null;
  const annualized = legReturn?.fundingAnnualizedPercent ?? null;
  const isSpot = legReturn?.isSpot ?? false;
  const basis = legReturn?.fundingPriceBasis ?? null;
  // Amounts scale each percentage by this leg's own entry notional; leg2's
  // notional already holds β, so the β effect shows up exactly once.
  const amounts = legReturnAmountsUsd(legReturn, notionalUsd);
  // Only a proxied price makes the number an estimate; an all-mark price is exact
  // to the settlement data, so it carries no badge.
  const proxied = isProxiedFundingBasis(basis);
  // Only unreadable funding history is a funding-data warning. A missing price is
  // a different problem and is reported separately, never as "incomplete rates".
  const noFundingHistory = !isSpot && (legReturn?.fundingNote === "no-funding-data"
    || (legReturn?.fundingIncomplete ?? false));
  const priceMissing = legReturn?.priceMissing ?? false;
  const entryCloseUnknown = basis === null && legReturn?.fundingNote === "missing-entry-time";
  const basisNote = basis === "settlement-mark"
    ? "按结算费率 × 结算 mark 价 / 入场价逐笔计，非真实账户现金流。"
    : basis === "candle-proxy"
      ? "结算 mark 价缺失，按该结算所在本腿 K 线收盘价代理，精度受当前 K 线周期限制。"
      : basis === "bucket-candle"
        ? "上游仅提供桶内合计费率，按该桶本腿 K 线收盘价代理，不是逐笔结算价。"
        : basis === "mixed"
          ? "部分结算用 mark 价、部分用本腿 K 线收盘代理，精度受当前 K 线周期限制。"
          : priceMissing
            ? "结算价格缺失，资金收益暂不计算。"
            : funding === null
              ? "资金收益暂不可计算。"
              : "入场后尚无结算，资金收益按 0 计。";
  const footNote = !hasPostEntryCandle
    ? "入场后尚无后续 K 线，暂无收益。"
    : isSpot
      ? "现货腿没有资金费率（按 0 计），价格收益即总收益。"
      : basisNote;
  return {
    key: `leg-${leg}-returns`,
    label: `腿${leg} 收益（${side}）`,
    content: <>
      <ReturnTriplet
        rows={{
          price: { percent: price, usd: amounts.price },
          funding: { percent: funding, usd: amounts.funding },
          total: { percent: total, usd: amounts.total },
        }}
        estimate={proxied}
      />
      <p className="mt-1 text-[10px] leading-4 text-gray-500">
        资金费率年化 {isSpot ? "--（现货腿无资金费率）" : signedPercent(annualized)}
        {!isSpot && annualized !== null && <span className="text-gray-600">（按持有时长折算，非未来收益预测）</span>}
      </p>
      <p className="mt-0.5 text-[10px] leading-4 text-gray-500">
        USDT 金额按本腿入场名义本金 {notionalLabel(notionalUsd)} 折算{leg === 2 ? "（已含 β）" : ""}，与上列百分比同源。
      </p>
      {noFundingHistory && (
        <p className="mt-0.5 text-[10px] leading-4 text-red-300" role="note">未读取到资金费率历史数据</p>
      )}
      {priceMissing && (
        <p className="mt-0.5 text-[10px] leading-4 text-red-300" role="note">缺少可用的价格（结算价或入场价），资金收益暂不计算（非资金费率历史缺失）</p>
      )}
      {entryCloseUnknown && (
        <p className="mt-0.5 text-[10px] leading-4 text-gray-600">入场 K 线的真实收盘时间未知，资金费率窗口无法开启。</p>
      )}
      <p className="mt-0.5 text-[10px] leading-4 text-gray-600">{market} · {footNote}</p>
    </>,
  };
}

/**
 * The combined card: the latest viewport candle's canonical price PnL plus both
 * legs' funding amounts. Percentages always use the fixed 10,000 USDT basis, so
 * they are never the sum of the two leg percentages.
 */
function combinedPnlCard(
  priceUsd: number | null,
  firstLeg: PairLegReturn | null,
  firstNotionalUsd: number | null,
  secondLeg: PairLegReturn | null,
  secondNotionalUsd: number | null,
  hasPostEntryCandle: boolean,
): ScenarioCard {
  const combined = combinedReturnAmounts({
    priceUsd: hasPostEntryCandle ? priceUsd : null,
    firstLeg: hasPostEntryCandle ? firstLeg : null,
    firstNotionalUsd,
    secondLeg: hasPostEntryCandle ? secondLeg : null,
    secondNotionalUsd,
  });
  // Annualized funding follows the per-leg line: an estimate badge only when the
  // rate it restates is proxied, and never on an unknown value.
  const annualizedPartial = combined.annualizedPercent !== null && combined.fundingEstimated
    ? <span data-estimate="annualized" className="text-gray-600">，估算</span>
    : null;
  return {
    key: "merged-pnl",
    label: "最新合并 PnL",
    content: <>
      <ReturnTriplet
        rows={{
          price: { percent: combined.pricePercent, usd: combined.priceUsd },
          funding: { percent: combined.fundingPercent, usd: combined.fundingUsd },
          total: { percent: combined.totalPercent, usd: combined.totalUsd },
        }}
        estimate={combined.fundingEstimated}
      />
      <p className="mt-1 text-[10px] leading-4 text-gray-500">
        资金费率年化 {signedPercent(combined.annualizedPercent)}
        {combined.annualizedPercent !== null && <span className="text-gray-600">（按持有时长折算，非未来收益预测{annualizedPartial}）</span>}
      </p>
      <p className="mt-0.5 text-[10px] leading-4 text-gray-500">
        以 {COMBINED_PNL_BASIS_USD.toLocaleString("en-US")} 报价币（当前界面 USDT）为基准折算百分比，资金年化按两腿本金加权到该基准；资金为两腿实际金额加总（腿2 已含 β）。
      </p>
      {combined.fundingUnavailable && (
        <p className="mt-0.5 text-[10px] leading-4 text-amber-300">资金收益暂无可用值，仅保留价格收益；单腿资金状态见上方卡片。</p>
      )}
      {!hasPostEntryCandle && (
        <p className="mt-0.5 text-[10px] leading-4 text-gray-600">入场后尚无后续 K 线，暂无收益。</p>
      )}
      <p className="mt-0.5 text-[10px] leading-4 text-gray-600">
        价格收益即价格 PnL 曲线末点，仍不含资金、手续费与滑点；曲线不因本卡列示资金而改变口径。
      </p>
    </>,
  };
}

function PairTradeDiagnostics({ result, sourceResult, pairAnalysis, pairTrade, pairTradeReason, betaSource, olsModel, simpleReturnRegression, dailyVar, pairHistoricalVolatility, riskBeta, entryCustom, entryCloseTime, pairViewport, range, weights, timeZone, fitWindowMode, fitWindowStart, fitWindowEnd, fitWindowCount, fitWindowUnavailable, pairTradeLookahead }: {
  result: Props["result"];
  /** Uncropped preset series used for per-leg entry-to-now returns. */
  sourceResult: Props["pairTradeSourceResult"];
  pairAnalysis: PairAnalysis | null | undefined;
  pairTrade: PairTradeSeries | null | undefined;
  pairTradeReason: string | null | undefined;
  betaSource: PairBetaMode;
  olsModel: StatResult<PairModelEstimate> | null | undefined;
  simpleReturnRegression: StatResult<SimpleReturnRegression> | null | undefined;
  dailyVar: DailyPairVaR | null | undefined;
  pairHistoricalVolatility: PairHistoricalVolatility | null | undefined;
  riskBeta: number | null | undefined;
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
  const { coreCards, model } = pairDiagnosticCards(pairAnalysis, betaSource);
  const pairTradeFundingUnavailable = pairTrade == null || !Number.isFinite(pairTrade.beta) || pairTrade.beta <= 0;
  const { cards: liquidityCards, leg1, leg2 } = marketCards(result, marketAnalytics, weights, pairTradeFundingUnavailable);
  const viewportPoints = pairTrade?.points.filter((point) => (
    point.time > (pairTrade?.entryTime ?? Number.POSITIVE_INFINITY)
    && (pairViewport === null || (point.time >= pairViewport.startTime && point.time <= pairViewport.endTime))
  )) ?? [];
  const latest = viewportPoints[viewportPoints.length - 1] ?? null;
  // The only latest candle we accept is a real, finite post-entry point. We pass
  // it explicitly and never hand `null` to the helper, so a "use the last
  // retained candle" fallback can never quietly substitute a full-preset price
  // for a viewport that has no post-entry point.
  const latestTime = latest !== null && Number.isFinite(latest.time) ? latest.time : null;
  const hasPostEntryCandle = latestTime !== null;
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
  // Per-leg entry-to-now returns come from the uncropped preset series so the
  // left edge of a zoomed viewport can never move the prices being compared.
  // `latestTime` is always a real viewport candle, never `null`, so the helper
  // cannot fall back to the full-preset last candle.
  const legReturns = pairTrade && latestTime !== null
    ? calculatePairLegReturns(sourceResult ?? result, pairTrade, latestTime, entryCloseTime)
    : null;
  const firstLegReturn = legReturns?.first ?? null;
  const secondLegReturn = legReturns?.second ?? null;
  // Canonical price-only PnL of the latest viewport candle: this is what the
  // price PnL curve plots, and the combined card reuses it verbatim.
  const mergedPnlUsd = latest?.pnlUsd ?? null;
  const scenarioCards: ScenarioCard[] = pairTrade ? [
    {
      key: "beta-legs",
      label: "β 与腿位（多/空）",
      content: <>
        <p className="mt-1 font-mono text-sm font-semibold text-fuchsia-300">β = {betaText}</p>
        <p className="mt-0.5 font-mono text-xs text-indigo-200">多 腿1 · 空 腿2</p>
        <p className="mt-1 text-[10px] leading-4 text-gray-600">来源：{pairBetaModeLabel(betaSource)}；腿1 = {leg1}；腿2 = {leg2}</p>
      </>,
    },
    {
      key: "notional",
      label: "USDT 名义本金",
      content: <>
        <p className="mt-1 font-mono text-sm font-semibold text-emerald-200">${pairTrade.firstNotionalUsd.toLocaleString("en-US")} / ${pairTrade.secondNotionalUsd.toLocaleString("en-US")}</p>
        <p className="mt-1 text-[10px] leading-4 text-gray-600">腿2 = β × 腿1（β={decimal(pairTrade.beta, 4)}），入场后数量固定</p>
      </>,
    },
    {
      key: "entry",
      label: "入场 K 线时间标记",
      content: <>
        <p className="mt-1 font-mono text-sm font-semibold text-cyan-200">{formatChartDateTime(pairTrade.entryTime, timeZone)}</p>
        <p className="mt-1 text-[10px] leading-4 text-gray-600">{entryCustom ? "自选 K 线" : "预设范围首根 K 线"}；时间戳标记开盘，入场价格取收盘：腿1 {decimal(pairTrade.entryFirstClose, 6)} · 腿2 {decimal(pairTrade.entrySecondClose, 6)}</p>
      </>,
    },
    legReturnCard(1, "多", leg1, firstLegReturn, hasPostEntryCandle, pairTrade.firstNotionalUsd),
    legReturnCard(2, "空", leg2, secondLegReturn, hasPostEntryCandle, pairTrade.secondNotionalUsd),
    combinedPnlCard(
      mergedPnlUsd,
      firstLegReturn,
      pairTrade.firstNotionalUsd,
      secondLegReturn,
      pairTrade.secondNotionalUsd,
      hasPostEntryCandle,
    ),
  ] : [];
  // Shared grouped diagnostics: the auto log-price OLS β/R² come from the
  // fit-window automatic model, the simple-return regression from the fit-window
  // series, and VaR / volatility from the selected fit window with the applied β.
  const groupedCards = groupedDiagnosticCards({
    pairAnalysis, olsModel, simpleReturnRegression, dailyVar, riskBeta,
    appliedBeta: pairTrade?.beta ?? null,
    appliedBetaMode: betaSource,
    varScope: "fit-window",
  });
  const volatility = pairHistoricalVolatility?.annualizedPercent;
  const volatilityAvailable = Boolean(volatility?.available && volatility.value !== null && Number.isFinite(volatility.value));
  const volatilityReason = volatilityAvailable ? `${pairHistoricalVolatility?.sampleCount ?? 0} 个相邻有效收益样本 · 按 365 天年化` : volatility?.reason === "invalid-beta"
    ? "当前应用 β 无效，无法计算。"
    : volatility?.reason === "insufficient-returns"
      ? `有效相邻收益不足 2 个（当前 ${pairHistoricalVolatility?.sampleCount ?? 0} 个）。`
    : volatility?.reason === "invalid-interval" || volatility?.reason === "invalid-as-of"
      ? "K 线周期或时间范围无效，无法年化。"
      : volatility?.reason === "non-finite-volatility"
        ? "收益样本无法得到有限的波动率。"
      : volatility?.reason
          ? "历史波动率数据不可用。"
          : "未提供历史波动率数据。";
  const volatilityCard: GroupedCard = {
    title: "历史年化组合波动率（占腿1名义本金 %）",
    values: [{ label: "年化波动率（%）", value: volatilityAvailable ? `${volatility!.value!.toFixed(2)}%` : "--", tone: volatilityAvailable ? "text-cyan-200" : "text-gray-500", sub: volatilityReason }],
    hint: "所选拟合窗口内按样本标准差计算；收益代理 (r1 − β×r2)/1，以腿1名义本金为基准，按 365 天及当前 K 线周期年化。每期重设 1:β 名义暴露，不随图表视窗或入场变化；非固定数量情景 PnL，不含费用或资金费率。",
  };
  const pairGroupedCards = [...groupedCards, volatilityCard];

  return <section className="rounded-lg border border-violet-500/25 bg-gray-800 p-4" aria-labelledby="mixed-analytics-title">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h3 id="mixed-analytics-title" className="text-sm font-semibold text-white">配对交易 · 诊断</h3><p className="mt-1 font-mono text-xs text-violet-200">可视范围：{pairViewport ? `${timeZone}：${formatChartTimeSelection(pairViewport, timeZone)}` : "当前预设全范围"}</p><p className="mt-1 text-xs text-gray-500">PnL、可视区诊断与入场使用当前预设范围及图表视窗；模型 β 固定来自拟合窗口。缩放不会改变 β 或入场，点击/键盘候选 K 线也不会改变视窗。拟合窗口晚于入场可能含前视信息。</p><p className="mt-1 font-mono text-[11px] text-cyan-200">拟合：{fitWindowMode} · {fitWindowStart ?? "--"} → {fitWindowEnd ?? "--"} · {fitWindowCount} 个匹配点</p>{fitWindowUnavailable && <p className="mt-1 text-xs text-amber-300" role="status">{fitWindowUnavailable}</p>}{pairTradeLookahead && <p className="mt-1 text-xs text-amber-300" role="status">拟合结束晚于入场：情景含前视信息，不是回测。</p>}</div><span className={`w-fit rounded-full border px-2 py-1 text-[11px] ${pairTrade ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>{pairTrade ? "情景可用" : "情景不可用"}</span></div>
    {pairTrade ? (
      <div className="mt-4 overflow-x-auto pb-1">
        {/* Always 3 columns × 2 rows; on narrow screens the block scrolls sideways instead of squeezing. */}
        <div className="grid min-w-[760px] grid-cols-3 gap-2">{scenarioCards.map((card) => <div key={card.key} data-scenario-card={card.key} className="min-w-0 rounded-md border border-gray-700 bg-gray-900/65 p-3"><p className="text-[11px] leading-4 text-gray-500">{card.label}</p>{card.content}</div>)}</div>
      </div>
    ) : (
      <p className="mt-3 rounded border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-200" role="status">{pairTradeUnavailableReason(pairTradeReason)}</p>
    )}
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">配对诊断</h4><GroupedDiagnosticCards cards={pairGroupedCards} /><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{coreCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label}</p><p className={`mt-1 font-mono text-sm ${card.tone}`}>{card.value}</p><p className="mt-1 text-[10px] text-gray-600">{card.note}</p></div>)}</div></div>
    <div className="mt-3 border-t border-gray-700/70 pt-3"><h4 className="text-xs font-medium text-gray-300">资金费率与流动性</h4><div className="mt-2 rounded-md border border-cyan-500/35 bg-cyan-950/20 p-3"><p className="text-xs font-semibold text-cyan-200">入场后 1:β 加权年化资金费率差</p><p className="mt-1 font-mono text-lg font-semibold text-cyan-100">{postEntryFundingValue}</p><p className="mt-1 text-[10px] leading-4 text-gray-400">{postEntryFundingReason}</p></div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{liquidityCards.map((card) => <div key={card.label} className="rounded-md border border-gray-700/80 bg-gray-900/40 px-3 py-2"><p className="text-[10px] text-gray-500">{card.label.includes("历史资金费率") ? card.label.replace("历史", "视窗历史") : card.label}</p><p className="mt-1 font-mono text-sm text-gray-300">{card.value}</p><p className="mt-1 text-[10px] text-gray-600">当前可视窗口历史统计。{card.note}</p></div>)}</div></div>
    <aside className="mt-3 rounded border border-amber-500/20 bg-gray-900/50 px-3 py-2.5 text-[11px] leading-5 text-gray-500"><p className="font-medium text-amber-300">样本内情景模拟{pairTradeLookahead ? "／含前视信息，非回测" : "／非回测"}</p><p>β 固定来自拟合窗口，PnL 曲线由完整显示预设范围的行情独立计算；<strong className="font-medium text-gray-400">PnL 曲线仍只含价格</strong>，不含资金费率、手续费与滑点。最新合并 PnL 卡片另取当前图表视窗内入场后的最后一根 K 线：其中价格收益就是该点曲线值，资金收益则是两腿实际资金金额之和（腿2 已含 β），两者相加得总收益；三项百分比统一以 10,000 报价币（当前界面 USDT）为基准折算，因此既不等于两腿百分比之和，也不是按两腿名义本金加权；该卡下方的资金费率年化同样以这 10,000 为基准，把两条腿各自的年化费率按本腿入场名义本金加权后相加（腿2 本金已含 β），与单腿卡片显示的年化口径一致。两只单腿收益卡片另行拆分价格收益、资金费率收益与两者之和，区间为入场收盘到同一根可视末根收盘/当前时刻，各自以本腿入场名义本金为分母；每项下方的 USDT 金额就是该百分比乘以本腿自己的入场名义本金（腿2 的名义本金已含 β，因此 β 体现在金额上、不再缩放百分比），金额随百分比同号着色并同样标注「估算」。其中资金部分逐笔按 Σ(多空符号 × 结算费率 × 结算价 / 入场价) 计：有结算 mark 价时优先用 mark 价，缺失时以该结算所在本腿 K 线收盘价代理（精度受当前 K 线周期限制，并在卡片上标注「估算」），因此不等于真实账户结算现金流。年化值按持有窗口真实时长折算，是历史折算而非未来收益预测。现货腿没有资金费率，按 0 计。只要读到该腿历史数据就按完整处理，入场后暂无结算即按 0 计；只有完全读不到资金费率历史才红字提示。入场默认是预设范围首根，也可独立指定；缩放只改变可视诊断和末根选取，不改变入场、拟合与各腿入场的价格基准。</p><p>残差、ADF、半衰期、滚动 β 与 BTC β 按当前可视窗口诊断；资金费率历史摘要也按当前视窗筛选。单独的入场后费率差为年化历史费率指标，不是收益或 PnL，与单腿卡片里的资金收益是两回事。</p><p>本组卡片口径：OLS β 与对数价格 R² 来自拟合窗口的自动回归，与当前应用 β 分开显示；简单收益率 R² 同样取自拟合窗口，但以每根 K 线简单收益率回归。VaR 与年化波动率使用所选拟合窗口及当前生效 β，不随图表视窗或入场变化。{VAR_METHOD_NOTE}</p></aside>
  </section>;
}

export default function MixedAnalyticsDashboard({ result, pairAnalysis, pairTrade = null, pairTradeReason = null, pairTradeBetaSource = "auto", olsModel = null, simpleReturnRegression = null, dailyVar = null, pairHistoricalVolatility = null, riskBeta = null, pairTradeEntryCustom = false, pairTradeEntryCloseTime = null, pairViewport = null, pairTradeSourceResult = null, fitWindowMode = "all", fitWindowStart = null, fitWindowEnd = null, fitWindowCount = 0, fitWindowUnavailable = null, pairTradeLookahead = false, view, range, initialTailTrim = 1, exactSelection = null, weights = DEFAULT_WEIGHTS, timeZone }: Props) {
  if (view === "pair-trade") {
    return <PairTradeDiagnostics result={result} sourceResult={pairTradeSourceResult} pairAnalysis={pairAnalysis} pairTrade={pairTrade} pairTradeReason={pairTradeReason} betaSource={pairTradeBetaSource} olsModel={olsModel} simpleReturnRegression={simpleReturnRegression} dailyVar={dailyVar} pairHistoricalVolatility={pairHistoricalVolatility} riskBeta={riskBeta} entryCustom={pairTradeEntryCustom} entryCloseTime={pairTradeEntryCloseTime} pairViewport={pairViewport} range={range} weights={weights} timeZone={timeZone} fitWindowMode={fitWindowMode} fitWindowStart={fitWindowStart} fitWindowEnd={fitWindowEnd} fitWindowCount={fitWindowCount} fitWindowUnavailable={fitWindowUnavailable} pairTradeLookahead={pairTradeLookahead} />;
  }
  if (view === "ols") {
    return <OlsDiagnostics result={result} pairAnalysis={pairAnalysis} olsModel={olsModel} simpleReturnRegression={simpleReturnRegression} dailyVar={dailyVar} riskBeta={riskBeta} range={range} exactSelection={exactSelection} weights={weights} timeZone={timeZone} />;
  }
  return <PlainDashboard result={result} range={range} initialTailTrim={initialTailTrim} exactSelection={exactSelection} weights={weights} timeZone={timeZone} />;
}
