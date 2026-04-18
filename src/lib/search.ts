// ==================== Cross-Exchange Search Utility ====================
// Fetches, filters, and computes detail fields for funding rates across
// Hyperliquid, Gate.io, Binance, and Lighter exchanges.

import {
  getAllFundingRatesWithHistory,
  getCandleSnapshot as hlGetCandleSnapshot,
  getFundingHistoryForDays as hlGetFundingHistoryForDays,
  getAverageFundingRatesByInterval as hlGetAverageFundingRatesByInterval,
  type FundingHistoryItem as HlFundingHistoryItem,
  type CandleSnapshotItem as HlCandleSnapshotItem,
} from "./hyperliquid";
import {
  getAllFundingRates as gateGetAllFundingRates,
  getCandleSnapshot as gateGetCandleSnapshot,
  getFundingHistoryForDays as gateGetFundingHistoryForDays,
  getAverageFundingRatesByInterval as gateGetAverageFundingRatesByInterval,
  getFundingHistory as gateGetFundingHistory,
  type FundingHistoryItem as GateFundingHistoryItem,
  type CandleSnapshotItem as GateCandleSnapshotItem,
} from "./gateio";
import { calculateHistoricalVolatility } from "./utils/funding";
import {
  getLatestSettledFundingRate as lighterGetLatestSettledFundingRate,
  getFundingHistoryForDays as lighterGetFundingHistoryForDays,
  getCandleSnapshot as lighterGetCandleSnapshot,
} from "./lighter";
import { isAbortLikeError } from "./utils/abort";
import {
  fetchBinanceCanonicalDetail,
  fetchBinanceSearchRates,
  hydrateBinanceOpenInterest,
  mapDetailToMetrics as mapBinanceDetailToMetrics,
} from "@/lib/adapters/binance";
import {
  fetchGateCanonicalDetail,
  fetchGateSearchRates,
} from "@/lib/adapters/gate";
import {
  computeOkxAverageFundingRatesByInterval,
  fetchOkxCanonicalDetail,
  fetchOkxCanonicalRates,
  mapOkxDetailToMetrics,
} from "@/lib/adapters/okx";

// ==================== Interfaces ====================

export interface SearchExchangeRate {
  exchange: "Hyperliquid" | "Gate.io" | "Binance" | "Lighter" | "OKX";
  exchangeColor: string;
  symbol: string;
  rawSymbol?: string;
  marketId?: number;
  fundingRate: number;
  markPrice: number;
  lastPrice: number;
  change24h: number;
  quoteVolume: number;
  openInterest: number;
  notionalValue: number;
  oiLoaded?: boolean;
  fundingInterval: number;
  assetCategory: string;
  bestBid?: number;
  bestAsk?: number;
  // Detail fields (loaded progressively)
  lastSettlementRate?: number | null;
  avgFundingRate1d?: number | null;
  historicalVolatility?: number | null;
  bidAskSpread?: number | null;
  avgFundingRate7d?: number | null;
  avgFundingRate30d?: number | null;
  detailLoading?: boolean;
  detailError?: boolean;
}

interface DetailResult {
  lastSettlementRate: number | null;
  avgFundingRate1d: number | null;
  historicalVolatility: number | null;
  bidAskSpread: number | null;
  avgFundingRate7d: number | null;
  avgFundingRate30d: number | null;
}

// ==================== Lighter API Types ====================

interface LighterFundingEntry {
  exchange: string;
  symbol: string;
  market_id: number;
  rate: string;
}

interface LighterOrderBookStat {
  symbol: string;
  last_trade_price: number | string;
  daily_price_change: number | string;
  daily_quote_token_volume: number | string;
}

interface LighterOrderBookDetail {
  market_id: number;
  open_interest: number | string;
  last_trade_price: number | string;
}

interface LighterCandle {
  t?: number;
  timestamp?: number;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  v?: number | string;
}

interface LighterFundingEntryRaw {
  rate: string;
  direction?: string;
  timestamp: number;
}

// ==================== Lighter Asset Categories ====================

