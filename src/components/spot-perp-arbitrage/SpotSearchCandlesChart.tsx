"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { SpotCandlePoint, SpotChartInterval } from "@/lib/spot-search-candles";
import type { CandleSourceProvenance } from "@/lib/candle-provenance";
import ChartSourceCaption from "@/components/ChartSourceCaption";
import { chartSelectionIndices, chartTimeSelectionFromIndices, formatChartTimeSelection, moveChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { chartIntlTimeZone, type ChartTimeZone } from "@/lib/chart-timezone";

interface SpotSearchCandlesChartProps {
  exchange: string;
  symbol: string;
  interval: SpotChartInterval;
  candles: SpotCandlePoint[];
  showBaseVolume: boolean;
  provenance?: CandleSourceProvenance;
  timeSelection?: ChartTimeSelection | null;
  onTimeSelectionChange?: (selection: ChartTimeSelection | null) => void;
  timeZone: ChartTimeZone;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: { open: number; close: number; low: number; high: number };
}

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord {
  return value as UnknownRecord;
}

function numberFrom(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function candleNumber(candle: SpotCandlePoint, ...keys: string[]): number {
  const record = recordOf(candle);
  for (const key of keys) {
    const value = numberFrom(record[key], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function candleTime(candle: SpotCandlePoint): number {
  return candleNumber(candle, "openTime", "time", "timestamp");
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 10_000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function formatTime(timestamp: number, interval: SpotChartInterval, timeZone: ChartTimeZone): string {
  const detailed = String(interval) === "1m" || String(interval) === "5m" || String(interval) === "1h" || String(interval) === "4h";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(detailed ? { hour: "2-digit", minute: "2-digit" } : {}),
    hour12: false,
    timeZone: chartIntlTimeZone(timeZone),
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

export default function SpotSearchCandlesChart({
  exchange,
  symbol,
  interval,
  candles,
  showBaseVolume,
  provenance,
  timeSelection = null,
  onTimeSelectionChange,
  timeZone,
}: SpotSearchCandlesChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const applySelectionRef = useRef<((selection: ChartTimeSelection | null, showTip?: boolean, zoomRange?: boolean) => void) | null>(null);
  const selectAtPixelRef = useRef<((point: [number, number]) => void) | null>(null);
  const pointerRef = useRef<{ pointerId: number; clientX: number; clientY: number; dragged: boolean } | null>(null);
  const selectionRef = useRef(timeSelection);
  const selectionChangeRef = useRef(onTimeSelectionChange);
  useEffect(() => { selectionRef.current = timeSelection; }, [timeSelection]);
  useEffect(() => { selectionChangeRef.current = onTimeSelectionChange; }, [onTimeSelectionChange]);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const categories = candles.map((candle) => formatTime(candleTime(candle), interval, timeZone));
    const candleSeries: CandleDatum[] = candles.map((candle) => {
      const open = candleNumber(candle, "open");
      const close = candleNumber(candle, "close");
      const low = candleNumber(candle, "low");
      const high = candleNumber(candle, "high");
      return { value: [open, close, low, high], raw: { open, close, low, high } };
    });
    const volumeData = candles.map((candle) => {
      const open = candleNumber(candle, "open");
      const close = candleNumber(candle, "close");
      const baseVolume = candleNumber(candle, "volume", "baseVolume");
      const record = recordOf(candle);
      const official = ["quoteVolume", "quoteTurnover", "turnover"]
        .map((key) => numberFrom(record[key], Number.NaN))
        .find(Number.isFinite);
      const quoteTurnover = official === undefined ? baseVolume * close : official;
      return {
        value: showBaseVolume ? baseVolume : quoteTurnover,
        itemStyle: { color: close >= open ? "rgba(34,197,94,.5)" : "rgba(239,68,68,.5)" },
      };
    });
    const axisInterval = Math.max(0, Math.floor(candles.length / 7));
    const subpanelLabel = showBaseVolume ? "基础币成交量" : "报价币成交额";

    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: [
        { left: 58, right: 20, top: 18, height: "62%" },
        { left: 58, right: 20, top: "73%", height: "17%" },
      ],
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,24,39,.96)",
        borderColor: "#374151",
        textStyle: { color: "#e5e7eb", fontSize: 12 },
        formatter: (parameters: unknown) => {
          const items = (Array.isArray(parameters) ? parameters : [parameters]) as Array<UnknownRecord>;
          const candleItem = items.find((item) => item.seriesType === "candlestick");
          const volumeItem = items.find((item) => item.seriesType === "bar");
          const datum = candleItem?.data as CandleDatum | undefined;
          const lines = [`<strong>${escapeHtml(exchange)} ${escapeHtml(symbol)}</strong>`, escapeHtml(String(items[0]?.axisValueLabel ?? ""))];
          if (datum?.raw) {
            lines.push(`开盘：${formatPrice(datum.raw.open)}`);
            lines.push(`最高：${formatPrice(datum.raw.high)}`);
            lines.push(`最低：${formatPrice(datum.raw.low)}`);
            lines.push(`收盘：${formatPrice(datum.raw.close)}`);
          }
          const volume = numberFrom(volumeItem?.value, Number.NaN);
          if (Number.isFinite(volume)) lines.push(`${subpanelLabel}：${formatCompact(volume)}`);
          return lines.join("<br />");
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], moveOnMouseMove: false },
        { type: "slider", xAxisIndex: [0, 1], bottom: 2, height: 15, borderColor: "#374151", fillerColor: "rgba(59,130,246,.12)" },
      ],
      ...(typeof onTimeSelectionChange === "function" ? { brush: { brushType: "lineX", brushMode: "single", removeOnClick: false, xAxisIndex: [0, 1], brushLink: "all" } } : {}),
      xAxis: [
        {
          type: "category",
          data: categories,
          boundaryGap: true,
          axisLine: { lineStyle: { color: "#4b5563" } },
          axisLabel: { show: false },
          min: "dataMin",
          max: "dataMax",
        },
        {
          type: "category",
          gridIndex: 1,
          data: categories,
          boundaryGap: true,
          axisLine: { lineStyle: { color: "#4b5563" } },
          axisLabel: { color: "#9ca3af", interval: axisInterval, fontSize: 10, margin: 14 },
          min: "dataMin",
          max: "dataMax",
        },
      ],
      yAxis: [
        {
          scale: true,
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: "#9ca3af", formatter: formatPrice },
          splitLine: { lineStyle: { color: "rgba(75,85,99,.35)" } },
        },
        {
          gridIndex: 1,
          position: "right",
          axisLine: { show: false },
          axisLabel: { color: "#9ca3af", formatter: formatCompact },
          splitLine: { lineStyle: { color: "rgba(75,85,99,.22)" } },
        },
      ],
      series: [
        {
          id: "exact-selection-candles",
          type: "candlestick",
          name: "K线",
          data: candleSeries,
          itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" },
        },
        { type: "bar", name: subpanelLabel, xAxisIndex: 1, yAxisIndex: 1, data: volumeData, barMaxWidth: 12 },
      ],
    });
    const openTimes = candles.map(candleTime);
    const focus = (selection: ChartTimeSelection | null, showTip = false, zoomRange = false) => {
      if (!selection) { chart.setOption({ series: [{ id: "exact-selection-candles", markArea: { data: [] } }] }); if (openTimes.length > 0) chart.dispatchAction({ type: "dataZoom", startValue: 0, endValue: openTimes.length - 1 }); return; }
      const indices = chartSelectionIndices(openTimes, selection);
      if (!indices) return;
      if (zoomRange) chart.dispatchAction({ type: "dataZoom", startValue: indices.startIndex, endValue: indices.endIndex });
      chart.setOption({ series: [{ id: "exact-selection-candles", markArea: { silent: true, itemStyle: { color: "rgba(34,211,238,.09)" }, label: { show: false }, data: [[{ xAxis: indices.startIndex }, { xAxis: indices.endIndex }]] } }] });
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
  }, [candles, exchange, interval, showBaseVolume, symbol, onTimeSelectionChange, timeZone]);

  useEffect(() => { applySelectionRef.current?.(timeSelection); }, [timeSelection]);

  return <><div ref={chartRef} {...(typeof onTimeSelectionChange === "function" ? { tabIndex: 0, role: "region", "aria-label": `${exchange} ${symbol} spot candlestick chart`, "aria-describedby": "spot-chart-instructions", onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => { chartRef.current?.focus({ preventScroll: true }); pointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, dragged: false }; }, onPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; if (pointer?.pointerId === event.pointerId && Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 5) pointer.dragged = true; }, onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => { const pointer = pointerRef.current; pointerRef.current = null; if (!pointer || pointer.pointerId !== event.pointerId || pointer.dragged) return; const rect = chartRef.current?.getBoundingClientRect(); if (rect) selectAtPixelRef.current?.([event.clientX - rect.left, event.clientY - rect.top]); }, onPointerCancelCapture: () => { pointerRef.current = null; }, onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const times = candles.map(candleTime);
    event.preventDefault();
    const selected = moveChartTimeSelection(times, selectionRef.current, event.key, event.shiftKey);
    if (selected) { selectionRef.current = selected; selectionChangeRef.current?.(selected); applySelectionRef.current?.(selected, true); }
  } } : {})} className="h-[440px] w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800 sm:h-[520px]" /><ChartSourceCaption provenance={provenance} /><p id="spot-chart-instructions" className="sr-only">Drag to select an exact {timeZone} range. Click a candle to select it. Left and right arrows move the candle; Shift plus arrows extends the range.</p><p className="mt-2 text-xs text-cyan-200/80">点击 K 线后可用方向键移动；Shift + 方向键扩展区间。</p><p aria-live="polite" className="mt-2 rounded border border-cyan-500/20 bg-cyan-950/20 px-3 py-1.5 text-xs text-cyan-100">{timeSelection ? `精确 ${timeZone} 区间：${formatChartTimeSelection(timeSelection, timeZone)}` : `精确 ${timeZone} 区间：预设可见范围`}</p></>;
}
