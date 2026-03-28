"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LighterFundingCandlesChart from "@/components/funding/LighterFundingCandlesChart";

// ==================== 类型定义 ====================

type ChartInterval = "1d" | "4h" | "1h";
type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";
type FilterType = "all" | "Majors" | "DeFi" | "Meme" | "AI" | "Other";

interface FundingRate {
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

interface CandleSnapshotItem {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
}

// ==================== 常量 ====================

const LIGHTER_FUNDING_INTERVAL_SECONDS = 3600; // 1小时

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

const CATEGORY_CONFIG: Record<string, { label: string; borderColor: string; bgColor: string; dotColor: string }> = {
  all: { label: "全部资产", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  Equities: { label: "Equities", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  "ETF/Index": { label: "ETF/Index", borderColor: "border-green-600", bgColor: "bg-green-600", dotColor: "bg-green-400" },
  FX: { label: "FX", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  Commodities: { label: "Commodities", borderColor: "border-orange-600", bgColor: "bg-orange-600", dotColor: "bg-orange-400" },
  Crypto: { label: "Crypto", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// Equities
const EQUITIES = ["HOOD", "AAPL", "META", "INTC", "AMZN", "BMNR", "PLTR", "COIN", "SAMSUNG", "STRC", "AMD", "SNDK", "HANMI", "HYUNDAI", "ASML"];

// ETF/Index
const ETF_INDEX = ["QQQ", "SPY", "KRCOMP", "URA", "IWM", "MAGS", "BOTZ", "DIA"];

// FX (外汇)
const FX = ["EURUSD", "USDKRW", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"];

// Commodities (商品)
const COMMODITIES = ["XAU", "XAG", "WTI", "BRENTOIL", "XPT", "XCU"];

// ==================== 工具函数 ====================

function getAssetCategory(symbol: string): string {
  // 检查是否是 Equities
  if (EQUITIES.includes(symbol)) return "Equities";
  
  // 检查是否是 ETF/Index
  if (ETF_INDEX.includes(symbol)) return "ETF/Index";
  
  // 检查是否是 FX
  if (FX.includes(symbol)) return "FX";
  
  // 检查是否是 Commodities
  if (COMMODITIES.includes(symbol)) return "Commodities";
  
  // 其他都是 Crypto
  return "Crypto";
}

function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // 将 8 小时费率转换为每小时费率（除以 8）
  const hourlyRate = rateNumber / 8;
  return `${(hourlyRate * 100).toFixed(4)}%`;
}

function formatAnnualizedRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // 将 8 小时费率转换为每小时费率（除以 8）
  const hourlyRate = rateNumber / 8;
  const annualized = hourlyRate * 24 * 365 * 100; // 每小时结算，每天24次
  const absRate = Math.abs(annualized);

  if (absRate >= 100) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  }

  if (absRate >= 10) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  }

  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;

  if (priceNumber >= 1000) {
    return priceNumber.toFixed(2);
  }
  if (priceNumber >= 1) {
    return priceNumber.toFixed(4);
  }
  return priceNumber.toFixed(6);
}

function formatVolume(volume: string | number): string {
  const volumeNumber = typeof volume === "string" ? parseFloat(volume) : volume;

  if (volumeNumber >= 1e9) {
    return `${(volumeNumber / 1e9).toFixed(2)}B`;
  }
  if (volumeNumber >= 1e6) {
    return `${(volumeNumber / 1e6).toFixed(2)}M`;
  }
  if (volumeNumber >= 1e3) {
    return `${(volumeNumber / 1e3).toFixed(2)}K`;
  }
  return volumeNumber.toFixed(2);
}

function getFundingStats(items: IntervalFundingRateItem[]): FundingStats | null {
  if (items.length === 0) {
    return null;
  }

  const rates = items.map((item) => item.averageFundingRate);
  const highest = Math.max(...rates);
  const lowest = Math.min(...rates);
  const average = rates.reduce((sum, r) => sum + r, 0) / rates.length;

  return { highest, lowest, average };
}

function getAverageFundingRatesByInterval(
  history: FundingHistoryItem[],
  interval: ChartInterval
): IntervalFundingRateItem[] {
  if (history.length === 0) return [];

  let intervalMs: number;
  switch (interval) {
    case "1d":
      intervalMs = 24 * 60 * 60 * 1000;
      break;
    case "4h":
      intervalMs = 4 * 60 * 60 * 1000;
      break;
    case "1h":
      intervalMs = 60 * 60 * 1000;
      break;
    default:
      intervalMs = 24 * 60 * 60 * 1000;
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

// ==================== 主组件 ====================

export default function LighterFundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("1d");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candles, setCandles] = useState<CandleSnapshotItem[]>([]);
  const [intervalFundingRates, setIntervalFundingRates] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates30d, setHourlyFundingRates30d] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates7d, setHourlyFundingRates7d] = useState<IntervalFundingRateItem[]>([]);
  const [bidAskSpread, setBidAskSpread] = useState<number | null>(null);

  // ==================== 数据获取 ====================

  const fetchRates = useCallback(async () => {
    try {
      setError(null);

      // 获取 Lighter 资金费率、exchangeStats 和 orderBookDetails
      const [fundingRes, statsRes] = await Promise.all([
        fetch("/api/lighter?endpoint=funding-rates"),
        fetch("/api/lighter?endpoint=exchangeStats"),
      ]);

      if (!fundingRes.ok || !statsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const fundingData = await fundingRes.json();
      const statsData = await statsRes.json();
      
      // 只保留 Lighter 交易所的资金费率数据
      const lighterRates = (fundingData.funding_rates || []).filter(
        (entry: any) => entry.exchange === "lighter"
      );

      // 创建 stats 映射
      const statsMap = new Map<string, any>();
      for (const stat of statsData.order_book_stats || []) {
        statsMap.set(stat.symbol, stat);
      }

      // 获取所有市场的 orderBookDetails（一次性获取，避免逐个请求）
      const orderBookDetailsMap = new Map<number, { openInterest: number; lastPrice: number }>();
      try {
        const orderBookRes = await fetch("/api/lighter?endpoint=orderBookDetails&filter=perp");
        if (orderBookRes.ok) {
          const orderBookData = await orderBookRes.json();
          const details = orderBookData.order_book_details || [];
          for (const item of details) {
            orderBookDetailsMap.set(item.market_id, {
              openInterest: parseFloat(item.open_interest || "0"),
              lastPrice: parseFloat(item.last_trade_price || "0"),
            });
          }
        }
      } catch (e) {
        console.error("Error fetching orderBookDetails:", e);
      }

      const rates: FundingRate[] = lighterRates.map((entry: any) => {
        const stat = statsMap.get(entry.symbol);
        const orderDetails = orderBookDetailsMap.get(entry.market_id);
        const lastPrice = orderDetails?.lastPrice || stat?.last_trade_price || 0;
        const openInterest = orderDetails?.openInterest || 0;
        const notionalValue = openInterest * lastPrice;  // 持仓价值 = open_interest * 当前价格

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

      if (rates.length === 0) {
        setError("未能获取到资金费率数据，请稍后重试。");
        return;
      }

      setFundingRates(rates);
      setLastUpdate(new Date());
    } catch (fetchError) {
      console.error("Error fetching data:", fetchError);
      setError("获取数据时发生错误。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, 60000);
    return () => clearInterval(interval);
  }, [fetchRates]);

  const fetchDetail = useCallback(async (symbol: string, chartInterval: ChartInterval) => {
    setDetailLoading(true);
    setDetailError(null);
    setCandles([]);
    setIntervalFundingRates([]);
    setHourlyFundingRates30d([]);
    setHourlyFundingRates7d([]);

    try {
      // 找到对应的 marketId
      const selectedRate = fundingRates.find(r => r.symbol === symbol);
      const marketId = selectedRate?.marketId;
      
      if (marketId === undefined) {
        setDetailError("找不到该资产的市场 ID");
        return;
      }

      // 计算时间范围（毫秒）
      const nowMs = Date.now();
      const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;

      // 根据图表周期计算 count_back
      // 日线：30根（30天）
      // 4小时线：180根（30天）
      // 1小时线：720根（30天）
      let countBack: number;
      switch (chartInterval) {
        case "1d":
          countBack = 30;  // 30天
          break;
        case "4h":
          countBack = 180; // 30天 * 6根/天 = 180根
          break;
        case "1h":
        default:
          countBack = 720; // 30天 * 24根/天 = 720根
          break;
      }

      // 并行获取蜡烛图和资金费率数据（使用 Lighter 官方 API）
      const [candlesRes, fundingRes] = await Promise.all([
        fetch(`/api/lighter?endpoint=candles&market_id=${marketId}&resolution=${chartInterval}&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=${countBack}`),
        fetch(`/api/lighter?endpoint=fundings&market_id=${marketId}&resolution=1h&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=720`),
      ]);

      // 处理蜡烛图数据
      let candles: CandleSnapshotItem[] = [];
      if (candlesRes.ok) {
        const candlesData = await candlesRes.json();
        // Lighter API 返回格式: {code: 200, r: "1h", c: [{t, o, h, l, c, v, V, i}, ...]}
        const candleArray = candlesData.c || candlesData.candlesticks || candlesData;
        if (Array.isArray(candleArray)) {
          let intervalMs: number;
          switch (chartInterval) {
            case "1d":
              intervalMs = 24 * 60 * 60 * 1000;
              break;
            case "4h":
              intervalMs = 4 * 60 * 60 * 1000;
              break;
            case "1h":
            default:
              intervalMs = 60 * 60 * 1000;
              break;
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

      // 处理资金费率数据
      let fundingHistory: FundingHistoryItem[] = [];
      if (fundingRes.ok) {
        const fundingData = await fundingRes.json();
        // Lighter API 返回格式: {code: 200, resolution: "1h", fundings: [{timestamp, value, rate, direction}, ...]}
        const fundingArray = fundingData.fundings || fundingData;
        if (Array.isArray(fundingArray)) {
          fundingHistory = fundingArray.map((item: any) => {
            // 根据 direction 确定资金费率的正负
            // direction: "long" → 多头支付空头（正的资金费率）
            // direction: "short" → 空头支付多头（负的资金费率）
            const rate = parseFloat(item.rate || "0");
            const direction = item.direction || "long";
            const signedRate = direction === "short" ? -rate : rate;
            
            return {
              time: item.timestamp * 1000,  // Lighter API 返回的是秒，需要转换为毫秒
              fundingRate: signedRate.toString(),
            };
          });
        }
      }

      if (candles.length === 0) {
        setDetailError(`暂时拿不到该资产最近 30 天的${intervalLabels[chartInterval]}数据。`);
        return;
      }

      const visibleCandles =
        chartInterval === "1d" ? candles : candles.slice(Math.max(candles.length - 30, 0));

      const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory, chartInterval);
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );
      const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory, "1h");

      // 计算 7 天和 30 天的数据
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgoMsForStats = Date.now() - 30 * 24 * 60 * 60 * 1000;
      
      const hourlyFundingRates7d = hourlyFundingRates.filter((item) => item.bucketStartTime >= sevenDaysAgoMs);
      const hourlyFundingRates30d = hourlyFundingRates.filter((item) => item.bucketStartTime >= thirtyDaysAgoMsForStats);

      // 获取 orderBook 数据以计算买卖价差
      try {
        const orderBookRes = await fetch(`/api/lighter?endpoint=orderBookOrders&market_id=${marketId}&limit=1`);
        if (orderBookRes.ok) {
          const orderBookData = await orderBookRes.json();
          const bestAsk = orderBookData.asks?.[0]?.price ? parseFloat(orderBookData.asks[0].price) : null;
          const bestBid = orderBookData.bids?.[0]?.price ? parseFloat(orderBookData.bids[0].price) : null;
          
          if (bestAsk && bestBid && bestAsk > 0 && bestBid > 0) {
            const mid = (bestAsk + bestBid) / 2;
            const spread = ((bestAsk - bestBid) / mid) * 100;
            setBidAskSpread(spread);
          } else {
            setBidAskSpread(null);
          }
        }
      } catch (e) {
        console.error("Error fetching order book:", e);
        setBidAskSpread(null);
      }

      setCandles(visibleCandles);
      setIntervalFundingRates(visibleFundingRates);
      setHourlyFundingRates30d(hourlyFundingRates30d);
      setHourlyFundingRates7d(hourlyFundingRates7d);
    } catch (fetchError) {
      console.error("Error fetching detail:", fetchError);
      setDetailError("加载图表数据时发生错误。");
    } finally {
      setDetailLoading(false);
    }
  }, [fundingRates]);

  useEffect(() => {
    if (selectedCoin) {
      fetchDetail(selectedCoin, selectedInterval);
    }
  }, [fetchDetail, selectedCoin, selectedInterval]);

  // ==================== 筛选和排序 ====================

  const ratesByType = useMemo(() => {
    return fundingRates.filter((rate) => {
      if (filterType === "all") return true;
      return rate.assetCategory === filterType;
    });
  }, [fundingRates, filterType]);

  const filteredAndSortedRates = useMemo(() => {
    const filtered = ratesByType.filter((rate) => {
      const matchesSearch = !searchTerm || rate.symbol.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "rate":
          comparison = Math.abs(parseFloat(b.fundingRate)) - Math.abs(parseFloat(a.fundingRate));
          break;
        case "name":
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case "price":
          comparison = parseFloat(b.lastPrice || b.markPrice) - parseFloat(a.lastPrice || a.markPrice);
          break;
        case "change":
          comparison = parseFloat(b.priceChangePercent || "0") - parseFloat(a.priceChangePercent || "0");
          break;
        case "volume":
          comparison = parseFloat(b.quoteVolume || "0") - parseFloat(a.quoteVolume || "0");
          break;
        case "oi":
          comparison = parseFloat(b.notionalValue || "0") - parseFloat(a.notionalValue || "0");
          break;
      }

      return sortDesc ? comparison : -comparison;
    });
  }, [ratesByType, searchTerm, sortBy, sortDesc]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDesc((current) => !current);
      return;
    }

    setSortBy(field);
    setSortDesc(true);
  };

  // ==================== 统计数据 ====================

  const fundingStats30d = useMemo(() => getFundingStats(hourlyFundingRates30d), [hourlyFundingRates30d]);
  const fundingStats7d = useMemo(() => getFundingStats(hourlyFundingRates7d), [hourlyFundingRates7d]);

  const positiveCount = filteredAndSortedRates.filter((r) => parseFloat(r.fundingRate) > 0).length;
  const negativeCount = filteredAndSortedRates.filter((r) => parseFloat(r.fundingRate) < 0).length;

  // 计算 OI 加权平均年化资金费率
  const weightedAvgRate = filteredAndSortedRates.length > 0
    ? filteredAndSortedRates.reduce((sum, r) => {
        const notional = parseFloat(r.notionalValue) || 0;
        return sum + parseFloat(r.fundingRate) * notional;
      }, 0) / filteredAndSortedRates.reduce((sum, r) => sum + (parseFloat(r.notionalValue) || 0), 0)
    : 0;

  // 计算历史波动率（年化）
  const selectedSummary = useMemo(() => {
    if (candles.length === 0) {
      return null;
    }

    const closes = candles.map((candle) => Number(candle.close));

    // 计算历史波动率（年化）
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }

    let historicalVolatility = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const periodVolatility = Math.sqrt(variance);

      // 根据图表周期计算年化系数
      const periodsPerYear = selectedInterval === "1d" ? 365 : selectedInterval === "4h" ? 365 * 6 : 365 * 24;
      historicalVolatility = periodVolatility * Math.sqrt(periodsPerYear) * 100;
    }

    // 买卖价差需要从 orderBook 数据中获取，这里先返回 null
    // 实际值会在 fetchDetail 中计算并存储到状态中
    return {
      historicalVolatility,
    };
  }, [candles, selectedInterval]);

  // ==================== 渲染 ====================

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-purple-500" />
          <p className="mt-4 text-gray-400">正在加载 Lighter 资金费率数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="mb-4 text-red-400">{error}</p>
          <button
            onClick={fetchRates}
            className="rounded-lg bg-purple-600 px-4 py-2 text-white transition-colors hover:bg-purple-700"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <p className="text-sm text-gray-400">交易对数量</p>
          <p className="mt-2 text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <p className="text-sm text-gray-400">正资金费率</p>
          <p className="mt-2 text-2xl font-bold text-green-400">{positiveCount}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <p className="text-sm text-gray-400">负资金费率</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{negativeCount}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <p className="text-sm text-gray-400">OI 加权平均年化</p>
          <p className={`mt-2 text-2xl font-bold ${weightedAvgRate >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatAnnualizedRate(weightedAvgRate)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
          <p className="text-sm text-gray-400">结算周期</p>
          <p className="mt-2 text-2xl font-bold text-purple-400">1 小时</p>
        </div>
      </div>

      {/* 资产类别筛选 */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setFilterType(key as FilterType)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              filterType === key
                ? `${config.borderColor} ${config.bgColor} text-white`
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${config.dotColor}`} />
            {config.label}
            <span className="text-xs opacity-70">
              ({key === "all" ? fundingRates.length : fundingRates.filter(r => r.assetCategory === key).length})
            </span>
          </button>
        ))}
      </div>

      {/* 主内容区 */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
        {/* 搜索和排序 */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="搜索交易对，例如 BTC、ETH"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleSort("rate")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "rate"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              预测费率 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("price")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "price"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              价格 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("change")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "change"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 涨跌 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("volume")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "volume"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 成交额 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("oi")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "oi"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              持仓价值 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("name")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "name"
                  ? "border-purple-600 bg-purple-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              名称 {sortDesc ? "↓" : "↑"}
            </button>
          </div>
        </div>

        {lastUpdate && (
          <div className="mb-4 text-sm text-gray-500">
            最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}（每 60 秒自动刷新）
          </div>
        )}

        {/* 表格和图表 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
          {/* 左侧表格 */}
          <div className="min-h-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 lg:flex lg:h-full lg:flex-col">
            <div className="border-b border-gray-700 p-4">
              <h2 className="text-lg font-semibold text-white">
                {filterType === "all" ? "Lighter 资金费率总览" : `${CATEGORY_CONFIG[filterType].label} 资金费率`}
              </h2>
              <p className="text-sm text-gray-400">
                共 {filteredAndSortedRates.length} 个交易对
                {searchTerm && `（从 ${ratesByType.length} 个中筛选）`}
              </p>
            </div>
            <div className="max-h-[960px] overflow-x-auto overflow-y-auto lg:min-h-0 lg:flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400">交易对</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">价格</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">24h 涨跌</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">预测费率</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">24h 成交额</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400">持仓价值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filteredAndSortedRates.map((rate) => {
                    const change24h = parseFloat(rate.priceChangePercent || "0");

                    return (
                      <tr
                        key={rate.symbol}
                        onClick={() => setSelectedCoin(rate.symbol)}
                        className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                          selectedCoin === rate.symbol ? "bg-gray-700/90" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-medium text-white">{rate.symbol}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-300">{rate.lastPrice !== "0" ? formatPrice(rate.lastPrice) : "--"}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-mono text-sm ${
                              change24h > 0 ? "text-green-400" : change24h < 0 ? "text-red-400" : "text-gray-400"
                            }`}
                          >
                            {change24h !== 0 ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%` : "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div>
                            <span
                              className={`font-mono font-medium ${
                                parseFloat(rate.fundingRate) > 0
                                  ? "text-green-400"
                                  : parseFloat(rate.fundingRate) < 0
                                    ? "text-red-400"
                                    : "text-gray-400"
                              }`}
                            >
                              {formatAnnualizedRate(rate.fundingRate)}
                            </span>
                            <span className="ml-2 text-xs text-gray-500">
                              ({formatFundingRate(rate.fundingRate)})
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-400">{rate.quoteVolume !== "0" ? formatVolume(rate.quoteVolume) : "--"}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-400">{rate.notionalValue !== "0" ? formatVolume(rate.notionalValue) : "--"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredAndSortedRates.length === 0 && (
                <div className="p-8 text-center text-gray-500">没有找到匹配的交易对。</div>
              )}
            </div>
          </div>

          {/* 右侧图表 */}
          <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
            <div className="border-b border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-white">
                  {selectedCoin ? `${selectedCoin} 近 30 天价格与资金费率` : "选择左侧资产查看图表"}
                </h2>
                {selectedCoin && (
                  <div className="flex gap-2">
                    {(Object.keys(intervalLabels) as ChartInterval[]).map((interval) => (
                      <button
                        key={interval}
                        onClick={() => setSelectedInterval(interval)}
                        className={`rounded-lg px-3 py-1 text-xs transition-colors ${
                          selectedInterval === interval
                            ? "bg-purple-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {intervalLabels[interval]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4">
              {selectedCoin ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                    <LighterFundingCandlesChart
                      symbol={selectedCoin}
                      interval={selectedInterval}
                      candles={candles}
                      intervalFundingRates={intervalFundingRates}
                      fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">结算周期</p>
                      <p className="mt-2 font-mono text-lg font-bold text-purple-400">1 小时</p>
                      <p className="mt-1 text-xs text-gray-500">Lighter 统一</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">历史波动率(30周期)</p>
                      <p className="mt-2 font-mono text-lg font-bold text-purple-400">
                        {selectedSummary ? `${selectedSummary.historicalVolatility.toFixed(2)}%` : "--"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">年化</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">当前买卖价差</p>
                      <p className="mt-2 font-mono text-lg font-bold text-yellow-400">
                        {bidAskSpread !== null ? `${bidAskSpread.toFixed(4)}%` : "--"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">(Ask-Bid)/Mid</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                    <FundingStatCard title="最高资金费率(7天)" rate={fundingStats7d?.highest ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                    <FundingStatCard title="最低资金费率(7天)" rate={fundingStats7d?.lowest ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                    <FundingStatCard title="平均资金费率(7天)" rate={fundingStats7d?.average ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                    <FundingStatCard title="最高资金费率(30天)" rate={fundingStats30d?.highest ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                    <FundingStatCard title="最低资金费率(30天)" rate={fundingStats30d?.lowest ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                    <FundingStatCard title="平均资金费率(30天)" rate={fundingStats30d?.average ?? null} fundingIntervalSeconds={LIGHTER_FUNDING_INTERVAL_SECONDS} />
                  </div>
                </div>
              ) : (
                <div className="flex h-[560px] items-center justify-center text-gray-400">
                  <div className="text-center">
                    <svg className="mx-auto h-16 w-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                    <p className="mt-4">点击左侧资产查看详细图表</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 说明 */}
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
    </div>
  );
}

// ==================== 子组件 ====================

function FundingStatCard({
  title,
  rate,
  fundingIntervalSeconds = 3600,
}: {
  title: string;
  rate: number | null;
  fundingIntervalSeconds?: number;
}) {
  if (rate === null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-2 text-sm text-gray-500">暂无数据</p>
      </div>
    );
  }

  // rate 是小时平均费率，需要年化
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  const annualized = rate * settlementsPerDay * 365;
  const colorClass = annualized >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`mt-2 font-mono text-lg font-bold ${colorClass}`}>
        {annualized >= 0 ? "+" : ""}{annualized.toFixed(3)}%
      </p>
      <p className="mt-1 text-xs text-gray-500">当前：{formatFundingRate(rate)}</p>
    </div>
  );
}
