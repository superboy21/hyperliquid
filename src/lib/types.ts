// ==================== 交易所标识 ====================

export type ExchangeId = "hyperliquid" | "gateio" | "binance";

export interface ExchangeInfo {
  id: ExchangeId;
  name: string;
  color: string; // 主题色
  accentColor: string; // 强调色
}

export const EXCHANGES: Record<ExchangeId, ExchangeInfo> = {
  hyperliquid: {
    id: "hyperliquid",
    name: "Hyperliquid",
    color: "blue",
    accentColor: "bg-blue-600",
  },
  gateio: {
    id: "gateio",
    name: "Gate.io",
    color: "cyan",
    accentColor: "bg-cyan-600",
  },
  binance: {
    id: "binance",
    name: "Binance",
    color: "yellow",
    accentColor: "bg-yellow-600",
  },
};

// ==================== 统一数据接口 ====================

/**
 * 标准化的资金费率数据
 * 所有交易所的数据都会转换为这个统一格式
 */
export interface NormalizedFundingRate {
  // 基本信息
  exchange: ExchangeId;           // 交易所标识
  symbol: string;                 // 简化交易对名称 (如 "BTC")
  rawSymbol: string;              // 原始交易对名称 (如 "BTC_USDT" 或 "BTC")
  
  // 资金费率
  fundingRate: number;            // 当前资金费率 (小数，如 0.0001 = 0.01%)
  fundingRateIndicative?: number; // 预测资金费率 (Gate.io)
  
  // 价格数据
  markPrice: number;              // 标记价格
  indexPrice: number;             // 指数价格
  lastPrice?: number;             // 最新成交价 (Gate.io)
  
  // 市场数据
  openInterest: number;           // 持仓量 (原始单位)
  notionalValue: number;          // 持仓价值 (USD)
  volume24h: number;              // 24小时成交量 (USD)
  change24h?: number;             // 24小时涨跌幅 (%, Gate.io)
  
  // 资金费率周期
  fundingIntervalSeconds: number; // 结算周期 (秒)，默认 28800 (8小时)
  fundingIntervalsPerDay: number; // 每日结算次数
  
  // 资产分类
  assetCategory: string;          // 资产类别 (Crypto/股票/指数/商品/其他)
  isHip3?: boolean;               // 是否为 HIP-3 资产 (Hyperliquid)
  
  // 历史统计 (可选)
  avg7d?: number;                 // 7天平均资金费率
  avg30d?: number;                // 30天平均资金费率
  
  // 原始数据 (用于调试或特殊需求)
  raw?: unknown;
}

/**
 * 标准化的历史资金费率数据
 */
export interface NormalizedFundingHistoryItem {
  exchange: ExchangeId;
  symbol: string;
  timestamp: number;              // 毫秒时间戳
  fundingRate: number;            // 资金费率 (小数)
}

/**
 * 标准化的 K 线数据
 */
export interface NormalizedCandle {
  exchange: ExchangeId;
  symbol: string;
  openTime: number;               // 毫秒时间戳
  closeTime: number;              // 毫秒时间戳
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 按时间间隔聚合的资金费率
 */
export interface NormalizedIntervalFundingRate {
  exchange: ExchangeId;
  symbol: string;
  bucketStartTime: number;        // 毫秒时间戳
  averageFundingRate: number;     // 平均资金费率 (小数)
  sampleCount: number;            // 样本数量
}

// ==================== 图表周期 ====================

export type ChartInterval = "1d" | "4h" | "1h";

export const INTERVAL_MS: Record<ChartInterval, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

// ==================== 资产分类 ====================

export type AssetCategory = "Crypto" | "股票/指数" | "商品" | "其他";

export const ASSET_CATEGORIES: AssetCategory[] = [
  "Crypto",
  "股票/指数",
  "商品",
  "其他",
];

// ==================== 排序和筛选 ====================

export type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";

export interface SortConfig {
  field: SortField;
  descending: boolean;
}

export interface FilterConfig {
  searchTerm: string;
  category: AssetCategory | "all";
}

// ==================== 统计数据 ====================

export interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
  weightedAverage?: number;       // 按持仓价值加权的平均年化
}

// ==================== 格式化工具函数 ====================

/**
 * 将资金费率转换为年化费率
 * @param rate 资金费率 (小数)
 * @param fundingIntervalSeconds 结算周期 (秒)
 */
export function toAnnualizedRate(
  rate: number,
  fundingIntervalSeconds: number = 28800
): number {
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  return rate * settlementsPerDay * 365 * 100;
}

/**
 * 格式化资金费率为百分比字符串
 */
export function formatFundingRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

/**
 * 格式化年化资金费率
 */
export function formatAnnualizedRate(
  rate: number,
  fundingIntervalSeconds: number = 28800
): string {
  const annualized = toAnnualizedRate(rate, fundingIntervalSeconds);
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
export function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toFixed(2);
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  return price.toFixed(6);
}

/**
 * 格式化成交量/持仓价值
 */
export function formatVolume(volume: number): string {
  if (volume >= 1e9) {
    return `${(volume / 1e9).toFixed(2)}B`;
  }
  if (volume >= 1e6) {
    return `${(volume / 1e6).toFixed(2)}M`;
  }
  if (volume >= 1e3) {
    return `${(volume / 1e3).toFixed(2)}K`;
  }
  return volume.toFixed(2);
}

/**
 * 格式化时间戳
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

/**
 * 格式化 K 线标签
 */
export function formatIntervalLabel(
  timestamp: number,
  interval: ChartInterval
): string {
  if (interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/**
 * 格式化坐标轴标签 (带换行)
 */
export function formatAxisIntervalLabel(
  timestamp: number,
  interval: ChartInterval
): string {
  const formatted = formatIntervalLabel(timestamp, interval);
  return interval !== "1d" ? formatted.replace(" ", "\n") : formatted;
}
