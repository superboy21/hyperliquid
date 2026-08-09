"use client";

import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";
import type { ChartComponentProps } from "@/components/funding/ExchangeFundingMonitor";

/** Bybit uses the existing generic Binance-style funding/candlestick chart. */
export default function BybitFundingCandlesChart({
  selectedCoin,
  interval,
  candles,
  intervalFundingRates,
  fundingIntervalSeconds,
}: ChartComponentProps) {
  return (
    <BinanceFundingCandlesChart
      symbol={selectedCoin}
      interval={interval}
      candles={candles}
      intervalFundingRates={intervalFundingRates}
      fundingIntervalSeconds={fundingIntervalSeconds}
    />
  );
}
