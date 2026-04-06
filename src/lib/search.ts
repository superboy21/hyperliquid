// ==================== Cross-Exchange Search Utility ====================
// Fetches, filters, and computes detail fields for funding rates across
// Hyperliquid, Gate.io, Binance, and Lighter exchanges.

import {
  getAllFundingRatesWithHistory,
  getCandleSnapshot as hlGetCandleSnapshot,
  getFundingHistoryForDays as hlGetFundingHistoryForDays,
  getAverageFundingRatesByInterval as hlGetAverageFundingRatesByInterval,
  getLatestSettledFundingRate as hlGetLatestSettledFundingRate,
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

// ==================== Interfaces ====================

export interface SearchExchangeRate {
  exchange: "Hyperliquid" | "Gate.io" | "Binance" | "Lighter";
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

// ==================== Binance API Types ====================

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
}

interface BinanceTicker24hr {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
}

interface BinanceFundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  askPrice: string;
}

interface BinanceOpenInterestResponse {
  openInterest: string;
  symbol?: string;
}

interface BinanceKline {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface BinanceFundingHistoryItem {
  fundingTime: number;
  fundingRate: string;
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

// ==================== Binance Asset Categories ====================

const BINANCE_DELISTED = new Set([
  "1000WHYUSDT", "1000XUSDT", "42USDT", "AGIXUSDT", "AI16ZUSDT", "ALPACAUSDT", "ALPHAUSDT",
  "AMBUSDT", "BADGERUSDT", "BAKEUSDT", "BALUSDT", "BDXNUSDT", "BIDUSDT", "BLZUSDT", "BNXUSDT",
  "BONDUSDT", "BSWUSDT", "BTCSTUSDT", "CHESSUSDT", "COMBOUSDT", "COMMONUSDT", "CUDISUSDT",
  "DARUSDT", "DEFIUSDT", "DFUSDT", "DGBUSDT", "DMCUSDT", "EOSUSDT", "EPTUSDT", "FISUSDT",
  "FLMUSDT", "FRONTUSDT", "FTMUSDT", "FTTUSDT", "FXSUSDT", "GAIBUSDT", "GHSTUSDT", "GLMRUSDT",
  "HIFIUSDT", "IDEXUSDT", "KDAUSDT", "KEYUSDT", "KLAYUSDT", "LEVERUSDT", "LINAUSDT", "LOKAUSDT",
  "LOOMUSDT", "MATICUSDT", "MDTUSDT", "MEMEFIUSDT", "MILKUSDT", "MKRUSDT", "MYROUSDT",
  "NEIROETHUSDT", "NKNUSDT", "NULSUSDT", "OBOLUSDT", "OCEANUSDT", "OMGUSDT", "OMNIUSDT",
  "OMUSDT", "ORBSUSDT", "PERPUSDT", "PONKEUSDT", "PORT3USDT", "QUICKUSDT", "RADUSDT",
  "RAYUSDT", "REEFUSDT", "REIUSDT", "RENUSDT", "RVVUSDT", "SCUSDT", "SKATEUSDT", "SLERFUSDT",
  "SNTUSDT", "STMXUSDT", "STPTUSDT", "STRAXUSDT", "SWELLUSDT", "SXPUSDT", "TANSSIUSDT",
  "TOKENUSDT", "TROYUSDT", "UNFIUSDT", "UXLINKUSDT", "VFYUSDT", "VIDTUSDT", "VOXELUSDT",
  "WAVESUSDT", "XCNUSDT", "XEMUSDT", "YALAUSDT", "ZRCUSDT",
  "A2ZUSDT", "FORTHUSDT", "HOOKUSDT", "LRCUSDT", "NTRNUSDT", "RDNTUSDT",
]);

const BINANCE_MAJORS = ["BTC", "ETH", "BNB", "SOL", "HYPE", "LINK", "XRP", "TRX", "ADA", "WLFI", "AAVE", "SKY", "DOGE", "BCH"];
const BINANCE_METALS = ["XAU", "XAG", "XPT", "XPD", "COPPER", "PAXG", "XAUT"];
const BINANCE_ENERGY = ["CL", "BZ", "NATGAS"];
const BINANCE_STOCKS = [
  "TSLA", "MSTR", "AMZN", "AAPL", "NVDA", "EWY", "EWJ", "QQQ", "SPY", "META", "GOOGL", "MSFT", "NFLX", "AMD", "INTC", "COIN",
  "BABA", "TSM", "JPM", "V", "MA", "DIS", "PYPL", "UBER", "ABNB", "SOFI", "PLTR", "HOOD", "RIVN", "LCID", "NIO",
  "XOM", "CRCL", "PFE", "JNJ", "UNH", "HD", "WMT", "COST", "TGT", "NKE", "SBUX", "MCD", "KO", "PEP",
  "QQQX", "TQQQ", "SPXL", "SOXL", "TNA", "UVXY", "VIX", "TLT", "IEF", "LQD", "HYG", "EMB", "PAYP",
  "MSTRX", "COINX", "NVDAX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX",
];

function getBinanceAssetCategory(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  if (BINANCE_MAJORS.includes(base)) return "Majors";
  if (BINANCE_METALS.includes(base)) return "Metals";
  if (BINANCE_ENERGY.includes(base)) return "Energy";
  if (BINANCE_STOCKS.includes(base)) return "Stocks";
  return "Other Crypto";
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
  const [hyperliquidRates, gateioRates, binanceRates, lighterRates] = await Promise.allSettled([
    fetchHyperliquidRates(),
    fetchGateioRates(),
    fetchBinanceRates(),
    fetchLighterRates(),
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
  const rates = await gateGetAllFundingRates();
  return rates.map((r) => ({
    exchange: "Gate.io" as const,
    exchangeColor: "cyan",
    symbol: r.coin,
    rawSymbol: r.coin,
    fundingRate: parseFloat(r.fundingRateIndicative || r.fundingRate),
    markPrice: parseFloat(r.markPrice),
    lastPrice: parseFloat(r.lastPrice),
    change24h: parseFloat(r.change24h),
    quoteVolume: parseFloat(r.dayVolume),
    openInterest: parseFloat(r.openInterest),
    notionalValue: parseFloat(r.notionalValue) || 0,
    fundingInterval: r.fundingInterval || 28800,
    assetCategory: r.assetCategory || "其他",
    bestBid: r.bestBid ? parseFloat(r.bestBid) : undefined,
    bestAsk: r.bestAsk ? parseFloat(r.bestAsk) : undefined,
  }));
}

// ==================== Binance Rates ====================

async function fetchBinanceRates(): Promise<SearchExchangeRate[]> {
  const [tickersRes, premiumRes, fundingInfoRes, bookTickerRes] = await Promise.allSettled([
    fetch("https://fapi.binance.com/fapi/v1/ticker/24hr"),
    fetch("https://fapi.binance.com/fapi/v1/premiumIndex"),
    fetch("https://fapi.binance.com/fapi/v1/fundingInfo"),
    fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker"),
  ]);

  if (tickersRes.status !== "fulfilled" || !tickersRes.value.ok) {
    throw new Error("Binance ticker fetch failed");
  }
  if (premiumRes.status !== "fulfilled" || !premiumRes.value.ok) {
    throw new Error("Binance premium fetch failed");
  }

  const tickers: BinanceTicker24hr[] = await tickersRes.value.json();
  const premiums: BinancePremiumIndex[] = await premiumRes.value.json();

  const fundingInfos: BinanceFundingInfo[] = fundingInfoRes.status === "fulfilled" && fundingInfoRes.value.ok
    ? await fundingInfoRes.value.json()
    : [];
  const bookTickers: BinanceBookTicker[] = bookTickerRes.status === "fulfilled" && bookTickerRes.value.ok
    ? await bookTickerRes.value.json()
    : [];

  const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
  const premiumMap = new Map(premiums.map((p) => [p.symbol, p]));
  const fundingInfoMap = new Map(fundingInfos.map((f) => [f.symbol, f]));
  const bookTickerMap = new Map(bookTickers.map((b) => [b.symbol, b]));

  const usdtSymbols = Array.from(premiumMap.keys()).filter((symbol) => symbol.endsWith("USDT") && !BINANCE_DELISTED.has(symbol));
  const openInterestMap = new Map<string, number>();
  const batchSize = 50;

  for (let i = 0; i < usdtSymbols.length; i += batchSize) {
    const batch = usdtSymbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
          if (!oiRes.ok) return { symbol, value: 0 };
          const oiData: BinanceOpenInterestResponse = await oiRes.json();
          const oi = parseFloat(oiData.openInterest || "0");
          const premium = premiumMap.get(symbol);
          const markPrice = parseFloat(premium?.markPrice || "0");
          return { symbol, value: oi * markPrice };
        } catch {
          return { symbol, value: 0 };
        }
      }),
    );

