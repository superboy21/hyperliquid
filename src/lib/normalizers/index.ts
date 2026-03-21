// ==================== 统一导出 ====================

// 类型导出
export * from "../types";

// Hyperliquid 标准化函数
export {
  normalizeHyperliquidPerpRates,
  normalizeHyperliquidHip3Rates,
  normalizeHyperliquidHistory,
  normalizeHyperliquidCandles,
  aggregateFundingRatesByInterval as aggregateHyperliquidFundingRates,
} from "./hyperliquid";

// Gate.io 标准化函数
export {
  normalizeGateioTickers,
  normalizeGateioHistory,
  normalizeGateioCandles,
  aggregateFundingRatesByInterval as aggregateGateioFundingRates,
  formatContractName,
  toContractName,
  convertInterval,
} from "./gateio";

// Binance 标准化函数
export {
  getAllFundingRates as getBinanceFundingRates,
  getFundingHistory as getBinanceFundingHistory,
  getFundingHistoryForDays as getBinanceFundingHistoryForDays,
  getCandleSnapshot as getBinanceCandleSnapshot,
  getAverageFundingRatesByInterval as getBinanceAverageFundingRatesByInterval,
  formatContractName as formatBinanceContractName,
  toContractName as toBinanceContractName,
  convertInterval as convertBinanceInterval,
  toAnnualizedRate as toBinanceAnnualizedRate,
  formatFundingRate as formatBinanceFundingRate,
  formatAnnualizedRate as formatBinanceAnnualizedRate,
  formatPrice as formatBinancePrice,
  formatVolume as formatBinanceVolume,
  type FundingRate as BinanceFundingRate,
  type FundingHistoryItem as BinanceFundingHistoryItem,
  type CandleSnapshotItem as BinanceCandleSnapshotItem,
  type ChartInterval as BinanceChartInterval,
  type IntervalFundingRateItem as BinanceIntervalFundingRateItem,
} from "./binance";

// 工具函数
export {
  calculateAverageFundingRate,
  calculateAveragesFromHistory,
  calculateWeightedAverageRate,
  getRatesByCategory,
  filterFundingRates,
  sortFundingRates,
  filterAndSortFundingRates,
  getLastNDaysHistory,
  annualizeReturn,
  calculateHistoricalVolatility,
} from "../utils/funding";

// ==================== 交易所工厂 ====================

import type { ExchangeId } from "../types";
import {
  normalizeHyperliquidPerpRates,
  normalizeHyperliquidHip3Rates,
  normalizeHyperliquidHistory,
  normalizeHyperliquidCandles,
  aggregateFundingRatesByInterval as aggregateHyperliquidFundingRates,
} from "./hyperliquid";
import {
  normalizeGateioTickers,
  normalizeGateioHistory,
  normalizeGateioCandles,
  aggregateFundingRatesByInterval as aggregateGateioFundingRates,
} from "./gateio";

/**
 * 交易所标准化器接口
 */
export interface ExchangeNormalizer {
  normalizeRates(rawData: unknown[]): unknown[];
  normalizeHistory(history: unknown[], symbol: string): unknown[];
  normalizeCandles(candles: unknown[], symbol?: string, interval?: string): unknown[];
  aggregateHistory(history: unknown[], interval: string): unknown[];
}

/**
 * 获取交易所标准化器
 */
export function getNormalizer(exchange: ExchangeId): ExchangeNormalizer {
  switch (exchange) {
    case "hyperliquid":
      return {
        normalizeRates: (data) => {
          // 假设 data 是 [markets, contexts] 元组
          const [markets, contexts] = data as [unknown[], unknown[]];
          return normalizeHyperliquidPerpRates(markets as any, contexts as any);
        },
        normalizeHistory: (history, symbol) => 
          normalizeHyperliquidHistory(history as any, symbol),
        normalizeCandles: (candles) => 
          normalizeHyperliquidCandles(candles as any),
        aggregateHistory: (history, interval) =>
          aggregateHyperliquidFundingRates(history as any, interval as any),
      };
      
    case "gateio":
      return {
        normalizeRates: (data) => 
          normalizeGateioTickers(data as any),
        normalizeHistory: (history, symbol) => 
          normalizeGateioHistory(history as any, symbol),
        normalizeCandles: (candles, symbol, interval) => 
          normalizeGateioCandles(candles as any, symbol || "", (interval || "1d") as any),
        aggregateHistory: (history, interval) =>
          aggregateGateioFundingRates(history as any, interval as any),
      };
      
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}

// ==================== 统计计算 ====================

import type { 
  NormalizedFundingRate, 
  FundingStats 
} from "../types";

/**
 * 计算资金费率统计
 */
export function calculateFundingStats(
  rates: NormalizedFundingRate[]
): FundingStats | null {
  if (rates.length === 0) return null;
  
  const annualizedRates = rates.map((rate) => {
    const { fundingRate, fundingIntervalSeconds } = rate;
    const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
    return fundingRate * settlementsPerDay * 365 * 100;
  });
  
  const highest = Math.max(...annualizedRates);
  const lowest = Math.min(...annualizedRates);
  const average = annualizedRates.reduce((sum, r) => sum + r, 0) / annualizedRates.length;
  
  // 按持仓价值加权的平均年化
  const totalNotional = rates.reduce((sum, r) => sum + r.notionalValue, 0);
  const weightedSum = rates.reduce((sum, r) => {
    const { fundingRate, fundingIntervalSeconds, notionalValue } = r;
    const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
    const annualized = fundingRate * settlementsPerDay * 365 * 100;
    return sum + annualized * notionalValue;
  }, 0);
  const weightedAverage = totalNotional > 0 ? weightedSum / totalNotional : 0;
  
  return {
    highest,
    lowest,
    average,
    weightedAverage,
  };
}

/**
 * 计算正负资金费率数量
 */
export function countPositiveNegativeRates(
  rates: NormalizedFundingRate[]
): { positive: number; negative: number; zero: number } {
  let positive = 0;
  let negative = 0;
  let zero = 0;
  
  for (const rate of rates) {
    if (rate.fundingRate > 0) positive++;
    else if (rate.fundingRate < 0) negative++;
    else zero++;
  }
  
  return { positive, negative, zero };
}
