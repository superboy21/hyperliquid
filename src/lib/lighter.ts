import { isAbortLikeError, throwIfAborted } from "./utils/abort";

// Lighter.xyz API 资金费率监控模块
// API 文档: https://apidocs.lighter.xyz

// 使用 Next.js API 代理避免 CORS 问题
const API_PROXY_BASE = "/api/lighter";

// ==================== 类型定义 ====================

export interface LighterFundingRateEntry {
  market_id: number;
  exchange: string;
  symbol: string;
  rate: string;
}

export interface LighterFundingRatesResponse {
  funding_rates: LighterFundingRateEntry[];
}

export interface LighterFundingItem {
  timestamp: number;  // 秒
  value: string;
  rate: string;
  direction: string;
}

export interface LighterCandleItem {
  t: number;  // 毫秒时间戳
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  V: string;
  i: string;
}

export interface LighterOrderBook {
  symbol: string;
  market_id: number;
  market_type: string;
  min_base_amount: string;
  min_quote_amount: string;
}

export interface LighterOrderBooksResponse {
  order_books: LighterOrderBook[];
}

// 内部使用的统一类型
export interface FundingRate {
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

export interface FundingHistoryItem {
  time: number;
  fundingRate: string;
}

export interface CandleSnapshotItem {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

export interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
}

export type ChartInterval = "1d" | "4h" | "1h";

// ==================== 常量 ====================

export const LIGHTER_FUNDING_INTERVAL_SECONDS = 3600; // 1小时

export const intervalMap: Record<ChartInterval, string> = {
  "1d": "1d",
  "4h": "4h",
  "1h": "1h",
};

// ==================== 市场映射 ====================

// 缓存市场映射
let marketMapCache: Map<number, LighterOrderBook> | null = null;

/**
 * 获取所有市场的元数据
 */
export async function getMarketMap(): Promise<Map<number, LighterOrderBook>> {
  if (marketMapCache) {
    return marketMapCache;
  }

  try {
    const response = await fetch(
      `${API_PROXY_BASE}?endpoint=orderBooks`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch order books");
    }

    const data: LighterOrderBooksResponse = await response.json();
    const map = new Map<number, LighterOrderBook>();
    
    for (const book of data.order_books || []) {
      map.set(book.market_id, book);
    }

    marketMapCache = map;
    return map;
  } catch (error) {
    console.error("Error fetching market map:", error);
    return new Map();
  }
}

// ==================== 资产分类 ====================

// Majors 代币
const MAJORS = ["BTC", "ETH", "SOL", "AVAX", "DOGE", "XRP", "LINK", "ADA", "DOT", "MATIC", "NEAR", "ARB", "OP"];

// DeFi 代币
const DEFI = ["UNI", "AAVE", "MKR", "COMP", "CRV", "LDO", "SUSHI", "1INCH"];

// Meme 代币
const MEME = ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF"];

// AI 代币
const AI = ["FET", "RNDR", "WLD", "AGIX", "TAO"];

// 大宗商品
const COMMODITIES = ["XAU", "XAG", "WTI", "BRENTOIL", "XPT", "XCU", "XPD", "PAXG"];

/**
 * 获取资产类别
 */
export function getAssetCategory(symbol: string): string {
  const base = symbol.replace("-USD", "").replace("-PERP", "").toUpperCase();

  if (MAJORS.includes(base)) return "Majors";
  if (DEFI.includes(base)) return "DeFi";
  if (MEME.includes(base)) return "Meme";
  if (AI.includes(base)) return "AI";
  if (COMMODITIES.includes(base)) return "Commodities";

  return "Other";
}

// ==================== API 函数 ====================

/**
 * 获取所有永续合约的资金费率
 */
export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const response = await fetch(
      `${API_PROXY_BASE}?endpoint=funding-rates`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch funding rates");
    }

    const data: LighterFundingRatesResponse = await response.json();
    
    // 只保留 Lighter 交易所的数据
    const lighterRates = (data.funding_rates || []).filter(
      (entry) => entry.exchange === "lighter"
    );

    // 获取市场映射
    const marketMap = await getMarketMap();

