// ==================== Search Candlestick Data Layer ====================
// Fetches candlestick data for all 5 exchanges with maximum history per interval.
// Used by the search page chart component.

import { getCandleSnapshot as hlGetCandleSnapshot } from "./hyperliquid";
import { isAbortLikeError } from "./utils/abort";
import type { SearchExchangeRate } from "./search";

// ==================== Types ====================

export type SearchChartInterval = "1d" | "1w" | "4h" | "1h" | "5m";

export interface SearchCandlePoint {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface SearchCandleResult {
  candles: SearchCandlePoint[];
  interval: SearchChartInterval;
  exchange: string;
  symbol: string;
}

// ==================== Interval Utilities ====================

const SEARCH_INTERVAL_MS: Record<SearchChartInterval, number> = {
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "5m": 5 * 60 * 1000,
};

export function getSearchIntervalMs(interval: SearchChartInterval): number {
  return SEARCH_INTERVAL_MS[interval];
}

// ==================== Max Candles Per Exchange ====================
// Each exchange has different API limits. We request the maximum reasonable
// amount per single request to maximize history without pagination.

const MAX_CANDLES: Record<string, number> = {
  hyperliquid: 5000,
  binance: 1500,
  gateio: 2000,
  okx: 300,
  lighter: 500,
};

// ==================== Interval → Days Mapping ====================
// Convert (max_candles * interval_ms) to days for exchanges that use days parameter.

function maxDaysForInterval(interval: SearchChartInterval, maxCandles: number): number {
  const intervalMs = SEARCH_INTERVAL_MS[interval];
  return Math.ceil((maxCandles * intervalMs) / (24 * 60 * 60 * 1000));
}

// ==================== Exchange-Specific Interval Name Mapping ====================

function toBinanceInterval(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1w";
    case "1d": return "1d";
    case "4h": return "4h";
    case "1h": return "1h";
    case "5m": return "5m";
    default: return "1d";
  }
}

function toGateInterval(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1w";
    case "1d": return "1d";
    case "4h": return "4h";
    case "1h": return "1h";
    case "5m": return "5m";
    default: return "1d";
  }
}

function toOkxBar(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1W";
    case "1d": return "1Dutc";
    case "4h": return "4H";
    case "1h": return "1H";
    case "5m": return "5m";
    default: return "1Dutc";
  }
}

function toLighterResolution(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1w";
    case "1d": return "1d";
    case "4h": return "4h";
    case "1h": return "1h";
    case "5m": return "5m";
    default: return "1d";
  }
}

function toHyperliquidInterval(interval: SearchChartInterval): string {
  // Hyperliquid supports: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M
  switch (interval) {
    case "1w": return "1w";
    case "1d": return "1d";
    case "4h": return "4h";
    case "1h": return "1h";
    case "5m": return "5m";
    default: return "1d";
  }
}

function toHyperliquidDays(interval: SearchChartInterval): number {
  // Hyperliquid's getCandleSnapshot uses `days` parameter with startTime/endTime.
  // We request max history based on 5000 candle limit.
  return maxDaysForInterval(interval, MAX_CANDLES.hyperliquid);
}

// ==================== Gate.io Interval MS (not in public API) ====================

function getGateIntervalMs(interval: SearchChartInterval): number {
  return SEARCH_INTERVAL_MS[interval];
}

function getUtcWeekStart(timestamp: number): number {
  const date = new Date(timestamp);
  const utcDay = date.getUTCDay();
  const daysSinceMonday = utcDay === 0 ? 6 : utcDay - 1;
  const weekStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0,
  );
  return weekStart;
}

