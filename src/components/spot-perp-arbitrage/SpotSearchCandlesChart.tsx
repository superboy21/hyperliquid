"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { SpotCandlePoint, SpotChartInterval } from "@/lib/spot-search-candles";

interface SpotSearchCandlesChartProps {
  exchange: string;
  symbol: string;
  interval: SpotChartInterval;
  candles: SpotCandlePoint[];
  showBaseVolume: boolean;
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

function formatTime(timestamp: number, interval: SpotChartInterval): string {
  const detailed = String(interval) === "1m" || String(interval) === "5m" || String(interval) === "1h" || String(interval) === "4h";
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(detailed ? { hour: "2-digit", minute: "2-digit" } : {}),
    hour12: false,
    timeZone: "UTC",
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
}: SpotSearchCandlesChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const categories = candles.map((candle) => formatTime(candleTime(candle), interval));
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
      const quoteTurnover = candleNumber(candle, "quoteVolume", "quoteTurnover", "turnover") || baseVolume * close;
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
        { type: "inside", xAxisIndex: [0, 1] },
        { type: "slider", xAxisIndex: [0, 1], bottom: 2, height: 15, borderColor: "#374151", fillerColor: "rgba(59,130,246,.12)" },
      ],
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
          type: "candlestick",
          name: "K线",
          data: candleSeries,
          itemStyle: { color: "#22c55e", color0: "#ef4444", borderColor: "#22c55e", borderColor0: "#ef4444" },
        },
        { type: "bar", name: subpanelLabel, xAxisIndex: 1, yAxisIndex: 1, data: volumeData, barMaxWidth: 12 },
      ],
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [candles, exchange, interval, showBaseVolume, symbol]);

  return <div ref={chartRef} className="h-[440px] w-full sm:h-[520px]" role="img" aria-label={`${exchange} ${symbol} 现货K线图`} />;
}
