"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  type SearchChartInterval,
  type SearchCandlePoint,
} from "@/lib/search-candles";
import { type ComboCandleResult } from "@/lib/combo";

// ==================== Types ====================

type ChartRange = "all" | "3y" | "1y" | "6m" | "1m" | "1d" | "4h";

interface Props {
  data: ComboCandleResult;
  interval: SearchChartInterval;
  timeRange: ChartRange;
  onTimeRangeChange: (range: ChartRange) => void;
  showVolume: boolean;
  onToggleVolume: () => void;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: { open: number; close: number; low: number; high: number };
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
}: Props) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const { candles, fundingRates, mode, firstSymbol, firstExchange, secondSymbol, secondExchange } = data;
    const is1m = interval === "1m";
    const hasFunding = !is1m && fundingRates.length > 0;

    const separator = mode === "spread" ? "-" : "/";
    const modeLabel = mode === "spread" ? "Spread" : "Ratio";
    const title = `${firstSymbol} (${firstExchange}) ${separator} ${secondSymbol} (${secondExchange}) [${modeLabel}]`;

    const categories = candles.map((c) => formatLabel(c.openTime, interval));
    const axisCategories = buildYearAwareCategories(candles, interval);

    const candleSeries: CandleDatum[] = candles.map((candle) => {
      const open = parseFloat(candle.open);
      const close = parseFloat(candle.close);
      const high = Math.max(open, close);
      const low = Math.min(open, close);
      return { value: [open, close, low, high], raw: { open, close, low, high } };
    });

    const subLabel = showVolume ? "较小成交量" : "较小成交额";
    const subData = candles.map((candle) => {
      const val = showVolume ? parseFloat(candle.volume) : parseFloat(candle.quoteVolume);
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

    const fundingData = hasFunding
      ? fundingRates.map((f) => ({
          value: f.annualizedRate * 100,
          rawRate: f.rate,
        }))
      : [];

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
      legendData.push({ name: "资金费率差" });
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
        ? items.find((item: any) => item.seriesType === "line")
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
        lines.push(`${modeLabel}: ${formatComboPrice(cd.raw.close, mode)}`);
        lines.push(`开盘: ${formatComboPrice(cd.raw.open, mode)}`);
        lines.push(`收盘: ${formatComboPrice(cd.raw.close, mode)}`);
      }

      if (volumeItem) {
        lines.push(`${subLabel}: ${formatVolume(volumeItem.value)}`);
      }

      if (fundingItem) {
        const annualized = fundingItem.value as number;
        const rawRate = fundingItem.data?.rawRate as number | undefined;
        const annualizedStr = annualized >= 0 ? `+${annualized.toFixed(2)}%` : `${annualized.toFixed(2)}%`;
        const rawStr = rawRate !== undefined ? `${(rawRate * 100).toFixed(4)}%` : "N/A";
        lines.push(`年化资金费率差: ${annualizedStr}`);
        lines.push(`原始小时费率差: ${rawStr}`);
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
        name: "资金费率差",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: fundingData,
        smooth: false,
        symbol: "none",
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
    }

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
        },
        {
          type: "slider",
          xAxisIndex: hasFunding ? [0, 1, 2] : [0, 1],
          bottom: 28,
          height: 16,
        },
      ],
      xAxis: xAxisConfig,
      yAxis: yAxisConfig,
      series: seriesConfig,
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [data, interval, showVolume]);

  const hasFunding = data.fundingRates.length > 0 && interval !== "1m";
  const { mode } = data;

  return (
    <div className="relative">
      <div ref={chartRef} className="h-[520px] w-full" />
      {/* 图表说明注释 */}
      <div className="mt-2 px-4 py-2 text-xs text-gray-500 bg-gray-900/50 rounded">
        <p className="font-medium text-gray-400 mb-1">📊 图表说明：</p>
        <p>• 主图：{mode === "spread" ? "价差 (first - second)" : "价比 (first / second)"}，仅显示开盘/收盘</p>
        <p>• 副图1：{showVolume ? "较小成交量" : "较小成交额"} = min(第一交易对, 第二交易对)</p>
        {hasFunding && <p>• 副图2：资金费率差 = 第一交易对年化费率 - 第二交易对年化费率</p>}
        <p>• 数据对齐：仅保留两个交易对共同存在的时间戳（交集）</p>
      </div>
    </div>
  );
}
