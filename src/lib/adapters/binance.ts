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
    fundingInterval: row.fundingIntervalSeconds,
    assetCategory: row.assetCategory,
    bestBid: row.bestBid ?? undefined,
    bestAsk: row.bestAsk ?? undefined,
  };
}

async function fetchNativeRates(): Promise<CanonicalFundingRateRow[]> {
  const [tickersRes, premiumRes, fundingInfoRes, bookTickerRes] = await Promise.all([
    fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"),
    fetch("https://fapi.binance.com/fapi/v1/premiumIndex"),
    fetch("https://fapi.binance.com/fapi/v1/fundingInfo"),
    fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker"),
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
  const openInterestMap = await fetchNativeOpenInterestNotional(candidateSymbols);
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

    const oiNotional = openInterestMap.get(symbol) ?? 0;
    const openInterest = markPrice > 0 ? oiNotional / markPrice : 0;
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
      quoteVolume: Number.parseFloat(ticker?.quoteVolume || "0"),
      openInterest,
      notionalValue: oiNotional > 0 ? oiNotional : Number.parseFloat(ticker?.quoteVolume || "0"),
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
    fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=30`, { signal }),
    fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`, { signal }),
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

  const response = await fetch("https://fapi.binance.com/fapi/v1/fundingRate?limit=1000", { cache: "no-store" });
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

async function fetchNativeOpenInterestNotional(symbols: string[]): Promise<Map<string, number>> {
  const batchSize = 50;
  const openInterestMap = new Map<string, number>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const [oiRes, premiumRes] = await Promise.all([
            fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { cache: "no-store" }),
            fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { cache: "no-store" }),
          ]);
          if (!oiRes.ok || !premiumRes.ok) {
            return { symbol, value: 0 };
          }

          const oiData = (await oiRes.json()) as NativeOpenInterestResponse;
          const premiumData = (await premiumRes.json()) as NativePremiumIndex;
          const oi = Number.parseFloat(oiData.openInterest || "0");
          const markPrice = Number.parseFloat(premiumData.markPrice || "0");
          return { symbol, value: oi * markPrice };
        } catch {
          return { symbol, value: 0 };
        }
      }),
    );

    for (const result of results) {
      openInterestMap.set(result.symbol, result.value);
    }
  }

  return openInterestMap;
}

async function fetchNativeLatestSettledRateMap(symbols: string[]): Promise<Map<string, number>> {
  return hydrateBinanceLatestSettlementRates(symbols);
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
