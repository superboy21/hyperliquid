"use client";

import { useCallback, useMemo } from "react";
import OkxFundingCandlesChart from "@/components/funding/OkxFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
} from "@/components/funding/ExchangeFundingMonitor";
import {
  computeOkxAverageFundingRatesByInterval,
  fetchOkxCanonicalDetail,
  fetchOkxFundingMonitorRates,
  hydrateOkxLatestSettlementRates,
  mapOkxDetailToMetrics,
} from "@/lib/adapters/okx";
import { formatAnnualizedRate, formatFundingRate, formatPrice, formatVolume } from "@/lib/types";

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-emerald-600", bgColor: "bg-emerald-600", dotColor: "bg-emerald-400" },
  Crypto: { label: "Crypto", borderColor: "border-sky-600", bgColor: "bg-sky-600", dotColor: "bg-sky-400" },
  "股票/指数": { label: "股票/指数", borderColor: "border-violet-600", bgColor: "bg-violet-600", dotColor: "bg-violet-400" },
  商品: { label: "商品", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
  外汇: { label: "外汇", borderColor: "border-cyan-600", bgColor: "bg-cyan-600", dotColor: "bg-cyan-400" },
  债券: { label: "债券", borderColor: "border-lime-600", bgColor: "bg-lime-600", dotColor: "bg-lime-600" },
  其他: { label: "其他", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

function OkxChartWrapper({ selectedCoin, interval, candles, intervalFundingRates, fundingIntervalSeconds }: ChartComponentProps) {
  return (
    <OkxFundingCandlesChart
      symbol={selectedCoin}
      interval={interval}
      candles={candles}
      intervalFundingRates={intervalFundingRates}
      fundingIntervalSeconds={fundingIntervalSeconds}
    />
  );
}

export default function OkxFundingMonitor() {
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    return fetchOkxFundingMonitorRates();
  }, []);

  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
  ): Promise<void> => {
    const missingSymbols = targetSymbols.filter((symbol) => {
      const rate = rates.find((item) => item.symbol === symbol);
      return rate && !Number.isFinite(rate.lastSettlementRate);
    });

    const latestBySymbol = await hydrateOkxLatestSettlementRates(missingSymbols);
    if (latestBySymbol.size === 0) {
      return;
    }

    updateRates((prev) =>
      prev.map((item) => {
        const latest = latestBySymbol.get(item.symbol);
        return latest !== undefined ? { ...item, lastSettlementRate: latest } : item;
      }),
    );
  }, []);

  const fetchDetailData = useCallback(async (
    symbol: string,
    interval: ChartInterval,
    rates: ExchangeFundingRate[],
  ): Promise<DetailData> => {
    const selectedRate = rates.find((rate) => rate.symbol === symbol);
    const rawSymbol = selectedRate?.settlementHydrationKey?.replace(/^okx:/, "") ?? `${symbol}-USDT-SWAP`;
    const detail = mapOkxDetailToMetrics(
      await fetchOkxCanonicalDetail(
        rawSymbol,
        interval as "1d" | "4h" | "1h",
        selectedRate?.fundingInterval,
      ),
    );
    const fundingHistory = detail.fundingHistory.filter((item) => item.timestamp >= Date.now() - 30 * 24 * 60 * 60 * 1000);
    const visibleCandles = detail.candles.slice(Math.max(detail.candles.length - 30, 0));
    const aggregatedFundingRates = computeOkxAverageFundingRatesByInterval(fundingHistory, interval as "1d" | "4h" | "1h");
    const visibleFundingRates = aggregatedFundingRates.filter((item) =>
      visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
    );
    const hourlyFundingRates = computeOkxAverageFundingRatesByInterval(fundingHistory, "1h");

    return {
      candles: visibleCandles,
      intervalFundingRates: visibleFundingRates,
      hourlyFundingRates30d: hourlyFundingRates,
      latestSettlementRate: detail.lastSettlementRate,
    };
  }, []);

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "OKX",
      exchangeColor: "emerald",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) =>
        formatAnnualizedRate(rate, fundingIntervalSeconds),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: OkxChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH、SOL",
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
          <p className="text-sm text-gray-400">OKX 永续合约</p>
          <p className="text-2xl font-bold text-emerald-400">USDT / USD</p>
        </div>
      ),
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">OKX 资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>OKX 永续合约页面当前使用 OKX 官方 API 获取 SWAP 市场数据。</li>
            <li>最新结算费率优先使用 OKX 官方 funding-rate 接口中的 settled 信息进行补充。</li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的资金费率，便于横向比较。</li>
            <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
          </ul>
        </div>
      ),
    }),
    [fetchDetailData, fetchRates, hydrateRates],
  );

  return <ExchangeFundingMonitor config={config} />;
}
