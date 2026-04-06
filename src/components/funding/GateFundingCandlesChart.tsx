"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  formatAnnualizedRate,
  formatAxisIntervalLabel,
  formatFundingRate,
  formatIntervalLabel,
  formatPrice,
  toAnnualizedRate,
  type CandleSnapshotItem,
  type ChartInterval,
  type IntervalFundingRateItem,
} from "@/lib/gateio";

interface GateFundingCandlesChartProps {
  coin: string;
  interval: ChartInterval;
  candles: CandleSnapshotItem[];
  intervalFundingRates: IntervalFundingRateItem[];
  fundingIntervalSeconds?: number;  // 结算周期（秒）
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

export default function GateFundingCandlesChart({
  coin,
  interval,
  candles,
  intervalFundingRates,
  fundingIntervalSeconds = 28800,
}: GateFundingCandlesChartProps) {
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
          const candleItem = items.find((item) => item.seriesType === "candlestick");
          const fundingItem = items.find((item) => item.seriesType === "bar");

          const lines = [
            `<div style="font-weight:600;margin-bottom:6px;">${coin} ${items[0]?.axisValueLabel ?? ""}</div>`,
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
            lines.push(`折算年化费率: ${formatAnnualizedRate(fundingData.rawFundingRate, fundingIntervalSeconds)}`);
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
          axisLabel: {
            color: "#9CA3AF",
            interval: interval === "1h" ? 7 : interval === "4h" ? 5 : 4,
            lineHeight: interval === "1d" ? 16 : 14,
            margin: 10,
          },
          min: "dataMin",
          max: "dataMax",
        },
      ],
      yAxis: [
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
            formatter: (value: number) => `${value.toFixed(2)}%`,
          },
          min: (value: { min: number; max: number }) => {
            const bound = Math.max(Math.abs(value.min), Math.abs(value.max), 1);
            return -bound * 1.15;
          },
          max: (value: { min: number; max: number }) => {
            const bound = Math.max(Math.abs(value.min), Math.abs(value.max), 1);
            return bound * 1.15;
          },
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
          type: "bar",
          name: "年化预测费率",
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

    const observer = new ResizeObserver(() => {
      chart.resize();
    });

    observer.observe(chartRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [coin, interval, candles, intervalFundingRates]);

  return <div ref={chartRef} className="h-[440px] w-full" />;
}
