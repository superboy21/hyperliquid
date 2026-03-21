"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";

// ==================== 类型定义 ====================

type ChartInterval = "1d" | "4h" | "1h";
type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";
type FilterType = "all" | "Layer1/Layer2" | "DeFi" | "Meme" | "AI" | "GameFi" | "Storage" | "其他";

interface Ticker24hr {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  openPrice: string;
  bidPrice: string;
  askPrice: string;
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
}

interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

interface ExchangeSymbolInfo {
  symbol: string;
  baseAsset: string;
  underlyingSubType?: string[];
}

interface FundingRate {
  symbol: string;
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

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

const CATEGORY_CONFIG: Record<string, { label: string; borderColor: string; bgColor: string; dotColor: string }> = {
  all: { label: "全部资产", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  "Layer1/Layer2": { label: "Layer1/Layer2", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  DeFi: { label: "DeFi", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  Meme: { label: "Meme", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
  AI: { label: "AI", borderColor: "border-cyan-600", bgColor: "bg-cyan-600", dotColor: "bg-cyan-400" },
  GameFi: { label: "GameFi", borderColor: "border-green-600", bgColor: "bg-green-600", dotColor: "bg-green-400" },
  Storage: { label: "Storage", borderColor: "border-orange-600", bgColor: "bg-orange-600", dotColor: "bg-orange-400" },
  其他: { label: "其他", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// Layer1/Layer2 主流币
const LAYER1_LAYER2 = ["BTC", "ETH", "BNB", "SOL", "ADA", "AVAX", "DOT", "MATIC", "NEAR", "ATOM", "FTM", "ALGO", "XTZ", "EOS", "TRX", "ICP", "APT", "SUI", "ARB", "OP", "BASE"];

// Meme 币
const MEME_COINS = ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "MYRO", "BOME", "MEME", "MOG", "TURBO"];

// DeFi 代币
const DEFI_TOKENS = ["UNI", "AAVE", "MKR", "COMP", "SNX", "CRV", "SUSHI", "1INCH", "YFI", "BAL", "LDO", "RPL", "PENDLE", "GMX", "DYDX", "RDNT", "MAGIC", "JOE", "CAKE", "PANCAKE"];

// AI 代币
const AI_TOKENS = ["AGIX", "FET", "OCEAN", "RNDR", "GRT", "NMR", "CTXC", "NFP", "AI", "WLD"];

// GameFi 代币
const GAMEFI_TOKENS = ["AXS", "SAND", "MANA", "ENJ", "GALA", "ILV", "YGG", "GMT", "STEPN", "ALICE", "TLM", "STAR", "PIXEL", "PORTAL"];

// Storage 代币
const STORAGE_TOKENS = ["FIL", "AR", "STORJ", "SC", "BTT", "HOT"];

// ==================== 工具函数 ====================

function getAssetCategory(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  
  if (LAYER1_LAYER2.includes(base)) return "Layer1/Layer2";
  if (MEME_COINS.includes(base)) return "Meme";
  if (DEFI_TOKENS.includes(base)) return "DeFi";
  if (AI_TOKENS.includes(base)) return "AI";
  if (GAMEFI_TOKENS.includes(base)) return "GameFi";
  if (STORAGE_TOKENS.includes(base)) return "Storage";
  
  return "其他";
}

function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

function formatAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  const annualized = rateNumber * settlementsPerDay * 365 * 100;
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

export default function BinanceFundingMonitor() {
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
  const [failedOISymbols, setFailedOISymbols] = useState<string[]>([]);

  // ==================== 数据获取 ====================

  const fetchRates = useCallback(async () => {
    try {
      setError(null);

      // 分批获取数据，避免限流
      const tickersRes = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr");
      if (!tickersRes.ok) {
        throw new Error(`Ticker API failed: ${tickersRes.status}`);
      }

      const premiumRes = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex");
      if (!premiumRes.ok) {
        throw new Error(`Premium API failed: ${premiumRes.status}`);
      }

      const fundingInfoRes = await fetch("https://fapi.binance.com/fapi/v1/fundingInfo");
      
      const bookTickerRes = await fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker");

      const tickers: Ticker24hr[] = await tickersRes.json();
      const premiums: PremiumIndex[] = await premiumRes.json();
      const fundingInfos: FundingInfo[] = fundingInfoRes.ok ? await fundingInfoRes.json() : [];
      const bookTickers: Array<{symbol: string; bidPrice: string; askPrice: string}> = bookTickerRes.ok ? await bookTickerRes.json() : [];

      // 创建查找 Map
      const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
      const premiumMap = new Map(premiums.map((p) => [p.symbol, p]));
      const fundingInfoMap = new Map(fundingInfos.map((f) => [f.symbol, f]));
      const bookTickerMap = new Map(bookTickers.map((b) => [b.symbol, b]));

      // 获取所有 USDT 永续合约的 openInterest (并发获取)
      const usdtSymbols = Array.from(premiumMap.keys()).filter(s => s.endsWith("USDT"));
      const openInterestMap = new Map<string, number>();
      const failedSymbols: string[] = [];
      
      // 分批并发获取 openInterest，每批20个
      const batchSize = 20;
      for (let i = 0; i < usdtSymbols.length; i += batchSize) {
        const batch = usdtSymbols.slice(i, i + batchSize);
        const promises = batch.map(async (symbol) => {
          try {
            const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
            if (oiRes.ok) {
              const oiData = await oiRes.json();
              const oi = parseFloat(oiData.openInterest || "0");
              const premium = premiumMap.get(symbol);
              const markPrice = parseFloat(premium?.markPrice || "0");
              // 持仓价值 = 持仓量 * 标记价格 (USD)
              return { symbol, value: oi * markPrice, success: oi > 0 };
            }
          } catch (e) {
            // 忽略单个请求失败
          }
          return { symbol, value: 0, success: false };
        });
        
        const results = await Promise.all(promises);
        for (const { symbol, value, success } of results) {
          openInterestMap.set(symbol, value);
          if (!success) {
            failedSymbols.push(symbol);
          }
        }
        
        // 批次间短暂延迟避免限流
        if (i + batchSize < usdtSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // 设置失败的合约列表
      setFailedOISymbols(failedSymbols);

      // 只保留 USDT 永续合约
      const rates: FundingRate[] = [];
      for (const [symbol, premium] of premiumMap) {
        if (!symbol.endsWith("USDT")) continue;
        
        // 跳过拿不到 openInterest 的资产（可能已下架）
        if (failedSymbols.includes(symbol)) continue;
        
        const ticker = tickerMap.get(symbol);
        const fundingInfo = fundingInfoMap.get(symbol);
        
        // 默认 8 小时，如果有特殊配置则使用配置值
        const fundingInterval = fundingInfo?.fundingIntervalHours 
          ? fundingInfo.fundingIntervalHours * 3600 
          : 8 * 60 * 60;

        const markPrice = parseFloat(premium.markPrice || "0");
        
        // 从 bookTicker 获取 bidPrice 和 askPrice
        const bookTicker = bookTickerMap.get(symbol);
        const bidPrice = parseFloat(bookTicker?.bidPrice || "0");
        const askPrice = parseFloat(bookTicker?.askPrice || "0");
        
        // 获取持仓价值
        const notionalValue = openInterestMap.get(symbol) || parseFloat(ticker?.quoteVolume || "0");

        rates.push({
          symbol,
          fundingRate: premium.lastFundingRate || "0",
          markPrice: premium.markPrice || "0",
          indexPrice: premium.indexPrice || "0",
          lastFundingRate: premium.lastFundingRate || "0",
          nextFundingTime: premium.nextFundingTime || 0,
          lastPrice: premium.lastPrice || premium.markPrice || "0",
          bidPrice: bookTicker?.bidPrice || "0",
          askPrice: bookTicker?.askPrice || "0",
          priceChangePercent: ticker?.priceChangePercent || "0",
          quoteVolume: ticker?.quoteVolume || "0",
          openInterest: String(notionalValue / markPrice), // 反推持仓量
          notionalValue: String(notionalValue),
          fundingInterval,
          assetCategory: getAssetCategory(symbol),
        });
      }

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
    const interval = setInterval(fetchRates, 30000);
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
      // 获取 K 线数据
      const candleResponse = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${chartInterval}&limit=30`
      );

      if (!candleResponse.ok) {
        throw new Error("Failed to fetch candles");
      }

      const candleData = await candleResponse.json();
      if (!Array.isArray(candleData) || candleData.length === 0) {
        setDetailError(`暂时拿不到该资产最近 30 天的${intervalLabels[chartInterval]}数据。`);
        return;
      }

      const candles: CandleSnapshotItem[] = candleData.map((kline: any[]) => ({
        openTime: kline[0],  // 毫秒时间戳
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        closeTime: kline[6],  // 毫秒时间戳
      }));

      // 获取历史资金费率 (获取足够多的数据以覆盖30天)
      // Binance API 最多返回1000条记录
      const fundingResponse = await fetch(
        `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`
      );

      let fundingHistory: FundingHistoryItem[] = [];
      if (fundingResponse.ok) {
        const fundingData = await fundingResponse.json();
        if (Array.isArray(fundingData)) {
          fundingHistory = fundingData.map((item: any) => ({
            time: item.fundingTime,  // 毫秒时间戳
            fundingRate: item.fundingRate,
          }));
        }
      }

      // 计算 exactly 30天和7天的时间范围
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      // 筛选出 exactly 30天内的资金费率
      const fundingHistory30d = fundingHistory.filter((item) => item.time >= thirtyDaysAgo);
      const fundingHistory7d = fundingHistory.filter((item) => item.time >= sevenDaysAgo);

      // 按1小时聚合
      const hourlyFundingRates30d = getAverageFundingRatesByInterval(fundingHistory30d, "1h");
      const hourlyFundingRates7d = getAverageFundingRatesByInterval(fundingHistory7d, "1h");

      const visibleCandles =
        chartInterval === "1d" ? candles : candles.slice(Math.max(candles.length - 30, 0));

      const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory30d, chartInterval);
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );

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
  }, []);

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

  const selectedSummary = useMemo(() => {
    if (candles.length === 0) {
      return null;
    }

    const closes = candles.map((candle) => Number(candle.close));
    const highs = candles.map((candle) => Number(candle.high));
    const lows = candles.map((candle) => Number(candle.low));

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
      const periodsPerYear = selectedInterval === "1d" ? 365 : selectedInterval === "4h" ? 365 * 6 : 365 * 24;
      historicalVolatility = periodVolatility * Math.sqrt(periodsPerYear) * 100;
    }

    // 获取当前选中交易对的买卖价差
    let bidAskSpread = null;
    if (selectedCoin) {
      const selectedRate = fundingRates.find(r => r.symbol === selectedCoin);
      console.log("Selected rate:", selectedRate?.symbol, "bid:", selectedRate?.bidPrice, "ask:", selectedRate?.askPrice);
      if (selectedRate) {
        const bestBid = parseFloat(selectedRate.bidPrice);
        const bestAsk = parseFloat(selectedRate.askPrice);
        const markPrice = parseFloat(selectedRate.markPrice);
        
        // 如果 bidPrice 和 askPrice 都有值，使用它们
        if (bestBid > 0 && bestAsk > 0) {
          const midPrice = (bestBid + bestAsk) / 2;
          bidAskSpread = ((bestAsk - bestBid) / midPrice) * 100;
        } 
        // 否则，如果只有 lastPrice 或 markPrice，无法计算买卖价差
        // Binance premiumIndex API 不返回 bid/ask，需要使用 ticker/24hr 或单独获取
      }
    }

    const latestPrice = closes[closes.length - 1];

    return {
      latestClose: latestPrice,
      highestHigh: Math.max(...highs),
      lowestLow: Math.min(...lows),
      historicalVolatility,
      bidAskSpread,
    };
  }, [candles, selectedInterval, selectedCoin, fundingRates]);

  // 获取选中合约的结算周期
  const selectedFundingInterval = useMemo(() => {
    if (!selectedCoin) return 28800;
    const selected = fundingRates.find(r => r.symbol === selectedCoin);
    return selected?.fundingInterval || 28800;
  }, [selectedCoin, fundingRates]);

  // ==================== 渲染 ====================

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-yellow-500" />
          <p className="mt-4 text-gray-400">正在加载 Binance 资金费率数据...</p>
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
            className="rounded-lg bg-yellow-600 px-4 py-2 text-white transition-colors hover:bg-yellow-700"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const positiveCount = fundingRates.filter((r) => parseFloat(r.fundingRate) > 0).length;
  const negativeCount = fundingRates.filter((r) => parseFloat(r.fundingRate) < 0).length;

  const weightedAvgRate = fundingRates.length > 0
    ? fundingRates.reduce((sum, r) => {
        const notional = parseFloat(r.notionalValue) || 0;
        return sum + parseFloat(r.fundingRate) * notional;
      }, 0) / fundingRates.reduce((sum, r) => sum + (parseFloat(r.notionalValue) || 0), 0)
    : 0;

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
          <p className="mt-2 text-2xl font-bold text-yellow-400">8h / 4h / 1h</p>
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
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleSort("rate")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "rate"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              预测费率 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("price")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "price"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              价格 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("change")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "change"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 涨跌 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("volume")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "volume"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 成交额 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("oi")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "oi"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              持仓价值 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("name")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "name"
                  ? "border-yellow-600 bg-yellow-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              名称 {sortDesc ? "↓" : "↑"}
            </button>
          </div>
        </div>

        {lastUpdate && (
          <div className="mb-4 text-sm text-gray-500">
            最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}（每 30 秒自动刷新）
          </div>
        )}

        {/* 表格和图表 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
          {/* 左侧表格 */}
          <div className="min-h-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 lg:flex lg:h-full lg:flex-col">
            <div className="border-b border-gray-700 p-4">
              <h2 className="text-lg font-semibold text-white">
                {filterType === "all" ? "Binance 资金费率总览" : `${CATEGORY_CONFIG[filterType].label} 资金费率`}
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
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">交易对</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">价格</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 涨跌</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">预测费率</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 成交额</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">持仓价值</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filteredAndSortedRates.map((rate) => {
                    const change24h = parseFloat(rate.priceChangePercent);
                    const bidAskSpread = parseFloat(rate.bidPrice) && parseFloat(rate.askPrice)
                      ? ((parseFloat(rate.askPrice) - parseFloat(rate.bidPrice)) / ((parseFloat(rate.askPrice) + parseFloat(rate.bidPrice)) / 2)) * 100
                      : 0;

                    return (
                      <tr
                        key={rate.symbol}
                        onClick={() => setSelectedCoin(rate.symbol)}
                        className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                          selectedCoin === rate.symbol ? "bg-gray-700/90" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">{rate.symbol}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-300">{formatPrice(rate.lastPrice)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-mono text-sm ${
                              change24h > 0 ? "text-green-400" : change24h < 0 ? "text-red-400" : "text-gray-400"
                            }`}
                          >
                            {change24h >= 0 ? "+" : ""}
                            {change24h.toFixed(2)}%
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
                              {formatAnnualizedRate(rate.fundingRate, rate.fundingInterval)}
                            </span>
                            <span className="ml-2 text-xs text-gray-500">
                              ({formatFundingRate(rate.fundingRate)})
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-400">{formatVolume(rate.quoteVolume)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-sm text-gray-400">{formatVolume(rate.notionalValue)}</span>
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
                <h2 className="text-lg font-semibold text-white">
                  {selectedCoin ? `${selectedCoin} 近 30 天价格与资金费率` : "选择左侧资产查看图表"}
                </h2>
                {selectedCoin && (
                  <div className="flex gap-2">
                    {(Object.keys(intervalLabels) as ChartInterval[]).map((interval) => (
                      <button
                        key={interval}
                        onClick={() => setSelectedInterval(interval)}
                        className={`rounded-lg px-3 py-1 text-sm transition-colors ${
                          selectedInterval === interval
                            ? "bg-yellow-600 text-white"
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
                detailLoading ? (
                  <div className="flex h-[560px] items-center justify-center">
                    <div className="text-center">
                      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-yellow-500" />
                      <p className="mt-4 text-gray-400">加载图表数据中...</p>
                    </div>
                  </div>
                ) : detailError ? (
                  <div className="flex h-[560px] items-center justify-center text-gray-400">
                    <div className="text-center">
                      <p className="text-red-400">{detailError}</p>
                      <button
                        onClick={() => fetchDetail(selectedCoin, selectedInterval)}
                        className="mt-4 rounded-lg bg-yellow-600 px-4 py-2 text-white transition-colors hover:bg-yellow-700"
                      >
                        重新加载图表
                      </button>
                    </div>
                  </div>
                ) : candles.length > 0 ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                      <BinanceFundingCandlesChart
                        symbol={selectedCoin}
                        interval={selectedInterval}
                        candles={candles}
                        intervalFundingRates={intervalFundingRates}
                        fundingIntervalSeconds={selectedFundingInterval}
                      />
                    </div>

                    {selectedSummary && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                          <p className="text-xs text-gray-400">结算周期</p>
                          <p className="mt-2 font-mono text-lg font-bold text-yellow-400">
                            {selectedFundingInterval / 3600} 小时
                          </p>
                          <p className="mt-1 text-xs text-gray-500">Binance 合约</p>
                        </div>
                        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                          <p className="text-xs text-gray-400">历史波动率(30周期)</p>
                          <p className="mt-2 font-mono text-lg font-bold text-purple-400">
                            {selectedSummary.historicalVolatility.toFixed(2)}%
                          </p>
                          <p className="mt-1 text-xs text-gray-500">年化</p>
                        </div>
                        <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                          <p className="text-xs text-gray-400">当前买卖价差</p>
                          <p className="mt-2 font-mono text-lg font-bold text-yellow-400">
                            {selectedSummary.bidAskSpread !== null
                              ? `${selectedSummary.bidAskSpread.toFixed(4)}%`
                              : "--"}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">(Ask-Bid)/Mid</p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                      <FundingStatCard title="最高资金费率(7天)" rate={fundingStats7d?.highest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                      <FundingStatCard title="最低资金费率(7天)" rate={fundingStats7d?.lowest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                      <FundingStatCard title="平均资金费率(7天)" rate={fundingStats7d?.average ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                      <FundingStatCard title="最高资金费率(30天)" rate={fundingStats30d?.highest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                      <FundingStatCard title="最低资金费率(30天)" rate={fundingStats30d?.lowest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                      <FundingStatCard title="平均资金费率(30天)" rate={fundingStats30d?.average ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[560px] items-center justify-center text-gray-400">
                    <div className="text-center">
                      <p>暂无可展示的图表数据。</p>
                    </div>
                  </div>
                )
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
    </div>
  );
}

// ==================== 子组件 ====================

function FundingStatCard({
  title,
  rate,
  fundingIntervalSeconds = 28800,
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

  // rate 是小数形式 (如 0.000071 表示 0.0071%)
  // 年化计算：rate * 每天结算次数 * 365天 * 100 (转换为百分比)
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  const annualized = rate * settlementsPerDay * 365 * 100;
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