const LIGHTER_EQUITIES = [
  "HOOD", "AAPL", "META", "INTC", "AMZN", "BMNR", "PLTR", "COIN",
  "SAMSUNG", "STRC", "AMD", "SNDK", "HANMI", "HYUNDAI", "ASML",
  "CRCL", "TSLA", "NVDA", "GOOGL", "MSTR", "MSFT",
];
const LIGHTER_ETF_INDEX = ["QQQ", "SPY", "KRCOMP", "URA", "IWM", "MAGS", "BOTZ", "DIA"];
const LIGHTER_FX = [
  "EURUSD", "USDKRW", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
];
const LIGHTER_COMMODITIES = ["XAU", "XAG", "WTI", "BRENTOIL", "XPT", "XCU", "XPD"];

function getLighterAssetCategory(symbol: string): string {
  if (LIGHTER_EQUITIES.includes(symbol)) return "Equities";
  if (LIGHTER_ETF_INDEX.includes(symbol)) return "ETF/Index";
  if (LIGHTER_FX.includes(symbol)) return "FX";
  if (LIGHTER_COMMODITIES.includes(symbol)) return "Commodities";
  return "Crypto";
}

// ==================== Interval Helpers ====================

type ChartInterval = "1d" | "4h" | "1h";

function getIntervalMs(interval: ChartInterval): number {
  switch (interval) {
    case "1d": return 24 * 60 * 60 * 1000;
    case "4h": return 4 * 60 * 60 * 1000;
    case "1h": return 60 * 60 * 1000;
  }
}

function getAverageFundingRatesByInterval(
  history: { time: number; fundingRate: string }[],
  interval: ChartInterval,
): { bucketStartTime: number; averageFundingRate: number; sampleCount: number }[] {
  if (history.length === 0) return [];
  const intervalMs = getIntervalMs(interval);
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

// ==================== Volatility Calculation ====================

function computeHistoricalVolatility(
  candles: Array<{ close: string }>,
): number | null {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => Number(c.close));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const periodVolatility = Math.sqrt(variance);
  const periodsPerYear = 365;
  return periodVolatility * Math.sqrt(periodsPerYear) * 100;
}

// ==================== Bid-Ask Spread Calculation ====================