function aggregateDailyCandlesToWeekly(candles: SearchCandlePoint[]): SearchCandlePoint[] {
  if (candles.length === 0) return [];

  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  const groups = new Map<number, SearchCandlePoint[]>();

  for (const candle of sorted) {
    const weekStart = getUtcWeekStart(candle.openTime);
    const existing = groups.get(weekStart);
    if (existing) {
      existing.push(candle);
    } else {
      groups.set(weekStart, [candle]);
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, weekCandles]) => {
      const ordered = weekCandles.sort((a, b) => a.openTime - b.openTime);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const high = Math.max(...ordered.map((c) => Number(c.high)));
      const low = Math.min(...ordered.map((c) => Number(c.low)));
      const volume = ordered.reduce((sum, c) => sum + Number(c.volume), 0);

      return {
        openTime: weekStart,
        closeTime: weekStart + SEARCH_INTERVAL_MS["1w"],
        open: first.open,
        high: String(high),
        low: String(low),
        close: last.close,
        volume: String(volume),
      } satisfies SearchCandlePoint;
    })
    .filter((candle) => Number.isFinite(Number(candle.open)) && Number.isFinite(Number(candle.close)));
}

// ==================== Fetch Functions Per Exchange ====================

async function fetchHyperliquidCandles(
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    const hlInterval = toHyperliquidInterval(interval) as "1d" | "4h" | "1h" | "5m" | "1w";
    const days = toHyperliquidDays(interval);
    const candles = await hlGetCandleSnapshot(symbol, hlInterval as any, days, signal);
    return candles.map((c) => ({
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      volume: String(c.volume ?? 0),
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Hyperliquid fetch failed:", error);
    return [];
  }
}

async function fetchBinanceCandles(
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    const binanceInterval = toBinanceInterval(interval);
    const limit = MAX_CANDLES.binance;
    // Use Next.js API proxy to avoid CORS
    const url = `/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${binanceInterval}&limit=${limit}`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((item: any[]) => ({
      openTime: Number(item[0]),
      closeTime: Number(item[6]),
      open: String(item[1]),
      high: String(item[2]),
      low: String(item[3]),
      close: String(item[4]),
      volume: String(item[5]),
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Binance fetch failed:", error);
    return [];
  }
}

async function fetchGateCandles(
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    // Gate.io uses same interval naming convention for these intervals
    const gateInterval = toGateInterval(interval);
    const limit = MAX_CANDLES.gateio;
    const contract = `${symbol}_USDT`;
    const url = `/api/gate/futures/usdt/candlesticks?contract=${encodeURIComponent(contract)}&interval=${gateInterval}&limit=${limit}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal,
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const intervalMs = getGateIntervalMs(interval);
    return data.map((item: { t: number; o: string; h: string; l: string; c: string; v: number; sum?: string }) => {
      const openTime = item.t * 1000;
      return {
        openTime,
        closeTime: openTime + intervalMs,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: String(item.v),
      };
    });
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Gate.io fetch failed:", error);
    return [];
  }
}

async function fetchOkxCandles(
  rawSymbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    const bar = toOkxBar(interval);
    // OKX live candles endpoint returns up to 300 per request
    // For maximum history we use limit=300
    const limit = MAX_CANDLES.okx;
    const url = `/api/okx?endpoint=market/history-candles&instId=${encodeURIComponent(rawSymbol)}&bar=${encodeURIComponent(bar)}&limit=${limit}`;
    const response = await fetch(url, { cache: "no-store", signal });

    if (!response.ok) return [];

    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .map((item: any[]) => ({
        openTime: Number(item[0]),
        closeTime: Number(item[0]),
        open: String(item[1] ?? 0),
        high: String(item[2] ?? 0),
        low: String(item[3] ?? 0),
        close: String(item[4] ?? 0),
        volume: String(item[7] ?? item[6] ?? item[5] ?? 0),
      }))
      .filter((item: SearchCandlePoint) => item.openTime > 0)
      .sort((a: SearchCandlePoint, b: SearchCandlePoint) => a.openTime - b.openTime);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] OKX fetch failed:", error);
    return [];
  }
}

async function fetchLighterCandles(
  marketId: number | undefined,
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    // Resolve marketId if not available
    let resolvedMarketId = marketId ?? null;
    if (resolvedMarketId === null) {
      try {
        const fundingRes = await fetch("/api/lighter?endpoint=funding-rates", { signal });
        if (fundingRes.ok) {
          const fundingData = await fundingRes.json();
          const entry = (fundingData.funding_rates || []).find(
            (e: { exchange: string; symbol: string; market_id: number }) => e.exchange === "lighter" && e.symbol === symbol,
          );
          if (entry) resolvedMarketId = entry.market_id;
        }
      } catch {
        // Ignore resolution errors
      }
    }

    if (resolvedMarketId === null) return [];

    const effectiveInterval: SearchChartInterval = interval === "1w" ? "1d" : interval;
    const resolution = toLighterResolution(effectiveInterval);
    const limit = MAX_CANDLES.lighter;
    const now = Date.now();
    const intervalMs = SEARCH_INTERVAL_MS[effectiveInterval];
    // Lighter launched ~2024, don't request data before that
    const lighterLaunchMs = new Date("2024-01-01T00:00:00Z").getTime();
    const batchSize = 500; // Max candles per Lighter API request

    // Paginate backwards: start from now, request batches until we have enough
    // or until we reach data before the exchange existed
    const allCandles: SearchCandlePoint[] = [];
    let endTimestamp = Math.floor(now);
    let fetchedCount = 0;

    while (fetchedCount < limit) {
      const startTimestamp = Math.max(Math.floor(endTimestamp - batchSize * intervalMs), Math.floor(lighterLaunchMs));
      const url = `/api/lighter?endpoint=candles&market_id=${resolvedMarketId}&resolution=${resolution}&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=${batchSize}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal,
      });

      if (!response.ok) break;

      const data = await response.json();
      const candleArray = data.c || data.candlesticks || data;
      if (!Array.isArray(candleArray) || candleArray.length === 0) break;

      const batch: SearchCandlePoint[] = candleArray
        .map((item: any) => ({
          openTime: Number(item.t ?? item.timestamp ?? 0),
          closeTime: Number(item.t ?? item.timestamp ?? 0) + intervalMs,
          open: String(item.o ?? item.O ?? 0),
          high: String(item.h ?? item.H ?? 0),
          low: String(item.l ?? item.L ?? 0),
          close: String(item.c ?? item.C ?? 0),
          volume: String(item.v ?? item.V ?? 0),
        }))
        .filter((candle) => Number(candle.openTime) > 0);

      for (const candle of batch) {
        allCandles.push(candle);
      }
      fetchedCount += batch.length;

      // If we got fewer than batchSize, we've reached the end of available data
      if (batch.length < batchSize) break;

      // Set endTimestamp to the earliest candle's openTime for the next batch
      const earliestTime = Math.min(...batch.map((c) => c.openTime));
      if (earliestTime <= lighterLaunchMs) break; // Don't go before exchange launch
      endTimestamp = earliestTime;
    }

    // Sort chronologically (oldest first)
    allCandles.sort((a, b) => a.openTime - b.openTime);

    // Deduplicate by openTime (in case batches overlap)
    const seen = new Set<number>();
    const deduped = allCandles.filter((c) => {
      if (seen.has(c.openTime)) return false;
      seen.add(c.openTime);
      return true;
    });

    if (interval === "1w") {
      return aggregateDailyCandlesToWeekly(deduped);
    }

    return deduped;
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Lighter fetch failed:", error);
    return [];
  }
}

// ==================== Unified Fetch Dispatcher ====================

export async function fetchSearchCandles(
  rate: SearchExchangeRate,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandleResult> {
  const empty: SearchCandleResult = {
    candles: [],
    interval,
    exchange: rate.exchange,
    symbol: rate.symbol,
  };

  switch (rate.exchange) {
    case "Hyperliquid": {
      const candles = await fetchHyperliquidCandles(rate.symbol, interval, signal);
      return { ...empty, candles };
    }
    case "Gate.io": {
      const candles = await fetchGateCandles(rate.symbol, interval, signal);
      return { ...empty, candles };
    }
    case "Binance": {
      const rawSymbol = rate.rawSymbol || `${rate.symbol}USDT`;
      const candles = await fetchBinanceCandles(rawSymbol, interval, signal);
      return { ...empty, candles };
    }
    case "OKX": {
      const rawSymbol = rate.rawSymbol || `${rate.symbol}-USDT-SWAP`;
      const candles = await fetchOkxCandles(rawSymbol, interval, signal);
      return { ...empty, candles };
    }
    case "Lighter": {
      const candles = await fetchLighterCandles(rate.marketId, rate.symbol, interval, signal);
      return { ...empty, candles };
    }
    default:
      return empty;
  }
}
