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
  fetchL2BookBestBidAsk,
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
import { fetchImpactSpread, type ImpactSpreadResult } from "@/lib/impact-price";

// ==================== Helpers ====================

const isXyzHip3Coin = (coin: string) => coin.startsWith("xyz:");
const isParaHip3Coin = (coin: string) => coin.startsWith("para:");
const isCashHip3Coin = (coin: string) => coin.startsWith("cash:");
const isHynaHip3Coin = (coin: string) => coin.startsWith("hyna:");
const isHip3Asset = (coin: string) => isXyzHip3Coin(coin) || isParaHip3Coin(coin) || isCashHip3Coin(coin) || isHynaHip3Coin(coin);

import { toDisplaySymbol, toApiSymbol } from "@/lib/symbol-mapping";

function getAssetCategory(coin: string): string {
  if (isXyzHip3Coin(coin)) return "xyzHip3";
  if (isParaHip3Coin(coin)) return "paraHip3";
  if (isCashHip3Coin(coin)) return "cashHip3";
  if (isHynaHip3Coin(coin)) return "hynaHip3";
  return "standard";
}

function mapToExchangeFundingRate(rate: FundingRate): ExchangeFundingRate {
  const markPrice = parseFloat(rate.markPrice);
  const prevDayPx = parseFloat(rate.prevDayPx);
  const change24h = prevDayPx > 0 ? ((markPrice - prevDayPx) / prevDayPx) * 100 : 0;
  const openInterest = parseFloat(rate.openInterest);
  const notionalValue = openInterest * markPrice;
  const displaySymbol = toDisplaySymbol(rate.coin);

  return {
    symbol: displaySymbol,
    fundingRate: parseFloat(rate.fundingRate),
    lastSettlementRate: Number.NaN,
    settlementHydrationKey: `hyperliquid:${displaySymbol}`,
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
  paraHip3: { label: "Para-Hip3", borderColor: "border-pink-600", bgColor: "bg-pink-600", dotColor: "bg-pink-400" },
  cashHip3: { label: "Cash-Hip3", borderColor: "border-orange-600", bgColor: "bg-orange-600", dotColor: "bg-orange-400" },
  hynaHip3: { label: "Hyna-Hip3", borderColor: "border-teal-600", bgColor: "bg-teal-600", dotColor: "bg-teal-400" },
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
          const apiSymbol = toApiSymbol(rate.symbol);
          const lastSettlementRate = await getLatestSettledFundingRate(apiSymbol);
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
      searchPlaceholder: "搜索交易对，例如 BTC、ETH、xyz:GOLD、para:BTC.D、cash:xxx",
      fetchRates,
      hydrateRates,
      hydrationPolicy: {
        initialCount: 7,
        initialTargetStrategy: "selected-and-visible",
        initialHydrationCap: 7,
        neighborRadius: 3,
        enableScrollHydration: false,
        resetOnFilterChange: true,
      } satisfies HydrationPolicy,
      filterFn: (rate: ExchangeFundingRate, filterType: string) => {
        if (filterType === "xyzHip3") return rate.assetCategory === "xyzHip3";
        if (filterType === "paraHip3") return rate.assetCategory === "paraHip3";
        if (filterType === "cashHip3") return rate.assetCategory === "cashHip3";
        if (filterType === "hynaHip3") return rate.assetCategory === "hynaHip3";
        if (filterType === "standard") return rate.assetCategory === "standard";
        return true;
      },
      fetchDetailData: async (symbol: string, interval: ChartInterval, rates: ExchangeFundingRate[]): Promise<DetailData> => {
        const apiSymbol = toApiSymbol(symbol);
        const [candleData, fundingHistory, l2Top] = await Promise.all([
          getCandleSnapshot(apiSymbol, interval, 30),
          getFundingHistoryForDays(apiSymbol, 30),
          fetchL2BookBestBidAsk(apiSymbol),
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
        const latestFundingEntry = fundingHistory[fundingHistory.length - 1];
        const latestSettlementRate = latestFundingEntry
          ? Number.parseFloat(latestFundingEntry.fundingRate ?? "")
          : Number.NaN;

        // Compute spread from impactPxs (fetched in initial rates load)
        let bidAskSpread: number | null = null;
        if (l2Top?.bestBid && l2Top?.bestAsk) {
          const midPrice = (l2Top.bestBid + l2Top.bestAsk) / 2;
          if (midPrice > 0) {
            bidAskSpread = ((l2Top.bestAsk - l2Top.bestBid) / midPrice) * 100;
          }
        } else {
          const currentRate = rates.find((r) => r.symbol === symbol);
          if (currentRate?.bestBid && currentRate?.bestAsk) {
            const midPrice = (currentRate.bestBid + currentRate.bestAsk) / 2;
            if (midPrice > 0) {
              bidAskSpread = ((currentRate.bestAsk - currentRate.bestBid) / midPrice) * 100;
            }
          }
        }

        return {
          candles: visibleCandles,
          intervalFundingRates: visibleFundingRates,
          hourlyFundingRates30d: hourlyFundingRates,
          latestSettlementRate: Number.isFinite(latestSettlementRate) ? latestSettlementRate : null,
          bidAskSpread,
        };
      },
      fetchImpactSpread: async (symbol: string, notional = 1000): Promise<ImpactSpreadResult> => {
        const apiSymbol = toApiSymbol(symbol);
        return fetchImpactSpread("Hyperliquid", apiSymbol, undefined, notional);
      },
      renderExchangeBadge: (symbol: string) => (
        <>
          {isXyzHip3Coin(symbol) && (
            <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">Xyz-Hip3</span>
          )}
          {isParaHip3Coin(symbol) && (
            <span className="rounded bg-pink-500/20 px-2 py-0.5 text-xs text-pink-400">Para-Hip3</span>
          )}
          {isCashHip3Coin(symbol) && (
            <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs text-orange-400">Cash-Hip3</span>
          )}
          {isHynaHip3Coin(symbol) && (
            <span className="rounded bg-teal-500/20 px-2 py-0.5 text-xs text-teal-400">Hyna-Hip3</span>
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
