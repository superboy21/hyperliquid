"use client";

import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";
import type { ChartComponentProps } from "@/components/funding/ExchangeFundingMonitor";

/** Bitget uses the existing generic Binance-style funding/candlestick chart. */
export default function BitgetFundingCandlesChart({
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
