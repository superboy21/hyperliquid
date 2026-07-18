"use client";

import { useCallback, useMemo } from "react";
import BitgetFundingCandlesChart from "@/components/funding/BitgetFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
  type HydrationPolicy,
} from "@/components/funding/ExchangeFundingMonitor";
import {
  computeBitgetFundingRatesByInterval,
  fetchBitgetCanonicalDetail,
  fetchBitgetCanonicalRates,
  fetchBitgetImpactSpread,
  fetchLatestBitgetSettlement,
  selectBitgetDetailCandles,
} from "@/lib/adapters/bitget";
import { formatAnnualizedRate, formatFundingRate, formatPrice, formatVolume } from "@/lib/types";

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-teal-600", bgColor: "bg-teal-600", dotColor: "bg-teal-400" },
  Crypto: { label: "Crypto", borderColor: "border-cyan-600", bgColor: "bg-cyan-600", dotColor: "bg-cyan-400" },
  "股票/指数": { label: "股票/指数", borderColor: "border-violet-600", bgColor: "bg-violet-600", dotColor: "bg-violet-400" },
  商品: { label: "商品", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
  其他: { label: "其他", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

function mapBitgetRate(row: Awaited<ReturnType<typeof fetchBitgetCanonicalRates>>[number]): ExchangeFundingRate {
  return {
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingRate: row.fundingRate,
    lastSettlementRate: Number.NaN,
    settlementHydrationKey: `bitget:${row.marketKey}`,
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

export default function BitgetFundingMonitor() {
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    return (await fetchBitgetCanonicalRates()).map(mapBitgetRate);
  }, []);

  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
    _hydrationKey: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const rateMap = new Map(rates.map((rate) => [rate.symbol, rate]));
    const latestByMarket = new Map<string, number>();

    // Intentionally sequential. The shared Bitget scheduler also enforces one
    // in-flight request and each helper issues exactly cursor=1&limit=1 once.
    for (const symbol of targetSymbols) {
      if (signal.aborted) return;
      const rate = rateMap.get(symbol);
      if (!rate?.rawSymbol || Number.isFinite(rate.lastSettlementRate)) continue;
      try {
        const latest = await fetchLatestBitgetSettlement(rate.rawSymbol, { signal });
        if (latest) latestByMarket.set(rate.marketKey ?? rate.rawSymbol, latest.fundingRate);
      } catch (error) {
        if (signal.aborted) return;
        console.warn(`Bitget settlement hydration failed for ${rate.rawSymbol}:`, error);
      }
    }

    if (!signal.aborted && latestByMarket.size > 0) {
      updateRates((prev) => prev.map((rate) => {
        const latest = latestByMarket.get(rate.marketKey ?? rate.rawSymbol ?? rate.symbol);
        return latest === undefined ? rate : { ...rate, lastSettlementRate: latest };
      }));
    }
  }, []);

  const fetchDetailData = useCallback(async (
    rate: ExchangeFundingRate,
    interval: ChartInterval,
    _rates: ExchangeFundingRate[],
    signal: AbortSignal,
  ): Promise<DetailData> => {
    if (!rate.rawSymbol) throw new Error(`Bitget raw symbol is missing for ${rate.symbol}`);
    const detail = await fetchBitgetCanonicalDetail({
      symbol: rate.symbol,
      rawSymbol: rate.rawSymbol,
      marketKey: rate.marketKey ?? rate.rawSymbol,
      fundingIntervalSeconds: rate.fundingInterval,
      bestBid: rate.bestBid,
      bestAsk: rate.bestAsk,
    }, interval, { signal });
    const visibleCandles = selectBitgetDetailCandles(detail.candles, interval);
    const intervalFundingRates = computeBitgetFundingRatesByInterval(detail.fundingHistory, interval)
      .filter((item) => visibleCandles.some((candle) => candle.openTime === item.bucketStartTime));

    return {
      candles: visibleCandles,
      intervalFundingRates,
      hourlyFundingRates30d: computeBitgetFundingRatesByInterval(detail.fundingHistory, "1h"),
      bidAskSpread: detail.bidAskSpread,
      latestSettlementRate: detail.lastSettlementRate,
    };
  }, []);

  const config: ExchangeFundingMonitorConfig = useMemo(() => ({
    exchangeName: "Bitget",
    exchangeColor: "teal",
    categoryConfig,
    defaultFilterType: "all",
    formatFundingRate,
    formatAnnualizedRate,
    formatPrice,
    formatVolume,
    ChartComponent: BitgetFundingCandlesChart,
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
    fetchImpactSpread: async (rate: ExchangeFundingRate, notional = 1000, signal?: AbortSignal) => {
      if (!rate.rawSymbol) throw new Error(`Bitget raw symbol is missing for ${rate.symbol}`);
      return fetchBitgetImpactSpread(rate.rawSymbol, notional, signal);
    },
    renderExtraStatsCard: () => (
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <p className="text-sm text-gray-400">结算周期</p>
        <p className="text-2xl font-bold text-teal-400">1h / 2h / 4h / 8h</p>
      </div>
    ),
    renderInfoSection: () => (
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">Bitget 资金费率说明</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
          <li>Bitget 页面展示在线 USDT 永续合约的官方市场数据。</li>
          <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
          <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
          <li>不同合约可能采用 1、2、4 或 8 小时结算周期。</li>
          <li>页面按各合约实际结算周期换算年化资金费率，便于横向比较。</li>
          <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
        </ul>
      </div>
    ),
  }), [fetchDetailData, fetchRates, hydrateRates]);

  return <ExchangeFundingMonitor config={config} />;
}
