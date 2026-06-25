import {
  type NormalizedFundingRate,
  type NormalizedFundingHistoryItem,
  type NormalizedCandle,
  type NormalizedIntervalFundingRate,
  type ChartInterval,
  INTERVAL_MS,
} from "../types";

// ==================== 原始 API 类型 ====================

interface HyperliquidMarketInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

interface HyperliquidAssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: string[] | null;
  dayBaseVlm: string;
}

interface HyperliquidFundingHistoryItem {
  time: number;
  coin: string;
  fundingRate: string;
  premium: string;
  markPrice?: string;
  indexPrice?: string;
}

interface HyperliquidCandleItem {
  t: number;   // openTime
  T: number;   // closeTime
  s: string;   // symbol
  i: string;   // interval
  o: string;   // open
  h: string;   // high
  l: string;   // low
  c: string;   // close
  v: string;   // volume
  n: number;   // trades
}

// ==================== 标准化函数 ====================

/**
 * 将 Hyperliquid 永续合约数据标准化
 */
export function normalizeHyperliquidPerpRates(
  markets: HyperliquidMarketInfo[],
  contexts: HyperliquidAssetContext[]
): NormalizedFundingRate[] {
  return markets.map((market, index) => {
    const ctx = contexts[index];
    const fundingRate = parseFloat(ctx?.funding || "0");
    const markPrice = parseFloat(ctx?.markPx || "0");
    const openInterest = parseFloat(ctx?.openInterest || "0");
    const dayVolume = parseFloat(ctx?.dayNtlVlm || "0");
    
    // 持仓价值 = 持仓量 * 标记价格 (Hyperliquid 的 openInterest 已经是基础货币单位)
    const notionalValue = openInterest * markPrice;
    
    return {
      exchange: "hyperliquid",
      symbol: market.name,
      rawSymbol: market.name,
      fundingRate,
      markPrice,
      indexPrice: parseFloat(ctx?.oraclePx || "0"),
      openInterest,
      notionalValue,
      volume24h: dayVolume,
      change24h: ctx?.prevDayPx 
        ? ((markPrice - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx)) * 100 
        : undefined,
      fundingIntervalSeconds: 3600, // Hyperliquid 每小时结算
      fundingIntervalsPerDay: 24,
      assetCategory: "Crypto",
      isHip3: false,
      raw: { market, ctx },
    };
  });
}

/**
 * 将 Hyperliquid HIP-3 资产数据标准化
 */
export function normalizeHyperliquidHip3Rates(
  markets: HyperliquidMarketInfo[],
  contexts: HyperliquidAssetContext[],
  dex: "xyz" | "para" | "cash" | "hyna"
): NormalizedFundingRate[] {
  return markets.map((market, index) => {
    const ctx = contexts[index];
    const fundingRate = parseFloat(ctx?.funding || "0");
    const markPrice = parseFloat(ctx?.markPx || "0");
    const openInterest = parseFloat(ctx?.openInterest || "0");
    const dayVolume = parseFloat(ctx?.dayNtlVlm || "0");
    const notionalValue = openInterest * markPrice;
    
    const symbol = `${dex}:${market.name}`;
    
    return {
      exchange: "hyperliquid",
      symbol,
      rawSymbol: symbol,
      fundingRate,
      markPrice,
      indexPrice: parseFloat(ctx?.oraclePx || "0"),
      openInterest,
      notionalValue,
      volume24h: dayVolume,
      fundingIntervalSeconds: 3600,
      fundingIntervalsPerDay: 24,
      assetCategory: dex,
      isHip3: true,
      raw: { market, ctx, dex },
    };
  });
}

/**
 * 将 Hyperliquid 历史资金费率数据标准化
 */
export function normalizeHyperliquidHistory(
  history: HyperliquidFundingHistoryItem[],
  symbol: string
): NormalizedFundingHistoryItem[] {
  return history.map((item) => ({
    exchange: "hyperliquid",
    symbol,
    timestamp: item.time, // Hyperliquid 已经是毫秒
    fundingRate: parseFloat(item.fundingRate),
  }));
}

/**
 * 将 Hyperliquid K 线数据标准化
 */
export function normalizeHyperliquidCandles(
  candles: HyperliquidCandleItem[]
): NormalizedCandle[] {
  return candles.map((item) => ({
    exchange: "hyperliquid",
    symbol: item.s,
    openTime: item.t,
    closeTime: item.T,
    open: parseFloat(item.o),
    high: parseFloat(item.h),
    low: parseFloat(item.l),
    close: parseFloat(item.c),
    volume: parseFloat(item.v),
  }));
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