    return lighterRates.map((entry) => {
      const market = marketMap.get(entry.market_id);
      const symbol = entry.symbol || market?.symbol || `Market ${entry.market_id}`;
      
      return {
        symbol,
        marketId: entry.market_id,
        fundingRate: entry.rate || "0",
        markPrice: "0",  // 需要从其他端点获取
        indexPrice: "0",
        lastFundingRate: entry.rate || "0",
        nextFundingTime: 0,
        lastPrice: "0",
        bidPrice: "0",
        askPrice: "0",
        priceChangePercent: "0",
        quoteVolume: "0",
        openInterest: "0",
        notionalValue: "0",
        fundingInterval: LIGHTER_FUNDING_INTERVAL_SECONDS,
        assetCategory: getAssetCategory(symbol),
      };
    });
  } catch (error) {
    console.error("Error fetching funding rates:", error);
    return [];
  }
}

export async function getLatestSettledFundingRate(
  marketId: number,
  lookbackHours: number = 6,
  signal?: AbortSignal,
): Promise<number> {
  const latestRate = await fetchLatestSettledFundingRateInWindow(marketId, lookbackHours, signal);
  if (Number.isFinite(latestRate)) {
    return latestRate;
  }

  if (lookbackHours >= 24) {
    return Number.NaN;
  }

  return fetchLatestSettledFundingRateInWindow(marketId, 24, signal);
}
/**
 * 获取指定市场的历史资金费率
 * @param marketId 市场 ID
 * @param limit 返回记录数量，默认 100
 */
export async function getFundingHistory(
  marketId: number,
  limit: number = 100,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  try {
    throwIfAborted(signal);

    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (limit * LIGHTER_FUNDING_INTERVAL_SECONDS);
    
    const response = await fetch(
      `${API_PROXY_BASE}?endpoint=fundings&market_id=${marketId}&resolution=1h&start_timestamp=${startTime}&end_timestamp=${now}&count_back=${limit}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal,
        }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const fundingArray = data?.fundings ?? data;
    if (!Array.isArray(fundingArray)) {
      return [];
    }

    return fundingArray.map((item: LighterFundingItem) => {
      const rate = parseFloat(item.rate || item.value || "0");
      const direction = item.direction || "long";
      const signedRate = direction === "short" ? -rate : rate;

      return {
        time: item.timestamp * 1000,  // 转换为毫秒
        fundingRate: signedRate.toString(),
      };
    });
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return [];
    }

    console.error(`Error fetching funding history for market ${marketId}:`, error);
    return [];
  }
}

/**
 * 获取指定市场最近一次已结算资金费率
 * @param marketId 市场 ID
 * @param lookbackHours 回看小时数，默认 24 小时
 * @returns 最近一次已结算费率（已处理正负方向），如果无法获取则返回 NaN
 */
async function fetchLatestSettledFundingRateInWindow(
  marketId: number,
  lookbackHours: number,
  signal?: AbortSignal,
): Promise<number> {
  // 限制最大回看时间，避免请求过多数据
  const boundedHours = Math.min(Math.max(lookbackHours, 1), 168); // 1-168 小时
  const countBack = boundedHours;

  try {
  throwIfAborted(signal);

  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (boundedHours * LIGHTER_FUNDING_INTERVAL_SECONDS);

  const response = await fetch(
    `${API_PROXY_BASE}?endpoint=fundings&market_id=${marketId}&resolution=1h&start_timestamp=${startTime}&end_timestamp=${now}&count_back=${countBack}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
    }
  );

  if (!response.ok) {
    return Number.NaN;
  }

  const data = await response.json();
  const fundingArray = data?.fundings ?? data;
  if (!Array.isArray(fundingArray) || fundingArray.length === 0) {
    return Number.NaN;
  }

    // 按时间戳降序排序，取最新的一条
    const sortedData = [...fundingArray].sort((a, b) => b.timestamp - a.timestamp);
    const latestItem = sortedData[0];

    // 解析费率并处理方向（与 LighterFundingMonitor 逻辑一致）
    const rate = parseFloat(latestItem.rate || latestItem.value || "0");
    const direction = latestItem.direction || "long";
    const signedRate = direction === "short" ? -rate : rate;

    // Lighter funding history returns the settled 1h rate in percentage points,
    // while the shared table formatting path expects the same normalized scale
    // as the current funding-rate feed used elsewhere in this app.
    // Convert to that internal scale so the latest settlement column renders
    // with the same formula as the predicted-funding column.
    const normalizedRate = signedRate / 12.5;

    // 检查是否为有效数值
    if (Number.isNaN(rate) || !Number.isFinite(normalizedRate)) {
      return Number.NaN;
    }

    return normalizedRate;
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return Number.NaN;
    }

    console.error(`Error fetching latest settled funding rate for market ${marketId}:`, error);
    return Number.NaN;
  }
}

