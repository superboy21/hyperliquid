"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  type SearchChartInterval,
  type SearchCandlePoint,
  type FundingRatePoint,
} from "@/lib/search-candles";
import ChartSourceCaption from "@/components/ChartSourceCaption";
import { type ComboCandleResult, type ComboFundingLegObservation } from "@/lib/combo";
import { chartSelectionIndices, chartTimeSelectionFromIndices, formatChartTimeSelection, moveChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { type CombinationValueUnit, type CombinationViewMode } from "@/lib/combo-weighting";
import { chartIntlTimeZone, chartWeekday, chartYear, type ChartTimeZone } from "@/lib/chart-timezone";
import type { PairAnalysis } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { alignedPairChartSamples, alignedPairDerivedCandles } from "@/lib/spot-perp-arbitrage/pair-chart-data";
import { alignedPairCloses } from "@/lib/spot-perp-arbitrage/pair-adapter";
import { formatRawPriceAxis, pairTradeUnavailableReason, selectionFromPlotPixelX } from "@/components/spot-perp-arbitrage/CombinationWeightControls";

// ==================== Types ====================

interface Props {
  data: ComboCandleResult;
  /** One result from pair-statistics; the chart does not recalculate it. */
  pairAnalysis?: PairAnalysis | null;
  /**
   * The fit-window model behind the pair-trade beta. The pair-trade title only
   * shows a formula when this model's β matches the applied `pairTrade.beta`.
   */
  pairTradeAnalysis?: PairAnalysis | null;
  /**
   * The pair-trade scenario computed once by the controller from the same
   * aligned closes; null while unavailable or not applicable.
   */
  pairTrade?: PairTradeSeries | null;
  /** Honest reason copy when the scenario cannot be built (null when available). */
  pairTradeReason?: string | null;
  interval: SearchChartInterval;
  showVolume: boolean;
  onToggleVolume: () => void;
  timeSelection?: ChartTimeSelection | null;
  onTimeSelectionChange?: (selection: ChartTimeSelection | null) => void;
  onPairViewportChange?: (selection: ChartTimeSelection | null) => void;
  view: CombinationViewMode;
  timeZone: ChartTimeZone;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: { open: number; close: number; low: number; high: number };
}

/**
 * Funding lane datum: the derived difference (value = annualized % × 100,
 * null when the bucket is unavailable) plus each leg's interval-cumulative observation, or
 * null when that leg had no actual settlement in the bucket (including the
 * 4h/1h/5m chart-only temporary zero). Carried into the ECharts datum so the
 * tooltip can read per-leg metadata off the hovered point.
 */
interface FundingDatum {
  value: number | null;
  /** Difference of the legs' interval-cumulative settled returns. */
  rawRate: number;
  firstFunding: ComboFundingLegObservation | null;
  secondFunding: ComboFundingLegObservation | null;
}

// ==================== Constants ====================

const INTERVAL_LABELS: Record<SearchChartInterval, string> = {
  "1w": "周线",
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
  "5m": "5分钟线",
  "1m": "1分钟线",
};

const COMBO_BULL_COLOR = "#8b5cf6";
const COMBO_BEAR_COLOR = "#ef4444";

/**
 * Intraday intervals where funding settles sparsely inside each candle bucket
 * (e.g. one settlement per 8h within 4h/1h/5m buckets). Actual settlements are
 * drawn as visible points; buckets with sampleCount === 0 stay as gaps (no
 * fill, no interpolation, no joining across missing samples).
 */
const SETTLEMENT_POINT_INTERVALS: ReadonlySet<SearchChartInterval> = new Set(["4h", "1h", "5m"]);

/**
 * Genuinely sparse funding data: at least one actual settlement sample AND at
 * least one unavailable (sampleCount === 0) bucket. Dense/continuous data keeps
 * the plain line presentation even on intraday intervals.
 */
function isGenuinelySparseFunding(points: readonly FundingRatePoint[]): boolean {
  let hasActual = false;
  let hasGap = false;
  for (const point of points) {
    if (point.sampleCount === 0) {
      hasGap = true;
    } else {
      hasActual = true; // undefined or > 0 counts as an observed settlement
    }
    if (hasActual && hasGap) return true;
  }
  return hasActual && hasGap;
}

// ==================== Formatters ====================

function formatComboPrice(value: number, mode: "spread" | "ratio" | null): string {
  if (mode === "spread") {
    return `$${value.toFixed(2)}`;
  }
  // ratio
  if (value >= 10000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatChangePercent(open: number, close: number): string {
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return "N/A";
  const percent = ((close - open) / open) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

/**
 * One per-leg funding row: annualized (2 decimals) then interval cumulative (4 decimals), both
 * stored decimals multiplied by 100, positives prefixed with "+", true zero
 * without a plus. A null observation renders as no real settlement.
 */
function formatLegFundingRow(label: string, observation: ComboFundingLegObservation | null): string {
  if (observation === null) return `${label}: 无结算费率`;
  const annualized = observation.annualizedRate * 100;
  const raw = observation.rate * 100;
  const annualizedStr = `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  const rawStr = `${raw > 0 ? "+" : ""}${raw.toFixed(4)}%`;
  return `${label}: ${annualizedStr}（区间累计费率 ${rawStr}）`;
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(0);
  return value.toFixed(2);
}

function formatLabel(timestamp: number, interval: SearchChartInterval, timeZone: ChartTimeZone): string {
  if (interval === "1w" || interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: chartIntlTimeZone(timeZone),
    });
  }
  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: chartIntlTimeZone(timeZone),
    });
  }
  // 1h, 5m, 1m
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: chartIntlTimeZone(timeZone),
  });
}

function buildYearAwareCategories(candles: SearchCandlePoint[], interval: SearchChartInterval, timeZone: ChartTimeZone) {
  return candles.map((c, i) => {
    const base = formatLabel(c.openTime, interval, timeZone);
    const yy = String(chartYear(c.openTime, timeZone)).slice(2);

    if (interval === "1w" || interval === "1d") {
      return `${yy}/${base}`;
    }
    if (interval === "4h") {
      const prevYear = i > 0 ? chartYear(candles[i - 1].openTime, timeZone) : null;
      const currYear = chartYear(c.openTime, timeZone);
      return prevYear !== currYear ? `${yy}/${base}` : base;
    }
    return base.replace(" ", "\n");
  });
}

// ==================== Regression (OLS) view helpers ====================

function modelValue<T>(stat: unknown): T | null {
  if (stat && typeof stat === "object" && "value" in stat) return (stat as { value?: T | null }).value ?? null;
  return stat as T | null;
}
function modelDetails(analysis: PairAnalysis | null | undefined) {
  const model = modelValue<{ alpha?: number; beta?: number }>(analysis?.model);
  return { kind: "OLS", alpha: model?.alpha, beta: model?.beta };
}
/**
 * The pair-trade title may only claim a formula when the alpha and beta both
 * come from the model that actually produced the applied `pairTrade.beta`.
 * A mismatched model (min-variance, unit, or a stale full-preset fit) yields
 * null so the title keeps only its long/short description.
 */
function matchingTradeModel(analysis: PairAnalysis | null | undefined, appliedBeta: number | null | undefined) {
  if (typeof appliedBeta !== "number" || !Number.isFinite(appliedBeta)) return null;
  const model = modelValue<{ alpha?: number; beta?: number }>(analysis?.model);
  const alpha = model?.alpha;
  const beta = model?.beta;
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) return null;
  if (typeof beta !== "number" || !Number.isFinite(beta)) return null;
  const scale = Math.max(1, Math.abs(appliedBeta), Math.abs(beta));
  return Math.abs(appliedBeta - beta) <= 1e-9 * scale ? { alpha, beta } : null;
}
function numberText(value: number | null | undefined, digits = 4): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}
function timeLabel(time: number, interval: SearchChartInterval, timeZone: ChartTimeZone): string {
  return new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", ...(interval === "1d" || interval === "1w" ? {} : { hour: "2-digit", minute: "2-digit" }), hour12: false, timeZone: chartIntlTimeZone(timeZone) });
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

// ==================== Component ====================

export default function ComboSearchCandlesChart({
  data,
  pairAnalysis,
  pairTradeAnalysis = null,
  pairTrade = null,
  pairTradeReason = null,
  interval,
  showVolume,
  onToggleVolume,
  timeSelection = null,
  onTimeSelectionChange,
  onPairViewportChange,
  view,
  timeZone,
}: Props) {
  const [valueUnit, setValueUnit] = useState<CombinationValueUnit>("percent");
  const [showFirstRaw, setShowFirstRaw] = useState(false);
  const [showSecondRaw, setShowSecondRaw] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<"ratio" | "spread">("ratio");
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
    // pair-trade axis unit and comparison mode to their defaults.
    zoomRangeRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValueUnit("percent");
    setComparisonMode("ratio");
  }, [data]);
  useEffect(() => {
    // Plain, OLS, and pair-trade have independent viewport state at the
    // controller level. Never carry one view's preserved ECharts zoom into
    // another view; unit/subchart changes within the same view still preserve it.
    zoomRangeRef.current = null;
  }, [view]);

  // ---------- plain view: classic spread/ratio candlestick ----------
  useEffect(() => {
    if (view !== "plain" || !chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const { candles, fundingRates, mode, firstSymbol, firstExchange, secondSymbol, secondExchange } = data;
    const is1m = interval === "1m";
    const hasFunding = !is1m && fundingRates.length > 0;
    const showAllSymbol = hasFunding
      && SETTLEMENT_POINT_INTERVALS.has(interval)
      && isGenuinelySparseFunding(fundingRates);
    const fundingName = showAllSymbol ? "资金费率差(结算点)" : "资金费率差";

    const separator = mode === "spread" ? "-" : "/";
    const modeLabel = mode === "spread" ? "Spread" : "Ratio";
    const title = `${firstSymbol} (${firstExchange}) ${separator} ${secondSymbol} (${secondExchange}) [${modeLabel}]`;

    const categories = candles.map((c) => formatLabel(c.openTime, interval, timeZone));
    const axisCategories = buildYearAwareCategories(candles, interval, timeZone);

    const candleSeries: CandleDatum[] = candles.map((candle) => {
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);
      const sourceHigh = parseFloat(candle.high);
      const sourceLow = parseFloat(candle.low);
      const high = Number.isFinite(sourceHigh) ? sourceHigh : Math.max(open, close);
      const low = Number.isFinite(sourceLow) ? sourceLow : Math.min(open, close);
      return { value: [open, close, low, high], raw: { open, close, low, high } };
    });

    const subLabel = showVolume ? "较小成交量" : "较小成交额";
    const subData = candles.map((candle) => {
      const parsed = showVolume ? parseFloat(candle.volume) : Number(candle.quoteVolume);
      const val = Number.isFinite(parsed) ? parsed : null;
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);
      return {
        value: val,
        itemStyle: {
          color: close >= open
            ? `${COMBO_BULL_COLOR}80`
            : `${COMBO_BEAR_COLOR}80`,
        },
      };
    });

    // sampleCount === 0 marks a period with no funding samples: render a null gap
    // (no fake 0% difference line) while an observed zero still renders as 0%.
    const fundingData: FundingDatum[] = hasFunding
      ? fundingRates.map((f) => ({
          value: f.sampleCount === 0 ? null : f.annualizedRate * 100,
          rawRate: f.rate,
          firstFunding: f.firstFunding ?? null,
          secondFunding: f.secondFunding ?? null,
        }))
      : [];
    const temporaryZeroFundingData = fundingData.map((point) => (
      point.value !== null && ((point.firstFunding === null) !== (point.secondFunding === null))
        ? point.value
        : null
    ));
    const hasTemporaryZeroFunding = temporaryZeroFundingData.some((value) => value !== null);

    const axisInterval = candles.length > 200
      ? Math.floor(candles.length / 8)
      : candles.length > 100
        ? Math.floor(candles.length / 6)
        : Math.max(0, Math.floor(candles.length / 8));

    const legendData: any[] = [
      { name: INTERVAL_LABELS[interval] },
      { name: subLabel },
    ];
    if (hasFunding) {
      legendData.push({ name: fundingName });
      if (hasTemporaryZeroFunding) legendData.push({ name: "含临时0的费率差" });
    }

    const gridConfig = hasFunding
      ? [
          { left: 52, right: 18, top: 40, height: "44%" },
          { left: 52, right: 18, top: "60%", height: "16%" },
          { left: 52, right: 18, top: "78%", height: "18%" },
        ]
      : [
          { left: 52, right: 18, top: 40, height: "62%" },
          { left: 52, right: 18, top: "78%", height: "18%" },
        ];

    const axisPointerLink = hasFunding
      ? [{ xAxisIndex: [0, 1, 2] }]
      : [{ xAxisIndex: [0, 1] }];

    const tooltipFormatter = (params: any) => {
      const items = Array.isArray(params) ? params : [params];
      const candleItem = items.find((item: any) => item.seriesType === "candlestick");
      const volumeItem = items.find((item: any) => item.seriesType === "bar" && item.seriesName === subLabel);
      const fundingItem = hasFunding
        ? items.find((item: any) => item.seriesType === "line" && item.seriesName === fundingName)
        : null;

      const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const hoveredIndex = items[0]?.dataIndex ?? 0;
      const dayIndex = candles[hoveredIndex] ? chartWeekday(candles[hoveredIndex].openTime, timeZone) : -1;
      const dayOfWeek = dayIndex >= 0 ? dayNames[dayIndex] : "";

      const lines = [
        `<div style="font-weight:600;margin-bottom:6px;">${title} ${items[0]?.axisValueLabel ?? ""} ${dayOfWeek} · ${timeZone}</div>`,
      ];

      const cd = candleItem?.data as CandleDatum | undefined;
      if (cd?.raw) {
        lines.push(`开盘: ${formatComboPrice(cd.raw.open, mode)}`);
        lines.push(`收盘: ${formatComboPrice(cd.raw.close, mode)}`);
        lines.push(`涨跌幅: ${formatChangePercent(cd.raw.open, cd.raw.close)}`);
      }

      if (volumeItem) {
        const value = volumeItem.value == null ? Number.NaN : Number(volumeItem.value);
        lines.push(`${subLabel}: ${Number.isFinite(value) ? formatVolume(value) : "N/A"}`);
      }

      if (fundingItem && fundingItem.value != null) {
        const annualized = fundingItem.value as number;
        const rawRate = fundingItem.data?.rawRate as number | undefined;
        const annualizedStr = annualized >= 0 ? `+${annualized.toFixed(2)}%` : `${annualized.toFixed(2)}%`;
        const rawStr = rawRate !== undefined && Number.isFinite(rawRate)
          ? `${rawRate > 0 ? "+" : ""}${(rawRate * 100).toFixed(4)}%`
          : null;
        lines.push(`年化资金费率差: ${rawStr === null ? annualizedStr : `${annualizedStr}（区间累计费率 ${rawStr}）`}`);
        // Per-leg rows only when the derived difference is rendered (both
        // actual, or a one-sided chart-only zero) — never beneath 资金费率差: 无.
        const datum = fundingItem.data as FundingDatum | undefined;
        if ((datum?.firstFunding === null) !== (datum?.secondFunding === null)) lines.push("资金费率差：含临时0，仅图表显示");
        lines.push(formatLegFundingRow(`${firstExchange} ${firstSymbol}`, datum?.firstFunding ?? null));
        lines.push(formatLegFundingRow(`${secondExchange} ${secondSymbol}`, datum?.secondFunding ?? null));
      } else if (hasFunding) {
        // The line item may be omitted entirely from axis tooltip params when
        // the hovered funding point is null — the funding lane still exists.
        lines.push(`资金费率差: 无`);
      }

      return lines.join("<br/>");
    };

    const xAxisConfig = hasFunding
      ? [
          {
            type: "category",
            data: categories,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#4B5563" } },
            axisLabel: { color: "#9CA3AF", show: false },
            min: "dataMin",
            max: "dataMax",
          },
          {
            type: "category",
            gridIndex: 1,
            data: axisCategories,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#4B5563" } },
            axisLabel: { color: "#9CA3AF", show: false },
            min: "dataMin",
            max: "dataMax",
          },
          {
            type: "category",
            gridIndex: 2,
            data: axisCategories,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#4B5563" } },
            axisLabel: {
              color: "#9CA3AF",
              interval: axisInterval,
              lineHeight: interval === "1d" || interval === "1w" ? 16 : 14,
              margin: 22,
            },
            min: "dataMin",
            max: "dataMax",
          },
        ]
      : [
          {
            type: "category",
            data: categories,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#4B5563" } },
            axisLabel: { color: "#9CA3AF", show: false },
            min: "dataMin",
            max: "dataMax",
          },
          {
            type: "category",
            gridIndex: 1,
            data: axisCategories,
            boundaryGap: true,
            axisLine: { lineStyle: { color: "#4B5563" } },
            axisLabel: {
              color: "#9CA3AF",
              interval: axisInterval,
              lineHeight: 14,
              margin: 22,
            },
            min: "dataMin",
            max: "dataMax",
          },
        ];

    const yAxisConfig = hasFunding
      ? [
          {
            scale: true,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.35)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatComboPrice(value, mode),
            },
          },
          {
            gridIndex: 1,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.25)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatVolume(value),
            },
          },
          {
            gridIndex: 2,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.15)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => `${value.toFixed(1)}%`,
            },
          },
        ]
      : [
          {
            scale: true,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.35)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatComboPrice(value, mode),
            },
          },
          {
            gridIndex: 1,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.25)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatVolume(value),
            },
          },
        ];

    const seriesConfig: any[] = [
      {
        id: "exact-selection-candles",
        type: "candlestick",
        name: INTERVAL_LABELS[interval],
        data: candleSeries,
        itemStyle: {
          color: COMBO_BULL_COLOR,
          color0: COMBO_BEAR_COLOR,
          borderColor: COMBO_BULL_COLOR,
          borderColor0: COMBO_BEAR_COLOR,
        },
      },
      {
        type: "bar",
        name: subLabel,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: subData,
        barMaxWidth: 12,
      },
    ];

    if (hasFunding) {
      seriesConfig.push({
        type: "line",
        name: fundingName,
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: fundingData,
        smooth: false,
        connectNulls: false,
        // Genuinely sparse intraday data: render every actual settlement as a
        // visible point (showAllSymbol) so isolated observations surrounded by
        // sampleCount-0 gaps stay discoverable. Dense data and 1d/1w keep the
        // continuous line with no symbols.
        symbol: showAllSymbol ? "circle" : "none",
        ...(showAllSymbol
          ? {
              showSymbol: true,
              showAllSymbol: true,
              symbolSize: 6,
              itemStyle: {
                color: COMBO_BULL_COLOR,
                borderColor: "#0F172A",
                borderWidth: 1.5,
              },
            }
          : {}),
        lineStyle: {
          color: COMBO_BULL_COLOR,
          width: 1.5,
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${COMBO_BULL_COLOR}33` },
              { offset: 1, color: `${COMBO_BULL_COLOR}05` },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 0 }],
          lineStyle: { color: "#6B7280", type: "dashed", width: 1 },
          label: { show: false },
        },
      });
      if (hasTemporaryZeroFunding) {
        seriesConfig.push({
          type: "scatter",
          name: "含临时0的费率差",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: temporaryZeroFundingData,
          symbol: "diamond",
          symbolSize: 9,
          itemStyle: { color: "#fbbf24", borderColor: "#78350f", borderWidth: 1.5 },
          tooltip: { show: false },
          z: 5,
        });
      }
    }

    const openTimes = candles.map((candle) => candle.openTime);
    const preservedZoom = zoomRangeRef.current;
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      title: {
        text: title,
        left: 18,
        top: 8,
        textStyle: {
          color: "#E5E7EB",
          fontSize: 13,
          fontWeight: 600,
        },
      },
      legend: {
        data: legendData,
        top: 4,
        right: 18,
        textStyle: { color: "#9CA3AF", fontSize: 11 },
        itemWidth: 14,
        itemHeight: 10,
      },
      grid: gridConfig,
      axisPointer: {
        link: axisPointerLink,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        borderColor: "#374151",
        textStyle: { color: "#E5E7EB" },
        formatter: tooltipFormatter,
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: hasFunding ? [0, 1, 2] : [0, 1],
          moveOnMouseMove: false,
          ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}),
        },
        {
          type: "slider",
          xAxisIndex: hasFunding ? [0, 1, 2] : [0, 1],
          bottom: 28,
          height: 16,
          ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}),
        },
      ],
      ...(typeof onTimeSelectionChange === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, xAxisIndex: hasFunding ? [0, 1, 2] : [0, 1], brushLink: "all" } } : {}),
      xAxis: xAxisConfig,
      yAxis: yAxisConfig,
      series: seriesConfig,
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

    // Keep the visible zoom across re-renders/data changes; plain view never
    // triggers any recomputation.
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
    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      if (typeof onTimeSelectionChange === "function") chart.off("brushEnd", brushEnd);
      chart.off("dataZoom", onDataZoom);
      if (applySelectionRef.current === focus) applySelectionRef.current = null;
      selectAtPixelRef.current = null;
      chart.dispose();
    };
  }, [view, data, interval, showVolume, onTimeSelectionChange, timeZone]);

  // ---------- ols view: log-price regression residual + rolling Z ----------
  useEffect(() => {
    if (view !== "ols" || !chartRef.current || !pairAnalysis?.points.length) return;
    const chart = echarts.init(chartRef.current);
    const points = pairAnalysis.points;
    const labels = points.map((point) => timeLabel(point.time, interval, timeZone));
    const details = modelDetails(pairAnalysis);
    const formula = `ln(${data.firstSymbol}) = ${numberText(details.alpha, 6)} + ${numberText(details.beta, 6)} · ln(${data.secondSymbol})`;
    const title = `${data.firstSymbol} (${data.firstExchange}) ~ ${data.secondSymbol} (${data.secondExchange}) · ${details.kind} · ${formula}`;
    const residualData = points.map((point) => point.residual);
    const zData = points.map((point) => point.zScore);
    const times = points.map((point) => point.time);
    const tooltip = (params: any) => {
      const index = (Array.isArray(params) ? params[0] : params)?.dataIndex ?? 0;
      const point = points[index];
      if (!point) return "";
      return [`<strong>${title}</strong>`, `${timeLabel(point.time, interval, timeZone)} · ${timeZone}`, `残差 ε：${numberText(point.residual, 6)}`, `模型偏离：${numberText(point.modelDeviationPercent, 2)}%`, `Rolling Z：${numberText(point.zScore, 2)}`, `α：${numberText(details.alpha, 6)}`, `β：${numberText(details.beta, 6)}`].join("<br/>");
    };
    chart.setOption({
      animation: false, backgroundColor: "transparent",
      title: { text: title, left: 16, top: 6, textStyle: { color: "#e5e7eb", fontSize: 13, fontWeight: 600 } },
      legend: { data: ["对数价格回归残差 ε", "Rolling Z-score"], top: 5, right: 18, textStyle: { color: "#9ca3af", fontSize: 10 } },
      grid: [{ left: 58, right: 20, top: 42, height: "35%" }, { left: 58, right: 20, top: "57%", height: "31%" }],
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "rgba(17,24,39,.97)", borderColor: "#374151", textStyle: { color: "#e5e7eb", fontSize: 12 }, formatter: tooltip },
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1], moveOnMouseMove: false }, { type: "slider", xAxisIndex: [0, 1], bottom: 3, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)" }],
      ...(typeof onTimeSelectionChange === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, xAxisIndex: [0, 1], brushLink: "all" } } : {}),
      xAxis: [0, 1].map((gridIndex) => ({ type: "category", gridIndex, data: labels, boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: gridIndex ? { color: "#9ca3af", interval: Math.max(0, Math.floor(points.length / 8)), fontSize: 10, margin: 16 } : { show: false } })),
      yAxis: [
        { scale: true, position: "right", axisLine: { show: false }, axisLabel: { color: "#9ca3af", formatter: (value: number) => value.toFixed(3) }, splitLine: { lineStyle: { color: "rgba(75,85,99,.3)" } } },
        { gridIndex: 1, scale: true, position: "right", axisLine: { show: false }, axisLabel: { color: "#9ca3af", formatter: (value: number) => value.toFixed(1) }, splitLine: { lineStyle: { color: "rgba(75,85,99,.3)" } } },
      ],
      series: [
        { id: "exact-selection-residual", type: "line", name: "对数价格回归残差 ε", data: residualData, showSymbol: false, connectNulls: false, lineStyle: { color: "#a78bfa", width: 1.6 }, markLine: { silent: true, symbol: "none", label: { show: true, formatter: "ε = 0", color: "#9ca3af", fontSize: 10 }, data: [{ yAxis: 0, lineStyle: { color: "#64748b", type: "dashed" } }] } },
        { type: "line", name: "Rolling Z-score", xAxisIndex: 1, yAxisIndex: 1, data: zData, showSymbol: false, connectNulls: false, lineStyle: { color: "#22d3ee", width: 1.6 }, markLine: { silent: true, symbol: "none", label: { color: "#9ca3af", fontSize: 10 }, data: [0, 1, -1, 2, -2].map((value) => ({ yAxis: value, label: { formatter: value === 0 ? "0" : `${value > 0 ? "+" : ""}${value}σ` }, lineStyle: { color: value === 0 ? "#64748b" : Math.abs(value) === 2 ? "#f59e0b" : "#475569", type: "dashed" } })) } },
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
      const resolved = typeof value === "number" ? Math.round(value) : labels.indexOf(String(value));
      const index = Number.isFinite(resolved) && resolved >= 0 ? Math.max(0, Math.min(times.length - 1, resolved)) : 0;
      const selection = chartTimeSelectionFromIndices(times, index, index);
      if (selection) { selectionRef.current = selection; selectionChangeRef.current?.(selection); focus(selection, true); }
    };
    const brushEnd = (event: any) => { const range = event?.areas?.[0]?.coordRange; if (!Array.isArray(range)) return; const selected = chartTimeSelectionFromIndices(times, Math.round(range[0]), Math.round(range[1])); if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); focus(selected); } chart.dispatchAction({ type: "brush", areas: [] }); };
    if (typeof onTimeSelectionChange === "function") chart.on("brushEnd", brushEnd);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(chartRef.current);
    return () => { observer.disconnect(); if (typeof onTimeSelectionChange === "function") chart.off("brushEnd", brushEnd); if (applySelectionRef.current === focus) applySelectionRef.current = null; selectAtPixelRef.current = null; chart.dispose(); };
  }, [view, data.firstExchange, data.firstSymbol, data.secondExchange, data.secondSymbol, interval, onTimeSelectionChange, pairAnalysis, timeZone]);
  useEffect(() => { applySelectionRef.current?.(timeSelection); }, [timeSelection]);

  // ---------- pair-trade view: one zero-based chronological PnL line ----------
  useEffect(() => {
    if (view !== "pair-trade" || !chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const points = pairTrade?.points ?? alignedPairCloses(data).map((point) => ({ time: point.closeTime, pnlUsd: null, returnPercent: null }));
    if (points.length === 0) { chart.dispose(); return; }
    const labels = points.map((point) => timeLabel(point.time, interval, timeZone));
    const times = points.map((point) => point.time);
    const rawSamples = alignedPairChartSamples(data, times);
    const rawFirstData = rawSamples.map((sample) => sample.firstOhlc);
    const rawSecondData = rawSamples.map((sample) => sample.secondOhlc);
    // Endpoint-only composite candles: open/close derived from the two raw leg
    // endpoints, with low/high collapsed onto the body. The derived pane never
    // draws a wick that the raw legs do not actually support.
    const derivedCandles = alignedPairDerivedCandles(data, times, comparisonMode);
    const derivedPaneName = comparisonMode === "ratio" ? "原始比值（腿1/腿2）" : "原始价差（腿1−腿2）";
    const paneNames = ["配对交易 PnL", derivedPaneName, ...(showFirstRaw ? [`原始 ${data.firstSymbol}`] : []), ...(showSecondRaw ? [`原始 ${data.secondSymbol}`] : [])];
    const paneCount = paneNames.length;
    const grids = paneNames.map((_name, index) => ({ left: 62, right: 54, top: `${9 + index * (78 / paneCount)}%`, height: `${68 / paneCount}%` }));
    const axes = paneNames.map((_name, index) => index);
    const unitLabel = valueUnit === "usd" ? "USDT" : "%";
    let title = `${data.firstSymbol} (${data.firstExchange}) 多 / ${data.secondSymbol} (${data.secondExchange}) 空`;
    const tradeModel = pairTrade ? matchingTradeModel(pairTradeAnalysis, pairTrade.beta) : null;
    if (tradeModel) title += ` · ln(${data.firstSymbol}) = ${numberText(tradeModel.alpha, 6)} + ${numberText(tradeModel.beta, 6)} · ln(${data.secondSymbol})`;
    const pnlData = points.map((point) => pairTradeUnitValue(point, valueUnit));
    const preservedZoom = zoomRangeRef.current;
    const tooltip = (params: any) => {
      const index = (Array.isArray(params) ? params[0] : params)?.dataIndex ?? 0;
      const point = points[index];
      if (!point) return "";
      const sample = rawSamples[index];
      const derived = derivedCandles[index];
      const derivedLine = derived
        ? `${derivedPaneName}（端点）：开 ${formatRawPriceAxis(derived[0])} · 收 ${formatRawPriceAxis(derived[1])}`
        : `${derivedPaneName}：无数据`;
      const lines = [`<strong>${title}</strong>`, `${timeLabel(point.time, interval, timeZone)} · ${timeZone}`, derivedLine];
      // The raw close ratio only adds information in spread mode; in ratio mode
      // it would just repeat the derived close, so keep one authoritative mode.
      if (comparisonMode === "spread") {
        lines.push(`原始收盘价比值（腿1/腿2）：${sample?.ratio === null || sample?.ratio === undefined ? "无数据" : sample.ratio.toPrecision(7)}`);
      }
      for (const [label, ohlc] of [[data.firstSymbol, sample?.firstOhlc], [data.secondSymbol, sample?.secondOhlc]] as const) {
        if (ohlc) lines.push(`${label} 原始 OHLC：${ohlc.map((value) => numberText(value, 6)).join(" / ")}`);
        else lines.push(`${label} 原始 OHLC：无数据`);
      }
      if (!pairTrade) { lines.push(pairTradeUnavailableReason(pairTradeReason)); return lines.join("<br/>"); }
      if (point.pnlUsd === null || point.returnPercent === null) {
        lines.push("未入场（早于所选入场 K 线）", "入场前 PnL 留空，不按 0 计入。");
        return lines.join("<br/>");
      }
      const isEntry = index === pairTrade.entryIndex;
      lines.push(`情景 PnL：${signedUsd(point.pnlUsd)}（${signedPercentValue(point.returnPercent)}）`, `入场标记：${timeLabel(pairTrade.entryTime, interval, timeZone)} · 收盘价腿1 ${numberText(pairTrade.entryFirstClose, 6)} / 腿2 ${numberText(pairTrade.entrySecondClose, 6)}`, `腿位：多 腿1 $${pairTrade.firstNotionalUsd.toLocaleString("en-US")} · 空 腿2 β×$${pairTrade.firstNotionalUsd.toLocaleString("en-US")} = $${pairTrade.secondNotionalUsd.toLocaleString("en-US")}`, isEntry ? "入场点：曲线基准为 0" : "情景模拟，不含资金费率、手续费与滑点");
      return lines.join("<br/>");
    };
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      title: { text: title, left: 16, top: 6, textStyle: { color: "#e5e7eb", fontSize: 13, fontWeight: 600 } },
      legend: { data: paneNames, top: 5, right: 18, textStyle: { color: "#9ca3af", fontSize: 10 } },
      grid: grids,
      toolbox: { show: false },
      axisPointer: { link: [{ xAxisIndex: axes }] },
      tooltip: { trigger: "axis", axisPointer: { type: "cross" }, backgroundColor: "rgba(17,24,39,.97)", borderColor: "#374151", textStyle: { color: "#e5e7eb", fontSize: 12 }, formatter: tooltip },
      dataZoom: [
        { type: "inside", xAxisIndex: axes, moveOnMouseMove: false, ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
        { type: "slider", xAxisIndex: axes, bottom: 3, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)", ...(preservedZoom ? { startValue: preservedZoom.startIndex, endValue: preservedZoom.endIndex } : {}) },
      ],
      ...(typeof onTimeSelectionChange === "function" || typeof pairViewportChangeRef.current === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, brushThreshold: 6, xAxisIndex: axes, brushLink: "all" } } : {}),
      xAxis: axes.map((gridIndex) => ({ type: "category", gridIndex, data: points.map((_point, index) => index), boundaryGap: true, axisLine: { lineStyle: { color: "#4b5563" } }, axisLabel: { show: gridIndex === axes.length - 1, color: "#9ca3af", formatter: (value: number | string) => labels[Math.round(Number(value))] ?? "", interval: Math.max(0, Math.floor(points.length / 8)), fontSize: 10, margin: 16 } })),
      yAxis: axes.map((gridIndex) => ({
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
        name: paneNames[0],
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
      { type: "candlestick", name: paneNames[1], xAxisIndex: 1, yAxisIndex: 1, data: derivedCandles, itemStyle: { color: COMBO_BULL_COLOR, color0: COMBO_BEAR_COLOR, borderColor: COMBO_BULL_COLOR, borderColor0: COMBO_BEAR_COLOR } },
      ...(showFirstRaw ? [{ type: "candlestick", name: `原始 ${data.firstSymbol}`, xAxisIndex: showSecondRaw ? 2 : 2, yAxisIndex: 2, data: rawFirstData, itemStyle: { color: COMBO_BULL_COLOR, color0: COMBO_BEAR_COLOR, borderColor: COMBO_BULL_COLOR, borderColor0: COMBO_BEAR_COLOR } }] : []),
      ...(showSecondRaw ? [{ type: "candlestick", name: `原始 ${data.secondSymbol}`, xAxisIndex: showFirstRaw ? 3 : 2, yAxisIndex: showFirstRaw ? 3 : 2, data: rawSecondData, itemStyle: { color: COMBO_BULL_COLOR, color0: COMBO_BEAR_COLOR, borderColor: COMBO_BULL_COLOR, borderColor0: COMBO_BEAR_COLOR } }] : []),
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
      if (wasDragged || !Number.isFinite(x) || !Number.isFinite(y) || !axes.some((gridIndex) => chart.containPixel({ gridIndex }, [x, y]))) return;
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
        const selected = chartTimeSelectionFromIndices(times, Math.round(range[0]), Math.round(range[1]));
        if (selected) {
          chart.dispatchAction({ type: "dataZoom", startValue: selected.startIndex, endValue: selected.endIndex });
          if (selectionChangeRef.current) { selectionRef.current = selected; selectionChangeRef.current(selected); focus(selected); }
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
  }, [view, valueUnit, comparisonMode, showFirstRaw, showSecondRaw, pairTrade, pairTradeReason, pairTradeAnalysis, pairAnalysis, data, interval, onTimeSelectionChange, timeZone]);

  const hasAnalysis = Boolean(pairAnalysis?.points.length);
  const analysisNotice = pairAnalysis === undefined ? "正在计算配对统计…" : pairAnalysis === null ? "配对统计暂不可用；等待对齐价格与回归结果。" : "没有可绘制的残差样本；请检查对齐数据量。";
  const isPlain = view === "plain";
  const isPairTrade = view === "pair-trade";
  const hasPairTrade = Boolean(pairTrade?.points.length);
  const rawPairTimes = isPairTrade ? alignedPairCloses(data).map((point) => point.closeTime) : [];
  const pairTradeNotice = !hasPairTrade
    ? pairTradeReason !== null && pairTradeReason !== undefined
      ? pairTradeUnavailableReason(pairTradeReason)
      : "配对交易情景不可用；等待对齐价格与 β。"
    : "没有可绘制的配对交易点。";
  const chartVisible = isPlain ? data.candles.length > 0 : isPairTrade ? (hasPairTrade || rawPairTimes.length > 0) : hasAnalysis;
  const selectionTimes = isPlain
    ? data.candles.map((candle) => candle.openTime)
    : isPairTrade
      ? (pairTrade?.points.map((point) => point.time) ?? rawPairTimes)
      : (pairAnalysis?.points.map((point) => point.time) ?? []);
  const hasFunding = data.fundingRates.length > 0 && interval !== "1m";
  const isSparseFunding = hasFunding
    && SETTLEMENT_POINT_INTERVALS.has(interval)
    && isGenuinelySparseFunding(data.fundingRates);
  const { mode } = data;
  const viewLabel = isPlain ? "组合价差/比值 K 线图" : isPairTrade ? "配对交易情景 PnL 图" : "配对回归残差与 Z-score 图表";
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current; pointerRef.current = null;
    // Pair-trade clicks are handled by ZRender so blank grid cells select too.
    if (view === "pair-trade") return;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    selectAtPixelRef.current?.([event.clientX - rect.left, event.clientY - rect.top]);
  };
  return (
    <div className="relative">
      {chartVisible ? <div ref={chartRef} {...(typeof onTimeSelectionChange === "function" ? { tabIndex: 0, role: "region", "aria-label": viewLabel, "aria-describedby": "combo-chart-instructions", onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => { chartRef.current?.focus({ preventScroll: true }); pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dragged: false }; }, onPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 5) pointer.dragged = true; }, onPointerUpCapture: selectPoint, onPointerCancelCapture: () => { pointerRef.current = null; }, onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const selected = moveChartTimeSelection(selectionTimes, selectionRef.current, event.key, event.shiftKey);
        if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); applySelectionRef.current?.(selected, true); }
      } } : {})} className={`w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 ${isPairTrade && (showFirstRaw || showSecondRaw) ? "h-[700px]" : "h-[520px]"}`} /> : <div className="flex h-[260px] items-center justify-center rounded border border-dashed border-gray-700 bg-gray-900/35 px-6 text-center text-sm text-gray-400" role="status" aria-live="polite">{isPlain ? "没有可绘制的组合蜡烛数据。" : isPairTrade ? pairTradeNotice : analysisNotice}</div>}
      <ChartSourceCaption legProvenance={data.legProvenance} />
      <p id="combo-chart-instructions" className="sr-only">{isPlain ? `拖动选择精确 ${timeZone} 区间，点击 K 线选择时间；左右方向键移动，Shift 加方向键扩展区间。` : isPairTrade ? "在任一面板拖动即可缩放到所选时间范围；缩放滑块和内部缩放会刷新可见范围诊断。点击或用方向键只选择候选 K 线，不改变视图范围、入场或拟合。点击设为入场点后才会改变入场。入场前 PnL 留空。第二个面板为端点 K 线，可在腿1原始K线开关左侧的按钮切换比值与价差，均取两条腿的原始开收盘、不含影线。" : "拖动选择精确区间，点击数据点选择时间；左右方向键移动，Shift 加方向键扩展区间。"}</p>
      {isPairTrade && chartVisible && (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="配对交易图表控制">
          <span className="text-xs text-gray-500">纵轴</span>
          <button type="button" aria-pressed={valueUnit === "percent"} onClick={() => setValueUnit("percent")} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${valueUnit === "percent" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>%（相对 $10,000）</button>
          <button type="button" aria-pressed={valueUnit === "usd"} onClick={() => setValueUnit("usd")} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${valueUnit === "usd" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>USDT</button>
          <span className="text-[11px] text-gray-500">USDT 显示绝对盈亏，不换算为百分比。</span>
          <button type="button" aria-pressed={comparisonMode === "ratio"} aria-label={comparisonMode === "ratio" ? "当前为比值 K 线子图，点击切换为价差 K 线子图" : "当前为价差 K 线子图，点击切换为比值 K 线子图"} onClick={() => setComparisonMode((current) => (current === "ratio" ? "spread" : "ratio"))} className={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${comparisonMode === "ratio" ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>{comparisonMode === "ratio" ? "子图：比值K线" : "子图：价差K线"}</button>
          <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showFirstRaw} onChange={(event) => setShowFirstRaw(event.target.checked)} />腿1原始K线</label>
          <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showSecondRaw} onChange={(event) => setShowSecondRaw(event.target.checked)} />腿2原始K线</label>
        </div>
      )}
      {typeof onTimeSelectionChange === "function" && <>{isPlain && <p className="mt-2 text-xs text-violet-200/80">点击 K 线后可用方向键移动；Shift + 方向键扩展区间。</p>}<p aria-live="polite" className="mt-2 rounded border border-violet-500/20 bg-violet-950/20 px-3 py-1.5 text-xs text-violet-100">{timeSelection ? `精确 ${timeZone} 区间：${formatChartTimeSelection(timeSelection, timeZone)}` : `精确 ${timeZone} 区间：预设可见范围`}</p></>}
      {isPlain ? (
        <div className="mt-2 rounded bg-gray-900/50 px-4 py-2 text-xs text-gray-500">
          <p className="mb-1 font-medium text-gray-400">图表说明：</p>
          <p>• 主图：{mode === "spread" ? "价差 (first - second)" : "价比 (first / second)"}，仅显示开盘/收盘</p>
          <p>• 副图1：{showVolume ? "较小成交量" : "较小成交额"} = min(第一交易对, 第二交易对)</p>
          {hasFunding && !isSparseFunding && <p>• 副图2：资金费率差 = 第一交易对年化费率 - 第二交易对年化费率</p>}
          {hasFunding && isSparseFunding && (
            <p>• 副图2：资金费率差（结算点）＝ 第一交易对年化费率 − 第二交易对年化费率；圆点仅在数据含缺失结算时段时启用（连续数据仍为连续线），缺失时段留空</p>
          )}
          {data.fundingRates.some((point) => point.sampleCount !== 0 && ((point.firstFunding == null) !== (point.secondFunding == null))) && <p>• 黄色菱形：一条腿的显式 sampleCount=0 按临时 0 计算的费率差，仅用于图表展示，不计入历史资金费率平均值。</p>}
          <p>• 数据对齐：仅保留两个交易对共同存在的时间戳（交集）</p>
        </div>
      ) : isPairTrade ? (
        <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500">
          <p className="font-medium text-gray-400">配对交易情景视图</p>
          <p>{hasPairTrade && pairTrade ? `做多 腿1 $${pairTrade.firstNotionalUsd.toLocaleString("en-US")}、做空 腿2 β×$${pairTrade.firstNotionalUsd.toLocaleString("en-US")}（= $${pairTrade.secondNotionalUsd.toLocaleString("en-US")}，β=${numberText(pairTrade.beta, 4)}），入场前点位留空，入场 K 线的收盘价作为基准，曲线入场点为 0。` : pairTradeNotice}</p>
          <p>情景展示区间与入场来自当前预设范围；自动 β 使用上方单独选定的拟合窗口，自定义 β 直接用于情景。拟合结束晚于入场时包含前视信息，不是回测；PnL 不含资金费率、手续费与滑点。</p>
          <p>第二面板为端点 K 线：开盘/收盘由两条腿的原始开收盘直接推导（默认比值＝腿1开收/腿2开收，可切换为价差＝腿1开收−腿2开收），不取腿1或腿2的高低价，因此没有影线，实体即全部；任一条腿缺失或无效时该点留空。切换只改变此面板的绘制方式，不影响 PnL、入场与 β。</p>
          <p>此图中的精确区间只高亮曲线片段，不会改变入场或 β；下方当前残差/Z 与费率、流动性摘要会按精确区间筛选。</p>
        </div>
      ) : (
        <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500"><p className="font-medium text-gray-400">配对回归视图</p><p>上轨为对数价格回归残差 ε（零线）；下轨为 rolling Z-score（0、±1、±2）。缺失数据保留断点，不连接。</p><p>全预设范围一次拟合，历史残差包含全样本参数，不构成无前视交易回测。</p></div>
      )}
    </div>
  );
}
