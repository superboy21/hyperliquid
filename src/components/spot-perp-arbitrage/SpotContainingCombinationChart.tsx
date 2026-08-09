"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import {
  marketDisplaySymbol,
  type SpotContainingCombinationResult,
} from "@/lib/spot-perp-arbitrage";

interface Props {
  result: SpotContainingCombinationResult;
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

export default function SpotContainingCombinationChart({ result }: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const leg1Label = `${result.leg1.source.exchange} ${marketDisplaySymbol(result.leg1)}`;
  const leg2Label = `${result.leg2.source.exchange} ${marketDisplaySymbol(result.leg2)}`;

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

    const firstSubLabel = result.composition === "spot-spot" ? "腿1报价币成交额" : "较小报价币成交额";
    const secondSubLabel = result.composition === "spot-spot" ? "腿2报价币成交额" : "有符号年化资金费率";
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
      }
      const firstValue = numberValue(firstSub?.value);
      if (firstValue !== null) lines.push(`${firstSubLabel}：${compact(firstValue)}`);
      const secondValue = numberValue(secondSub?.value);
      if (secondValue !== null) {
        lines.push(result.composition === "spot-spot"
          ? `${secondSubLabel}：${compact(secondValue)}`
          : `${secondSubLabel}：${secondValue >= 0 ? "+" : ""}${secondValue.toFixed(2)}%`);
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
        { type: "inside", xAxisIndex: [0, 1, 2] },
        { type: "slider", xAxisIndex: [0, 1, 2], bottom: 2, height: 15, borderColor: "#374151", fillerColor: "rgba(139,92,246,.14)" },
      ],
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
              symbol: "none",
              connectNulls: false,
              lineStyle: { color: "#f59e0b", width: 1.5 },
              areaStyle: { color: "rgba(245,158,11,.08)" },
              markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], label: { show: false }, lineStyle: { color: "#6b7280", type: "dashed" } },
            },
      ],
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [leg1Label, leg2Label, result]);

  return (
    <div>
      <div ref={chartRef} className="h-[520px] w-full" role="img" aria-label={`${leg1Label} 与 ${leg2Label} 组合图`} />
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
            <p>副图2：有符号年化 Perp 资金费率；Perp 位于腿2时已按组合方向取反。</p>
          </>
        )}
      </div>
    </div>
  );
}
