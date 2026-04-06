"use client";

import { useCallback, useMemo, useRef } from "react";
import GateFundingCandlesChart from "@/components/funding/GateFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
} from "@/components/funding/ExchangeFundingMonitor";
import {
  formatAnnualizedRate,
  formatFundingRate,
  formatPrice,
  formatVolume,
  getAllFundingRates,
  getAverageFundingRatesByInterval,
  getBatchFundingHistory,
  getCandleSnapshot,
  getFundingHistoryForDays,
  type CandleSnapshotItem as GateCandle,
  type FundingRate,
  type IntervalFundingRateItem as GateIntervalRate,
} from "@/lib/gateio";

// ==================== Helpers ====================

function mapToExchangeFundingRate(rate: FundingRate): ExchangeFundingRate {
  return {
    symbol: rate.coin,
    fundingRate: parseFloat(rate.fundingRateIndicative || rate.fundingRate),
    lastSettlementRate: Number.NaN,
    markPrice: parseFloat(rate.markPrice),
    lastPrice: parseFloat(rate.lastPrice),
    change24h: parseFloat(rate.change24h),
    quoteVolume: parseFloat(rate.dayVolume),
    openInterest: parseFloat(rate.openInterest),
    notionalValue: parseFloat(rate.notionalValue) || 0,
    fundingInterval: rate.fundingInterval || 28800,
    assetCategory: rate.assetCategory || "其他",
    bestBid: rate.bestBid ? parseFloat(rate.bestBid) : undefined,
    bestAsk: rate.bestAsk ? parseFloat(rate.bestAsk) : undefined,
  };
}

// ==================== Category Config ====================

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  Crypto: { label: "Crypto", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  "股票/指数": { label: "股票/指数", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
  "商品": { label: "商品", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  "其他": { label: "其他", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// ==================== Chart Wrapper ====================

function GateChartWrapper({ selectedCoin, interval, candles, intervalFundingRates, fundingIntervalSeconds }: ChartComponentProps) {
  // Map shared candles to Gate format
  const mappedCandles: GateCandle[] = candles.map((c) => ({ ...c }));

  // Map shared interval rates to Gate format
  const mappedRates: GateIntervalRate[] = intervalFundingRates.map((r) => ({ ...r }));

  return (
    <GateFundingCandlesChart
      coin={selectedCoin}
      interval={interval}
      candles={mappedCandles}
      intervalFundingRates={mappedRates}
      fundingIntervalSeconds={fundingIntervalSeconds}
    />
  );
}

// ==================== Main Component ====================

export default function GateFundingMonitor() {
  const detailCacheRef = useRef(new Map<string, DetailData>());

  const buildDetailData = useCallback(async (
    symbol: string,
    interval: ChartInterval,
    rates: ExchangeFundingRate[],
  ): Promise<DetailData> => {
    const cacheKey = `${symbol}:${interval}`;
    const cached = detailCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const selectedRate = rates.find((r) => r.symbol === symbol);
    const fundingIntervalSeconds = selectedRate?.fundingInterval || 28800;
    const [candleData, fundingHistory] = await Promise.all([
      getCandleSnapshot(symbol, interval, 30),
      getFundingHistoryForDays(symbol, 30, fundingIntervalSeconds),
    ]);

    const mappedCandles = candleData.map((c: GateCandle) => ({ ...c }));
    const visibleCandles = interval === "1d" ? mappedCandles : mappedCandles.slice(Math.max(mappedCandles.length - 30, 0));
    const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory, interval);
    const visibleFundingRates = aggregatedFundingRates.filter((item) =>
      visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
    );
    const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory, "1h");

    const detailData = {
      candles: visibleCandles,
      intervalFundingRates: visibleFundingRates,
      hourlyFundingRates30d: hourlyFundingRates,
    };

    detailCacheRef.current.set(cacheKey, detailData);
    return detailData;
  }, []);

  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    const rates = await getAllFundingRates();
    return rates.map(mapToExchangeFundingRate);
  }, []);

  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
    ): Promise<void> => {
    const batchSize = 10;
    const rateMap = new Map(rates.map((rate) => [rate.symbol, rate]));
    const targetRates = targetSymbols
      .map((symbol) => rateMap.get(symbol))
      .filter((rate): rate is ExchangeFundingRate => Boolean(rate))
      .filter((rate) => !Number.isFinite(rate.lastSettlementRate));

    for (let i = 0; i < targetRates.length; i += batchSize) {
      const batch = targetRates.slice(i, Math.min(i + batchSize, targetRates.length));
      const contractMap = new Map(batch.map((rate) => [`${rate.symbol}_USDT`, rate.symbol]));
      const batchHistory = await getBatchFundingHistory(Array.from(contractMap.keys()));
      const updates = Array.from(batchHistory.entries()).map(([contract, history]) => {
        const symbol = contractMap.get(contract);
        if (!symbol || history.length === 0) {
          return null;
        }

        return {
          symbol,
          lastSettlementRate: parseFloat(history[0].fundingRate),
        };
      });

      const validUpdates = updates.filter((item): item is { symbol: string; lastSettlementRate: number } => item !== null);

      if (validUpdates.length > 0) {
        updateRates((prev) =>
          prev.map((item) => {
            const update = validUpdates.find((entry) => entry.symbol === item.symbol);
            return update ? { ...item, lastSettlementRate: update.lastSettlementRate } : item;
          }),
        );
      }

      if (i + batchSize < targetRates.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }, []);

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "Gate.io",
      exchangeColor: "cyan",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) =>
        formatAnnualizedRate(rate, fundingIntervalSeconds),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: GateChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH、SOL",
      fetchRates,
      hydrateRates,
      fetchDetailData: buildDetailData,
      renderExtraStatsCard: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Gate.io 永续合约</p>
          <p className="text-2xl font-bold text-cyan-400">USDT</p>
        </div>
      ),
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Gate.io 资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>Gate.io 永续合约采用 USDT 结算机制。</li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
            <li>主要合约每 8 小时结算一次，部分合约每 4 小时结算。</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
            <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
          </ul>
        </div>
      ),
    }),
    [buildDetailData, fetchRates, hydrateRates],
  );

  return <ExchangeFundingMonitor config={config} />;
}
