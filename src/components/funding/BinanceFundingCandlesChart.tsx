"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type ChartInterval = "1d" | "4h" | "1h";

interface BinanceFundingCandlesChartProps {
  symbol: string;
  interval: ChartInterval;
  candles: {
    openTime: number;
    closeTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }[];
  intervalFundingRates: {
    bucketStartTime: number;
    averageFundingRate: number;
    sampleCount: number;
  }[];
  fundingIntervalSeconds?: number;
}

interface CandleDatum {
  value: [number, number, number, number];
  raw: {
    open: number;
    close: number;
    low: number;
    high: number;
  };
}

interface FundingDatum {
  value: number;
  rawFundingRate: number;
}

const intervalNameMap: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

const fundingNameMap: Record<ChartInterval, string> = {
  "1d": "当日平均资金费率",
  "4h": "4小时平均资金费率",
  "1h": "1小时资金费率",
};

// 格式化日期标签
function formatIntervalLabel(timestamp: number, interval: ChartInterval): string {
  const date = new Date(timestamp);
  
  if (interval === "1d") {
    return date.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

// 格式化坐标轴标签（带换行）
function formatAxisIntervalLabel(timestamp: number, interval: ChartInterval): string {
  const formatted = formatIntervalLabel(timestamp, interval);
  return interval !== "1d" ? formatted.replace(" ", "\n") : formatted;
}

// 格式化价格
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toFixed(2);
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  return price.toFixed(6);
}

// 格式化资金费率
function formatFundingRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

// 计算年化费率
function toAnnualizedRate(rate: number, fundingIntervalSeconds: number = 28800): number {
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  return rate * settlementsPerDay * 365 * 100;
}

// 格式化年化费率
function formatAnnualizedRate(rate: number, fundingIntervalSeconds: number = 28800): string {
  const annualized = toAnnualizedRate(rate, fundingIntervalSeconds);
  const absRate = Math.abs(annualized);

  if (absRate >= 100) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  }

  if (absRate >= 10) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  }

  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

export default function BinanceFundingCandlesChart({
  symbol,
  interval,
  candles,
  intervalFundingRates,
  fundingIntervalSeconds = 28800,
}: BinanceFundingCandlesChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const chart = echarts.init(chartRef.current);
    const fundingByBucket = new Map(
      intervalFundingRates.map((item) => [item.bucketStartTime, item.averageFundingRate]),
    );

    const categories = candles.map((candle) => formatIntervalLabel(candle.openTime, interval));
    const axisCategories = candles.map((candle) => formatAxisIntervalLabel(candle.openTime, interval));
    const candleSeries: CandleDatum[] = candles.map((candle) => {
      const open = Number(candle.open);
      const close = Number(candle.close);
      const low = Number(candle.low);
      const high = Number(candle.high);

      return {
        value: [open, close, low, high],
        raw: { open, close, low, high },
      };
    });

    const fundingSeries: FundingDatum[] = candles.map((candle) => {
      const rawFundingRate = fundingByBucket.get(candle.openTime) ?? 0;
      return {
        value: toAnnualizedRate(rawFundingRate, fundingIntervalSeconds),
        rawFundingRate,
      };
    });

    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: [
        { left: 52, right: 18, top: 20, height: "55%" },
        { left: 52, right: 18, top: "72%", height: "18%" },
      ],
      axisPointer: {
        link: [{ xAxisIndex: [0, 1] }],
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
        },
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        borderColor: "#374151",
        textStyle: {
          color: "#E5E7EB",
        },
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params];
          const candleItem = items.find((item: any) => item.seriesType === "candlestick");
          const fundingItem = items.find((item: any) => item.seriesType === "bar");

          const lines = [
            `<div style="font-weight:600;margin-bottom:6px;">${symbol} ${items[0]?.axisValueLabel ?? ""}</div>`,
          ];

          const candleData = candleItem?.data as CandleDatum | undefined;
          if (candleData?.raw) {
            lines.push(`开盘: ${formatPrice(candleData.raw.open)}`);
            lines.push(`收盘: ${formatPrice(candleData.raw.close)}`);
            lines.push(`最高: ${formatPrice(candleData.raw.high)}`);
            lines.push(`最低: ${formatPrice(candleData.raw.low)}`);
          }

          const fundingData = fundingItem?.data as FundingDatum | undefined;
          if (fundingData) {
            // 将结算周期费率转换为小时费率
            const hourlyRate = fundingData.rawFundingRate / (fundingIntervalSeconds / 3600);
            lines.push(`${fundingNameMap[interval]}: ${formatFundingRate(fundingData.rawFundingRate)}`);
            lines.push(`平均小时费率: ${formatFundingRate(hourlyRate)}`);
            lines.push(`折算年化预测费率: ${formatAnnualizedRate(fundingData.rawFundingRate, fundingIntervalSeconds)}`);
          }

          return lines.join("<br/>");
        },
      },
      xAxis: [
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
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: "#9CA3AF",
            fontSize: 10,
            interval: Math.max(0, Math.floor(axisCategories.length / 8)),
          },
          min: "dataMin",
          max: "dataMax",
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLine: { lineStyle: { color: "#4B5563" } },
          splitLine: { lineStyle: { color: "#1F2937" } },
          axisLabel: {
            color: "#9CA3AF",
            formatter: (value: number) => formatPrice(value),
          },
        },
        {
          scale: true,
          gridIndex: 1,
          axisLine: { lineStyle: { color: "#4B5563" } },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          type: "candlestick",
          name: intervalNameMap[interval],
          data: candleSeries,
          itemStyle: {
            color: "#22C55E",
            color0: "#EF4444",
            borderColor: "#22C55E",
            borderColor0: "#EF4444",
          },
        },
        {
          name: "资金费率",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: fundingSeries,
          barMaxWidth: 18,
          itemStyle: {
            color: (params: { data: FundingDatum }) =>
              params.data.rawFundingRate >= 0 ? "#22C55E" : "#EF4444",
          },
          markLine: {
            silent: true,
            symbol: "none",
            label: {
              show: false,
            },
            lineStyle: {
              color: "#6B7280",
              type: "solid",
            },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    });

    const handleResize = () => {
      chart.resize();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, [symbol, interval, candles, intervalFundingRates, fundingIntervalSeconds]);

  return <div ref={chartRef} style={{ width: "100%", height: 560 }} />;
}
