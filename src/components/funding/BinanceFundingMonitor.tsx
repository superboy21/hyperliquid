"use client";

import { useCallback, useMemo, useState } from "react";
import BinanceFundingCandlesChart from "@/components/funding/BinanceFundingCandlesChart";
import ExchangeFundingMonitor, {
  type CategoryConfig,
  type ChartComponentProps,
  type ChartInterval,
  type DetailData,
  type ExchangeFundingMonitorConfig,
  type ExchangeFundingRate,
  type IntervalFundingRateItem,
} from "@/components/funding/ExchangeFundingMonitor";

// ==================== Binance-specific Types ====================

interface Ticker24hr {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  openPrice: string;
  bidPrice: string;
  askPrice: string;
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
}

interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  openInterest: string;
  notionalValue: string;
  fundingInterval: number;
  assetCategory: string;
}

interface FundingHistoryItem {
  time: number;
  fundingRate: string;
}

interface BinanceCandle {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ==================== Constants ====================

const DELISTED_SYMBOLS = new Set([
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
]);

const MAJORS = ["BTC", "ETH", "BNB", "SOL", "HYPE", "LINK", "XRP", "TRX", "ADA", "WLFI", "AAVE", "SKY", "DOGE", "BCH"];
const METALS = ["XAU", "XAG", "XPT", "XPD", "COPPER", "PAXG", "XAUT"];
const STOCKS = [
  "TSLA", "MSTR", "AMZN", "AAPL", "NVDA", "EWY", "EWJ", "QQQ", "SPY", "META", "GOOGL", "MSFT", "NFLX", "AMD", "INTC", "COIN",
  "BABA", "TSM", "JPM", "V", "MA", "DIS", "PYPL", "UBER", "ABNB", "SOFI", "PLTR", "HOOD", "RIVN", "LCID", "NIO",
  "XOM", "CRCL", "PFE", "JNJ", "UNH", "HD", "WMT", "COST", "TGT", "NKE", "SBUX", "MCD", "KO", "PEP",
  "QQQX", "TQQQ", "SPXL", "SOXL", "TNA", "UVXY", "VIX", "TLT", "IEF", "LQD", "HYG", "EMB", "PAYP",
  "MSTRX", "COINX", "NVDAX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX",
];

// ==================== Helpers ====================

function getAssetCategory(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  if (MAJORS.includes(base)) return "Majors";
  if (METALS.includes(base)) return "Metals";
  if (STOCKS.includes(base)) return "Stocks";
  return "Other Crypto";
}

function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

function formatAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  const annualized = rateNumber * settlementsPerDay * 365 * 100;
  const absRate = Math.abs(annualized);

  if (absRate >= 100) return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  if (absRate >= 10) return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;
  if (priceNumber >= 1000) return priceNumber.toFixed(2);
  if (priceNumber >= 1) return priceNumber.toFixed(4);
  return priceNumber.toFixed(6);
}

function formatVolume(volume: string | number): string {
  const volumeNumber = typeof volume === "string" ? parseFloat(volume) : volume;
  if (volumeNumber >= 1e9) return `${(volumeNumber / 1e9).toFixed(2)}B`;
  if (volumeNumber >= 1e6) return `${(volumeNumber / 1e6).toFixed(2)}M`;
  if (volumeNumber >= 1e3) return `${(volumeNumber / 1e3).toFixed(2)}K`;
  return volumeNumber.toFixed(2);
}

