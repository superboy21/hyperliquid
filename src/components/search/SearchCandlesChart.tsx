"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  type SearchChartInterval,
  type SearchCandlePoint,
  type FundingRatePoint,
} from "@/lib/search-candles";

// ==================== Types ====================

interface SearchCandlesChartProps {
  symbol: string;
  exchange: string;
  exchangeColor: string;
  interval: SearchChartInterval;
  candles: SearchCandlePoint[];
  fundingRates: FundingRatePoint[];
  showVolume: boolean;
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

const EXCHANGE_COLORS: Record<string, string> = {
  Hyperliquid: "#3B82F6",   // blue-500
  "Gate.io": "#06B6D4",     // cyan-500
  Binance: "#EAB308",       // yellow-500
  Lighter: "#A855F7",       // purple-500
  OKX: "#10B981",           // emerald-500
};

function formatPrice(value: number): string {
  if (value >= 10000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
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

/**
 * Build axis labels with year info:
 * - 1w, 1d: every label gets a 2-digit year prefix → "26/04-20" (always visible)
 * - 4h: year shown only at year boundaries → "26/04-20 08" at Jan, else "04-20 08"
 * - 1h, 5m: no year, just time split across lines
 */
function buildYearAwareCategories(candles: SearchCandlePoint[], interval: SearchChartInterval) {
  return candles.map((c, i) => {
    const base = formatLabel(c.openTime, interval); // "MM-DD" or "MM-DD HH"
    const yy = String(new Date(c.openTime).getUTCFullYear()).slice(2);

    if (interval === "1w" || interval === "1d") {
      // Always show year on 1w/1d so user can continuously read it
      return `${yy}/${base}`;
    }
    if (interval === "4h") {
      // Year only at boundary — concise for dense charts
      const prevYear = i > 0 ? new Date(candles[i - 1].openTime).getUTCFullYear() : null;
      const currYear = new Date(c.openTime).getUTCFullYear();
      return prevYear !== currYear ? `${yy}/${base}` : base;
    }
    // 1h, 5m, 1m: split date and time onto two lines
    return base.replace(" ", "\n");
  });
}

// ==================== Component ====================

export default function SearchCandlesChart({
  symbol,
  exchange,
  exchangeColor,
  interval,
  candles,
  fundingRates,
  showVolume,
}: SearchCandlesChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current);
    const themeColor = EXCHANGE_COLORS[exchange] || exchangeColor || "#3B82F6";
    const is1m = interval === "1m";

    const categories = candles.map((c) => formatLabel(c.openTime, interval));
    const axisCategories = buildYearAwareCategories(candles, interval);

    const candleSeries: CandleDatum[] = candles.map((candle) => {
      const open = Number(candle.open);
      const close = Number(candle.close);
      const low = Number(candle.low);
      const high = Number(candle.high);
      return { value: [open, close, low, high], raw: { open, close, low, high } };
    });

    const isTurnover = !showVolume;
    const subLabel = isTurnover ? "成交额" : "成交量";
    const subData = candles.map((candle) => {
      const val = isTurnover ? Number(candle.quoteVolume) : Number(candle.volume);
      const open = Number(candle.open);
      const close = Number(candle.close);
      return {
        value: val,
        itemStyle: {
          color: close >= open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
        },
      };
    });

    // Funding rate data (only for non-1m intervals)
    const fundingData = is1m
      ? []
      : fundingRates.map((f) => ({
          value: f.annualizedRate * 100,
          rawRate: f.rate,
        }));

    // Determine axis label interval based on data density
    const axisInterval = candles.length > 200
      ? Math.floor(candles.length / 8)
      : candles.length > 100
        ? Math.floor(candles.length / 6)
        : Math.max(0, Math.floor(candles.length / 8));

    // Build legend data
    const legendData: any[] = [
      { name: INTERVAL_LABELS[interval] },
      { name: subLabel },
    ];
    if (!is1m) {
      legendData.push({ name: "资金费率" });
    }

    // Build grid config
    const gridConfig = is1m
      ? [
          { left: 52, right: 18, top: 32, height: "62%" },
          { left: 52, right: 18, top: "78%", height: "18%" },
        ]
      : [
          { left: 52, right: 18, top: 32, height: "40%" },
          { left: 52, right: 18, top: "56%", height: "14%" },
          { left: 52, right: 18, top: "72%", height: "28%" },
        ];

    // Build axisPointer link
    const axisPointerLink = is1m
      ? [{ xAxisIndex: [0, 1] }]
      : [{ xAxisIndex: [0, 1, 2] }];

    // Build tooltip formatter
    const tooltipFormatter = (params: any) => {
      const items = Array.isArray(params) ? params : [params];
      const candleItem = items.find((item: any) => item.seriesType === "candlestick");
      const volumeItem = items.find((item: any) => item.seriesType === "bar" && item.seriesName === subLabel);
      const fundingItem = is1m
        ? null
        : items.find((item: any) => item.seriesType === "line");

      const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const hoveredIndex = items[0]?.dataIndex ?? 0;
      const dayOfWeek = candles[hoveredIndex] ? dayNames[new Date(candles[hoveredIndex].openTime).getUTCDay()] : "";

      const lines = [
        `<div style="font-weight:600;margin-bottom:6px;">${exchange} ${symbol} ${items[0]?.axisValueLabel ?? ""} ${dayOfWeek}</div>`,
      ];

      const cd = candleItem?.data as CandleDatum | undefined;
      if (cd?.raw) {
        lines.push(`开盘: ${formatPrice(cd.raw.open)}`);
        lines.push(`收盘: ${formatPrice(cd.raw.close)}`);
        lines.push(`最高: ${formatPrice(cd.raw.high)}`);
        lines.push(`最低: ${formatPrice(cd.raw.low)}`);
      }

      if (volumeItem) {
        lines.push(`${subLabel}: ${formatVolume(volumeItem.value)}`);
      }

      if (fundingItem) {
        const annualized = fundingItem.value as number;
        const rawRate = fundingItem.data?.rawRate as number | undefined;
        const annualizedStr = annualized >= 0 ? `+${annualized.toFixed(2)}%` : `${annualized.toFixed(2)}%`;
        const rawStr = rawRate !== undefined ? `${(rawRate * 100).toFixed(4)}%` : "N/A";
        lines.push(`年化资金费率: ${annualizedStr}`);
        lines.push(`原始小时费率: ${rawStr}`);
      }

      return lines.join("<br/>");
    };

    // Build xAxis config
    const xAxisConfig = is1m
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
            axisLabel: {
              color: "#9CA3AF",
              interval: axisInterval,
              lineHeight: 14,
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
        ];

    // Build yAxis config
    const yAxisConfig = is1m
      ? [
          {
            scale: true,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.35)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatPrice(value),
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
        ]
      : [
          {
            scale: true,
            position: "right",
            axisLine: { show: false },
            splitLine: { lineStyle: { color: "rgba(75, 85, 99, 0.35)" } },
            axisLabel: {
              color: "#9CA3AF",
              formatter: (value: number) => formatPrice(value),
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
        ];

    // Build series config
    const seriesConfig: any[] = [
      {
        type: "candlestick",
        name: INTERVAL_LABELS[interval],
        data: candleSeries,
        itemStyle: {
          color: "#22C55E",
          color0: "#EF4444",
          borderColor: "#22C55E",
          borderColor0: "#EF4444",
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

    if (!is1m) {
      seriesConfig.push({
        type: "line",
        name: "资金费率",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: fundingData,
        smooth: false,
        symbol: "none",
        lineStyle: {
          color: themeColor,
          width: 1.5,
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `${themeColor}33` },
              { offset: 1, color: `${themeColor}05` },
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
          xAxisIndex: is1m ? [0, 1] : [0, 1, 2],
        },
        {
          type: "slider",
          xAxisIndex: is1m ? [0, 1] : [0, 1, 2],
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
  }, [symbol, exchange, exchangeColor, interval, candles, fundingRates, showVolume]);

  const is1m = interval === "1m";

  return (
    <div className="relative">
      <div ref={chartRef} className="h-[520px] w-full" />
      {/* 图表说明注释 */}
      <div className="mt-2 px-4 py-2 text-xs text-gray-500 bg-gray-900/50 rounded">
        <p className="font-medium text-gray-400 mb-1">📊 图表说明：</p>
        <p>• 主图：K线图，显示开盘/收盘/最高/最低价格</p>
        <p>• 副图1：{showVolume ? "成交量" : "成交额"}（可切换）</p>
        {!is1m && <p>• 副图2：年化资金费率（%），0轴为参考线</p>}
        <p>• 1m间隔隐藏资金费率副图（资金费率按小时结算）</p>
      </div>
    </div>
  );
}