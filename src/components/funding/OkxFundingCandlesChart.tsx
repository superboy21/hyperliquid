"use client";

import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";

type ChartInterval = "1d" | "4h" | "1h";

interface OkxFundingCandlesChartProps {
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

export default function OkxFundingCandlesChart(props: OkxFundingCandlesChartProps) {
  return <BinanceFundingCandlesChart {...props} />;
}
