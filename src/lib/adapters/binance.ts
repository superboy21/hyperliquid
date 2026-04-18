import type {
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";
import { getExchangeTransportFlags } from "@/lib/exchange-flags";
import { BINANCE_DELISTED_SYMBOLS, getBinanceAssetCategory } from "@/lib/binance-metadata";

export type BinanceChartInterval = "1d" | "4h" | "1h";

export interface BinanceFundingMonitorRow {
  symbol: string;
  fundingRate: number;
  lastSettlementRate: number;
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
}

export interface BinanceSearchRate {
  exchange: "Binance";
  exchangeColor: string;
  symbol: string;
  rawSymbol: string;
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
}

export interface BinanceDetailMetrics {
  candles: Array<{
    openTime: number;
    closeTime: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
  fundingHistory: CanonicalFundingHistoryPoint[];
  lastSettlementRate: number | null;
}

interface NativeTicker24hr {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
}

interface NativePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
}

interface NativeFundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

interface NativeBookTicker {
  symbol: string;
  bidPrice: string;
  askPrice: string;
}

interface NativeOpenInterestResponse {
  openInterest: string;
}

interface NativeFundingHistoryItem {
  symbol?: string;
  fundingTime: number;
  fundingRate: string;
}

interface NativeCandleArray extends Array<number | string> {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: number;
}

// ==================== Binance Fetch Helper ====================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BINANCE_DIRECT_BASE = "https://fapi.binance.com/fapi/v1";
const BINANCE_PROXY_BASE = "/api/binance";

/**
 * Fetch from Binance with automatic fallback:
 * 1. Try direct connection first (faster, no server roundtrip)
 * 2. If direct fails (network/CORS), fall back to Next.js API proxy
 */
async function binanceFetch(endpoint: string, params: string, init?: RequestInit): Promise<Response> {
  const paramPrefix = params ? `?${params}` : "";
  const directUrl = `${BINANCE_DIRECT_BASE}/${endpoint}${paramPrefix}`;
  const proxyUrl = `${BINANCE_PROXY_BASE}?endpoint=${encodeURIComponent(endpoint)}${params ? `&${params}` : ""}`;

  // Try direct first
  try {
    const response = await fetch(directUrl, init);
    if (response.ok) return response;
    // If rate-limited, wait and retry direct once
    if (response.status === 429) {
      await sleep(1000);
      const retryResponse = await fetch(directUrl, init);
      if (retryResponse.ok) return retryResponse;
    }
  } catch {
    // Direct connection failed (CORS/network), fall through to proxy
  }

  // Fallback to proxy
  return fetch(proxyUrl, { ...init, cache: "no-store" });
}

// ==================== Mapping Functions ====================

function mapCanonicalRow(row: CanonicalFundingRateRow): BinanceFundingMonitorRow {
  return {
    symbol: row.symbol,
    fundingRate: row.fundingRate,
    lastSettlementRate: Number.isFinite(row.lastSettlementRate) ? (row.lastSettlementRate as number) : Number.NaN,
    markPrice: row.markPrice,
    lastPrice: row.lastPrice,
    change24h: row.change24h,
    quoteVolume: row.quoteVolume,
    openInterest: row.openInterest,
    notionalValue: row.notionalValue,
    oiLoaded: (row as CanonicalFundingRateRow & { oiLoaded?: boolean }).oiLoaded,
    fundingInterval: row.fundingIntervalSeconds,
    assetCategory: row.assetCategory,
    bestBid: row.bestBid ?? undefined,
    bestAsk: row.bestAsk ?? undefined,
  };
}

function mapCanonicalSearchRow(row: CanonicalFundingRateRow): BinanceSearchRate {
  return {
    exchange: "Binance",
    exchangeColor: "yellow",
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    fundingRate: row.fundingRate,
    markPrice: row.markPrice,
    lastPrice: row.lastPrice,
    change24h: row.change24h,
    quoteVolume: row.quoteVolume,
    openInterest: row.openInterest,
    notionalValue: row.notionalValue,
    oiLoaded: (row as CanonicalFundingRateRow & { oiLoaded?: boolean }).oiLoaded,
    fundingInterval: row.fundingIntervalSeconds,
    assetCategory: row.assetCategory,
    bestBid: row.bestBid ?? undefined,
    bestAsk: row.bestAsk ?? undefined,
  };
}

async function fetchNativeRates(): Promise<CanonicalFundingRateRow[]> {
  const [tickersRes, premiumRes, fundingInfoRes, bookTickerRes] = await Promise.all([
    binanceFetch("ticker/24hr", ""),
    binanceFetch("premiumIndex", ""),
    binanceFetch("fundingInfo", ""),
    binanceFetch("ticker/bookTicker", ""),
  ]);

  if (!tickersRes.ok || !premiumRes.ok) {
    throw new Error("Failed to fetch Binance native list data");
  }

  const tickers = (await tickersRes.json()) as NativeTicker24hr[];
  const premiums = (await premiumRes.json()) as NativePremiumIndex[];
  const fundingInfos = fundingInfoRes.ok ? ((await fundingInfoRes.json()) as NativeFundingInfo[]) : [];
  const bookTickers = bookTickerRes.ok ? ((await bookTickerRes.json()) as NativeBookTicker[]) : [];

  const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const fundingInfoMap = new Map(fundingInfos.map((info) => [info.symbol, info]));
  const bookTickerMap = new Map(bookTickers.map((ticker) => [ticker.symbol, ticker]));
  const candidateSymbols = premiums
    .map((premium) => premium.symbol)
    .filter((symbol) => symbol.endsWith("USDT") && !BINANCE_DELISTED_SYMBOLS.has(symbol));
  // Only fetch settlement rates (1 request) — skip OI to avoid 200+ individual requests
  // OI data is derived from quoteVolume as a reasonable approximation
  const latestSettledMap = await fetchNativeLatestSettledRateMap(candidateSymbols);
  const results: CanonicalFundingRateRow[] = [];

  for (const premium of premiums) {
    const symbol = premium.symbol;
    if (!symbol.endsWith("USDT") || BINANCE_DELISTED_SYMBOLS.has(symbol)) {
      continue;
    }

    const ticker = tickerMap.get(symbol);
    const fundingInfo = fundingInfoMap.get(symbol);
    const bookTicker = bookTickerMap.get(symbol);
    const markPrice = Number.parseFloat(premium.markPrice || "0");
    const quoteVolume = Number.parseFloat(ticker?.quoteVolume || "0");

    results.push({
      exchange: "binance",
      transportMode: "native",
      symbol,
      rawSymbol: symbol,
      marketKey: symbol,
      fundingRate: Number.parseFloat(premium.lastFundingRate || "0"),
      predictedFundingRate: null,
      lastSettlementRate: latestSettledMap.get(symbol) ?? null,
      markPrice,
      indexPrice: Number.parseFloat(premium.indexPrice || "0"),
      lastPrice: Number.parseFloat(premium.lastPrice || premium.markPrice || "0"),
      change24h: Number.parseFloat(ticker?.priceChangePercent || "0"),
      quoteVolume,
      openInterest: 0, // Will be hydrated asynchronously
      notionalValue: quoteVolume, // Placeholder — replaced after OI hydration
      oiLoaded: false,
      fundingIntervalSeconds: fundingInfo?.fundingIntervalHours ? fundingInfo.fundingIntervalHours * 3600 : 8 * 60 * 60,
      assetCategory: getBinanceAssetCategory(symbol),
      bestBid: bookTicker?.bidPrice ? Number.parseFloat(bookTicker.bidPrice) : null,
      bestAsk: bookTicker?.askPrice ? Number.parseFloat(bookTicker.askPrice) : null,
    });
  }

  return results;
}

async function fetchCcxtRates(): Promise<CanonicalFundingRateRow[]> {
  const response = await fetch("/api/binance/ccxt?mode=list", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch Binance CCXT list data");
  }
  return (await response.json()) as CanonicalFundingRateRow[];
}

async function fetchNativeDetail(symbol: string, interval: BinanceChartInterval, signal?: AbortSignal): Promise<CanonicalFundingDetail> {
  const [candleRes, fundingRes] = await Promise.all([
    fetch(`/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=30`, { cache: "no-store", signal }),
    fetch(`/api/binance?endpoint=fundingRate&symbol=${encodeURIComponent(symbol)}&limit=1000`, { cache: "no-store", signal }),
  ]);

  const candles = candleRes.ok
    ? ((await candleRes.json()) as NativeCandleArray[]).map((item) => ({
        openTime: item[0],
        closeTime: item[6],
        open: String(item[1]),
        high: String(item[2]),
        low: String(item[3]),
        close: String(item[4]),
        volume: String(item[5]),
      }))
    : [];

  const fundingHistory = fundingRes.ok
    ? ((await fundingRes.json()) as NativeFundingHistoryItem[]).map((item) => ({
        timestamp: item.fundingTime,
        fundingRate: Number.parseFloat(item.fundingRate),
      }))
    : [];

  const latest = fundingHistory.reduce<CanonicalFundingHistoryPoint | null>((current, item) => {
    if (!current || item.timestamp > current.timestamp) {
      return item;
    }
    return current;
  }, null);

  return {
    exchange: "binance",
    transportMode: "native",
    symbol,
    rawSymbol: symbol,
    marketKey: symbol,
    candles,
    fundingHistory,
    lastSettlementRate: latest ? latest.fundingRate : null,
    bidAskSpread: null,
  };
}

async function fetchCcxtDetail(symbol: string, interval: BinanceChartInterval, signal?: AbortSignal): Promise<CanonicalFundingDetail> {
  const response = await fetch(`/api/binance/ccxt?mode=detail&symbol=${encodeURIComponent(symbol)}&interval=${interval}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error("Failed to fetch Binance CCXT detail data");
  }
  return (await response.json()) as CanonicalFundingDetail;
}

export async function fetchBinanceCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  const mode = getExchangeTransportFlags().binance;
  if (mode === "native") {
    return fetchNativeRates();
  }

  try {
    return await fetchCcxtRates();
  } catch {
    return fetchNativeRates();
  }
}

export async function fetchBinanceFundingMonitorRates(): Promise<BinanceFundingMonitorRow[]> {
  return (await fetchBinanceCanonicalRates()).map(mapCanonicalRow);
}

export async function fetchBinanceSearchRates(): Promise<BinanceSearchRate[]> {
  return (await fetchBinanceCanonicalRates()).map(mapCanonicalSearchRow);
}

export async function fetchBinanceCanonicalDetail(symbol: string, interval: BinanceChartInterval, signal?: AbortSignal): Promise<CanonicalFundingDetail> {
  const mode = getExchangeTransportFlags().binance;
  if (mode === "native") {
    return fetchNativeDetail(symbol, interval, signal);
  }

  try {
    return await fetchCcxtDetail(symbol, interval, signal);
  } catch {
    return fetchNativeDetail(symbol, interval, signal);
  }
}

export async function hydrateBinanceLatestSettlementRates(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const response = await binanceFetch("fundingRate", "limit=1000");
  if (!response.ok) {
    return new Map();
  }

  const targetSet = new Set(symbols);
  const history = (await response.json()) as NativeFundingHistoryItem[] & Array<{ symbol?: string }>;
  const latestBySymbol = new Map<string, { fundingTime: number; fundingRate: number }>();

  for (const item of history) {
    const symbol = item.symbol;
    if (!symbol || !targetSet.has(symbol)) {
      continue;
    }

    const existing = latestBySymbol.get(symbol);
    if (!existing || item.fundingTime > existing.fundingTime) {
      latestBySymbol.set(symbol, {
        fundingTime: item.fundingTime,
        fundingRate: Number.parseFloat(item.fundingRate),
      });
    }
  }

  return new Map(Array.from(latestBySymbol.entries()).map(([symbol, value]) => [symbol, value.fundingRate]));
}

async function fetchNativeLatestSettledRateMap(symbols: string[]): Promise<Map<string, number>> {
  return hydrateBinanceLatestSettlementRates(symbols);
}

// ==================== Async OI Hydration ====================
// OI requires ~200 individual API calls, so we load it asynchronously after the initial list.
// The UI shows quoteVolume as a placeholder (in lighter color), then replaces with OI × markPrice.

const OI_BATCH_SIZE = 50;

/**
 * Hydrate openInterest and notionalValue for Binance rates.
 * Fetches OI for each symbol with concurrency limits, then computes
 * notionalValue = openInterest × markPrice.
 * Returns a Map keyed by symbol with { openInterest, notionalValue }.
 */
export async function hydrateBinanceOpenInterest(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Map<string, { openInterest: number; notionalValue: number }>> {
  const result = new Map<string, { openInterest: number; notionalValue: number }>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += OI_BATCH_SIZE) {
    if (signal?.aborted) break;

    const batch = symbols.slice(i, i + OI_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const [oiResponse, premiumResponse] = await Promise.all([
            binanceFetch("openInterest", `symbol=${encodeURIComponent(symbol)}`),
            binanceFetch("premiumIndex", `symbol=${encodeURIComponent(symbol)}`),
          ]);

          if (!oiResponse.ok || !premiumResponse.ok) {
            return null;
          }

          const oiData = (await oiResponse.json()) as NativeOpenInterestResponse;
          const premiumData = (await premiumResponse.json()) as NativePremiumIndex;
          const openInterest = Number.parseFloat(oiData.openInterest || "0");
          const markPrice = Number.parseFloat(premiumData.markPrice || "0");
          const notionalValue = openInterest * markPrice;

          return { symbol, openInterest, notionalValue };
        } catch {
          return null;
        }
      }),
    );

    for (const item of batchResults) {
      if (!item) continue;
      result.set(item.symbol, {
        openInterest: item.openInterest,
        notionalValue: item.notionalValue,
      });
    }
  }

  return result;
}

export function computeAverageFundingRatesByInterval(
  history: CanonicalFundingHistoryPoint[],
  interval: BinanceChartInterval,
): Array<{ bucketStartTime: number; averageFundingRate: number; sampleCount: number }> {
  if (history.length === 0) {
    return [];
  }

  const intervalMs = interval === "1d" ? 24 * 60 * 60 * 1000 : interval === "4h" ? 4 * 60 * 60 * 1000 : 60 * 60 * 1000;
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
      bucketStartTime,
      averageFundingRate: value.count > 0 ? value.total / value.count : 0,
      sampleCount: value.count,
    }));
}

export function mapDetailToMetrics(detail: CanonicalFundingDetail): BinanceDetailMetrics {
  return {
    candles: detail.candles,
    fundingHistory: detail.fundingHistory,
    lastSettlementRate: detail.lastSettlementRate,
  };
}
