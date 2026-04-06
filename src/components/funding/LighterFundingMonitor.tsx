"use client";

import { useCallback, useMemo, useState } from "react";
import LighterFundingCandlesChart from "@/components/funding/LighterFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
  type HydrationPolicy,
  type IntervalFundingRateItem,
} from "@/components/funding/ExchangeFundingMonitor";
import { getFundingHistory, getLatestSettledFundingRate } from "@/lib/lighter";

// ==================== Lighter-specific Types ====================

interface LighterFundingRate {
  symbol: string;
  marketId: number;
  fundingRate: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  openInterest: string;
  notionalValue: string;
  fundingInterval: number;
  assetCategory: string;
}

interface FundingHistoryItem {
  time: number;
  fundingRate: string;
}

interface LighterCandle {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ==================== Constants ====================

const LIGHTER_FUNDING_INTERVAL_SECONDS = 3600; // 1 hour

const EQUITIES = ["HOOD", "AAPL", "META", "INTC", "AMZN", "BMNR", "PLTR", "COIN", "SAMSUNG", "STRC", "AMD", "SNDK", "HANMI", "HYUNDAI", "ASML", "CRCL", "TSLA", "NVDA", "GOOGL", "MSTR", "MSFT"];
const ETF_INDEX = ["QQQ", "SPY", "KRCOMP", "URA", "IWM", "MAGS", "BOTZ", "DIA"];
const FX = ["EURUSD", "USDKRW", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"];
const COMMODITIES = ["XAU", "XAG", "WTI", "BRENTOIL", "XPT", "XCU", "XPD"];

// ==================== Helpers ====================

function getAssetCategory(symbol: string): string {
  if (EQUITIES.includes(symbol)) return "Equities";
  if (ETF_INDEX.includes(symbol)) return "ETF/Index";
  if (FX.includes(symbol)) return "FX";
  if (COMMODITIES.includes(symbol)) return "Commodities";
  return "Crypto";
}

function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // Convert 8h rate to hourly rate (divide by 8)
  const hourlyRate = rateNumber / 8;
  return `${(hourlyRate * 100).toFixed(4)}%`;
}

function formatAnnualizedRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // Convert 8h rate to hourly, then annualize
  const annualizedPct = (rateNumber / 8) * 24 * 365;
  const absRate = Math.abs(annualizedPct);

  if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
  if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
  return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
}

function formatAnnualizedRateFromHourly(rate: number): string {
  // For stat cards: rate is already hourly, annualize directly
  const annualizedPct = rate * 24 * 365;
  const absRate = Math.abs(annualizedPct);

  if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
  if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
  return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
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

function getAverageFundingRatesByInterval(history: FundingHistoryItem[], interval: ChartInterval): IntervalFundingRateItem[] {
  if (history.length === 0) return [];

  let intervalMs: number;
  switch (interval) {
    case "1d": intervalMs = 24 * 60 * 60 * 1000; break;
    case "4h": intervalMs = 4 * 60 * 60 * 1000; break;
    case "1h": intervalMs = 60 * 60 * 1000; break;
    default: intervalMs = 24 * 60 * 60 * 1000;
  }

  const grouped = new Map<number, { total: number; count: number }>();
  for (const item of history) {
    const bucketStartTime = Math.floor(item.time / intervalMs) * intervalMs;
    const existing = grouped.get(bucketStartTime) ?? { total: 0, count: 0 };
    existing.total += parseFloat(item.fundingRate);
    existing.count += 1;
    grouped.set(bucketStartTime, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStartTime, value]) => ({
      bucketStartTime,
      averageFundingRate: value.count > 0 ? value.total / value.count : 0,
      sampleCount: value.count,
    }));
}

function mapToExchangeFundingRate(rate: LighterFundingRate): ExchangeFundingRate {
  return {
    symbol: rate.symbol,
    fundingRate: parseFloat(rate.fundingRate),
    lastSettlementRate: Number.NaN,
    markPrice: parseFloat(rate.markPrice),
    lastPrice: parseFloat(rate.lastPrice || rate.markPrice),
    change24h: parseFloat(rate.priceChangePercent || "0"),
    quoteVolume: parseFloat(rate.quoteVolume || "0"),
    openInterest: parseFloat(rate.openInterest || "0"),
    notionalValue: parseFloat(rate.notionalValue || "0"),
    fundingInterval: rate.fundingInterval || LIGHTER_FUNDING_INTERVAL_SECONDS,
    assetCategory: rate.assetCategory,
    bestBid: rate.bidPrice ? parseFloat(rate.bidPrice) : undefined,
    bestAsk: rate.askPrice ? parseFloat(rate.askPrice) : undefined,
  };
}

