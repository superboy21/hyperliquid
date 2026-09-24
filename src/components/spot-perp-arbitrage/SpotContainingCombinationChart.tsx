"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  marketDisplaySymbol,
  type CombinationMode,
  type SpotContainingCombinationResult,
} from "@/lib/spot-perp-arbitrage";
import ChartSourceCaption from "@/components/ChartSourceCaption";
import { chartSelectionIndices, chartTimeSelectionFromIndices, formatChartTimeSelection, moveChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { type CombinationValueUnit, type CombinationViewMode } from "@/lib/combo-weighting";
import { chartIntlTimeZone, type ChartTimeZone } from "@/lib/chart-timezone";
import type { PairAnalysis } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { alignedPairChartSamples, alignedPairDerivedCandles } from "@/lib/spot-perp-arbitrage/pair-chart-data";
import { alignedPairCloses } from "@/lib/spot-perp-arbitrage/pair-adapter";
import { formatRawPriceAxis, pairTradeUnavailableReason, selectionFromPlotPixelX } from "./CombinationWeightControls";

interface Props {
  result: SpotContainingCombinationResult;
  /** One shared pair-statistics result. It is never recalculated in this view. */
  pairAnalysis?: PairAnalysis | null;
  /**
   * The fit-window model behind the pair-trade beta. The pair-trade title only
   * shows a formula when this model's β matches the applied `pairTrade.beta`.
   */
  pairTradeAnalysis?: PairAnalysis | null;
  /** One shared pair-trade scenario from the controller; never recalculated here. */
  pairTrade?: PairTradeSeries | null;
  /** Honest reason copy when the scenario cannot be built (null when available). */
  pairTradeReason?: string | null;
  timeSelection?: ChartTimeSelection | null;
  onTimeSelectionChange?: (selection: ChartTimeSelection | null) => void;
  onPairViewportChange?: (selection: ChartTimeSelection | null) => void;
  view: CombinationViewMode;
  timeZone: ChartTimeZone;
}

interface TooltipItem {
  seriesName?: string;
  seriesType?: string;
  dataIndex?: number;
  axisValueLabel?: string;
  value?: unknown;
  data?: unknown;
}

interface FundingDatum {
  value: number | null;
  rawRate?: number;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: { open: number; close: number };
}

/**
 * Intraday intervals where funding settles sparsely inside each candle bucket
 * (e.g. one settlement per 8h within 4h/1h/5m buckets). Actual settlements are
 * drawn as visible points; buckets with no sample stay as gaps (no fill, no
 * interpolation, no joining across missing samples).
 */
const SETTLEMENT_POINT_INTERVALS: ReadonlySet<string> = new Set(["4h", "1h", "5m"]);

/**
 * Genuinely sparse funding: the funding array holds only actual observations
 * (normalized), so sparsity means at least one actual observation exists AND
 * at least one chart bucket has no settlement at its openTime. Dense/continuous
 * data keeps the plain line presentation even on intraday intervals.
 */
function hasFundingGaps(
  points: readonly { openTime: number }[],
  funding: readonly { time: number }[],
): boolean {
  if (funding.length === 0) return false;
  const settled = new Set<number>();
  for (const point of funding) settled.add(point.time);
  return points.some((point) => !settled.has(point.openTime));
}

function compact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

function derivedValue(value: number, mode: "spread" | "ratio"): string {
  if (mode === "spread") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
  }
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatChangePercent(open: number, close: number): string {
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return "N/A";
  const percent = ((close - open) / open) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

function dateLabel(timestamp: number, interval: string, timeZone: ChartTimeZone): string {
  const detailed = interval === "4h" || interval === "1h" || interval === "5m" || interval === "1m";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(detailed ? { hour: "2-digit", minute: "2-digit" } : {}),
    hour12: false,
    timeZone: chartIntlTimeZone(timeZone),
  });
}

function numberValue(value: unknown): number | null {
  const candidate = typeof value === "object" && value !== null && "value" in value
    ? (value as { value?: unknown }).value
    : value;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

// ==================== Regression (OLS) view helpers ====================

function statValue<T>(value: unknown): T | null {
  if (value && typeof value === "object" && "value" in value) return (value as { value?: T | null }).value ?? null;
  return value as T | null;
}
function finiteText(value: number | null | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}
/**
 * The pair-trade title may only claim a formula when alpha and beta both come
 * from the model that actually produced the applied `pairTrade.beta`. A
 * mismatched model (min-variance, unit, or a stale full-preset fit) yields null
 * so the title keeps only its long/short description.
 */
function matchingTradeModel(analysis: PairAnalysis | null | undefined, appliedBeta: number | null | undefined) {
  if (typeof appliedBeta !== "number" || !Number.isFinite(appliedBeta)) return null;
  const model = statValue<{ alpha?: number; beta?: number }>(analysis?.model);
  const alpha = model?.alpha;
  const beta = model?.beta;
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) return null;
  if (typeof beta !== "number" || !Number.isFinite(beta)) return null;
  const scale = Math.max(1, Math.abs(appliedBeta), Math.abs(beta));
  return Math.abs(appliedBeta - beta) <= 1e-9 * scale ? { alpha, beta } : null;
}

// ==================== Pair-trade view helpers ====================

function pairTradeUnitValue(point: { pnlUsd: number | null; returnPercent: number | null }, unit: CombinationValueUnit): number | null {
  return unit === "usd" ? point.pnlUsd : point.returnPercent;
}

function pairTradeAxisLabel(value: number, unit: CombinationValueUnit): string {
  if (unit === "usd") {
    const absolute = Math.abs(value);
    const scaled = absolute >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : absolute >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toFixed(0);
    return `$${scaled}`;
  }
  return `${value.toFixed(1)}%`;
}

function signedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function signedPercentValue(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function SpotContainingCombinationChart({ result: sourceResult, pairAnalysis, pairTradeAnalysis = null, pairTrade = null, pairTradeReason = null, timeSelection = null, onTimeSelectionChange, onPairViewportChange, view, timeZone }: Props) {
  const [valueUnit, setValueUnit] = useState<CombinationValueUnit>("percent");
  // Default subplot is the endpoint-only raw ratio; toggling switches the
  // derived candlestick to the raw spread. Independent from valueUnit.
  const [comparisonMode, setComparisonMode] = useState<CombinationMode>("ratio");
  const [showFirstRaw, setShowFirstRaw] = useState(false);
  const [showSecondRaw, setShowSecondRaw] = useState(false);
  const result = sourceResult;
  const chartRef = useRef<HTMLDivElement | null>(null);
  const applySelectionRef = useRef<((selection: ChartTimeSelection | null, showTip?: boolean, zoomRange?: boolean) => void) | null>(null);
  const selectAtPixelRef = useRef<((point: [number, number]) => void) | null>(null);
  const pointerRef = useRef<{ pointerId: number; clientX: number; clientY: number; dragged: boolean } | null>(null);
  const selectionRef = useRef(timeSelection);
  const selectionChangeRef = useRef(onTimeSelectionChange);
  const pairViewportChangeRef = useRef(onPairViewportChange);
  const zoomRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  useEffect(() => { selectionRef.current = timeSelection; }, [timeSelection]);
  useEffect(() => { selectionChangeRef.current = onTimeSelectionChange; }, [onTimeSelectionChange]);
  useEffect(() => { pairViewportChangeRef.current = onPairViewportChange; }, [onPairViewportChange]);
  useEffect(() => {
    // Chart identity changed: drop the preserved viewport and reset the
    // pair-trade axis unit to its default. The derived subplot returns to the
    // raw ratio default too, while valueUnit keeps its own independent state.
    zoomRangeRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValueUnit("percent");
    setComparisonMode("ratio");
  }, [sourceResult]);
  useEffect(() => {
    // Plain, OLS, and pair-trade have independent viewport state at the
    // controller level. Never carry one view's preserved ECharts zoom into
    // another view; unit/subchart changes within the same view still preserve it.
    zoomRangeRef.current = null;
  }, [view]);
  const leg1Label = `${sourceResult.leg1.source.exchange} ${marketDisplaySymbol(sourceResult.leg1)}`;
  const leg2Label = `${sourceResult.leg2.source.exchange} ${marketDisplaySymbol(sourceResult.leg2)}`;
  const showAllSymbol =
    SETTLEMENT_POINT_INTERVALS.has(sourceResult.interval)
    && sourceResult.composition !== "spot-spot"
    && hasFundingGaps(sourceResult.points, sourceResult.funding);

  const turnoverNotes = useMemo(() => {
    const leg1Estimated = sourceResult.points.some((point) => point.leg1Turnover?.provenance === "estimated-base-close");
    const leg2Estimated = sourceResult.points.some((point) => point.leg2Turnover?.provenance === "estimated-base-close");
    return { leg1Estimated, leg2Estimated };
  }, [sourceResult.points]);

  // ---------- plain view: classic spread/ratio candlestick ----------
  useEffect(() => {
    if (view !== "plain" || !chartRef.current || result.points.length === 0) return;
    const chart = echarts.init(chartRef.current);
    const categories = result.points.map((point) => dateLabel(point.openTime, result.interval, timeZone));
    const axisInterval = Math.max(0, Math.floor(result.points.length / 8));
    const candleData: CandleDatum[] = result.points.map((point) => ({
      value: [point.open, point.close, point.low ?? Math.min(point.open, point.close), point.high ?? Math.max(point.open, point.close)],
      raw: { open: point.open, close: point.close },
    }));
    const risingColors = result.points.map((point) => point.close >= point.open ? "rgba(139,92,246,.58)" : "rgba(239,68,68,.52)");

    const plainShowAllSymbol =
      SETTLEMENT_POINT_INTERVALS.has(result.interval)
      && result.composition !== "spot-spot"
      && hasFundingGaps(result.points, result.funding);
    const firstSubLabel = result.composition === "spot-spot" ? "腿1报价币成交额" : "较小报价币成交额";
    const secondSubLabel = result.composition === "spot-spot"
      ? "腿2报价币成交额"
      : plainShowAllSymbol
        ? "有符号年化资金费率(结算点)"
        : "有符号年化资金费率";
    const secondTooltipLabel = result.composition === "spot-spot"
      ? secondSubLabel
      : plainShowAllSymbol
        ? "年化资金费率(结算点)"
        : "年化资金费率";
    const firstSubData = result.points.map((point, index) => ({
      value: result.composition === "spot-spot" ? point.leg1Turnover?.value ?? null : point.minimumTurnover,
      itemStyle: { color: risingColors[index] },
    }));
    // sampleCount === 0 marks a period with no funding samples: drop it so the
    // funding line renders a gap instead of a fake 0% (observed zeros still render).
    const fundingByTime = new Map(
      result.funding
        .filter((point) => point.sampleCount !== 0)
        .map((point) => [point.time, point]),
    );
    const secondSubData = result.composition === "spot-spot"
      ? result.points.map((point, index) => ({ value: point.leg2Turnover?.value ?? null, itemStyle: { color: risingColors[index] } }))
      : result.points.map((point) => {
          const funding = fundingByTime.get(point.openTime);
          return funding
            ? { value: funding.annualizedRate * 100, rawRate: funding.rate }
            : null;
        });

    const title = `${leg1Label} ${result.mode === "spread" ? "−" : "÷"} ${leg2Label}`;
    const tooltipFormatter = (parameters: unknown) => {
      const items = (Array.isArray(parameters) ? parameters : [parameters]) as TooltipItem[];
      const index = items[0]?.dataIndex ?? 0;
      const point = result.points[index];
      const candle = items.find((item) => item.seriesType === "candlestick")?.data as CandleDatum | undefined;
      const firstSub = items.find((item) => item.seriesName === firstSubLabel);
      const secondSub = items.find((item) => item.seriesName === secondSubLabel);
      const lines = [
        `<strong>${escapeHtml(title)}</strong>`,
        `${escapeHtml(items[0]?.axisValueLabel ?? "")} · ${escapeHtml(timeZone)}`,
      ];
      if (candle?.raw) {
        lines.push(`开盘：${derivedValue(candle.raw.open, result.mode)}`);
        lines.push(`收盘：${derivedValue(candle.raw.close, result.mode)}`);
        lines.push(`涨跌幅：${formatChangePercent(candle.raw.open, candle.raw.close)}`);
      }
      const firstValue = numberValue(firstSub?.value);
      if (firstValue !== null) lines.push(`${firstSubLabel}：${compact(firstValue)}`);
      const secondValue = numberValue(secondSub?.value);
      if (secondValue !== null) {
        lines.push(result.composition === "spot-spot"
          ? `${secondSubLabel}：${compact(secondValue)}`
          : (() => {
              const funding = secondSub?.data as FundingDatum | undefined;
              const annualized = `${secondValue >= 0 ? "+" : ""}${secondValue.toFixed(2)}%`;
              const rawRate = funding?.rawRate;
              const raw = rawRate !== undefined && Number.isFinite(rawRate)
                ? `${rawRate >= 0 ? "+" : ""}${(rawRate * 100).toFixed(4)}%`
                : null;
              return `${secondTooltipLabel}：${raw === null ? annualized : `${annualized}（${raw}）`}`;
            })());
      } else if (result.composition !== "spot-spot") {
        // The funding line item may be omitted entirely from axis tooltip
        // params when its value is null — the funding lane still exists.
        lines.push(`${secondTooltipLabel}：无`);
      }
      if (result.composition === "spot-spot" && point) {
        if (point.leg1Turnover?.provenance === "estimated-base-close") lines.push("腿1成交额：估算");
        if (point.leg2Turnover?.provenance === "estimated-base-close") lines.push("腿2成交额：估算");
      }
      return lines.join("<br />");
    };

    const openTimes = result.points.map((point) => point.openTime);
    const preservedZoom = zoomRangeRef.current;
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      title: {
        text: title,
        left: 16,
        top: 6,
        textStyle: { color: "#e5e7eb", fontSize: 13, fontWeight: 600 },
      },
      legend: {
        data: [result.mode === "spread" ? "价差" : "比值", firstSubLabel, secondSubLabel],
        top: 5,
        right: 18,
        textStyle: { color: "#9ca3af", fontSize: 10 },
        itemWidth: 13,
        itemHeight: 9,
      },
      grid: [
        { left: 58, right: 20, top: 42, height: "42%" },
        { left: 58, right: 20, top: "56%", height: "15%" },
        { left: 58, right: 20, top: "74%", height: "18%" },
      ],
      axisPointer: { link: [{ xAxisIndex: [0, 1, 2] }] },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,24,39,.97)",
        borderColor: "#374151",
        textStyle: { color: "#e5e7eb", fontSize: 12 },
        formatter: tooltipFormatter,
      },
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1, 2], moveOnMouseMove: false, ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
        { type: "slider", xAxisIndex: [0, 1, 2], bottom: 2, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)", ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
      ],
      ...(typeof onTimeSelectionChange === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, xAxisIndex: [0, 1, 2], brushLink: "all" } } : {}),
      xAxis: [0, 1, 2].map((gridIndex) => ({
        type: "category",
        gridIndex,
        data: categories,
        boundaryGap: true,
        min: "dataMin",
        max: "dataMax",
        axisLine: { lineStyle: { color: "#4b5563" } },
        axisLabel: gridIndex === 2 ? { color: "#9ca3af", interval: axisInterval, fontSize: 10, margin: 16 } : { show: false },
      })),
      yAxis: [
        {
          scale: true,
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: "#9ca3af", formatter: (value: number) => derivedValue(value, result.mode) },
          splitLine: { lineStyle: { color: "rgba(75,85,99,.35)" } },
        },
        {
          gridIndex: 1,
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: "#9ca3af", formatter: compact },
          splitLine: { lineStyle: { color: "rgba(75,85,99,.22)" } },
        },
        {
          gridIndex: 2,
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: "#9ca3af", formatter: result.composition === "spot-spot" ? compact : (value: number) => `${value.toFixed(1)}%` },
          splitLine: { lineStyle: { color: "rgba(75,85,99,.18)" } },
        },
      ],
      series: [
        {
          id: "exact-selection-candles",
          type: "candlestick",
          name: result.mode === "spread" ? "价差" : "比值",
          data: candleData,
          itemStyle: { color: "#8b5cf6", color0: "#ef4444", borderColor: "#8b5cf6", borderColor0: "#ef4444" },
        },
        { type: "bar", name: firstSubLabel, xAxisIndex: 1, yAxisIndex: 1, data: firstSubData, barMaxWidth: 12 },
        result.composition === "spot-spot"
          ? { type: "bar", name: secondSubLabel, xAxisIndex: 2, yAxisIndex: 2, data: secondSubData, barMaxWidth: 12 }
          : {
              type: "line",
              name: secondSubLabel,
              xAxisIndex: 2,
              yAxisIndex: 2,
              data: secondSubData,
              connectNulls: false,
              // Genuinely sparse intraday data: render every actual settlement
              // as a visible point (showAllSymbol) so isolated observations
              // surrounded by gaps stay discoverable. Dense data and 1d/1w keep
              // the continuous line with no symbols.
              symbol: plainShowAllSymbol ? "circle" : "none",
              ...(plainShowAllSymbol
                ? {
                    showSymbol: true,
                    showAllSymbol: true,
                    symbolSize: 6,
                    itemStyle: { color: "#f59e0b", borderColor: "#0F172A", borderWidth: 1.5 },
                  }
                : {}),
              lineStyle: { color: "#f59e0b", width: 1.5 },
              areaStyle: { color: "rgba(245,158,11,.08)" },
              markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], label: { show: false }, lineStyle: { color: "#6b7280", type: "dashed" } },
            },
      ],
    });
    const focus = (selection: ChartTimeSelection | null, showTip = false, zoomRange = false) => {
      if (!selection) { chart.setOption({ series: [{ id: "exact-selection-candles", markArea: { data: [] } }] }); if (openTimes.length > 0) chart.dispatchAction({ type: "dataZoom", startValue: 0, endValue: openTimes.length - 1 }); return; }
      const indices = chartSelectionIndices(openTimes, selection);
      if (!indices) return;
      if (zoomRange) chart.dispatchAction({ type: "dataZoom", startValue: indices.startIndex, endValue: indices.endIndex });
      chart.setOption({ series: [{ id: "exact-selection-candles", markArea: { silent: true, itemStyle: { color: "rgba(139,92,246,.1)" }, label: { show: false }, data: [[{ xAxis: indices.startIndex }, { xAxis: indices.endIndex }]] } }] });
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 }); chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: indices.cursorIndex });
      if (showTip) chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: indices.cursorIndex });
    };
    applySelectionRef.current = focus;
    const commit = (first: number, second: number, showTip = false, zoomRange = false) => { const next = chartTimeSelectionFromIndices(openTimes, first, second); if (next) { selectionRef.current = next; chartRef.current?.focus({ preventScroll: true }); selectionChangeRef.current?.(next); focus(next, showTip, zoomRange); } };
    const brushEnd = (event: any) => { const range = event?.areas?.[0]?.coordRange; if (Array.isArray(range)) { commit(Math.round(range[0]), Math.round(range[1]), false, true); chart.dispatchAction({ type: "brush", areas: [] }); chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } }); } };
    selectAtPixelRef.current = (point) => { if (!chart.containPixel({ gridIndex: 0 }, point) || openTimes.length === 0) return; const converted = chart.convertFromPixel({ xAxisIndex: 0 }, point); const value = Array.isArray(converted) ? converted[0] : converted; const resolved = typeof value === "number" ? Math.round(value) : categories.indexOf(String(value)); const start = Number.isFinite(resolved) && resolved >= 0 ? Math.max(0, Math.min(openTimes.length - 1, resolved)) : 0; const nearest = openTimes.reduce((best, _candle, candidate) => { const px = Number(chart.convertToPixel({ xAxisIndex: 0 }, candidate)); const bestPx = Number(chart.convertToPixel({ xAxisIndex: 0 }, best)); return Number.isFinite(px) && Math.abs(px - point[0]) < Math.abs(bestPx - point[0]) ? candidate : best; }, start); commit(nearest, nearest, true); };
    if (typeof onTimeSelectionChange === "function") { chart.on("brushEnd", brushEnd); chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } }); }

    // Plain view only keeps the visible zoom; it never triggers a recompute.
    const onDataZoom = (event: any) => {
      const zoom = event?.batch?.[0] ?? event;
      const optionZoom = (chart.getOption().dataZoom as any[] | undefined)?.[0] ?? {};
      const startValue = Number(zoom?.startValue ?? optionZoom.startValue);
      const endValue = Number(zoom?.endValue ?? optionZoom.endValue);
      const startPercent = Number(zoom?.start ?? optionZoom.start);
      const endPercent = Number(zoom?.end ?? optionZoom.end);
      const start = Number.isFinite(startValue) ? Math.max(0, Math.min(openTimes.length - 1, Math.round(startValue))) : Number.isFinite(startPercent) ? Math.round((startPercent / 100) * (openTimes.length - 1)) : 0;
      const end = Number.isFinite(endValue) ? Math.max(start, Math.min(openTimes.length - 1, Math.round(endValue))) : Number.isFinite(endPercent) ? Math.max(start, Math.round((endPercent / 100) * (openTimes.length - 1))) : openTimes.length - 1;
      const previous = zoomRangeRef.current;
      if (previous?.startIndex === start && previous?.endIndex === end) return;
      zoomRangeRef.current = { startIndex: start, endIndex: end };
    };
    chart.on("dataZoom", onDataZoom);
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);
    return () => {
      resizeObserver.disconnect();
      if (typeof onTimeSelectionChange === "function") chart.off("brushEnd", brushEnd);
      chart.off("dataZoom", onDataZoom);
      if (applySelectionRef.current === focus) applySelectionRef.current = null;
      selectAtPixelRef.current = null;
      chart.dispose();
    };
  }, [view, leg1Label, leg2Label, result.composition, result.funding, result.interval, result.mode, result.points, onTimeSelectionChange, timeZone]);

  // ---------- ols view: log-price regression residual + rolling Z ----------
  useEffect(() => {
    if (view !== "ols" || !chartRef.current || !pairAnalysis?.points.length) return;
    const chart = echarts.init(chartRef.current);
    const points = pairAnalysis.points;
    const times = points.map((point) => point.time);
    const categories = points.map((point) => dateLabel(point.time, sourceResult.interval, timeZone));
    const model = statValue<{ alpha?: number; beta?: number }>(pairAnalysis.model);
    const formula = `ln(${leg1Label}) = ${finiteText(model?.alpha, 6)} + ${finiteText(model?.beta, 6)} · ln(${leg2Label})`;
    const title = `${leg1Label} ~ ${leg2Label} · OLS · ${formula}`;
    const formatter = (params: any) => {
      const index = (Array.isArray(params) ? params[0] : params)?.dataIndex ?? 0;
      const point = points[index]; if (!point) return "";
      return [`<strong>${title}</strong>`, `${dateLabel(point.time, sourceResult.interval, timeZone)} · ${timeZone}`, `残差 ε：${finiteText(point.residual, 6)}`, `模型偏离：${finiteText(point.modelDeviationPercent, 2)}%`, `Rolling Z：${finiteText(point.zScore, 2)}`, `α：${finiteText(model?.alpha, 6)}`, `β：${finiteText(model?.beta, 6)}`].join("<br/>");
    };
    chart.setOption({
      animation: false, backgroundColor: "transparent",
      title: { text: title, left: 16, top: 6, textStyle: { color: "#e5e7eb", fontSize: 13, fontWeight: 600 } },
      legend: { data: ["对数价格回归残差 ε", "Rolling Z-score"], top: 5, right: 18, textStyle: { color: "#9ca3af", fontSize: 10 } },
      grid: [{ left: 58, right: 20, top: 42, height: "35%" }, { left: 58, right: 20, top: "57%", height: "31%" }],
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "rgba(17,24,39,.97)", borderColor: "#374151", textStyle: { color: "#e5e7eb", fontSize: 12 }, formatter },
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1], moveOnMouseMove: false }, { type: "slider", xAxisIndex: [0, 1], bottom: 3, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)" }],
      ...(typeof onTimeSelectionChange === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, xAxisIndex: [0, 1], brushLink: "all" } } : {}),
      xAxis: [0, 1].map((gridIndex) => ({ type: "category", gridIndex, data: categories, boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: gridIndex ? { color: "#9ca3af", interval: Math.max(0, Math.floor(points.length / 8)), fontSize: 10, margin: 16 } : { show: false } })),
      yAxis: [
        { scale: true, position: "right", axisLine: { show: false }, axisLabel: { color: "#9ca3af", formatter: (value: number) => value.toFixed(3) }, splitLine: { lineStyle: { color: "rgba(75,85,99,.3)" } } },
        { gridIndex: 1, scale: true, position: "right", axisLine: { show: false }, axisLabel: { color: "#9ca3af", formatter: (value: number) => value.toFixed(1) }, splitLine: { lineStyle: { color: "rgba(75,85,99,.3)" } } },
      ],
      series: [
        { id: "exact-selection-residual", type: "line", name: "对数价格回归残差 ε", data: points.map((point) => point.residual), showSymbol: false, connectNulls: false, lineStyle: { color: "#a78bfa", width: 1.6 }, markLine: { silent: true, symbol: "none", label: { show: true, formatter: "ε = 0", color: "#9ca3af", fontSize: 10 }, data: [{ yAxis: 0, lineStyle: { color: "#64748b", type: "dashed" } }] } },
        { type: "line", name: "Rolling Z-score", xAxisIndex: 1, yAxisIndex: 1, data: points.map((point) => point.zScore), showSymbol: false, connectNulls: false, lineStyle: { color: "#22d3ee", width: 1.6 }, markLine: { silent: true, symbol: "none", label: { color: "#9ca3af", fontSize: 10 }, data: [0, 1, -1, 2, -2].map((value) => ({ yAxis: value, label: { formatter: value === 0 ? "0" : `${value > 0 ? "+" : ""}${value}σ` }, lineStyle: { color: value === 0 ? "#64748b" : Math.abs(value) === 2 ? "#f59e0b" : "#475569", type: "dashed" } })) } },
      ],
    });
    const focus = (selection: ChartTimeSelection | null, showTip = false) => {
      if (!selection) { chart.setOption({ series: [{ id: "exact-selection-residual", markArea: { data: [] } }] }); return; }
      const selected = chartSelectionIndices(times, selection); if (!selected) return;
      chart.setOption({ series: [{ id: "exact-selection-residual", markArea: { silent: true, itemStyle: { color: "rgba(139,92,246,.1)" }, label: { show: false }, data: [[{ xAxis: selected.startIndex }, { xAxis: selected.endIndex }]] } }] });
      if (showTip) chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: selected.cursorIndex });
    };
    applySelectionRef.current = focus;
    selectAtPixelRef.current = (point) => {
      if (!chart.containPixel({ gridIndex: 0 }, point) || times.length === 0) return;
      const converted = chart.convertFromPixel({ xAxisIndex: 0 }, point);
      const value = Array.isArray(converted) ? converted[0] : converted;
      const resolved = typeof value === "number" ? Math.round(value) : categories.indexOf(String(value));
      const index = Number.isFinite(resolved) && resolved >= 0 ? Math.max(0, Math.min(times.length - 1, resolved)) : 0;
      const selection = chartTimeSelectionFromIndices(times, index, index);
      if (selection) { selectionRef.current = selection; selectionChangeRef.current?.(selection); focus(selection, true); }
    };
    const brushEnd = (event: any) => { const range = event?.areas?.[0]?.coordRange; if (!Array.isArray(range)) return; const next = chartTimeSelectionFromIndices(times, Math.round(range[0]), Math.round(range[1])); if (next) { selectionRef.current = next; selectionChangeRef.current?.(next); focus(next); } chart.dispatchAction({ type: "brush", areas: [] }); };
    if (typeof onTimeSelectionChange === "function") chart.on("brushEnd", brushEnd);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(chartRef.current);
    return () => { observer.disconnect(); if (typeof onTimeSelectionChange === "function") chart.off("brushEnd", brushEnd); if (applySelectionRef.current === focus) applySelectionRef.current = null; selectAtPixelRef.current = null; chart.dispose(); };
  }, [view, leg1Label, leg2Label, onTimeSelectionChange, pairAnalysis, sourceResult.interval, timeZone]);
  useEffect(() => { applySelectionRef.current?.(timeSelection); }, [timeSelection]);

  // ---------- pair-trade view: one zero-based chronological PnL line ----------
  useEffect(() => {
    if (view !== "pair-trade" || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const points = pairTrade?.points ?? alignedPairCloses(sourceResult).map((point) => ({ time: point.closeTime, pnlUsd: null, returnPercent: null }));
    if (points.length === 0) { chart.dispose(); return; }
    const categories = points.map((point) => dateLabel(point.time, sourceResult.interval, timeZone));
    const times = points.map((point) => point.time);
    const rawSamples = alignedPairChartSamples(sourceResult, times);
    const firstBars = rawSamples.map((sample) => sample.firstOhlc);
    const secondBars = rawSamples.map((sample) => sample.secondOhlc);
    // Endpoint-only candles built from the raw leg endpoints (never β, never
    // the composite spread/ratio point). Each candle keeps the panel count: the
    // ratio/spread choice only swaps this one subplot's data and labelling.
    const derivedCandles = alignedPairDerivedCandles(sourceResult, times, comparisonMode);
    const derivedLabel = comparisonMode === "ratio" ? "原始比值（腿1/腿2）·端点" : "原始价差（腿1−腿2）·端点";
    const names = ["配对交易 PnL", derivedLabel, ...(showFirstRaw ? [`原始 ${leg1Label}`] : []), ...(showSecondRaw ? [`原始 ${leg2Label}`] : [])];
    const indexes = names.map((_name, index) => index);
    const grids = names.map((_name, index) => ({ left: 62, right: 54, top: `${9 + index * (78 / names.length)}%`, height: `${68 / names.length}%` }));
    let title = `${leg1Label} 多 / ${leg2Label} 空`;
    const tradeModel = pairTrade ? matchingTradeModel(pairTradeAnalysis, pairTrade.beta) : null;
    if (tradeModel) title += ` · ln(${leg1Label}) = ${finiteText(tradeModel.alpha, 6)} + ${finiteText(tradeModel.beta, 6)} · ln(${leg2Label})`;
    const pnlData = points.map((point) => pairTradeUnitValue(point, valueUnit));
    const preservedZoom = zoomRangeRef.current;
    const formatter = (params: any) => {
      const index = (Array.isArray(params) ? params[0] : params)?.dataIndex ?? 0;
      const point = points[index];
      if (!point) return "";
      const sample = rawSamples[index];
      const derived = derivedCandles[index];
      const derivedLines = derived
        // Endpoint-only candles carry open/close only: no high/low is drawn or
        // reported, so the tooltip never implies a wick.
        ? [`${derivedLabel} 开盘：${derivedValue(derived[0], comparisonMode)}`, `${derivedLabel} 收盘：${derivedValue(derived[1], comparisonMode)}`, `${comparisonMode === "ratio" ? "比值" : "价差"}涨跌幅：${formatChangePercent(derived[0], derived[1])}`]
        : [`${derivedLabel}：无数据（原始开收盘缺失或无效）`];
      const lines = [
        `<strong>${escapeHtml(title)}</strong>`,
        `${dateLabel(point.time, sourceResult.interval, timeZone)} · ${timeZone}`,
        ...derivedLines,
      ];
      // The derived close already is the raw close ratio in ratio mode, so the
      // raw line would only repeat it; keep it (clearly labelled) for spread.
      if (comparisonMode === "spread") {
        lines.push(`原始收盘价比值（腿1/腿2）：${sample?.ratio == null ? "无数据" : sample.ratio.toPrecision(7)}`);
      }
      for (const [label, ohlc] of [[leg1Label, sample?.firstOhlc], [leg2Label, sample?.secondOhlc]] as const) lines.push(ohlc ? `${escapeHtml(label)} 原始 OHLC：${ohlc.map((value) => finiteText(value, 6)).join(" / ")}` : `${escapeHtml(label)} 原始 OHLC：无数据`);
      if (!pairTrade) { lines.push(pairTradeUnavailableReason(pairTradeReason)); return lines.join("<br/>"); }
      if (point.pnlUsd === null || point.returnPercent === null) {
        lines.push("未入场（早于所选入场 K 线）", "入场前 PnL 留空，不按 0 计入。");
        return lines.join("<br/>");
      }
      const isEntry = index === pairTrade.entryIndex;
      lines.push(`情景 PnL：${signedUsd(point.pnlUsd)}（${signedPercentValue(point.returnPercent)}）`, `入场标记：${dateLabel(pairTrade.entryTime, sourceResult.interval, timeZone)} · 收盘价腿1 ${finiteText(pairTrade.entryFirstClose, 6)} / 腿2 ${finiteText(pairTrade.entrySecondClose, 6)}`, `腿位：多 腿1 $${pairTrade.firstNotionalUsd.toLocaleString("en-US")} · 空 腿2 β×$${pairTrade.firstNotionalUsd.toLocaleString("en-US")} = $${pairTrade.secondNotionalUsd.toLocaleString("en-US")}`, isEntry ? "入场点：曲线基准为 0" : "情景模拟，不含资金费率、手续费与滑点");
      return lines.join("<br/>");
    };
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      title: { text: title, left: 16, top: 6, textStyle: { color: "#e5e7eb", fontSize: 13, fontWeight: 600 } },
      legend: { data: names, top: 5, right: 18, textStyle: { color: "#9ca3af", fontSize: 10 } },
      grid: grids,
      toolbox: { show: false },
      axisPointer: { link: [{ xAxisIndex: indexes }] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "rgba(17,24,39,.97)", borderColor: "#374151", textStyle: { color: "#e5e7eb", fontSize: 12 }, formatter },
      dataZoom: [
        { type: "inside", xAxisIndex: indexes, moveOnMouseMove: false, ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
        { type: "slider", xAxisIndex: indexes, bottom: 3, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)", ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
      ],
      ...(typeof onTimeSelectionChange === "function" || typeof pairViewportChangeRef.current === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, brushThreshold: 6, xAxisIndex: indexes, brushLink: "all" } } : {}),
      xAxis: indexes.map((gridIndex) => ({ type: "category", gridIndex, data: points.map((_point, index) => index), boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: { show: gridIndex === indexes.length - 1, color: "#9ca3af", formatter: (value: number | string) => categories[Math.round(Number(value))] ?? "", interval: Math.max(0, Math.floor(points.length / 8)), fontSize: 10, margin: 16 } })),
      yAxis: indexes.map((gridIndex) => ({
        gridIndex,
        scale: true,
        position: "right",
        axisLine: { show: false },
        axisLabel: { color: "#9ca3af", formatter: (value: number) => gridIndex === 0 ? pairTradeAxisLabel(value, valueUnit) : formatRawPriceAxis(value) },
        splitLine: { lineStyle: { color: "rgba(75,85,99,.3)" } },
      })),
      series: [{
        id: "exact-selection-pair-trade",
        type: "line",
        name: names[0],
        data: pnlData,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: "#a78bfa", width: 1.7 },
        areaStyle: { color: "rgba(167,139,250,.08)" },
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          data: [{ yAxis: 0, lineStyle: { color: "#64748b", type: "dashed" } }],
        },
        markPoint: {
          silent: true,
          symbol: "pin",
          symbolSize: 34,
          label: { show: true, formatter: "入场", color: "#0f172a", fontSize: 9, fontWeight: 600 },
          itemStyle: { color: "#22d3ee" },
          data: pairTrade ? [{ coord: [pairTrade.entryIndex, 0] }] : [],
        },
      },
      { type: "candlestick", id: "pair-derived-candles", name: derivedLabel, xAxisIndex: 1, yAxisIndex: 1, data: derivedCandles, itemStyle: { color: "#8b5cf6", color0: "#ef4444", borderColor: "#8b5cf6", borderColor0: "#ef4444" } },
      ...(showFirstRaw ? [{ type: "candlestick", name: `原始 ${leg1Label}`, xAxisIndex: 2, yAxisIndex: 2, data: firstBars, itemStyle: { color: "#8b5cf6", color0: "#ef4444", borderColor: "#8b5cf6", borderColor0: "#ef4444" } }] : []),
      ...(showSecondRaw ? [{ type: "candlestick", name: `原始 ${leg2Label}`, xAxisIndex: showFirstRaw ? 3 : 2, yAxisIndex: showFirstRaw ? 3 : 2, data: secondBars, itemStyle: { color: "#8b5cf6", color0: "#ef4444", borderColor: "#8b5cf6", borderColor0: "#ef4444" } }] : []),
      ],
    });
    const focus = (selection: ChartTimeSelection | null, showTip = false) => {
      if (!selection) { chart.setOption({ series: [{ id: "exact-selection-pair-trade", markArea: { data: [] } }] }); return; }
      const selected = chartSelectionIndices(times, selection); if (!selected) return;
      chart.setOption({ series: [{ id: "exact-selection-pair-trade", markArea: { silent: true, itemStyle: { color: "rgba(139,92,246,.1)" }, label: { show: false }, data: [[{ xAxis: selected.startIndex }, { xAxis: selected.endIndex }]] } }] });
      if (showTip) chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: selected.cursorIndex });
    };
    applySelectionRef.current = focus;
    focus(selectionRef.current);
    // Use ZRender's chart-native click so empty plot cells (including null
    // pre-entry segments) remain selectable. Map the x pixel to a numeric data
    // index rather than a possibly repeated human-readable category label.
    let zrDown: { x: number; y: number } | null = null;
    let zrDragged = false;
    const zr = chart.getZr();
    const onZrMouseDown = (event: any) => {
      zrDown = { x: Number(event.offsetX ?? event.zrX), y: Number(event.offsetY ?? event.zrY) };
      zrDragged = false;
    };
    const onZrMouseMove = (event: any) => {
      if (!zrDown) return;
      const x = Number(event.offsetX ?? event.zrX);
      const y = Number(event.offsetY ?? event.zrY);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - zrDown.x, y - zrDown.y) > 5) zrDragged = true;
    };
    const onZrClick = (event: any) => {
      const x = Number(event.offsetX ?? event.zrX);
      const y = Number(event.offsetY ?? event.zrY);
      const wasDragged = zrDragged;
      zrDown = null;
      zrDragged = false;
      if (wasDragged || !Number.isFinite(x) || !Number.isFinite(y) || !indexes.some((gridIndex) => chart.containPixel({ gridIndex }, [x, y]))) return;
      const selection = selectionFromPlotPixelX(times, x, (index) => {
        const projected = chart.convertToPixel({ xAxisIndex: 0 }, index);
        return Number(Array.isArray(projected) ? projected[0] : projected);
      });
      if (selection) { selectionRef.current = selection; selectionChangeRef.current?.(selection); focus(selection, true); }
    };
    zr.on("mousedown", onZrMouseDown);
    zr.on("mousemove", onZrMouseMove);
    zr.on("click", onZrClick);
    const activateLineBrush = () => chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } });
    const brushEnd = (event: any) => {
      const range = event?.areas?.[0]?.coordRange;
      if (Array.isArray(range)) {
        const next = chartTimeSelectionFromIndices(times, Math.round(range[0]), Math.round(range[1]));
        if (next) {
          chart.dispatchAction({ type: "dataZoom", startValue: next.startIndex, endValue: next.endIndex });
          if (selectionChangeRef.current) { selectionRef.current = next; selectionChangeRef.current(next); focus(next); }
        }
      }
      chart.dispatchAction({ type: "brush", areas: [] });
      activateLineBrush();
    };
    if (typeof onTimeSelectionChange === "function" || typeof pairViewportChangeRef.current === "function") {
      chart.on("brushEnd", brushEnd);
      activateLineBrush();
    }
    // Keep the visible zoom across unit switches so toggling %/USDT never
    // reframes the scenario.
    const onDataZoom = (event: any) => {
      const zoom = event?.batch?.[0] ?? event;
      const optionZoom = (chart.getOption().dataZoom as any[] | undefined)?.[0] ?? {};
      const startValue = Number(zoom?.startValue ?? optionZoom.startValue);
      const endValue = Number(zoom?.endValue ?? optionZoom.endValue);
      const startPercent = Number(zoom?.start ?? optionZoom.start);
      const endPercent = Number(zoom?.end ?? optionZoom.end);
      const start = Number.isFinite(startValue) ? Math.max(0, Math.min(times.length - 1, Math.round(startValue))) : Number.isFinite(startPercent) ? Math.round((startPercent / 100) * (times.length - 1)) : 0;
      const end = Number.isFinite(endValue) ? Math.max(start, Math.min(times.length - 1, Math.round(endValue))) : Number.isFinite(endPercent) ? Math.max(start, Math.round((endPercent / 100) * (times.length - 1))) : times.length - 1;
      const previous = zoomRangeRef.current;
      if (previous?.startIndex === start && previous?.endIndex === end) return;
      zoomRangeRef.current = { startIndex: start, endIndex: end };
      pairViewportChangeRef.current?.(start === 0 && end === times.length - 1 ? null : chartTimeSelectionFromIndices(times, start, end));
    };
    chart.on("dataZoom", onDataZoom);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(chartRef.current);
    return () => { observer.disconnect(); zr.off("mousedown", onZrMouseDown); zr.off("mousemove", onZrMouseMove); zr.off("click", onZrClick); if (typeof onTimeSelectionChange === "function" || typeof pairViewportChangeRef.current === "function") chart.off("brushEnd", brushEnd); chart.off("dataZoom", onDataZoom); if (applySelectionRef.current === focus) applySelectionRef.current = null; selectAtPixelRef.current = null; chart.dispose(); };
  }, [view, valueUnit, comparisonMode, showFirstRaw, showSecondRaw, pairTrade, pairTradeReason, pairTradeAnalysis, pairAnalysis, leg1Label, leg2Label, sourceResult, onTimeSelectionChange, timeZone]);

  const hasAnalysis = Boolean(pairAnalysis?.points.length);
  const analysisNotice = pairAnalysis === undefined ? "正在计算配对统计…" : pairAnalysis === null ? "配对统计暂不可用；等待对齐价格与回归结果。" : "没有可绘制的残差样本；请检查对齐数据量。";
  const isPlain = view === "plain";
  const isPairTrade = view === "pair-trade";
  const hasPairTrade = Boolean(pairTrade?.points.length);
  const rawPairTimes = isPairTrade ? alignedPairCloses(sourceResult).map((point) => point.closeTime) : [];
  const pairTradeNotice = !hasPairTrade
    ? pairTradeReason !== null && pairTradeReason !== undefined
      ? pairTradeUnavailableReason(pairTradeReason)
      : "配对交易情景不可用；等待对齐价格与 β。"
    : "没有可绘制的配对交易点。";
  const chartVisible = isPlain ? sourceResult.points.length > 0 : isPairTrade ? (hasPairTrade || rawPairTimes.length > 0) : hasAnalysis;
  const selectionTimes = isPlain
    ? sourceResult.points.map((point) => point.openTime)
    : isPairTrade
      ? (pairTrade?.points.map((point) => point.time) ?? rawPairTimes)
      : (pairAnalysis?.points.map((point) => point.time) ?? []);
  const viewLabel = isPlain ? `${leg1Label} 与 ${leg2Label} 的组合 K 线图` : isPairTrade ? `${leg1Label} 与 ${leg2Label} 的配对交易情景 PnL 图` : `${leg1Label} 与 ${leg2Label} 的配对回归残差与 Z-score 图表`;
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current; pointerRef.current = null;
    // Pair-trade clicks are handled by ZRender so blank grid cells select too.
    if (view === "pair-trade") return;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    selectAtPixelRef.current?.([event.clientX - rect.left, event.clientY - rect.top]);
  };
  return (
    <div>
      {chartVisible ? <div ref={chartRef} {...(typeof onTimeSelectionChange === "function" ? { tabIndex: 0, role: "region", "aria-label": viewLabel, "aria-describedby": "spot-combo-chart-instructions", onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => { chartRef.current?.focus({ preventScroll: true }); pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dragged: false }; }, onPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 5) pointer.dragged = true; }, onPointerUpCapture: selectPoint, onPointerCancelCapture: () => { pointerRef.current = null; }, onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const selected = moveChartTimeSelection(selectionTimes, selectionRef.current, event.key, event.shiftKey);
        if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); applySelectionRef.current?.(selected, true); }
      } } : {})} className={`w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 ${isPairTrade && (showFirstRaw || showSecondRaw) ? "h-[700px]" : "h-[520px]"}`} /> : <div className="flex h-[260px] items-center justify-center rounded border border-dashed border-gray-700 bg-gray-900/35 px-6 text-center text-sm text-gray-400" role="status" aria-live="polite">{isPlain ? "没有可绘制的组合蜡烛数据。" : isPairTrade ? pairTradeNotice : analysisNotice}</div>}
      <ChartSourceCaption legProvenance={sourceResult.legProvenance} />
      {isPairTrade && <p className="sr-only">在任一面板拖动即可缩放到所选时间范围；点击或用方向键只选择候选 K 线，不改变视图范围、入场或拟合。</p>}
      <p id="spot-combo-chart-instructions" className="sr-only">{isPlain ? `拖动选择精确 ${timeZone} 区间，点击 K 线选择时间；左右方向键移动，Shift 加方向键扩展区间。` : isPairTrade ? "点击或用方向键选择候选 K 线；点击设为入场点后才会改变入场。拖动区间仅选择光标 K 线作为候选，不会自动改变入场。入场前 PnL 留空。" : "拖动选择精确区间，点击数据点选择时间；左右方向键移动，Shift 加方向键扩展区间。"}</p>
      {isPairTrade && chartVisible && (
        <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="配对交易视图控制">
          <span className="text-xs text-gray-500">纵轴</span>
          <button type="button" aria-pressed={valueUnit === "percent"} onClick={() => setValueUnit("percent")} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${valueUnit === "percent" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>%（相对 $10,000）</button>
          <button type="button" aria-pressed={valueUnit === "usd"} onClick={() => setValueUnit("usd")} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${valueUnit === "usd" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>USDT</button>
          <span className="text-[11px] text-gray-500">USDT 显示绝对盈亏，不换算为百分比。</span>
          <span className="text-[11px] text-gray-500">拖动图表或使用缩放滑块/滚轮可更新可见范围诊断；点击与键盘仅选候选 K 线。</span>
          <button type="button" aria-pressed={comparisonMode === "ratio"} aria-label={`端点副图：当前为${comparisonMode === "ratio" ? "原始比值 K 线" : "原始价差 K 线"}，点击切换为${comparisonMode === "ratio" ? "原始价差 K 线" : "原始比值 K 线"}`} onClick={() => setComparisonMode((mode) => mode === "ratio" ? "spread" : "ratio")} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${comparisonMode === "ratio" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>副图：{comparisonMode === "ratio" ? "原始比值" : "原始价差"}K线</button>
          <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showFirstRaw} onChange={(event) => setShowFirstRaw(event.target.checked)} />腿1原始K线</label>
          <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showSecondRaw} onChange={(event) => setShowSecondRaw(event.target.checked)} />腿2原始K线</label>
        </div>
      )}
      <>{isPlain && <p className="mt-2 text-xs text-violet-200/80">点击 K 线后可用方向键移动；Shift + 方向键扩展区间。</p>}<p aria-live="polite" className="mt-2 rounded border border-violet-500/20 bg-violet-950/20 px-3 py-1.5 text-xs text-violet-100">{timeSelection ? `精确 ${timeZone} 区间：${formatChartTimeSelection(timeSelection, timeZone)}` : `精确 ${timeZone} 区间：预设可见范围`}</p></>
      {isPairTrade && <p className="sr-only">在任一面板拖动即可缩放到所选时间范围；点击或用方向键只选择候选 K 线，不改变视图范围、入场或拟合。</p>}
      {isPlain ? (
        <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500">
          <p>主图：{sourceResult.mode === "spread" ? "腿1 − 腿2 的价差" : "腿1 ÷ 腿2 的比值"}，仅使用共同时间点。</p>
          {sourceResult.composition === "spot-spot" ? (
            <>
              <p>副图1：{leg1Label} 报价币成交额{turnoverNotes.leg1Estimated ? "（部分为基础币成交量 × 收盘价估算）" : "（官方）"}</p>
              <p>副图2：{leg2Label} 报价币成交额{turnoverNotes.leg2Estimated ? "（部分为基础币成交量 × 收盘价估算）" : "（官方）"}</p>
            </>
          ) : (
            <>
              <p>副图1：同一时间点 Spot 与 Perp 报价币成交额的较小值。</p>
              {showAllSymbol ? (
                <p>副图2：有符号年化 Perp 资金费率（结算点）；Perp 位于腿2时已按组合方向取反。圆点仅在数据含缺失结算时段时启用（连续数据仍为连续线），无样本时段留空、不插值。</p>
              ) : (
                <p>副图2：有符号年化 Perp 资金费率；Perp 位于腿2时已按组合方向取反。</p>
              )}
            </>
          )}
        </div>
      ) : isPairTrade ? (
        <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500">
          <p className="font-medium text-gray-400">配对交易情景视图</p>
          <p>{hasPairTrade && pairTrade ? `做多 腿1 $${pairTrade.firstNotionalUsd.toLocaleString("en-US")}、做空 腿2 β×$${pairTrade.firstNotionalUsd.toLocaleString("en-US")}（= $${pairTrade.secondNotionalUsd.toLocaleString("en-US")}，β=${finiteText(pairTrade.beta, 4)}），入场前点位留空，入场 K 线的收盘价作为基准，曲线入场点为 0。` : pairTradeNotice}</p>
          <p>情景展示区间与入场来自当前预设范围；自动 β 使用上方单独选定的拟合窗口，自定义 β 直接用于情景。拟合结束晚于入场时包含前视信息，不是回测；PnL 不含资金费率、手续费与滑点。</p>
          <p>副图由两腿原始开盘与收盘按{comparisonMode === "ratio" ? "比值（腿1 ÷ 腿2）" : "价差（腿1 − 腿2）"}生成，只画开盘与收盘，没有影线（不表示期间最高/最低）；任一条腿开盘或收盘缺失、无效时该点留空，不插值。</p>
          <p>“原始比值”与“原始价差”仅切换副图；两者都使用未经 β 加权的原始腿价格，不是组合数据。按钮文字显示当前在用的模式，点一下即可互换。</p>
          <p>此图中的精确区间只高亮曲线片段，不会改变入场或 β；下方当前残差/Z 与费率、流动性摘要会按精确区间筛选。</p>
        </div>
      ) : (
        <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500"><p className="font-medium text-gray-400">配对回归视图</p><p>上轨为对数价格回归残差 ε（零线）；下轨为 rolling Z-score（0、±1、±2）。缺失数据保留断点，不连接。</p><p>全预设范围一次拟合，历史残差包含全样本参数，不构成无前视交易回测。</p></div>
      )}
    </div>
  );
}
