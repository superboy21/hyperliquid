"use client";

import { useCallback, useMemo } from "react";
import BybitFundingCandlesChart from "@/components/funding/BybitFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
  type HydrationPolicy,
} from "@/components/funding/ExchangeFundingMonitor";
import {
  computeBybitFundingRatesByInterval,
  fetchBybitCanonicalDetail,
  fetchBybitCanonicalRates,
  fetchBybitImpactSpread,
  hydrateBybitLatestSettlementRates,
  selectBybitDetailCandles,
} from "@/lib/adapters/bybit";
import { type ImpactDepthMode, resolvePerpImpactDepth } from "@/lib/order-book-impact";
import { formatAnnualizedRate, formatFundingRate, formatPrice, formatVolume } from "@/lib/types";

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-orange-600", bgColor: "bg-orange-600", dotColor: "bg-orange-400" },
  Crypto: { label: "Crypto", borderColor: "border-indigo-600", bgColor: "bg-indigo-600", dotColor: "bg-indigo-400" },
};

function mapBybitRate(row: Awaited<ReturnType<typeof fetchBybitCanonicalRates>>[number]): ExchangeFundingRate {
  return {
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingRate: row.fundingRate,
    lastSettlementRate: Number.NaN,
    settlementHydrationKey: `bybit:${row.marketKey}`,
    markPrice: row.markPrice,
    lastPrice: row.lastPrice,
    change24h: row.change24h,
    quoteVolume: row.quoteVolume,
    openInterest: row.openInterest,
    notionalValue: row.notionalValue,
    fundingInterval: row.fundingIntervalSeconds,
    assetCategory: row.assetCategory,
    bestBid: row.bestBid ?? undefined,
    bestAsk: row.bestAsk ?? undefined,
  };
}

export default function BybitFundingMonitor() {
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    return (await fetchBybitCanonicalRates()).map(mapBybitRate);
  }, []);

  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
    _hydrationKey: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const missingRates = rates.filter((rate) =>
      targetSymbols.includes(rate.symbol)
      && typeof rate.rawSymbol === "string"
      && rate.rawSymbol.length > 0
      && !Number.isFinite(rate.lastSettlementRate),
    );
    if (missingRates.length === 0) return;

    try {
      // Bybit has no bulk funding-history endpoint, so the shared scheduler
      // admits up to two limit=1 requests concurrently with controlled spacing.
      const latestByRawSymbol = await hydrateBybitLatestSettlementRates(
        missingRates.map((rate) => rate.rawSymbol as string),
        signal,
      );
      if (signal.aborted || latestByRawSymbol.size === 0) return;

      updateRates((prev) => prev.map((rate) => {
        if (!rate.rawSymbol) return rate;
        const latest = latestByRawSymbol.get(rate.rawSymbol);
        return latest === undefined ? rate : { ...rate, lastSettlementRate: latest };
      }));
    } catch (error) {
      if (signal.aborted) return;
      console.warn("Bybit settlement hydration failed:", error);
    }
  }, []);

  const fetchDetailData = useCallback(async (
    rate: ExchangeFundingRate,
    interval: ChartInterval,
    _rates: ExchangeFundingRate[],
    signal: AbortSignal,
  ): Promise<DetailData> => {
    if (!rate.rawSymbol) throw new Error(`Bybit raw symbol is missing for ${rate.symbol}`);
    const detail = await fetchBybitCanonicalDetail({
      symbol: rate.symbol,
      rawSymbol: rate.rawSymbol,
      marketKey: rate.marketKey ?? rate.rawSymbol,
      fundingIntervalSeconds: rate.fundingInterval,
      bestBid: rate.bestBid,
      bestAsk: rate.bestAsk,
    }, interval, { signal });
    const visibleCandles = selectBybitDetailCandles(detail.candles, interval);
    const intervalFundingRates = computeBybitFundingRatesByInterval(detail.fundingHistory, interval)
      .filter((item) => visibleCandles.some((candle) => candle.openTime === item.bucketStartTime));

    return {
      candles: visibleCandles,
      intervalFundingRates,
      hourlyFundingRates30d: computeBybitFundingRatesByInterval(detail.fundingHistory, "1h"),
      bidAskSpread: detail.bidAskSpread,
      latestSettlementRate: detail.lastSettlementRate,
    };
  }, []);

  const config: ExchangeFundingMonitorConfig = useMemo(() => ({
    exchangeName: "Bybit",
    exchangeColor: "orange",
    categoryConfig,
    defaultFilterType: "all",
    formatFundingRate,
    formatAnnualizedRate,
    formatPrice,
    formatVolume,
    ChartComponent: BybitFundingCandlesChart,
    searchPlaceholder: "搜索交易对，例如 BTC、ETH、SOL",
    fetchRates,
    hydrateRates,
    hydrationPolicy: {
      initialCount: 8,
      initialTargetStrategy: "selected-and-visible",
      initialHydrationCap: 8,
      neighborRadius: 3,
      enableScrollHydration: true,
      resetOnFilterChange: true,
      deferSelectedSettlementToDetail: false,
      boundTargetsToCurrentBatch: true,
    } satisfies HydrationPolicy,
    fetchDetailData,
    fetchImpactSpread: async (rate: ExchangeFundingRate, notional = 1000, signal?: AbortSignal, depthMode?: ImpactDepthMode) => {
      if (!rate.rawSymbol) throw new Error(`Bybit raw symbol is missing for ${rate.symbol}`);
      // Bybit is now part of the shared impact-depth registry; it mirrors the
      // V5 orderbook policy (standard 100, max 500) resolved by the adapter.
      return fetchBybitImpactSpread(rate.rawSymbol, notional, signal, resolvePerpImpactDepth("Bybit", depthMode ?? "standard"));
    },
    renderExtraStatsCard: () => (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <p className="text-sm text-gray-400">结算周期</p>
        <p className="text-2xl font-bold text-orange-400">1h / 4h / 8h</p>
      </div>
    ),
    renderInfoSection: () => (
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">Bybit 资金费率说明</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
          <li>Bybit 页面展示在线 USDT 永续合约的官方市场数据。</li>
          <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
          <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
          <li>不同合约可能采用 1、4 或 8 小时结算周期。</li>
          <li>页面按各合约实际结算周期换算年化资金费率，便于横向比较。</li>
          <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
        </ul>
      </div>
    ),
  }), [fetchDetailData, fetchRates, hydrateRates]);

  return <ExchangeFundingMonitor config={config} />;
}