// ==================== Category Config ====================

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  Equities: { label: "Equities", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  "ETF/Index": { label: "ETF/Index", borderColor: "border-green-600", bgColor: "bg-green-600", dotColor: "bg-green-400" },
  FX: { label: "FX", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  Commodities: { label: "Commodities", borderColor: "border-orange-600", bgColor: "bg-orange-600", dotColor: "bg-orange-400" },
  Crypto: { label: "Crypto", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// ==================== Chart Wrapper ====================

function LighterChartWrapper({ selectedCoin, interval, candles, intervalFundingRates, fundingIntervalSeconds }: ChartComponentProps) {
  return (
    <LighterFundingCandlesChart
      symbol={selectedCoin}
      interval={interval}
      candles={candles}
      intervalFundingRates={intervalFundingRates}
      fundingIntervalSeconds={fundingIntervalSeconds}
    />
  );
}

// ==================== Main Component ====================

export default function LighterFundingMonitor() {
  const [fundingRates, setFundingRates] = useState<LighterFundingRate[]>([]);

  // Fetch rates with Lighter-specific logic
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    const [fundingRes, statsRes, orderBookRes] = await Promise.all([
      fetch("/api/lighter?endpoint=funding-rates"),
      fetch("/api/lighter?endpoint=exchangeStats"),
      fetch("/api/lighter?endpoint=orderBookDetails&filter=perp"),
    ]);

    if (!fundingRes.ok || !statsRes.ok) throw new Error("Failed to fetch data");

    const fundingData = await fundingRes.json();
    const statsData = await statsRes.json();

    const lighterRates = (fundingData.funding_rates || []).filter(
      (entry: any) => entry.exchange === "lighter",
    );

    const statsMap = new Map<string, any>();
    for (const stat of statsData.order_book_stats || []) {
      statsMap.set(stat.symbol, stat);
    }

    const orderBookDetailsMap = new Map<number, { openInterest: number; lastPrice: number }>();
    if (orderBookRes.ok) {
      try {
        const orderBookData = await orderBookRes.json();
        const details = orderBookData.order_book_details || [];
        for (const item of details) {
          orderBookDetailsMap.set(item.market_id, {
            openInterest: parseFloat(item.open_interest || "0"),
            lastPrice: parseFloat(item.last_trade_price || "0"),
          });
        }
      } catch (e) {
        console.error("Error parsing orderBookDetails:", e);
      }
    }

    const rates: LighterFundingRate[] = lighterRates.map((entry: any) => {
      const stat = statsMap.get(entry.symbol);
      const orderDetails = orderBookDetailsMap.get(entry.market_id);
      const lastPrice = orderDetails?.lastPrice || stat?.last_trade_price || 0;
      const openInterest = orderDetails?.openInterest || 0;
      const notionalValue = openInterest * lastPrice;

      return {
        symbol: entry.symbol || `Market ${entry.market_id}`,
        marketId: entry.market_id,
        fundingRate: entry.rate || "0",
        markPrice: lastPrice.toString(),
        indexPrice: "0",
        lastFundingRate: entry.rate || "0",
        nextFundingTime: 0,
        lastPrice: lastPrice.toString(),
        bidPrice: "0",
        askPrice: "0",
        priceChangePercent: stat?.daily_price_change?.toString() || "0",
        quoteVolume: stat?.daily_quote_token_volume?.toString() || "0",
        openInterest: openInterest.toString(),
        notionalValue: notionalValue.toString(),
        fundingInterval: LIGHTER_FUNDING_INTERVAL_SECONDS,
        assetCategory: getAssetCategory(entry.symbol || ""),
      };
    });

    setFundingRates(rates);
    return rates.map(mapToExchangeFundingRate);
  }, []);

  // Hydrate rates with latest settled funding from history (conservative batching)
  const hydrateRates = useCallback(
    async (
      rates: ExchangeFundingRate[],
      updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
      targetSymbols: string[],
    ): Promise<void> => {
      const batchSize = 3;
      const rateMap = new Map(rates.map((rate) => [rate.symbol, rate]));

      // Build marketId map for quick lookup - need to get marketId from fundingRates state
      const symbolToMarketIdMap = new Map<string, number>();
      for (const rate of fundingRates) {
        symbolToMarketIdMap.set(rate.symbol, rate.marketId);
      }

      const targetRates = targetSymbols
        .map((symbol) => {
          const rate = rateMap.get(symbol);
          if (!rate) return null;
          const marketId = symbolToMarketIdMap.get(symbol);
          if (marketId === undefined) return null;
          return { rate, marketId };
        })
        .filter(
          (item): item is { rate: ExchangeFundingRate; marketId: number } =>
            item !== null && !Number.isFinite(item.rate.lastSettlementRate),
        );

      for (let i = 0; i < targetRates.length; i += batchSize) {
        const batch = targetRates.slice(i, Math.min(i + batchSize, targetRates.length));
        const updates = await Promise.all(
          batch.map(async ({ rate, marketId }) => {
            const lastSettlementRate = await getLatestSettledFundingRate(marketId);
            if (!Number.isFinite(lastSettlementRate)) {
              return null;
            }

            return {
              symbol: rate.symbol,
              lastSettlementRate,
            };
          }),
        );

        const validUpdates = updates.filter(
          (item): item is { symbol: string; lastSettlementRate: number } => item !== null,
        );

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
    },
    [fundingRates],
  );

  // Fetch detail data
  const fetchDetailData = useCallback(
    async (symbol: string, interval: ChartInterval): Promise<DetailData> => {
      const selectedRate = fundingRates.find((r) => r.symbol === symbol);
      const marketId = selectedRate?.marketId;

      if (marketId === undefined) {
        return { candles: [], intervalFundingRates: [], hourlyFundingRates30d: [] };
      }

      const nowMs = Date.now();
      const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;

      let countBack: number;
      switch (interval) {
        case "1d": countBack = 30; break;
        case "4h": countBack = 180; break;
        case "1h": default: countBack = 720; break;
      }

      const [candlesRes, fundingRes] = await Promise.all([
        fetch(
          `/api/lighter?endpoint=candles&market_id=${marketId}&resolution=${interval}&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=${countBack}`,
        ),
        fetch(
          `/api/lighter?endpoint=fundings&market_id=${marketId}&resolution=1h&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=720`,
        ),
      ]);

      // Process candles
      let candles: LighterCandle[] = [];
      if (candlesRes.ok) {
        const candlesData = await candlesRes.json();
        const candleArray = candlesData.c || candlesData.candlesticks || candlesData;
        if (Array.isArray(candleArray)) {
          let intervalMs: number;
          switch (interval) {
            case "1d": intervalMs = 24 * 60 * 60 * 1000; break;
            case "4h": intervalMs = 4 * 60 * 60 * 1000; break;
            case "1h": default: intervalMs = 60 * 60 * 1000; break;
          }
          candles = candleArray.map((item: any) => ({
            openTime: item.t || item.timestamp,
            closeTime: (item.t || item.timestamp) + intervalMs,
            open: (item.o || item.open)?.toString() || "0",
            high: (item.h || item.high)?.toString() || "0",
            low: (item.l || item.low)?.toString() || "0",
            close: (item.c || item.close)?.toString() || "0",
            volume: (item.v || item.volume)?.toString() || "0",
          }));
        }
      }

      // Process funding history
      let fundingHistory: FundingHistoryItem[] = [];
      if (fundingRes.ok) {
        const fundingData = await fundingRes.json();
        const fundingArray = fundingData.fundings || fundingData;
        if (Array.isArray(fundingArray)) {
          fundingHistory = fundingArray.map((item: any) => {
            const rate = parseFloat(item.rate || "0");
            const direction = item.direction || "long";
            const signedRate = direction === "short" ? -rate : rate;
            return {
              time: item.timestamp * 1000,
              fundingRate: signedRate.toString(),
            };
          });
        }
      }

      const visibleCandles = interval === "1d" ? candles : candles.slice(Math.max(candles.length - 30, 0));

      const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory, interval);
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );
      const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory, "1h");

      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgoMsForStats = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const hourlyFundingRates7d = hourlyFundingRates.filter((item) => item.bucketStartTime >= sevenDaysAgoMs);
      const hourlyFundingRates30d = hourlyFundingRates.filter((item) => item.bucketStartTime >= thirtyDaysAgoMsForStats);

      // Fetch order book for bid-ask spread
      let bidAskSpread: number | null = null;
      try {
        const orderBookRes = await fetch(`/api/lighter?endpoint=orderBookOrders&market_id=${marketId}&limit=1`);
        if (orderBookRes.ok) {
          const orderBookData = await orderBookRes.json();
          const bestAsk = orderBookData.asks?.[0]?.price ? parseFloat(orderBookData.asks[0].price) : null;
          const bestBid = orderBookData.bids?.[0]?.price ? parseFloat(orderBookData.bids[0].price) : null;
          if (bestAsk && bestBid && bestAsk > 0 && bestBid > 0) {
            const mid = (bestAsk + bestBid) / 2;
            bidAskSpread = ((bestAsk - bestBid) / mid) * 100;
          }
        }
      } catch (e) {
        console.error("Error fetching order book:", e);
      }

      return {
        candles: visibleCandles,
        intervalFundingRates: visibleFundingRates,
        hourlyFundingRates30d,
        bidAskSpread,
      };
    },
    [fundingRates],
  );

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "Lighter",
      exchangeColor: "purple",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number) => {
        // Table: raw 8h rates need /8 * 8760 * 100
        const annualizedPct = (rate / 8) * 24 * 365 * 100;
        const absRate = Math.abs(annualizedPct);
        if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
        if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
        return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
      },
      formatStatCardAnnualizedRate: (rate: number) => formatAnnualizedRateFromHourly(rate),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: LighterChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH",
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
      fetchDetailData,
      renderExtraStatsCard: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">结算周期</p>
          <p className="text-2xl font-bold text-purple-400">1 小时</p>
        </div>
      ),
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Lighter 资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>Lighter 是去中心化永续合约交易所</li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空</li>
            <li>所有合约每 1 小时结算一次</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较</li>
          </ul>
        </div>
      ),
    }),
    [fetchRates, fetchDetailData, hydrateRates],
  );

  return <ExchangeFundingMonitor config={config} />;
}
