import {
  type NormalizedFundingRate,
  type NormalizedFundingHistoryItem,
  type NormalizedCandle,
  type NormalizedIntervalFundingRate,
  type ChartInterval,
  INTERVAL_MS,
} from "../types";

// ==================== 原始 API 类型 ====================

interface GateTicker {
  contract: string;
  last: string;
  low_24h: string;
  high_24h: string;
  change_percentage: string;
  change_price: string;
  funding_rate: string;
  funding_rate_indicative: string;
  mark_price: string;
  index_price: string;
  total_size: string;
  volume_24h: string;
  volume_24h_settle: string;
  volume_24h_base: string;
  volume_24h_quote: string;
  quanto_multiplier: string;
  highest_bid: string;
  lowest_ask: string;
  funding_interval: number;
  asset_category: string;
}

interface GateFundingHistoryItem {
  contract: string;
  t: number;  // 秒
  r: string;  // 资金费率
}

interface GateCandlestick {
  t: number;  // 秒
  o: string;
  h: string;
  l: string;
  c: string;
  v: number;
  sum: string;
}

// ==================== 工具函数 ====================

/**
 * 将合约名称转换为简化格式
 * "BTC_USDT" -> "BTC"
 */
function formatContractName(contract: string): string {
  return contract.replace("_USDT", "").replace("_USD", "");
}

/**
 * 将简化名称转换为合约名称
 * "BTC" -> "BTC_USDT"
 */
function toContractName(coin: string): string {
  if (coin.includes("_")) {
    return coin;
  }
  return `${coin}_USDT`;
}

/**
 * 将 ChartInterval 转换为 Gate.io API 参数
 */
function convertInterval(interval: ChartInterval): string {
  switch (interval) {
    case "1d":
      return "1d";
    case "4h":
      return "4h";
    case "1h":
      return "1h";
    default:
      return "1d";
  }
}

// ==================== 标准化函数 ====================

/**
 * 将 Gate.io ticker 数据标准化
 */
export function normalizeGateioTickers(
  tickers: GateTicker[]
): NormalizedFundingRate[] {
  return tickers.map((ticker) => {
    const totalSize = parseFloat(ticker.total_size) || 0;
    const markPrice = parseFloat(ticker.mark_price) || 0;
    const multiplier = parseFloat(ticker.quanto_multiplier) || 1;
    const fundingRate = parseFloat(ticker.funding_rate) || 0;
    
    // 持仓价值 = 持仓张数 * 合约乘数 * 标记价格
    const notionalValue = totalSize * multiplier * markPrice;
    
    // 结算周期 (秒)
    const fundingIntervalSeconds = ticker.funding_interval || 28800;
    const fundingIntervalsPerDay = (24 * 3600) / fundingIntervalSeconds;
    
    // 24h 涨跌幅
    const change24h = parseFloat(ticker.change_percentage) || undefined;
    
    return {
      exchange: "gateio",
      symbol: formatContractName(ticker.contract),
      rawSymbol: ticker.contract,
      fundingRate,
      fundingRateIndicative: parseFloat(ticker.funding_rate_indicative) || undefined,
      markPrice,
      indexPrice: parseFloat(ticker.index_price) || 0,
      lastPrice: parseFloat(ticker.last) || undefined,
      openInterest: totalSize,
      notionalValue,
      volume24h: parseFloat(ticker.volume_24h_settle) || 0,
      change24h,
      fundingIntervalSeconds,
      fundingIntervalsPerDay,
      assetCategory: ticker.asset_category || "其他",
      isHip3: false,
      raw: ticker,
    };
  });
}

/**
 * 将 Gate.io 历史资金费率数据标准化
 */
export function normalizeGateioHistory(
  history: GateFundingHistoryItem[],
  symbol: string
): NormalizedFundingHistoryItem[] {
  return history.map((item) => ({
    exchange: "gateio" as const,
    symbol,
    timestamp: item.t * 1000, // 转换为毫秒
    fundingRate: parseFloat(item.r),
  }));
}

/**
 * 将 Gate.io K 线数据标准化
 */
export function normalizeGateioCandles(
  candles: GateCandlestick[],
  symbol: string,
  interval: ChartInterval
): NormalizedCandle[] {
  const intervalMs = INTERVAL_MS[interval];
  
  return candles.map((item) => {
    const openTime = item.t * 1000; // 转换为毫秒
    return {
      exchange: "gateio" as const,
      symbol,
      openTime,
      closeTime: openTime + intervalMs,
      open: parseFloat(item.o),
      high: parseFloat(item.h),
      low: parseFloat(item.l),
      close: parseFloat(item.c),
      volume: item.v,
    };
  });
}

/**
 * 按时间间隔聚合历史资金费率
 */
export function aggregateFundingRatesByInterval(
  history: NormalizedFundingHistoryItem[],
  interval: ChartInterval
): NormalizedIntervalFundingRate[] {
  if (history.length === 0) return [];
  
  const exchange = history[0].exchange;
  const symbol = history[0].symbol;
  const intervalMs = INTERVAL_MS[interval];
  
  const grouped = new Map<number, { total: number; count: number }>();

  for (const item of history) {
    const bucketStartTime = Math.floor(item.timestamp / intervalMs) * intervalMs;
    const existing = grouped.get(bucketStartTime) ?? { total: 0, count: 0 };
    existing.total += item.fundingRate;
    existing.count += 1;
    grouped.set(bucketStartTime, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStartTime, value]) => ({
      exchange,
      symbol,
      bucketStartTime,
      averageFundingRate: value.count > 0 ? value.total / value.count : 0,
      sampleCount: value.count,
    }));
}

// ==================== 导出工具函数 ====================

export { formatContractName, toContractName, convertInterval };
