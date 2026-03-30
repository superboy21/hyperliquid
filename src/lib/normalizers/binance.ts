// Binance API 资金费率监控模块
// API 文档: https://binance-docs.github.io/apidocs/futures/en/

// 使用 Next.js API 代理避免 CORS 问题
const API_PROXY_BASE = "/api/binance";

// ==================== 类型定义 ====================

export interface BinanceFundingRateItem {
  symbol: string;
  fundingTime: number;
  fundingRate: string;
  markPrice?: string;
}

export interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  estimatedSettlePrice: string;
  interestRate: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
}

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

export interface BinanceSymbolInfo {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  onboardDate: number;
  status: string;
  maintMarginPercent: string;
  requiredMarginPercent: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quotePrecision: number;
  filters: Array<{
    filterType: string;
    minPrice?: string;
    maxPrice?: string;
    tickSize?: string;
    minQty?: string;
    maxQty?: string;
    stepSize?: string;
  }>;
}

export interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  futuresType: string;
  rateLimits: Array<{
    rateLimitType: string;
    interval: string;
    intervalNum: number;
    limit: number;
  }>;
  symbols: BinanceSymbolInfo[];
}

// 内部使用的统一类型
export interface FundingRate {
  symbol: string;
  fundingRate: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  volume24h: string;
  priceChangePercent: string;
  openInterest: string;
  fundingInterval: number;
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

export type ChartInterval = "1d" | "4h" | "1h";

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

// ==================== 常量 ====================

export const BINANCE_FUNDING_INTERVAL_SECONDS = 8 * 60 * 60; // 8小时

export const intervalMap: Record<ChartInterval, string> = {
  "1d": "1d",
  "4h": "4h",
  "1h": "1h",
};

// ==================== API 函数 ====================

/**
 * 获取所有永续合约的资金费率
 */
export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    // 使用 premiumIndex 获取实时资金费率
    const response = await fetch(
      `${API_PROXY_BASE}/funding?endpoint=premiumIndex`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch funding rates");
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid response format");
    }

    return data.map((item: BinancePremiumIndex) => ({
      symbol: item.symbol,
      fundingRate: item.lastFundingRate || "0",
      markPrice: item.markPrice || "0",
      indexPrice: item.indexPrice || "0",
      lastFundingRate: item.lastFundingRate || "0",
      nextFundingTime: item.nextFundingTime || 0,
      lastPrice: item.lastPrice || "0",
      bidPrice: item.bidPrice || "0",
      askPrice: item.askPrice || "0",
      volume24h: "0",
      priceChangePercent: "0",
      openInterest: "0",
      fundingInterval: BINANCE_FUNDING_INTERVAL_SECONDS,
    }));
  } catch (error) {
    console.error("Error fetching funding rates:", error);
    return [];
  }
}

/**
 * 获取指定合约的历史资金费率
 * @param symbol 合约名称，如 "BTCUSDT"
 * @param limit 返回记录数量，默认 100
 */
export async function getFundingHistory(
  symbol: string,
  limit: number = 100
): Promise<FundingHistoryItem[]> {
  try {
    const response = await fetch(
      `${API_PROXY_BASE}/funding?endpoint=fundingRate&symbol=${symbol}&limit=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: BinanceFundingRateItem) => ({
      time: item.fundingTime,
      fundingRate: item.fundingRate,
    }));
  } catch (error) {
    console.error(`Error fetching funding history for ${symbol}:`, error);
    return [];
  }
}

/**
 * 获取指定合约的历史资金费率（指定天数）
 * @param symbol 合约名称，如 "BTCUSDT"
 * @param days 天数
 */
export async function getFundingHistoryForDays(
  symbol: string,
  days: number = 30
): Promise<FundingHistoryItem[]> {
  const limit = Math.min(days * 3, 1000); // Binance API 最多返回 1000 条
  return getFundingHistory(symbol, limit);
}

/**
 * 获取 K 线数据
 */
export async function getCandleSnapshot(
  symbol: string,
  interval: ChartInterval,
  limit: number = 30
): Promise<CandleSnapshotItem[]> {
  try {
    const response = await fetch(
      `${API_PROXY_BASE}/klines?symbol=${symbol}&interval=${intervalMap[interval]}&limit=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((kline: any[]) => ({
      openTime: kline[0],
      open: kline[1],
      high: kline[2],
      low: kline[3],
      close: kline[4],
      volume: kline[5],
      closeTime: kline[6],
    }));
  } catch (error) {
    console.error(`Error fetching candles for ${symbol}:`, error);
    return [];
  }
}

/**
 * 格式化合约名称
 * "BTCUSDT" -> "BTC"
 */
export function formatContractName(symbol: string): string {
  // 移除 USDT 后缀
  return symbol.replace(/USDT$/i, "");
}

/**
 * 将简化名称转换为合约名称
 * "BTC" -> "BTCUSDT"
 */
export function toContractName(coin: string): string {
  if (coin.endsWith("USDT")) {
    return coin;
  }
  return `${coin}USDT`;
}

/**
 * 将 ChartInterval 转换为 Binance API 参数
 */
export function convertInterval(interval: ChartInterval): string {
  return intervalMap[interval];
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

export interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
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
  return rateNumber * 3 * 365 * 100; // 8小时结算，每天3次
}

/**
 * 格式化资金费率为百分比字符串
 */
export function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

/**
 * 格式化年化资金费率
 * @param fundingIntervalSeconds 结算周期（秒），默认 28800（8小时）
 */
export function formatAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): string {
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
