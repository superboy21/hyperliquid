"use client";

import { useCallback, useMemo } from "react";
import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";
import {
  computeAverageFundingRatesByInterval,
  fetchBinanceCanonicalDetail,
  fetchBinanceFundingMonitorRates,
  hydrateBinanceLatestSettlementRates,
  mapDetailToMetrics as mapBinanceDetailToMetrics,
} from "@/lib/adapters/binance";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
} from "@/components/funding/ExchangeFundingMonitor";

// ==================== Helpers ====================

function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

function formatAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  const annualized = rateNumber * settlementsPerDay * 365 * 100;
  const absRate = Math.abs(annualized);

  if (absRate >= 100) return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  if (absRate >= 10) return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;
  if (priceNumber >= 1000) return priceNumber.toFixed(2);
  if (priceNumber >= 1) return priceNumber.toFixed(4);
  return priceNumber.toFixed(6);
}

function formatVolume(volume: string | number): string {
  const volumeNumber = typeof volume === "string" ? parseFloat(volume) : volume;
  if (volumeNumber >= 1e9) return `${(volumeNumber / 1e9).toFixed(2)}B`;
  if (volumeNumber >= 1e6) return `${(volumeNumber / 1e6).toFixed(2)}M`;
  if (volumeNumber >= 1e3) return `${(volumeNumber / 1e3).toFixed(2)}K`;
  return volumeNumber.toFixed(2);
}

// ==================== Category Config ====================

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  Majors: { label: "Majors", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  Metals: { label: "Metals", borderColor: "border-yellow-500", bgColor: "bg-yellow-500", dotColor: "bg-yellow-300" },
  Energy: { label: "Energy", borderColor: "border-orange-500", bgColor: "bg-orange-500", dotColor: "bg-orange-400" },
  Stocks: { label: "Stocks", borderColor: "border-green-600", bgColor: "bg-green-600", dotColor: "bg-green-400" },
  "Other Crypto": { label: "Other Crypto", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// ==================== Chart Wrapper ====================

function BinanceChartWrapper({ selectedCoin, interval, candles, intervalFundingRates, fundingIntervalSeconds }: ChartComponentProps) {
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

// ==================== Main Component ====================

export default function BinanceFundingMonitor() {
  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
  ): Promise<void> => {
    const missingSymbols = targetSymbols.filter((symbol) => {
      const rate = rates.find((item) => item.symbol === symbol);
      return rate && !Number.isFinite(rate.lastSettlementRate);
    });

    const latestBySymbol = await hydrateBinanceLatestSettlementRates(missingSymbols);
    if (latestBySymbol.size === 0) {
      return;
    }

    updateRates((prev) =>
      prev.map((item) => {
        const latestSettledRate = latestBySymbol.get(item.symbol);
        return latestSettledRate !== undefined
          ? { ...item, lastSettlementRate: latestSettledRate }
          : item;
      }),
    );
  }, []);

  // Fetch rates with Binance-specific logic
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    return fetchBinanceFundingMonitorRates();
  }, []);

  // Fetch detail data
  const fetchDetailData = useCallback(
    async (symbol: string, interval: ChartInterval): Promise<DetailData> => {
      const detail = mapBinanceDetailToMetrics(await fetchBinanceCanonicalDetail(symbol, interval));
      if (detail.candles.length === 0) {
        return { candles: [], intervalFundingRates: [], hourlyFundingRates30d: [] };
      }

      const fundingHistory = detail.fundingHistory.filter(
        (item) => item.timestamp >= Date.now() - 30 * 24 * 60 * 60 * 1000,
      );
      const visibleCandles = interval === "1d" ? detail.candles : detail.candles.slice(Math.max(detail.candles.length - 30, 0));
      const aggregatedFundingRates = computeAverageFundingRatesByInterval(fundingHistory, interval as "1d" | "4h" | "1h");
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );
      const hourlyFundingRates = computeAverageFundingRatesByInterval(fundingHistory, "1h");

      return {
        candles: visibleCandles,
        intervalFundingRates: visibleFundingRates,
        hourlyFundingRates30d: hourlyFundingRates,
        latestSettlementRate: detail.lastSettlementRate,
      };
    },
    [],
  );

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "Binance",
      exchangeColor: "yellow",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) =>
        formatAnnualizedRate(rate, fundingIntervalSeconds),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: BinanceChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH",
      fetchRates,
      hydrateRates,
      hydrationPolicy: {
        initialCount: 50,
        enableScrollHydration: true,
        resetOnFilterChange: true,
      },
      fetchDetailData,
      renderExtraStatsCard: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">结算周期</p>
          <p className="text-2xl font-bold text-yellow-400">8h / 4h / 1h</p>
        </div>
      ),
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Binance 资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>Binance 永续合约采用 USDT 结算机制。</li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
            <li>主要合约每 8 小时结算一次，部分合约每 4 小时或 1 小时结算。</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
            <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
          </ul>
        </div>
      ),
    }),
    [fetchRates, fetchDetailData, hydrateRates],
  );

  return <ExchangeFundingMonitor config={config} />;
}
