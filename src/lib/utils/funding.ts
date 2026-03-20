import type { NormalizedFundingRate, NormalizedFundingHistoryItem } from "../types";

/**
 * 计算历史平均资金费率
 * @param history 历史数据
 * @param days 天数
 * @returns 平均资金费率
 */
export function calculateAverageFundingRate(
  history: { time: number; fundingRate: string }[],
  days: number
): number | null {
  if (history.length === 0) return null;
  
  const endTimeMs = Date.now();
  const startTimeMs = endTimeMs - days * 24 * 60 * 60 * 1000;
  const filteredHistory = history.filter((h) => h.time >= startTimeMs);
  
  if (filteredHistory.length === 0) return null;
  
  const sum = filteredHistory.reduce((acc, h) => acc + parseFloat(h.fundingRate), 0);
  return sum / filteredHistory.length;
}

/**
 * 计算7天和30天平均资金费率
 * @param history 历史数据
 * @returns 包含7天和30天平均的对象
 */
export function calculateAveragesFromHistory(
  history: { time: number; fundingRate: string }[]
): { avg7d: number | null; avg30d: number | null } {
  if (history.length === 0) {
    return { avg7d: null, avg30d: null };
  }
  
  const avg7d = calculateAverageFundingRate(history, 7);
  const avg30d = calculateAverageFundingRate(history, 30);
  
  return { avg7d, avg30d };
}

/**
 * 计算持仓价值加权平均资金费率
 * @param rates 标准化资金费率数据
 * @returns 加权平均资金费率
 */
export function calculateWeightedAverageRate(
  rates: NormalizedFundingRate[]
): number {
  if (rates.length === 0) return 0;
  
  const totalNotionalValue = rates.reduce((sum, r) => sum + r.notionalValue, 0);
  
  if (totalNotionalValue === 0) {
    // 如果没有持仓价值数据，返回简单平均
    const sum = rates.reduce((acc, r) => acc + r.fundingRate, 0);
    return sum / rates.length;
  }
  
  const weightedSum = rates.reduce(
    (sum, r) => sum + r.fundingRate * r.notionalValue,
    0
  );
  
  return weightedSum / totalNotionalValue;
}

/**
 * 按资产类别统计资金费率数量
 * @param rates 标准化资金费率数据
 * @returns 按类别分组的数量统计
 */
export function getRatesByCategory(
  rates: NormalizedFundingRate[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  
  for (const rate of rates) {
    const category = rate.assetCategory || "其他";
    counts[category] = (counts[category] || 0) + 1;
  }
  
  return counts;
}

/**
 * 筛选资金费率数据
 * @param rates 标准化资金费率数据
 * @param searchTerm 搜索词
 * @param category 资产类别
 * @returns 筛选后的数据
 */
export function filterFundingRates(
  rates: NormalizedFundingRate[],
  searchTerm: string = "",
  category: string = "all"
): NormalizedFundingRate[] {
  return rates.filter((rate) => {
    // 搜索词筛选
    const matchesSearch = !searchTerm || 
      rate.symbol.toLowerCase().includes(searchTerm.toLowerCase());
    
    // 资产类别筛选
    const matchesCategory = category === "all" || 
      rate.assetCategory === category;
    
    return matchesSearch && matchesCategory;
  });
}

/**
 * 排序资金费率数据
 * @param rates 标准化资金费率数据
 * @param sortBy 排序字段
 * @param descending 是否降序
 * @returns 排序后的数据
 */
export function sortFundingRates(
  rates: NormalizedFundingRate[],
  sortBy: string = "rate",
  descending: boolean = true
): NormalizedFundingRate[] {
  const sorted = [...rates].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case "rate":
        comparison = Math.abs(a.fundingRate) - Math.abs(b.fundingRate);
        break;
      case "name":
        comparison = a.symbol.localeCompare(b.symbol);
        break;
      case "volume":
        comparison = a.volume24h - b.volume24h;
        break;
      case "price":
        comparison = a.markPrice - b.markPrice;
        break;
      case "change":
        comparison = (a.change24h || 0) - (b.change24h || 0);
        break;
      case "oi":
        comparison = a.notionalValue - b.notionalValue;
        break;
      default:
        comparison = 0;
    }
    
    return descending ? -comparison : comparison;
  });
  
  return sorted;
}

/**
 * 筛选并排序资金费率数据
 * @param rates 标准化资金费率数据
 * @param searchTerm 搜索词
 * @param category 资产类别
 * @param sortBy 排序字段
 * @param descending 是否降序
 * @returns 筛选并排序后的数据
 */
export function filterAndSortFundingRates(
  rates: NormalizedFundingRate[],
  searchTerm: string = "",
  category: string = "all",
  sortBy: string = "rate",
  descending: boolean = true
): NormalizedFundingRate[] {
  const filtered = filterFundingRates(rates, searchTerm, category);
  return sortFundingRates(filtered, sortBy, descending);
}

/**
 * 获取历史数据的最后N天
 * @param history 历史数据
 * @param days 天数
 * @returns 筛选后的历史数据
 */
export function getLastNDaysHistory(
  history: NormalizedFundingHistoryItem[],
  days: number
): NormalizedFundingHistoryItem[] {
  const startTimeMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((h) => h.timestamp >= startTimeMs);
}

/**
 * 计算年化收益率
 * @param totalReturn 总收益率（小数）
 * @param days 天数
 * @returns 年化收益率（百分比）
 */
export function annualizeReturn(
  totalReturn: number,
  days: number
): number {
  if (days <= 0) return 0;
  return (totalReturn * 365 / days) * 100;
}

/**
 * 计算历史波动率
 * @param prices 价格数组
 * @returns 年化波动率（百分比）
 */
export function calculateHistoricalVolatility(
  prices: number[]
): number {
  if (prices.length < 2) return 0;
  
  // 计算对数收益率
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  
  if (logReturns.length < 2) return 0;
  
  // 计算标准差
  const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  // 年化（假设每日数据）
  return stdDev * Math.sqrt(365) * 100;
}