    for (const result of batchResults) {
      openInterestMap.set(result.symbol, result.value);
    }

    if (i + batchSize < usdtSymbols.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const results: SearchExchangeRate[] = [];

  for (const [symbol, premium] of premiumMap) {
    if (!symbol.endsWith("USDT")) continue;
    if (BINANCE_DELISTED.has(symbol)) continue;

    const ticker = tickerMap.get(symbol);
    const fundingInfo = fundingInfoMap.get(symbol);
    const fundingInterval = fundingInfo?.fundingIntervalHours
      ? fundingInfo.fundingIntervalHours * 3600
      : 8 * 60 * 60;
    const bookTicker = bookTickerMap.get(symbol);
    const quoteVolume = parseFloat(ticker?.quoteVolume || "0");
    const markPrice = parseFloat(premium.markPrice || "0");
    const oiValue = openInterestMap.get(symbol) || 0;
    const openInterest = markPrice > 0 ? oiValue / markPrice : 0;

    results.push({
      exchange: "Binance" as const,
      exchangeColor: "yellow",
      symbol,
      rawSymbol: symbol,
      fundingRate: parseFloat(premium.lastFundingRate || "0"),
      markPrice,
      lastPrice: parseFloat(premium.lastPrice || premium.markPrice || "0"),
      change24h: parseFloat(ticker?.priceChangePercent || "0"),
      quoteVolume,
      openInterest,
      notionalValue: oiValue > 0 ? oiValue : quoteVolume,
      fundingInterval,
      assetCategory: getBinanceAssetCategory(symbol),
      bestBid: bookTicker?.bidPrice ? parseFloat(bookTicker.bidPrice) : undefined,
      bestAsk: bookTicker?.askPrice ? parseFloat(bookTicker.askPrice) : undefined,
    });
  }

  return results;
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
    case "Lighter":
      return fetchLighterDetail(rate.symbol, rate.bestBid, rate.bestAsk, signal);
  }
}

// ==================== Hyperliquid Detail ====================

async function fetchHyperliquidDetail(
  symbol: string,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  const [candles, fundingHistory, latestSettledRate] = await Promise.all([
    hlGetCandleSnapshot(symbol, "1d", 30),
    hlGetFundingHistoryForDays(symbol, 30),
    hlGetLatestSettledFundingRate(symbol),
  ]);

  if (signal?.aborted) {
    return { lastSettlementRate: null, avgFundingRate1d: null, historicalVolatility: null, bidAskSpread: null, avgFundingRate7d: null, avgFundingRate30d: null };
  }

  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);
  const avg1d = computeAvgFundingRate1d(fundingHistory);

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
  const [candles, fundingHistory] = await Promise.all([
    gateGetCandleSnapshot(symbol, "1d", 30),
    gateGetFundingHistoryForDays(symbol, 30, fundingIntervalSeconds),
  ]);