function getAverageFundingRatesByInterval(history: FundingHistoryItem[], interval: ChartInterval): IntervalFundingRateItem[] {
  if (history.length === 0) return [];

  let intervalMs: number;
  switch (interval) {
    case "1d": intervalMs = 24 * 60 * 60 * 1000; break;
    case "4h": intervalMs = 4 * 60 * 60 * 1000; break;
    case "1h": intervalMs = 60 * 60 * 1000; break;
    default: intervalMs = 24 * 60 * 60 * 1000;
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

function mapToExchangeFundingRate(rate: BinanceFundingRate): ExchangeFundingRate {
  return {
    symbol: rate.symbol,
    fundingRate: parseFloat(rate.fundingRate),
    markPrice: parseFloat(rate.markPrice),
    lastPrice: parseFloat(rate.lastPrice || rate.markPrice),
    change24h: parseFloat(rate.priceChangePercent),
    quoteVolume: parseFloat(rate.quoteVolume),
    openInterest: parseFloat(rate.openInterest) || 0,
    notionalValue: parseFloat(rate.notionalValue) || 0,
    fundingInterval: rate.fundingInterval || 28800,
    assetCategory: rate.assetCategory,
    bestBid: rate.bidPrice ? parseFloat(rate.bidPrice) : undefined,
    bestAsk: rate.askPrice ? parseFloat(rate.askPrice) : undefined,
  };
}

// ==================== Category Config ====================

const categoryConfig: Record<string, CategoryConfig> = {
  all: { label: "全部资产", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  Majors: { label: "Majors", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  Metals: { label: "Metals", borderColor: "border-yellow-500", bgColor: "bg-yellow-500", dotColor: "bg-yellow-300" },
  Stocks: { label: "Stocks", borderColor: "border-green-600", bgColor: "bg-green-600", dotColor: "bg-green-400" },
  "Other Crypto": { label: "Other Crypto", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

// ==================== Chart Wrapper ====================

function BinanceChartWrapper({ selectedCoin, interval, candles, intervalFundingRates, fundingIntervalSeconds }: ChartComponentProps) {
  return (
    <BinanceFundingCandlesChart
      symbol={selectedCoin}
      interval={interval}
      candles={candles}
      intervalFundingRates={intervalFundingRates}
      fundingIntervalSeconds={fundingIntervalSeconds}
    />
  );
}

// ==================== Main Component ====================

export default function BinanceFundingMonitor() {
  const [fundingRates, setFundingRates] = useState<BinanceFundingRate[]>([]);

  // Async fetch openInterest
  const fetchOpenInterestAsync = useCallback(async (
    premiumMap: Map<string, PremiumIndex>,
  ): Promise<Map<string, number>> => {
    const usdtSymbols = Array.from(premiumMap.keys()).filter((s) => s.endsWith("USDT") && !DELISTED_SYMBOLS.has(s));

    const batchSize = 50;
    const openInterestMap = new Map<string, number>();

    for (let i = 0; i < usdtSymbols.length; i += batchSize) {
      const batch = usdtSymbols.slice(i, i + batchSize);
      const promises = batch.map(async (symbol) => {
        try {
          const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
          if (oiRes.ok) {
            const oiData = await oiRes.json();
            const oi = parseFloat(oiData.openInterest || "0");
            const premium = premiumMap.get(symbol);
            const markPrice = parseFloat(premium?.markPrice || "0");
            return { symbol, value: oi * markPrice };
          }
        } catch {
          // Ignore individual request failures
        }
        return { symbol, value: 0 };
      });

      const results = await Promise.all(promises);
      for (const { symbol, value } of results) {
        openInterestMap.set(symbol, value);
      }

      if (i + batchSize < usdtSymbols.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return openInterestMap;
  }, []);

  // Fetch rates with Binance-specific logic
  const fetchRates = useCallback(async (): Promise<ExchangeFundingRate[]> => {
    const tickersRes = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr");
    if (!tickersRes.ok) throw new Error(`Ticker API failed: ${tickersRes.status}`);

    const premiumRes = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex");
    if (!premiumRes.ok) throw new Error(`Premium API failed: ${premiumRes.status}`);

    const fundingInfoRes = await fetch("https://fapi.binance.com/fapi/v1/fundingInfo");
    const bookTickerRes = await fetch("https://fapi.binance.com/fapi/v1/ticker/bookTicker");

    const tickers: Ticker24hr[] = await tickersRes.json();
    const premiums: PremiumIndex[] = await premiumRes.json();
    const fundingInfos: FundingInfo[] = fundingInfoRes.ok ? await fundingInfoRes.json() : [];
    const bookTickers: Array<{ symbol: string; bidPrice: string; askPrice: string }> = bookTickerRes.ok
      ? await bookTickerRes.json()
      : [];

    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
    const premiumMap = new Map(premiums.map((p) => [p.symbol, p]));
    const fundingInfoMap = new Map(fundingInfos.map((f) => [f.symbol, f]));
    const bookTickerMap = new Map(bookTickers.map((b) => [b.symbol, b]));

    const rates: BinanceFundingRate[] = [];
    for (const [symbol, premium] of premiumMap) {
      if (!symbol.endsWith("USDT")) continue;
      if (DELISTED_SYMBOLS.has(symbol)) continue;

      const ticker = tickerMap.get(symbol);
      const fundingInfo = fundingInfoMap.get(symbol);
      const fundingInterval = fundingInfo?.fundingIntervalHours ? fundingInfo.fundingIntervalHours * 3600 : 8 * 60 * 60;
      const bookTicker = bookTickerMap.get(symbol);
      const quoteVolume = parseFloat(ticker?.quoteVolume || "0");

      rates.push({
        symbol,
        fundingRate: premium.lastFundingRate || "0",
        markPrice: premium.markPrice || "0",
        indexPrice: premium.indexPrice || "0",
        lastFundingRate: premium.lastFundingRate || "0",
        nextFundingTime: premium.nextFundingTime || 0,
        lastPrice: premium.lastPrice || premium.markPrice || "0",
        bidPrice: bookTicker?.bidPrice || "0",
        askPrice: bookTicker?.askPrice || "0",
        priceChangePercent: ticker?.priceChangePercent || "0",
        quoteVolume: ticker?.quoteVolume || "0",
        openInterest: "0",
        notionalValue: String(quoteVolume),
        fundingInterval,
        assetCategory: getAssetCategory(symbol),
      });
    }

    const openInterestMap = await fetchOpenInterestAsync(premiumMap);

    const ratesWithRealOI = rates.map((rate) => {
      const oiValue = openInterestMap.get(rate.symbol);
      if (oiValue && oiValue > 0) {
        return {
          ...rate,
          openInterest: rate.markPrice && parseFloat(rate.markPrice) > 0
            ? String(oiValue / parseFloat(rate.markPrice))
            : rate.openInterest,
          notionalValue: String(oiValue),
        };
      }
      return rate;
    });

    setFundingRates(ratesWithRealOI);
    return ratesWithRealOI.map(mapToExchangeFundingRate);
  }, [fetchOpenInterestAsync]);

  // Fetch detail data
  const fetchDetailData = useCallback(
    async (symbol: string, interval: ChartInterval): Promise<DetailData> => {
      // Get K-line data
      const candleResponse = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=30`,
      );
      if (!candleResponse.ok) throw new Error("Failed to fetch candles");

      const candleData = await candleResponse.json();
      if (!Array.isArray(candleData) || candleData.length === 0) {
        return { candles: [], intervalFundingRates: [], hourlyFundingRates30d: [] };
      }

      const candles: BinanceCandle[] = candleData.map((kline: any[]) => ({
        openTime: kline[0],
        closeTime: kline[6],
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
      }));

      // Get funding history
      const fundingResponse = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1000`);

      let fundingHistory: FundingHistoryItem[] = [];
      if (fundingResponse.ok) {
        const fundingData = await fundingResponse.json();
        if (Array.isArray(fundingData)) {
          fundingHistory = fundingData.map((item: any) => ({
            time: item.fundingTime,
            fundingRate: item.fundingRate,
          }));
        }
      }

      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const fundingHistory30d = fundingHistory.filter((item) => item.time >= thirtyDaysAgo);

      const visibleCandles = interval === "1d" ? candles : candles.slice(Math.max(candles.length - 30, 0));

      const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory30d, interval);
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );
      const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory30d, "1h");

      return {
        candles: visibleCandles,
        intervalFundingRates: visibleFundingRates,
        hourlyFundingRates30d: hourlyFundingRates,
      };
    },
    [],
  );

  const config: ExchangeFundingMonitorConfig = useMemo(
    () => ({
      exchangeName: "Binance",
      exchangeColor: "yellow",
      categoryConfig,
      defaultFilterType: "all",
      formatFundingRate: (rate: number) => formatFundingRate(rate),
      formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) =>
        formatAnnualizedRate(rate, fundingIntervalSeconds),
      formatPrice: (price: number) => formatPrice(price),
      formatVolume: (volume: number) => formatVolume(volume),
      ChartComponent: BinanceChartWrapper,
      searchPlaceholder: "搜索交易对，例如 BTC、ETH",
      fetchRates,
      fetchDetailData,
      renderExtraStatsCard: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">结算周期</p>
          <p className="text-2xl font-bold text-yellow-400">8h / 4h / 1h</p>
        </div>
      ),
      renderInfoSection: () => (
        <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-gray-300">Binance 资金费率说明</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
            <li>Binance 永续合约采用 USDT 结算机制。</li>
            <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
            <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
            <li>主要合约每 8 小时结算一次，部分合约每 4 小时或 1 小时结算。</li>
            <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
            <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
          </ul>
        </div>
      ),
    }),
    [fetchRates, fetchDetailData],
  );

  return <ExchangeFundingMonitor config={config} />;
}
