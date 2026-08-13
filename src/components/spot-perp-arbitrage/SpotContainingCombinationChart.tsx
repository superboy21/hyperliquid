"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import {
  marketDisplaySymbol,
  type SpotContainingCombinationResult,
} from "@/lib/spot-perp-arbitrage";
import ChartSourceCaption from "@/components/ChartSourceCaption";
import { chartSelectionIndices, chartTimeSelectionFromIndices, formatChartTimeSelection, moveChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";

interface Props {
  result: SpotContainingCombinationResult;
  timeSelection?: ChartTimeSelection | null;
  onTimeSelectionChange?: (selection: ChartTimeSelection | null) => void;
}

interface TooltipItem {
  seriesName?: string;
  seriesType?: string;
  dataIndex?: number;
  axisValueLabel?: string;
  value?: unknown;
  data?: unknown;
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

function dateLabel(timestamp: number, interval: string): string {
  const detailed = interval === "4h" || interval === "1h" || interval === "5m" || interval === "1m";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(detailed ? { hour: "2-digit", minute: "2-digit" } : {}),
    hour12: false,
    timeZone: "UTC",
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

export default function SpotContainingCombinationChart({ result, timeSelection = null, onTimeSelectionChange }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const applySelectionRef = useRef<((selection: ChartTimeSelection | null, showTip?: boolean, zoomRange?: boolean) => void) | null>(null);
  const selectAtPixelRef = useRef<((point: [number, number]) => void) | null>(null);
  const pointerRef = useRef<{ pointerId: number; clientX: number; clientY: number; dragged: boolean } | null>(null);
  const selectionRef = useRef(timeSelection);
  const selectionChangeRef = useRef(onTimeSelectionChange);
  useEffect(() => { selectionRef.current = timeSelection; }, [timeSelection]);
  useEffect(() => { selectionChangeRef.current = onTimeSelectionChange; }, [onTimeSelectionChange]);
  const leg1Label = `${result.leg1.source.exchange} ${marketDisplaySymbol(result.leg1)}`;
  const leg2Label = `${result.leg2.source.exchange} ${marketDisplaySymbol(result.leg2)}`;
  const showAllSymbol =
    SETTLEMENT_POINT_INTERVALS.has(result.interval)
    && result.composition !== "spot-spot"
    && hasFundingGaps(result.points, result.funding);

  const turnoverNotes = useMemo(() => {
    const leg1Estimated = result.points.some((point) => point.leg1Turnover?.provenance === "estimated-base-close");
    const leg2Estimated = result.points.some((point) => point.leg2Turnover?.provenance === "estimated-base-close");
    return { leg1Estimated, leg2Estimated };
  }, [result.points]);

  useEffect(() => {
    if (!chartRef.current || result.points.length === 0) return;
    const chart = echarts.init(chartRef.current);
    const categories = result.points.map((point) => dateLabel(point.openTime, result.interval));
    const axisInterval = Math.max(0, Math.floor(result.points.length / 8));
    const candleData: CandleDatum[] = result.points.map((point) => ({
      value: [point.open, point.close, Math.min(point.open, point.close), Math.max(point.open, point.close)],
      raw: { open: point.open, close: point.close },
    }));
    const risingColors = result.points.map((point) => point.close >= point.open ? "rgba(139,92,246,.58)" : "rgba(239,68,68,.52)");

    const showAllSymbol =
      SETTLEMENT_POINT_INTERVALS.has(result.interval)
      && result.composition !== "spot-spot"
      && hasFundingGaps(result.points, result.funding);
    const firstSubLabel = result.composition === "spot-spot" ? "腿1报价币成交额" : "较小报价币成交额";
    const secondSubLabel = result.composition === "spot-spot"
      ? "腿2报价币成交额"
      : showAllSymbol
        ? "有符号年化资金费率(结算点)"
        : "有符号年化资金费率";
    const firstSubData = result.points.map((point, index) => ({
      value: result.composition === "spot-spot" ? point.leg1Turnover?.value ?? null : point.minimumTurnover,
      itemStyle: { color: risingColors[index] },
    }));
    // sampleCount === 0 marks a period with no funding samples: drop it so the
    // funding line renders a gap instead of a fake 0% (observed zeros still render).
    const fundingByTime = new Map(
      result.funding
        .filter((point) => point.sampleCount !== 0)
        .map((point) => [point.time, point.annualizedRate * 100]),
    );
    const secondSubData = result.composition === "spot-spot"
      ? result.points.map((point, index) => ({ value: point.leg2Turnover?.value ?? null, itemStyle: { color: risingColors[index] } }))
      : result.points.map((point) => fundingByTime.get(point.openTime) ?? null);

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
        escapeHtml(items[0]?.axisValueLabel ?? ""),
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
          : `${secondSubLabel}：${secondValue >= 0 ? "+" : ""}${secondValue.toFixed(2)}%`);
      } else if (result.composition !== "spot-spot") {
        // The funding line item may be omitted entirely from axis tooltip
        // params when its value is null — the funding lane still exists.
        lines.push(`${secondSubLabel}：无`);
      }
      if (result.composition === "spot-spot" && point) {
        if (point.leg1Turnover?.provenance === "estimated-base-close") lines.push("腿1成交额：估算");
        if (point.leg2Turnover?.provenance === "estimated-base-close") lines.push("腿2成交额：估算");
      }
      return lines.join("<br />");
    };

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
        { type: "inside", xAxisIndex: [0, 1, 2], moveOnMouseMove: false },
        { type: "slider", xAxisIndex: [0, 1, 2], bottom: 2, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)" },
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
              symbol: showAllSymbol ? "circle" : "none",
              ...(showAllSymbol
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
    const openTimes = result.points.map((point) => point.openTime);
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

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);
    return () => {
      resizeObserver.disconnect();
      if (typeof onTimeSelectionChange === "function") chart.off("brushEnd", brushEnd);
      if (applySelectionRef.current === focus) applySelectionRef.current = null;
      selectAtPixelRef.current = null;
      chart.dispose();
    };
  }, [leg1Label, leg2Label, result, onTimeSelectionChange]);

  useEffect(() => { applySelectionRef.current?.(timeSelection); }, [timeSelection]);

  return (
    <div>
      <div ref={chartRef} {...(typeof onTimeSelectionChange === "function" ? { tabIndex: 0, role: "region", "aria-label": `${leg1Label} and ${leg2Label} combination candlestick chart`, "aria-describedby": "spot-combo-chart-instructions", onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => { chartRef.current?.focus({ preventScroll: true }); pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dragged: false }; }, onPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 5) pointer.dragged = true; }, onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; pointerRef.current = null; if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged) return; const rect = chartRef.current?.getBoundingClientRect(); if (rect) selectAtPixelRef.current?.([event.clientX - rect.left, event.clientY - rect.top]); }, onPointerCancelCapture: () => { pointerRef.current = null; }, onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const times = result.points.map((point) => point.openTime);
        event.preventDefault();
        const selected = moveChartTimeSelection(times, selectionRef.current, event.key, event.shiftKey);
        if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); applySelectionRef.current?.(selected, true); }
      } } : {})} className="h-[520px] w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800" />
      <ChartSourceCaption legProvenance={result.legProvenance} />
      <p id="spot-combo-chart-instructions" className="sr-only">Drag to select an exact UTC range. Click a candle to select it. Left and right arrows move the candle; Shift plus arrows extends the range.</p>
      <p className="mt-2 text-xs text-violet-200/80">点击 K 线后可用方向键移动；Shift + 方向键扩展区间。</p>
      <p aria-live="polite" className="mt-2 rounded border border-violet-500/20 bg-violet-950/20 px-3 py-1.5 text-xs text-violet-100">{timeSelection ? `精确 UTC 区间：${formatChartTimeSelection(timeSelection)}` : "精确 UTC 区间：预设可见范围"}</p>
      <div className="mt-2 rounded bg-gray-900/60 px-4 py-2 text-xs leading-5 text-gray-500">
        <p>主图：{result.mode === "spread" ? "腿1 − 腿2 的价差" : "腿1 ÷ 腿2 的比值"}，仅使用共同时间点。</p>
        {result.composition === "spot-spot" ? (
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
    </div>
  );
}