  // Get latest settled rate from the first entry in funding history (same as GateFundingMonitor hydration)
  const latestSettledRate = fundingHistory.length > 0 ? parseFloat(fundingHistory[0].fundingRate) : NaN;

  if (signal?.aborted) {
    return { lastSettlementRate: null, avgFundingRate1d: null, historicalVolatility: null, bidAskSpread: null, avgFundingRate7d: null, avgFundingRate30d: null };
  }

  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory);
  const avg1d = computeAvgFundingRate1d(fundingHistory);

  return {
    lastSettlementRate: Number.isFinite(latestSettledRate) ? latestSettledRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
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
  const [candleRes, fundingRes] = await Promise.allSettled([
    fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=30`),
    fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`),
  ]);

  if (signal?.aborted) {
    return { lastSettlementRate: null, avgFundingRate1d: null, historicalVolatility: null, bidAskSpread: null, avgFundingRate7d: null, avgFundingRate30d: null };
  }

  // Parse candles
  let candles: Array<{ close: string }> = [];
  if (candleRes.status === "fulfilled" && candleRes.value.ok) {
    const candleData = await candleRes.value.json();
    if (Array.isArray(candleData)) {
      candles = candleData.map((kline: unknown[]) => ({
        close: String(kline[4]),
      }));
    }
  }

  // Parse funding history
  let fundingHistory: { time: number; fundingRate: string }[] = [];
  let latestSettledRate: number = NaN;
  if (fundingRes.status === "fulfilled" && fundingRes.value.ok) {
    const fundingData = await fundingRes.value.json();
    if (Array.isArray(fundingData)) {
      fundingHistory = fundingData.map((item: BinanceFundingHistoryItem) => ({
        time: item.fundingTime,
        fundingRate: item.fundingRate,
      }));
      // First entry is the most recent settled rate (same as BinanceFundingMonitor hydration)
      if (fundingData.length > 0) {
        latestSettledRate = parseFloat(fundingData[0]?.fundingRate ?? "");
      }
    }
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const fundingHistory30d = fundingHistory.filter((item) => item.time >= thirtyDaysAgo);

  const historicalVolatility = computeHistoricalVolatility(candles);
  const { avg7d, avg30d } = computeAvgFundingRates(fundingHistory30d);
  const avg1d = computeAvgFundingRate1d(fundingHistory30d);

  return {
    lastSettlementRate: Number.isFinite(latestSettledRate) ? latestSettledRate : null,
    avgFundingRate1d: avg1d,
    historicalVolatility,
    bidAskSpread: computeBidAskSpread(bestBid, bestAsk),
    avgFundingRate7d: avg7d,
    avgFundingRate30d: avg30d,
  };
}

// ==================== Lighter Detail ====================

async function fetchLighterDetail(
  symbol: string,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
): Promise<DetailResult> {
  let marketId: number | null = null;
  try {
    const fundingRes = await fetch("/api/lighter?endpoint=funding-rates");
    if (fundingRes.ok) {
      const fundingData = await fundingRes.json();
      const entry = (fundingData.funding_rates || []).find(
        (e: LighterFundingEntry) => e.exchange === "lighter" && e.symbol === symbol,
      );
      if (entry) marketId = entry.market_id;
    }
  } catch {
    // Continue without marketId
  }

  if (marketId === null) {
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
      `/api/lighter?endpoint=candles&market_id=${marketId}&resolution=1d&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=30`,
    ),
    fetch(
      `/api/lighter?endpoint=fundings&market_id=${marketId}&resolution=1h&start_timestamp=${thirtyDaysAgoMs}&end_timestamp=${nowMs}&count_back=720`,
    ),
    fetch(`/api/lighter?endpoint=orderBookOrders&market_id=${marketId}&limit=1`),
    lighterGetLatestSettledFundingRate(marketId),
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
      console.error(`[Search] Detail fetch failed for ${rate.symbol}:`, error);
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
