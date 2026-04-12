import ccxt from "ccxt";
import { NextRequest, NextResponse } from "next/server";
import type {
  CanonicalCandlePoint,
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";
import { BINANCE_DELISTED_SYMBOLS, getBinanceAssetCategory } from "@/lib/binance-metadata";

type BinanceUsdmExchange = InstanceType<typeof ccxt.binanceusdm>;
type CcxtOhlcvTuple = [number, number, number, number, number, number];

export const runtime = "nodejs";

const BINANCE_API_BASE = "https://fapi.binance.com";
const DEFAULT_FUNDING_INTERVAL_SECONDS = 8 * 60 * 60;

type CcxtFundingRate = {
  symbol?: string;
  info?: { symbol?: string; nextFundingTime?: number | string };
  fundingRate?: number | string | null;
  markPrice?: number | string | null;
  indexPrice?: number | string | null;
  interval?: string | null;
};

type CcxtTicker = {
  symbol?: string;
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  percentage?: number | null;
  quoteVolume?: number | null;
};

type CcxtFundingHistoryItem = {
  timestamp?: number;
  fundingRate?: number | string | null;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseFundingIntervalSeconds(interval: string | null | undefined): number {
  if (!interval) return DEFAULT_FUNDING_INTERVAL_SECONDS;
  const match = interval.match(/^(\d+)([mhd])$/i);
  if (!match) return DEFAULT_FUNDING_INTERVAL_SECONDS;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 3600;
  if (unit === "d") return amount * 86400;
  return DEFAULT_FUNDING_INTERVAL_SECONDS;
}

let exchangePromise: Promise<BinanceUsdmExchange> | null = null;

async function createExchange() {
  if (!exchangePromise) {
    exchangePromise = (async () => {
      const exchange = new ccxt.binanceusdm({
        enableRateLimit: true,
        options: { defaultType: "future" },
      });
      await exchange.loadMarkets();
      return exchange;
    })();
  }

  return exchangePromise;
}

async function fetchOpenInterestNotional(rawSymbols: string[], markPriceMap: Map<string, number>): Promise<Map<string, number>> {
  const openInterestMap = new Map<string, number>();
  const batchSize = 50;

  for (let i = 0; i < rawSymbols.length; i += batchSize) {
    const batch = rawSymbols.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (rawSymbol) => {
        try {
          const response = await fetch(`${BINANCE_API_BASE}/fapi/v1/openInterest?symbol=${rawSymbol}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            return { rawSymbol, value: 0 };
          }

          const data = (await response.json()) as { openInterest?: string };
          const oi = toNumber(data.openInterest);
          const markPrice = markPriceMap.get(rawSymbol) ?? 0;
          return { rawSymbol, value: oi * markPrice };
        } catch {
          return { rawSymbol, value: 0 };
        }
      }),
    );

    for (const result of results) {
      openInterestMap.set(result.rawSymbol, result.value);
    }
  }

  return openInterestMap;
}

async function getListRows(): Promise<CanonicalFundingRateRow[]> {
  const exchange = await createExchange();
  const fundingRatesResponse = (await exchange.fetchFundingRates()) as Record<string, CcxtFundingRate>;
  const fundingEntries = Object.values(fundingRatesResponse)
    .filter((entry) => entry.symbol && entry.info?.symbol)
    .filter((entry) => {
      const rawSymbol = entry.info?.symbol ?? "";
      return rawSymbol.endsWith("USDT") && !BINANCE_DELISTED_SYMBOLS.has(rawSymbol);
    });

  const unifiedSymbols = fundingEntries.map((entry) => entry.symbol as string);
  const rawSymbols = fundingEntries.map((entry) => entry.info?.symbol as string);
  const tickerResponse = (await exchange.fetchTickers(unifiedSymbols)) as Record<string, CcxtTicker>;
  const markPriceMap = new Map<string, number>(
    fundingEntries.map((entry) => [entry.info?.symbol as string, toNumber(entry.markPrice)]),
  );
  const openInterestMap = await fetchOpenInterestNotional(rawSymbols, markPriceMap);

  return fundingEntries.map((entry) => {
    const unifiedSymbol = entry.symbol as string;
    const rawSymbol = entry.info?.symbol as string;
    const ticker = tickerResponse[unifiedSymbol];
    const markPrice = toNumber(entry.markPrice);
    const notionalValue = openInterestMap.get(rawSymbol) ?? 0;
    const openInterest = markPrice > 0 ? notionalValue / markPrice : 0;

    return {
      exchange: "binance",
      transportMode: "ccxt",
      symbol: rawSymbol,
      rawSymbol,
      marketKey: unifiedSymbol,
      fundingRate: toNumber(entry.fundingRate),
      predictedFundingRate: null,
      lastSettlementRate: null,
      markPrice,
      indexPrice: toNumber(entry.indexPrice),
      lastPrice: ticker?.last ?? markPrice,
      change24h: ticker?.percentage ?? 0,
      quoteVolume: ticker?.quoteVolume ?? 0,
      openInterest,
      notionalValue: notionalValue > 0 ? notionalValue : ticker?.quoteVolume ?? 0,
      fundingIntervalSeconds: parseFundingIntervalSeconds(entry.interval),
      assetCategory: getBinanceAssetCategory(rawSymbol),
      bestBid: ticker?.bid ?? null,
      bestAsk: ticker?.ask ?? null,
    } satisfies CanonicalFundingRateRow;
  });
}

async function getDetail(symbol: string, interval: string): Promise<CanonicalFundingDetail> {
  const exchange = await createExchange();
  const marketCandidates = exchange.markets_by_id?.[symbol];
  const market = Array.isArray(marketCandidates) ? marketCandidates[0] : marketCandidates;

  if (!market?.symbol) {
    throw new Error(`Unknown Binance market: ${symbol}`);
  }

  const ccxtInterval = interval === "4h" || interval === "1h" || interval === "1d" ? interval : "1d";
  const [candlesResponse, fundingHistoryResponse] = await Promise.all([
    exchange.fetchOHLCV(market.symbol, ccxtInterval, undefined, 30),
    exchange.fetchFundingRateHistory(market.symbol, undefined, 1000),
  ]);

  const candles: CanonicalCandlePoint[] = (candlesResponse as CcxtOhlcvTuple[]).map((item) => {
    const openTime = toNumber(item[0]);
    return {
      openTime,
      closeTime: openTime,
      open: String(item[1] ?? 0),
      high: String(item[2] ?? 0),
      low: String(item[3] ?? 0),
      close: String(item[4] ?? 0),
      volume: String(item[5] ?? 0),
    };
  });

  const fundingHistory = (fundingHistoryResponse as CcxtFundingHistoryItem[])
    .map((item) => ({
      timestamp: item.timestamp ?? 0,
      fundingRate: toNumber(item.fundingRate),
    }))
    .filter((item) => item.timestamp > 0);

  const latestSettled = fundingHistory.reduce<CanonicalFundingHistoryPoint | null>((latest, item) => {
    if (!latest || item.timestamp > latest.timestamp) {
      return item;
    }
    return latest;
  }, null);

  return {
    exchange: "binance",
    transportMode: "ccxt",
    symbol,
    rawSymbol: symbol,
    marketKey: market.symbol,
    candles,
    fundingHistory,
    lastSettlementRate: latestSettled ? latestSettled.fundingRate : null,
    bidAskSpread: null,
  } satisfies CanonicalFundingDetail;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "list";

  try {
    if (mode === "list") {
      return NextResponse.json(await getListRows());
    }

    if (mode === "detail") {
      const symbol = searchParams.get("symbol");
      const interval = searchParams.get("interval") || "1d";
      if (!symbol) {
        return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
      }

      return NextResponse.json(await getDetail(symbol, interval));
    }

    return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
  } catch (error) {
    console.error("[Binance CCXT] Route error:", error);
    return NextResponse.json({ error: "Failed to fetch Binance CCXT data" }, { status: 500 });
  }
}