/**
 * 获取指定市场的历史资金费率（指定天数）
 */
export async function getFundingHistoryForDays(
  marketId: number,
  days: number = 30,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  const limit = Math.min(days * 24, 1000); // 每天24小时
  return getFundingHistory(marketId, limit, signal);
}

/**
 * 获取 K 线数据
 */
export async function getCandleSnapshot(
  marketId: number,
  interval: ChartInterval,
  limit: number = 30,
  signal?: AbortSignal,
): Promise<CandleSnapshotItem[]> {
  try {
    throwIfAborted(signal);

    const now = Date.now();
    let startTime: number;
    
    switch (interval) {
      case "1d":
        startTime = now - limit * 24 * 60 * 60 * 1000;
        break;
      case "4h":
        startTime = now - limit * 4 * 60 * 60 * 1000;
        break;
      case "1h":
        startTime = now - limit * 60 * 60 * 1000;
        break;
      default:
        startTime = now - limit * 24 * 60 * 60 * 1000;
    }

    const response = await fetch(
      `${API_PROXY_BASE}?endpoint=candles&market_id=${marketId}&resolution=${intervalMap[interval]}&start_timestamp=${Math.floor(startTime)}&end_timestamp=${now}&count_back=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal,
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((candle: LighterCandleItem) => ({
      openTime: candle.t,
      closeTime: candle.t + (interval === "1d" ? 86400000 : interval === "4h" ? 14400000 : 3600000),
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      volume: candle.v,
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return [];
    }

    console.error(`Error fetching candles for market ${marketId}:`, error);
    return [];
  }
}

/**
 * 按时间间隔聚合历史资金费率
 */
export function getAverageFundingRatesByInterval(
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

/**
 * 计算资金费率统计（最高、最低、平均）
 */
export function getFundingStats(items: IntervalFundingRateItem[]): FundingStats | null {
  if (items.length === 0) {
    return null;
  }

  const rates = items.map((item) => item.averageFundingRate);
  const highest = Math.max(...rates);
  const lowest = Math.min(...rates);
  const average = rates.reduce((sum, r) => sum + r, 0) / rates.length;

  return { highest, lowest, average };
}

// ==================== 格式化函数 ====================

/**
 * 将资金费率转换为年化费率
 */
export function toAnnualizedRate(rate: string | number): number {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return rateNumber * 24 * 365 * 100; // 1小时结算，每天24次
}

/**
 * 格式化资金费率为百分比字符串
 * 注意：API 返回的是 8 小时费率，需要除以 8 转换为每小时费率
 */
export function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // 将 8 小时费率转换为每小时费率（除以 8）
  const hourlyRate = rateNumber / 8;
  return `${(hourlyRate * 100).toFixed(4)}%`;
}

/**
 * 格式化年化资金费率
 * 注意：API 返回的是 8 小时费率，需要除以 8 转换为每小时费率后再年化
 */
export function formatAnnualizedRate(rate: string | number): string {
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

/**
 * 格式化价格
 */
export function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;

  if (priceNumber >= 1000) {
    return priceNumber.toFixed(2);
  }
  if (priceNumber >= 1) {
    return priceNumber.toFixed(4);
  }
  return priceNumber.toFixed(6);
}

/**
 * 格式化成交量
 */
export function formatVolume(volume: string | number): string {
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

/**
 * 格式化时间
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * 格式化日期
 */
export function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
}
