"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import {
  type SearchChartInterval,
  type SearchCandlePoint,
  type FundingRatePoint,
} from "@/lib/search-candles";
import ChartSourceCaption from "@/components/ChartSourceCaption";
import { type ComboCandleResult, type ComboFundingLegObservation } from "@/lib/combo";
import { chartSelectionIndices, chartTimeSelectionFromIndices, formatChartTimeSelection, moveChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { combineWeightedOhlc } from "@/lib/combo-weighting";
import { CombinationWeightControls, useCombinationWeighting } from "@/components/spot-perp-arbitrage/CombinationWeightControls";

// ==================== Types ====================

type ChartRange = "all" | "3y" | "1y" | "6m" | "1m" | "1d" | "4h";

interface Props {
  data: ComboCandleResult;
  interval: SearchChartInterval;
  timeRange: ChartRange;
  onTimeRangeChange: (range: ChartRange) => void;
  showVolume: boolean;
  onToggleVolume: () => void;
  timeSelection?: ChartTimeSelection | null;
  onTimeSelectionChange?: (selection: ChartTimeSelection | null) => void;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: { open: number; close: number; low: number; high: number };
}

/**
 * Funding lane datum: the derived difference (value = annualized % × 100,
 * null when the bucket is unavailable) plus each leg's raw observation, or
 * null when that leg had no actual settlement in the bucket (including the
 * 4h/1h/5m chart-only temporary zero). Carried into the ECharts datum so the
 * tooltip can read per-leg metadata off the hovered point.
 */
interface FundingDatum {
  value: number | null;
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
 * One per-leg funding row: annualized (2 decimals) then raw (4 decimals), both
 * stored decimals multiplied by 100, positives prefixed with "+", true zero
 * without a plus. A null observation renders as no real settlement.
 */
function formatLegFundingRow(label: string, observation: ComboFundingLegObservation | null): string {
  if (observation === null) return `${label}: 无结算费率`;
  const annualized = observation.annualizedRate * 100;
  const raw = observation.rate * 100;
  const annualizedStr = `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  const rawStr = `${raw > 0 ? "+" : ""}${raw.toFixed(4)}%`;
  return `${label}: ${annualizedStr}（${rawStr}）`;
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(0);
  return value.toFixed(2);
}

function formatLabel(timestamp: number, interval: SearchChartInterval): string {
  if (interval === "1w" || interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }
  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }
  // 1h, 5m, 1m
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function buildYearAwareCategories(candles: SearchCandlePoint[], interval: SearchChartInterval) {
  return candles.map((c, i) => {
    const base = formatLabel(c.openTime, interval);
    const yy = String(new Date(c.openTime).getUTCFullYear()).slice(2);

    if (interval === "1w" || interval === "1d") {
      return `${yy}/${base}`;
    }
    if (interval === "4h") {
      const prevYear = i > 0 ? new Date(candles[i - 1].openTime).getUTCFullYear() : null;
      const currYear = new Date(c.openTime).getUTCFullYear();
      return prevYear !== currYear ? `${yy}/${base}` : base;
    }
    return base.replace(" ", "\n");
  });
}

// ==================== Component ====================

export default function ComboSearchCandlesChart({
  data,
  interval,
  showVolume,
  onToggleVolume,
  timeSelection = null,
  onTimeSelectionChange,
}: Props) {
  const weighting = useCombinationWeighting(data.leg1Points, data.leg2Points);
  const weightedData = useMemo(() => {
    const combinationMode = data.mode;
    if (weighting.mode === "none" || !data.leg1Points || !data.leg2Points || !combinationMode) return data;
    const firstByTime = new Map(data.leg1Points.map((point) => [point.openTime, point]));
    const secondByTime = new Map(data.leg2Points.map((point) => [point.openTime, point]));
    return {
      ...data,
      candles: data.candles.map((candle) => {
        const first = firstByTime.get(candle.openTime);
        const second = secondByTime.get(candle.openTime);
        const combined = first && second ? combineWeightedOhlc(first, second, combinationMode, weighting.weights) : null;
        return combined ? { ...candle, open: String(combined.open), high: String(combined.high), low: String(combined.low), close: String(combined.close) } : candle;
      }),
    };
  }, [data, weighting.mode, weighting.weights]);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const applySelectionRef = useRef<((selection: ChartTimeSelection | null, showTip?: boolean, zoomRange?: boolean) => void) | null>(null);
  const selectAtPixelRef = useRef<((point: [number, number]) => void) | null>(null);
  const pointerRef = useRef<{ pointerId: number; clientX: number; clientY: number; dragged: boolean } | null>(null);
  const selectionRef = useRef(timeSelection);
  const selectionChangeRef = useRef(onTimeSelectionChange);
  const zoomRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
  const weightingModeRef = useRef(weighting.mode);
  const recomputeParityRef = useRef(weighting.recomputeParity);
  useEffect(() => {
    weightingModeRef.current = weighting.mode;
    recomputeParityRef.current = weighting.recomputeParity;
  }, [weighting.mode, weighting.recomputeParity]);
  useEffect(() => { selectionRef.current = timeSelection; }, [timeSelection]);
  useEffect(() => { selectionChangeRef.current = onTimeSelectionChange; }, [onTimeSelectionChange]);
  useEffect(() => { zoomRangeRef.current = null; }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const { candles, fundingRates, mode, firstSymbol, firstExchange, secondSymbol, secondExchange } = weightedData;
    const is1m = interval === "1m";
    const hasFunding = !is1m && fundingRates.length > 0;
    const showAllSymbol = hasFunding
      && SETTLEMENT_POINT_INTERVALS.has(interval)
      && isGenuinelySparseFunding(fundingRates);
    const fundingName = showAllSymbol ? "资金费率差(结算点)" : "资金费率差";

    const separator = mode === "spread" ? "-" : "/";
    const modeLabel = mode === "spread" ? "Spread" : "Ratio";
    const title = `${firstSymbol} (${firstExchange}) ${separator} ${secondSymbol} (${secondExchange}) [${modeLabel}]`;

    const categories = candles.map((c) => formatLabel(c.openTime, interval));
    const axisCategories = buildYearAwareCategories(candles, interval);

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
      const dayOfWeek = candles[hoveredIndex]
        ? dayNames[new Date(candles[hoveredIndex].openTime).getUTCDay()]
        : "";

      const lines = [
        `<div style="font-weight:600;margin-bottom:6px;">${title} ${items[0]?.axisValueLabel ?? ""} ${dayOfWeek}</div>`,
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
        lines.push(`年化资金费率差: ${rawStr === null ? annualizedStr : `${annualizedStr}（${rawStr}）`}`);
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
      if (weightingModeRef.current === "parity" && openTimes[start] !== undefined && openTimes[end] !== undefined) {
        recomputeParityRef.current(openTimes[start], openTimes[end]);
      }
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
  }, [weightedData, interval, showVolume, onTimeSelectionChange]);

  useEffect(() => { applySelectionRef.current?.(timeSelection); }, [timeSelection]);

  const hasFunding = data.fundingRates.length > 0 && interval !== "1m";
  const isSparseFunding = hasFunding
    && SETTLEMENT_POINT_INTERVALS.has(interval)
    && isGenuinelySparseFunding(data.fundingRates);
  const { mode } = data;
  return (
    <div className="relative">
      <CombinationWeightControls
        firstLabel={`${data.firstExchange} ${data.firstSymbol}`}
        secondLabel={`${data.secondExchange} ${data.secondSymbol}`}
        mode={weighting.mode}
        weights={weighting.weights}
        parity={weighting.parity}
        error={weighting.error}
        customOpen={weighting.customOpen}
        firstDraft={weighting.firstDraft}
        secondDraft={weighting.secondDraft}
        onToggleParity={() => {
          const zoom = zoomRangeRef.current;
          weighting.toggleParity(zoom ? data.candles[zoom.startIndex]?.openTime : undefined, zoom ? data.candles[zoom.endIndex]?.openTime : undefined);
        }}
        onToggleCustom={weighting.toggleCustom}
        onFirstDraftChange={weighting.setFirstDraft}
        onSecondDraftChange={weighting.setSecondDraft}
        onApplyCustom={weighting.applyCustom}
      />
      <div ref={chartRef} {...(typeof onTimeSelectionChange === "function" ? { tabIndex: 0, role: "region", "aria-label": "Perpetual combination candlestick chart", "aria-describedby": "combo-chart-instructions", onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => { chartRef.current?.focus({ preventScroll: true }); pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dragged: false }; }, onPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 5) pointer.dragged = true; }, onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; pointerRef.current = null; if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged) return; const rect = chartRef.current?.getBoundingClientRect(); if (rect) selectAtPixelRef.current?.([event.clientX - rect.left, event.clientY - rect.top]); }, onPointerCancelCapture: () => { pointerRef.current = null; }, onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const times = data.candles.map((candle) => candle.openTime);
        event.preventDefault();
        const selected = moveChartTimeSelection(times, selectionRef.current, event.key, event.shiftKey);
        if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); applySelectionRef.current?.(selected, true); }
      } } : {})} className="h-[520px] w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800" />
      <ChartSourceCaption legProvenance={data.legProvenance} />
      {typeof onTimeSelectionChange === "function" && <><p id="combo-chart-instructions" className="sr-only">Drag to select an exact UTC range. Click a candle to select it. Left and right arrows move the candle; Shift plus arrows extends the range.</p><p className="mt-2 text-xs text-violet-200/80">点击 K 线后可用方向键移动；Shift + 方向键扩展区间。</p><p aria-live="polite" className="mt-2 rounded border border-violet-500/20 bg-violet-950/20 px-3 py-1.5 text-xs text-violet-100">{timeSelection ? `精确 UTC 区间：${formatChartTimeSelection(timeSelection)}` : "精确 UTC 区间：预设可见范围"}</p></>}
      {/* 图表说明注释 */}
      <div className="mt-2 px-4 py-2 text-xs text-gray-500 bg-gray-900/50 rounded">
        <p className="font-medium text-gray-400 mb-1">📊 图表说明：</p>
        <p>• 主图：{mode === "spread" ? "价差 (first - second)" : "价比 (first / second)"}，仅显示开盘/收盘</p>
        <p>• 副图1：{showVolume ? "较小成交量" : "较小成交额"} = min(第一交易对, 第二交易对)</p>
        {hasFunding && !isSparseFunding && <p>• 副图2：资金费率差 = 第一交易对年化费率 - 第二交易对年化费率</p>}
        {hasFunding && isSparseFunding && (
          <p>• 副图2：资金费率差（结算点）＝ 第一交易对年化费率 − 第二交易对年化费率；圆点仅在数据含缺失结算时段时启用（连续数据仍为连续线），缺失时段留空</p>
        )}
        {data.fundingRates.some((point) => point.sampleCount !== 0 && ((point.firstFunding == null) !== (point.secondFunding == null))) && <p>• 黄色菱形：一条腿的显式 sampleCount=0 按临时 0 计算的费率差，仅用于图表展示，不计入历史资金费率平均值。</p>}
        <p>• 数据对齐：仅保留两个交易对共同存在的时间戳（交集）</p>
      </div>
    </div>
  );
}