function computeBidAskSpread(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number | null {
  if (bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0) {
    const midPrice = (bestBid + bestAsk) / 2;
    if (midPrice > 0) {
      return ((bestAsk - bestBid) / midPrice) * 100;
    }
  }
  return null;
}

// ==================== Avg Funding Rate Calculation ====================

function computeAvgFundingRates(
  fundingHistory: { time: number; fundingRate: string }[],
): { avg7d: number | null; avg30d: number | null } {
  // Filter to last 30 days first (same as BinanceFundingMonitor.tsx:374-376)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const fundingHistory30d = fundingHistory.filter((item) => item.time >= thirtyDaysAgo);

  const hourlyFundingRates30d = getAverageFundingRatesByInterval(fundingHistory30d, "1h");
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent7d = hourlyFundingRates30d.filter((item) => item.bucketStartTime >= sevenDaysAgo);

  const avg7d = recent7d.length > 0
    ? recent7d.reduce((sum, item) => sum + item.averageFundingRate, 0) / recent7d.length
    : null;

  const avg30d = hourlyFundingRates30d.length > 0
    ? hourlyFundingRates30d.reduce((sum, item) => sum + item.averageFundingRate, 0) / hourlyFundingRates30d.length
    : null;

  return { avg7d, avg30d };
}

// ==================== Avg 1D Funding Rate Calculation ====================

function computeAvgFundingRate1d(
  fundingHistory: { time: number; fundingRate: string }[],
): number | null {
  if (fundingHistory.length === 0) return null;

  // Get daily bucket averages
  const dailyRates = getAverageFundingRatesByInterval(fundingHistory, "1d");

  // Return the last 1d bucket average (matching chart tooltip semantics)
  if (dailyRates.length === 0) return null;

  const lastDailyBucket = dailyRates[dailyRates.length - 1];
  return lastDailyBucket.averageFundingRate;
}

// ==================== Fetch All Rates ====================

export async function fetchAllRates(): Promise<SearchExchangeRate[]> {
  const [hyperliquidRates, gateioRates, binanceRates, lighterRates, okxRates] = await Promise.allSettled([
    fetchHyperliquidRates(),
    fetchGateioRates(),
    fetchBinanceRates(),
    fetchLighterRates(),
    fetchOkxRates(),
  ]);

  const results: SearchExchangeRate[] = [];

  if (hyperliquidRates.status === "fulfilled") {
    results.push(...hyperliquidRates.value);
  } else {
    console.error("[Search] Hyperliquid fetch failed:", hyperliquidRates.reason);
  }

  if (gateioRates.status === "fulfilled") {
    results.push(...gateioRates.value);
  } else {
    console.error("[Search] Gate.io fetch failed:", gateioRates.reason);
  }

  if (binanceRates.status === "fulfilled") {
    results.push(...binanceRates.value);
  } else {
    console.error("[Search] Binance fetch failed:", binanceRates.reason);
  }

  if (lighterRates.status === "fulfilled") {
    results.push(...lighterRates.value);
  } else {
    console.error("[Search] Lighter fetch failed:", lighterRates.reason);
  }

  if (okxRates.status === "fulfilled") {
    results.push(...okxRates.value);
  } else {
    console.error("[Search] OKX fetch failed:", okxRates.reason);
  }

  return results;
}

// ==================== Hyperliquid Rates ====================

async function fetchHyperliquidRates(): Promise<SearchExchangeRate[]> {
  const rates = await getAllFundingRatesWithHistory();
  return rates.map((r) => ({
    exchange: "Hyperliquid" as const,
    exchangeColor: "blue",
    symbol: r.coin,
    rawSymbol: r.coin,
    fundingRate: parseFloat(r.fundingRate),
    markPrice: parseFloat(r.markPrice),
    lastPrice: parseFloat(r.markPrice),
    change24h: r.prevDayPx && parseFloat(r.prevDayPx) > 0
      ? ((parseFloat(r.markPrice) - parseFloat(r.prevDayPx)) / parseFloat(r.prevDayPx)) * 100
      : 0,
    quoteVolume: parseFloat(r.dayVolume),
    openInterest: parseFloat(r.openInterest),
    notionalValue: parseFloat(r.openInterest) * parseFloat(r.markPrice),
    fundingInterval: 3600,
    assetCategory: r.isSpot ? "股票/指数" : "Crypto",
    bestBid: r.bestBid ? parseFloat(r.bestBid) : undefined,
    bestAsk: r.bestAsk ? parseFloat(r.bestAsk) : undefined,
  }));
}

// ==================== Gate.io Rates ====================

async function fetchGateioRates(): Promise<SearchExchangeRate[]> {
  return fetchGateSearchRates();
}

// ==================== Binance Rates ====================

async function fetchBinanceRates(): Promise<SearchExchangeRate[]> {
  return fetchBinanceSearchRates();
}

export async function hydrateSearchBinanceOpenInterest(
  rates: SearchExchangeRate[],
  signal?: AbortSignal,
): Promise<Map<string, { openInterest: number; notionalValue: number }>> {
  const binanceRates = rates.filter((rate) => rate.exchange === "Binance");
  if (binanceRates.length === 0) {
    return new Map();
  }

const symbols = binanceRates.map((rate) => rate.symbol);
  return hydrateBinanceOpenInterest(symbols, signal);
}

// ==================== OKX Rates ====================

async function fetchOkxRates(): Promise<SearchExchangeRate[]> {
  const rows = await fetchOkxCanonicalRates();
  return rows.map((row) => ({
    exchange: "OKX" as const,
    exchangeColor: "emerald",
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    fundingRate: row.fundingRate,
    markPrice: row.markPrice,
    lastPrice: row.lastPrice,
    change24h: row.change24h,
    quoteVolume: row.quoteVolume,
    openInterest: row.openInterest,
    notionalValue: row.notionalValue,
    fundingInterval: row.fundingIntervalSeconds,
    assetCategory: row.assetCategory,
    bestBid: row.bestBid ?? undefined,
    bestAsk: row.bestAsk ?? undefined,
  }));
}

// ==================== Lighter Rates ====================

async function fetchLighterRates(): Promise<SearchExchangeRate[]> {
  const [fundingRes, statsRes, orderBookRes] = await Promise.allSettled([
    fetch("/api/lighter?endpoint=funding-rates"),
    fetch("/api/lighter?endpoint=exchangeStats"),
    fetch("/api/lighter?endpoint=orderBookDetails&filter=perp"),
  ]);

  if (fundingRes.status !== "fulfilled" || !fundingRes.value.ok) {
    throw new Error("Lighter funding-rates fetch failed");
  }
  if (statsRes.status !== "fulfilled" || !statsRes.value.ok) {
    throw new Error("Lighter exchangeStats fetch failed");
  }

  const fundingData = await fundingRes.value.json();
  const statsData = await statsRes.value.json();

  const lighterRates: LighterFundingEntry[] = (fundingData.funding_rates || []).filter(
    (entry: LighterFundingEntry) => entry.exchange === "lighter",
  );

  const statsMap = new Map<string, LighterOrderBookStat>();
  for (const stat of statsData.order_book_stats || []) {
    statsMap.set(stat.symbol, stat);
  }

  const orderBookDetailsMap = new Map<number, { openInterest: number; lastPrice: number }>();
  if (orderBookRes.status === "fulfilled" && orderBookRes.value.ok) {
    try {
      const orderBookData = await orderBookRes.value.json();
      const details: LighterOrderBookDetail[] = orderBookData.order_book_details || [];
      for (const item of details) {
        orderBookDetailsMap.set(item.market_id, {
          openInterest: parseFloat(String(item.open_interest || "0")),
          lastPrice: parseFloat(String(item.last_trade_price || "0")),
        });
      }
    } catch {
      // Ignore parse errors
    }
  }

  return lighterRates.map((entry: LighterFundingEntry) => {
    const stat = statsMap.get(entry.symbol);
    const orderDetails = orderBookDetailsMap.get(entry.market_id);
    const lastPrice = orderDetails?.lastPrice || parseFloat(String(stat?.last_trade_price || "0"));
    const openInterest = orderDetails?.openInterest || 0;
    const notionalValue = openInterest * lastPrice;

    return {
      exchange: "Lighter" as const,
      exchangeColor: "purple",
      symbol: entry.symbol || `Market ${entry.market_id}`,
      rawSymbol: entry.symbol || `Market ${entry.market_id}`,
      marketId: entry.market_id,
      fundingRate: parseFloat(entry.rate || "0"),
      markPrice: lastPrice,
      lastPrice,
      change24h: parseFloat(String(stat?.daily_price_change || "0")),
      quoteVolume: parseFloat(String(stat?.daily_quote_token_volume || "0")),
      openInterest,
      notionalValue,
      fundingInterval: 3600,
      assetCategory: getLighterAssetCategory(entry.symbol || ""),
    };
  });
}

// ==================== Filter by Keyword ====================

export function filterByKeyword(
  rates: SearchExchangeRate[],
  keyword: string,
): SearchExchangeRate[] {
  if (!keyword.trim()) return rates;
  const lower = keyword.toLowerCase();
  return rates.filter((r) => r.symbol.toLowerCase().includes(lower));
}

// ==================== Fetch Detail for Single Symbol ====================

export async function fetchDetailForSymbol(
  rate: SearchExchangeRate,
  signal?: AbortSignal,
): Promise<DetailResult> {
  switch (rate.exchange) {
    case "Hyperliquid":
      return fetchHyperliquidDetail(rate.symbol, rate.bestBid, rate.bestAsk, signal);
    case "Gate.io":
      return fetchGateioDetail(rate.symbol, rate.fundingInterval, rate.bestBid, rate.bestAsk, signal);
    case "Binance":
      return fetchBinanceDetail(rate.symbol, rate.bestBid, rate.bestAsk, signal);
    case "OKX":
      return fetchOkxDetail(rate.rawSymbol ?? `${rate.symbol}-USDT-SWAP`, rate.fundingInterval, rate.bestBid, rate.bestAsk, signal);
    case "Lighter":
      return fetchLighterDetail(rate.marketId, rate.symbol, rate.bestBid, rate.bestAsk, signal);
  }
}

// ==================== Hyperliquid Detail ====================

async function fetchHyperliquidDetail(
  symbol: string,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  const [candles, fundingHistory] = await Promise.all([
    hlGetCandleSnapshot(symbol, "1d", 30, signal),
    hlGetFundingHistoryForDays(symbol, 30, signal),
  ]);

  if (signal?.aborted) {
    return { lastSettlementRate: null, avgFundingRate1d: null, historicalVolatility: null, bidAskSpread: null, avgFundingRate7d: null, avgFundingRate30d: null };
  }

  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);
  const avg1d = computeAvgFundingRate1d(fundingHistory);
  const latestSettledRate = fundingHistory.length > 0
    ? Number.parseFloat(fundingHistory[fundingHistory.length - 1]?.fundingRate ?? "")
    : Number.NaN;

  return {
    lastSettlementRate: Number.isFinite(latestSettledRate) ? latestSettledRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== Gate.io Detail ====================

async function fetchGateioDetail(
  symbol: string,
  fundingIntervalSeconds: number,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  const detail = await fetchGateCanonicalDetail(symbol, "1d", fundingIntervalSeconds, bestBid, bestAsk, signal);
  const candles = detail.candles.map((item) => ({ close: item.close }));
  const fundingHistory = detail.fundingHistory.map((item) => ({
    time: item.timestamp,
    fundingRate: String(item.fundingRate),
  }));
  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);
  const avg1d = computeAvgFundingRate1d(fundingHistory);

  return {
    lastSettlementRate: Number.isFinite(detail.lastSettlementRate) ? detail.lastSettlementRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: detail.bidAskSpread ?? computeBidAskSpread(bestBid, bestAsk),
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== Binance Detail ====================

async function fetchBinanceDetail(
  symbol: string,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  const detail = mapBinanceDetailToMetrics(await fetchBinanceCanonicalDetail(symbol, "1d", signal));
  const candles = detail.candles.map((item) => ({ close: item.close }));
  const fundingHistory = detail.fundingHistory.map((item) => ({
    time: item.timestamp,
    fundingRate: String(item.fundingRate),
  }));
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const fundingHistory30d = fundingHistory.filter((item) => item.time >= thirtyDaysAgo);
  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory30d);
  const avg1d = computeAvgFundingRate1d(fundingHistory30d);

  return {
    lastSettlementRate: Number.isFinite(detail.lastSettlementRate) ? detail.lastSettlementRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== OKX Detail ====================

async function fetchOkxDetail(
  rawSymbol: string,
  fundingIntervalSeconds: number,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  const detail = mapOkxDetailToMetrics(
    await fetchOkxCanonicalDetail(rawSymbol, "1d", fundingIntervalSeconds, signal),
  );
  const fundingHistory = detail.fundingHistory
    .filter((item) => item.timestamp >= Date.now() - 30 * 24 * 60 * 60 * 1000)
    .map((item) => ({
      time: item.timestamp,
      fundingRate: String(item.fundingRate),
    }));
  const candles = detail.candles.map((item) => ({ close: item.close }));
  const historicalVolatility = computeHistoricalVolatility(candles);
  const avg1dBuckets = computeOkxAverageFundingRatesByInterval(detail.fundingHistory, "1d");
  const avg1d = avg1dBuckets.length > 0 ? avg1dBuckets[avg1dBuckets.length - 1]?.averageFundingRate ?? null : null;
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);

  return {
    lastSettlementRate: Number.isFinite(detail.lastSettlementRate) ? detail.lastSettlementRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== Lighter Detail ====================

async function fetchLighterDetail(
  marketId: number | undefined,
  symbol: string,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  let resolvedMarketId = marketId ?? null;

  if (resolvedMarketId === null) {
    try {
      const fundingRes = await fetch("/api/lighter?endpoint=funding-rates", { signal });
      if (fundingRes.ok) {
        const fundingData = await fundingRes.json();
        const entry = (fundingData.funding_rates || []).find(
          (e: LighterFundingEntry) => e.exchange === "lighter" && e.symbol === symbol,
        );
        if (entry) resolvedMarketId = entry.market_id;
      }
    } catch (error) {
      if (!(isAbortLikeError(error) || signal?.aborted)) {
        console.warn(`[Search] Failed to resolve Lighter marketId for ${symbol}:`, error);
      }
    }
  }

  if (resolvedMarketId === null) {
    return {
      lastSettlementRate: null,
      avgFundingRate1d: null,
      historicalVolatility: null,
      bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
      avgFundingRate7d: null,
      avgFundingRate30d: null,
    };
  }

  const nowMs = Date.now();
  const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  const [candlesRes, fundingRes, orderBookRes, latestSettledRate] = await Promise.allSettled([
    fetch(
      `/api/lighter?endpoint=candles&market_id=${resolvedMarketId}&resolution=1d&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=30`,
      { signal },
    ),
    fetch(
      `/api/lighter?endpoint=fundings&market_id=${resolvedMarketId}&resolution=1h&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=720`,
      { signal },
    ),
    fetch(`/api/lighter?endpoint=orderBookOrders&market_id=${resolvedMarketId}&limit=1`, { signal }),
    lighterGetLatestSettledFundingRate(resolvedMarketId, 6, signal),
  ]);

  if (signal?.aborted) {
    return { lastSettlementRate: null, avgFundingRate1d: null, historicalVolatility: null, bidAskSpread: null, avgFundingRate7d: null, avgFundingRate30d: null };
  }

  // Parse candles
  let candles: Array<{ close: string }> = [];
  if (candlesRes.status === "fulfilled" && candlesRes.value.ok) {
    const candlesData = await candlesRes.value.json();
    const candleArray: LighterCandle[] = candlesData.c || candlesData.candlesticks || candlesData;
    if (Array.isArray(candleArray)) {
      candles = candleArray.map((item) => ({
        close: String(item.c ?? "0"),
      }));
    }
  }

  // Parse funding history
  let fundingHistory: { time: number; fundingRate: string }[] = [];
  if (fundingRes.status === "fulfilled" && fundingRes.value.ok) {
    const fundingData = await fundingRes.value.json();
    const fundingArray: LighterFundingEntryRaw[] = fundingData.fundings || fundingData;
    if (Array.isArray(fundingArray)) {
      fundingHistory = fundingArray.map((item) => {
        const rate = parseFloat(item.rate || "0");
        const direction = item.direction || "long";
        const signedRate = direction === "short" ? -rate : rate;
        return {
          time: item.timestamp * 1000,
          fundingRate: String(signedRate),
        };
      });
    }
  }

  let bidAskSpread = computeBidAskSpread(bestBid, bestAsk);
  if (orderBookRes.status === "fulfilled" && orderBookRes.value.ok) {
    try {
      const orderBookData = await orderBookRes.value.json();
      const liveBestAsk = orderBookData.asks?.[0]?.price ? parseFloat(orderBookData.asks[0].price) : null;
      const liveBestBid = orderBookData.bids?.[0]?.price ? parseFloat(orderBookData.bids[0].price) : null;
      const liveSpread = computeBidAskSpread(liveBestBid, liveBestAsk);
      if (liveSpread !== null) {
        bidAskSpread = liveSpread;
      }
    } catch {
      // ignore parse errors
    }
  }

  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);
  const avg1d = computeAvgFundingRate1d(fundingHistory);

  // Extract latest settled rate from Promise.allSettled result
  let lastSettlementRateValue: number | null = null;
  if (latestSettledRate.status === "fulfilled" && Number.isFinite(latestSettledRate.value)) {
    lastSettlementRateValue = latestSettledRate.value;
  }

  return {
    lastSettlementRate: lastSettlementRateValue,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread,
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== Batch Fetch with Concurrency Control ====================

export async function batchFetchDetails(
  rates: SearchExchangeRate[],
  onUpdate: (rate: SearchExchangeRate, detail: DetailResult) => void,
  signal?: AbortSignal,
  concurrency: number = 4,
): Promise<void> {
  const queue = [...rates];
  const inFlight: Promise<void>[] = [];

  async function processOne(rate: SearchExchangeRate): Promise<void> {
    try {
      // Mark as loading
      onUpdate(rate, {
        lastSettlementRate: null,
        avgFundingRate1d: null,
        historicalVolatility: null,
        bidAskSpread: null,
        avgFundingRate7d: null,
        avgFundingRate30d: null,
      });

      const detail = await fetchDetailForSymbol(rate, signal);

      if (signal?.aborted) return;

      onUpdate(rate, detail);
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        return;
      }

      console.warn(`[Search] Detail fetch failed for ${rate.symbol}:`, error);
      if (!signal?.aborted) {
        onUpdate(rate, {
          lastSettlementRate: null,
          avgFundingRate1d: null,
          historicalVolatility: null,
          bidAskSpread: null,
          avgFundingRate7d: null,
          avgFundingRate30d: null,
        });
      }
    }
  }

  while (queue.length > 0 || inFlight.length > 0) {
    // Fill up to concurrency limit
    while (inFlight.length < concurrency && queue.length > 0) {
      const rate = queue.shift()!;
      const promise = processOne(rate).then(() => {
        const idx = inFlight.indexOf(promise);
        if (idx !== -1) inFlight.splice(idx, 1);
      });
      inFlight.push(promise);
    }

    if (inFlight.length > 0) {
      await Promise.race(inFlight);
    }

    if (signal?.aborted) break;
  }
}
