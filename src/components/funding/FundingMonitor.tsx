"use client";

import { useCallback, useMemo } from "react";
import FundingCandlesChart from "@/components/funding/FundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
  type HydrationPolicy,
} from "@/components/funding/ExchangeFundingMonitor";
import {
  formatAnnualizedRate,
  formatFundingRate,
  formatPrice,
  formatVolume,
  getAllFundingRatesWithHistory,
  getAverageFundingRatesByInterval,
  getCandleSnapshot,
  getFundingHistoryForDays,
  getLatestSettledFundingRate,
  type CandleSnapshotItem as HyperliquidCandle,
  type ChartInterval as HyperliquidChartInterval,
  type FundingRate,
  type IntervalFundingRateItem as HyperliquidIntervalRate,
} from "@/lib/hyperliquid";

// ==================== Helpers ====================

const isXyzHip3Coin = (coin: string) => coin.startsWith("xyz:");
const isVntlHip3Coin = (coin: string) => coin.startsWith("vntl:");
const isHip3Asset = (coin: string) => isXyzHip3Coin(coin) || isVntlHip3Coin(coin);

function getAssetCategory(coin: string): string {
  if (isXyzHip3Coin(coin)) return "xyzHip3";
  if (isVntlHip3Coin(coin)) return "vntlHip3";
  return "standard";
}

function mapToExchangeFundingRate(rate: FundingRate): ExchangeFundingRate {
  const markPrice = parseFloat(rate.markPrice);
  const prevDayPx = parseFloat(rate.prevDayPx);
  const change24h = prevDayPx > 0 ? ((markPrice - prevDayPx) / prevDayPx) * 100 : 0;
  const openInterest = parseFloat(rate.openInterest);
  const notionalValue = openInterest * markPrice;

  return {
    symbol: rate.coin,
    fundingRate: parseFloat(rate.fundingRate),
    lastSettlementRate: Number.NaN,
    markPrice,
    lastPrice: markPrice,
    change24h,
    quoteVolume: parseFloat(rate.dayVolume),
    openInterest,
    notionalValue,
    fundingInterval: 3600, // Hyperliquid uses 1h settlement
    assetCategory: getAssetCategory(rate.coin),
    bestBid: rate.bestBid ? parseFloat(rate.bestBid) : undefined,
    bestAsk: rate.bestAsk ? parseFloat(rate.bestAsk) : undefined,
  };
}

// ==================== Category Config ====================

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  standard: { label: "标准资产", borderColor: "border-cyan-600", bgColor: "bg-cyan-600", dotColor: "bg-cyan-400" },
  xyzHip3: { label: "Xyz-Hip3", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  vntlHip3: { label: "Vntl-Hip3", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
};

// ==================== Chart Wrapper ====================

function HyperliquidChartWrapper({ selectedCoin, interval, candles, intervalFundingRates }: ChartComponentProps) {
  // Map shared candles to Hyperliquid format
  const mappedCandles: HyperliquidCandle[] = candles.map((c) => ({
    ...c,
    coin: selectedCoin,
    interval,
    trades: 0,
  }));

  // Map shared interval rates to Hyperliquid format
  const mappedRates: HyperliquidIntervalRate[] = intervalFundingRates.map((r) => ({ ...r }));

  return (
    <FundingCandlesChart
      coin={selectedCoin}
      interval={interval as HyperliquidChartInterval}
      candles={mappedCandles}
      intervalFundingRates={mappedRates}
    />
  );
}

// ==================== Main Component ====================

export default function FundingMonitor() {
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    const rates = await getAllFundingRatesWithHistory();
    return rates.map(mapToExchangeFundingRate);
  }, []);

  const hydrateRates = useCallback(async (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
  ): Promise<void> => {
    const batchSize = 3;
    const rateMap = new Map(rates.map((rate) => [rate.symbol, rate]));
    const targetRates = targetSymbols
      .map((symbol) => rateMap.get(symbol))
      .filter((rate): rate is ExchangeFundingRate => Boolean(rate))
      .filter((rate) => !Number.isFinite(rate.lastSettlementRate));

    for (let i = 0; i < targetRates.length; i += batchSize) {
      const batch = targetRates.slice(i, Math.min(i + batchSize, targetRates.length));
      const updates = await Promise.all(
        batch.map(async (rate) => {
          const lastSettlementRate = await getLatestSettledFundingRate(rate.symbol);
          if (!Number.isFinite(lastSettlementRate)) {
            return null;
          }

          return {
            symbol: rate.symbol,
            lastSettlementRate,
          };
        }),
      );

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
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }, []);

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "Hyperliquid",
      exchangeColor: "blue",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number) => formatAnnualizedRate(rate),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: HyperliquidChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH、xyz:GOLD、vntl:OPENAI",
      fetchRates,
      hydrateRates,
      hydrationPolicy: {
        initialCount: 10,
        enableScrollHydration: false,
        resetOnFilterChange: true,
        onRowClickHydrate: (clickedSymbol: string, filteredRates: ExchangeFundingRate[]) => {
          const idx = filteredRates.findIndex((r) => r.symbol === clickedSymbol);
          if (idx === -1) return [];
          const start = Math.max(0, idx - 5);
          const end = Math.min(filteredRates.length, idx + 6);
          return filteredRates.slice(start, end).map((r) => r.symbol);
        },
      } satisfies HydrationPolicy,
      filterFn: (rate: ExchangeFundingRate, filterType: string) => {
        if (filterType === "xyzHip3") return rate.assetCategory === "xyzHip3";
        if (filterType === "vntlHip3") return rate.assetCategory === "vntlHip3";
        if (filterType === "standard") return rate.assetCategory === "standard";
        return true;
      },
      fetchDetailData: async (symbol: string, interval: ChartInterval): Promise<DetailData> => {
        const [candleData, fundingHistory] = await Promise.all([
          getCandleSnapshot(symbol, interval, 30),
          getFundingHistoryForDays(symbol, 30),
        ]);

        // Map Hyperliquid candles to shared type
        const mappedCandles = candleData.map((c: HyperliquidCandle) => ({
          openTime: c.openTime,
          closeTime: c.closeTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        const visibleCandles =
          interval === "1d" ? mappedCandles : mappedCandles.slice(Math.max(mappedCandles.length - 30, 0));

        const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory, interval);
        const visibleFundingRates = aggregatedFundingRates.filter((item) =>
          visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
        );
        const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory, "1h");

        return {
          candles: visibleCandles,
          intervalFundingRates: visibleFundingRates,
          hourlyFundingRates30d: hourlyFundingRates,
        };
      },
      renderExchangeBadge: (symbol: string) => (
        <>
          {isXyzHip3Coin(symbol) && (
            <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">Xyz-Hip3</span>
          )}
          {isVntlHip3Coin(symbol) && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">Vntl-Hip3</span>
          )}
        </>
      ),
      renderExtraStatsCard: (rates: ExchangeFundingRate[]) => {
        const hip3Count = rates.filter((r) => isHip3Asset(r.symbol)).length;
        return (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
            <p className="text-sm text-gray-400">HIP-3 资产</p>
            <p className="text-2xl font-bold text-purple-400">{hip3Count}</p>
          </div>
        );
      },
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>
              <strong className="text-gray-300">HIP-3 资产</strong>：Hyperliquid Improvement Proposal 3 支持的扩展资产，例如商品和股票指数等。
            </li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
            <li>右侧 7 天与 30 天统计会跟随当前图表周期切换，保持和副图一致的统计口径。</li>
          </ul>
        </div>
      ),
    }),
    [fetchRates, hydrateRates],
  );

  return <ExchangeFundingMonitor config={config} />;
}
