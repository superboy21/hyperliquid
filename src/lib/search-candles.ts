// ==================== Search Candlestick Data Layer ====================
// Fetches candlestick data for all 6 exchanges with maximum history per interval.
// Used by the search page chart component.

import { getCandleSnapshot as hlGetCandleSnapshot, getFundingHistoryRange as hlGetFundingHistoryRange } from "./hyperliquid";
import { lighterFetch } from "./lighter";
import { fetchOkxFundingHistory as fetchOkxFundingHistoryCanonical, okxFetch } from "./adapters/okx";
import { binanceFetch, binanceKlinesFetch } from "./adapters/binance";
import { fetchBitgetCandles, fetchBitgetFundingHistory } from "./adapters/bitget";
import { fetchBybitCandles, fetchBybitFundingHistory, resolveBybitFundingHistoryWindowMs } from "./adapters/bybit";
import { isAbortLikeError, throwIfAborted } from "./utils/abort";
import { getGateQuantoMultiplier } from "./gateio";
import { requestGate } from "./gate-upstream";
import { requireBitgetRawSymbol, requireBybitRawSymbol, type SearchExchangeRate } from "./search";
import { createCandleSourceProvenance, type CandleSourceProvenance } from "./candle-provenance";
import { calculateHistoricalFundingStatistics } from "./funding-statistics";

// ==================== Types ====================

export type SearchChartInterval = "1d" | "1w" | "4h" | "1h" | "5m" | "1m";
export type CandlePurpose = "single" | "combo";
export interface CandleFetchOptions {
  purpose?: CandlePurpose;
  /** Captured chart-generation bounds. Only Bitget consumes these currently. */
  window?: Readonly<{ startTime?: number; endTime: number }>;
}

export interface SearchCandlePoint {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume?: string;
}

export interface FundingRatePoint {
  time: number;
  /** Sum of settled funding rates in this candle interval (not an average). */
  rate: number;
  annualizedRate: number;
  sampleCount?: number;
}

export interface SearchCandleResult {
  candles: SearchCandlePoint[];
  fundingRates: FundingRatePoint[];
  interval: SearchChartInterval;
  exchange: string;
  symbol: string;
  provenance?: CandleSourceProvenance;
}

// ==================== Interval Utilities ====================

const SEARCH_INTERVAL_MS: Record<SearchChartInterval, number> = {
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "1m": 60 * 1000,
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
  bitget: 9000,
  bybit: 1000,
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
    case "1m": return "1m";
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
    case "1m": return "1m";
    default: return "1d";
  }
}

export function toOkxBar(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1Wutc";
    case "1d": return "1Dutc";
    case "4h": return "4H";
    case "1h": return "1H";
    case "5m": return "5m";
    case "1m": return "1m";
    default: return "1Dutc";
  }
}

export function normalizeOkxSearchCandle(item: any[], intervalMs: number): SearchCandlePoint {
  return {
    openTime: Number(item[0]),
    closeTime: Number(item[0]) + intervalMs,
    open: String(item[1] ?? 0),
    high: String(item[2] ?? 0),
    low: String(item[3] ?? 0),
    close: String(item[4] ?? 0),
    // OKX perpetual rows are [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm].
    volume: String(item[6] ?? 0),
    ...(item[7] === undefined || item[7] === null ? {} : { quoteVolume: String(item[7]) }),
  };
}

function toLighterResolution(interval: SearchChartInterval): string {
  switch (interval) {
    case "1w": return "1w";
    case "1d": return "1d";
    case "4h": return "4h";
    case "1h": return "1h";
    case "5m": return "5m";
    case "1m": return "1m";
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
    case "1m": return "1m";
    default: return "1d";
  }
}

function toHyperliquidDays(interval: SearchChartInterval): number {
  // Hyperliquid's getCandleSnapshot uses `days` parameter with startTime/endTime.
  // We request max history based on 5000 candle limit.
  return maxDaysForInterval(interval, MAX_CANDLES.hyperliquid);
}

export function resolvePerpCandleSource(
  exchange: "Hyperliquid" | "Lighter",
  interval: SearchChartInterval,
  purpose: CandlePurpose = "single",
): { sourceInterval: SearchChartInterval; aggregateWeekly: boolean } {
  if (interval !== "1w") return { sourceInterval: interval, aggregateWeekly: false };
  if (exchange === "Lighter") {
    return { sourceInterval: "1d", aggregateWeekly: true };
  }
  return purpose === "combo"
    ? { sourceInterval: "1d", aggregateWeekly: true }
    : { sourceInterval: "1w", aggregateWeekly: false };
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

export function aggregateDailyCandlesToWeekly(candles: SearchCandlePoint[]): SearchCandlePoint[] {
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
      const quoteVolume = ordered.reduce((sum, c) => sum + Number(c.quoteVolume), 0);

      return {
        openTime: weekStart,
        closeTime: weekStart + SEARCH_INTERVAL_MS["1w"],
        open: first.open,
        high: String(high),
        low: String(low),
        close: last.close,
        volume: String(volume),
        quoteVolume: String(quoteVolume),
      } satisfies SearchCandlePoint;
    })
    .filter((candle) => Number.isFinite(Number(candle.open)) && Number.isFinite(Number(candle.close)));
}

// ==================== Funding Rate Helpers ====================

export function toAnnualizedRate(rate: number, fundingIntervalSeconds: number): number {
  const settlementsPerDay = (24 * 3600) / fundingIntervalSeconds;
  return rate * settlementsPerDay * 365;
}

export function aggregateFundingRatesToCandles(
  rawHistory: { time: number; rate: number }[],
  candles: SearchCandlePoint[],
  /** @deprecated Historical annualization is based on the candle duration. */
  _fundingIntervalSeconds?: number,
): FundingRatePoint[] {
  if (candles.length === 0) return [];

  return candles.map((candle) => {
    const statistics = calculateHistoricalFundingStatistics(
      rawHistory,
      candle.openTime,
      candle.closeTime,
      candle.closeTime - candle.openTime,
    );

    if (statistics) {
      return {
        time: candle.openTime,
        rate: statistics.settledReturn,
        annualizedRate: statistics.annualizedRate,
        sampleCount: statistics.sampleCount,
      };
    }

    return { time: candle.openTime, rate: 0, annualizedRate: 0, sampleCount: 0 };
  });
}

// ==================== Fetch Functions Per Exchange ====================

async function fetchHyperliquidCandles(
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  purpose: CandlePurpose = "single",
): Promise<SearchCandlePoint[]> {
  try {
    // Hyperliquid's native week anchors on Thursday. Preserve that official
    // source for a single chart; combinations canonically aggregate UTC days.
    const { sourceInterval, aggregateWeekly } = resolvePerpCandleSource("Hyperliquid", interval, purpose);
    const hlInterval = toHyperliquidInterval(sourceInterval) as "1d" | "4h" | "1h" | "5m" | "1w";
    const days = toHyperliquidDays(sourceInterval);
    const candles = await hlGetCandleSnapshot(symbol, hlInterval as any, days, signal);
    const normalized = candles.map((c) => ({
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: String(c.open),
      high: String(c.high),
      low: String(c.low),
      close: String(c.close),
      volume: String(c.volume ?? 0),
      quoteVolume: String((Number(c.volume ?? 0)) * (Number(c.close) || 1)),
    }));
    return aggregateWeekly ? aggregateDailyCandlesToWeekly(normalized) : normalized;
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
    const response = await binanceKlinesFetch(symbol, binanceInterval, String(limit), { signal });

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
      quoteVolume: String(item[7] ?? Number(item[5]) * Number(item[4])),
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Binance fetch failed:", error);
    return [];
  }
}

export async function fetchGateCandles(
  symbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    // Gate.io uses same interval naming convention for these intervals
    const gateInterval = toGateInterval(interval);
    const limit = MAX_CANDLES.gateio;
    const contract = `${symbol}_USDT`;
    const response = await requestGate("candlesticks", {
      contract,
      interval: gateInterval,
      limit: String(limit),
    }, signal);

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];
    if (data.length === 0) return [];

    const multiplier = await getGateQuantoMultiplier(contract, signal);
    if (multiplier === null) return [];

    const intervalMs = getGateIntervalMs(interval);
    return data.flatMap((item: { t: number; o: string; h: string; l: string; c: string; v: number; sum?: string }) => {
      const contracts = Number(item.v);
      if (!Number.isFinite(contracts)) return [];
      const openTime = item.t * 1000;
      return [{
        openTime,
        closeTime: openTime + intervalMs,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: String(contracts * multiplier),
        ...(item.sum === undefined || item.sum === null ? {} : { quoteVolume: String(item.sum) }),
      }];
    });
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Gate.io fetch failed:", error);
    return [];
  }
}

export async function fetchOkxCandles(
  rawSymbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
): Promise<SearchCandlePoint[]> {
  try {
    const bar = toOkxBar(interval);
    const limit = MAX_CANDLES.okx;
    const intervalMs = SEARCH_INTERVAL_MS[interval];

    // For 1m interval, we need pagination because OKX returns max 300 candles per request
    // 1d = 1440 candles, 4h = 240 candles
    if (interval === "1m") {
      const allCandles: SearchCandlePoint[] = [];
      const seen = new Set<number>();
      let after: number | null = null;
      const maxLoops = 10; // Max 3000 candles for 1m

      for (let i = 0; i < maxLoops; i++) {
        throwIfAborted(signal);

        let url = `/api/okx?endpoint=market/history-candles&instId=${encodeURIComponent(rawSymbol)}&bar=${encodeURIComponent(bar)}&limit=${limit}`;
        if (after !== null) {
          url += `&after=${after}`;
        }

        const response = await okxFetch(url, { cache: "no-store", signal });
        if (!response.ok) break;

        const payload = await response.json();
        const rows = Array.isArray(payload.data) ? payload.data : [];
        if (rows.length === 0) break;

        for (const item of rows) {
          const openTime = Number(item[0]);
          if (!seen.has(openTime) && openTime > 0) {
            seen.add(openTime);
            allCandles.push(normalizeOkxSearchCandle(item, intervalMs));
          }
        }

        // Use the earliest timestamp as the next 'after' parameter
        const earliestTime = Math.min(...rows.map((r: any[]) => Number(r[0])));
        if (after !== null && earliestTime >= after) break; // No new data
        after = earliestTime;

        if (rows.length < limit) break; // Last page
      }

      return allCandles.sort((a, b) => a.openTime - b.openTime);
    }

    // Non-1m intervals: single request (existing behavior)
    const url = `/api/okx?endpoint=market/history-candles&instId=${encodeURIComponent(rawSymbol)}&bar=${encodeURIComponent(bar)}&limit=${limit}`;
    const response = await okxFetch(url, { cache: "no-store", signal });

    if (!response.ok) return [];

    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .map((item: any[]) => normalizeOkxSearchCandle(item, intervalMs))
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
  purpose: CandlePurpose = "single",
): Promise<SearchCandlePoint[]> {
  const { sourceInterval: effectiveInterval, aggregateWeekly } = resolvePerpCandleSource("Lighter", interval, purpose);
  try {
    // Resolve marketId if not available
    let resolvedMarketId = marketId ?? null;
    if (resolvedMarketId === null) {
      try {
        const fundingRes = await lighterFetch("funding-rates", "", { signal });
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

    const resolution = toLighterResolution(effectiveInterval);
    const limit = MAX_CANDLES.lighter;
    const now = Date.now();
    const intervalMs = SEARCH_INTERVAL_MS[effectiveInterval];
    // Lighter launched ~2024, don't request data before that
    const lighterLaunchMs = new Date("2024-01-01T00:00:00Z").getTime();
    const batchSize = 500; // Max candles per Lighter API request
    const PAGE_DELAY_MS = 100;

    // Paginate backwards: start from now, request batches until we have enough
    // or until we reach data before the exchange existed
    const allCandles: SearchCandlePoint[] = [];
    let endTimestamp = Math.floor(now);
    let fetchedCount = 0;

    while (fetchedCount < limit) {
      const startTimestamp = Math.max(Math.floor(endTimestamp - batchSize * intervalMs), Math.floor(lighterLaunchMs));

      const response = await lighterFetch(
        "candles",
        `market_id=${resolvedMarketId}&resolution=${resolution}&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=${batchSize}`,
        { signal },
      );

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
          quoteVolume: String(Number(item.v ?? item.V ?? 0) * Number(item.c ?? item.C ?? 0)),
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

      if (PAGE_DELAY_MS > 0 && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
      }
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

    if (aggregateWeekly) {
      // Lighter has no official weekly candle. Combo charts use canonical UTC
      // Monday buckets derived from its official daily source.
      return aggregateDailyCandlesToWeekly(deduped);
    }

    return deduped;
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Lighter fetch failed:", error);
    return [];
  }
}

export async function fetchBitgetSearchCandles(
  rawSymbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  fetchCandles: typeof fetchBitgetCandles = fetchBitgetCandles,
  window?: CandleFetchOptions["window"],
): Promise<SearchCandlePoint[]> {
  const candles = await fetchCandles(rawSymbol, interval, { ...window, signal, priority: "interactive" });
  return candles.map((candle) => ({ ...candle }));
}

// ==================== Bybit Candles ====================

/**
 * V5 kline rows arrive newest-first; the adapter normalizes them, but this
 * layer re-asserts ascending order and dedupes so the app chart always
 * receives chronological candles regardless of transport ordering.
 */
export async function fetchBybitSearchCandles(
  rawSymbol: string,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  fetchCandles: typeof fetchBybitCandles = fetchBybitCandles,
): Promise<SearchCandlePoint[]> {
  const candles = await fetchCandles(rawSymbol, interval, { signal });
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  return sorted.filter((candle, index) => index === 0 || candle.openTime !== sorted[index - 1].openTime);
}

// ==================== Funding History Fetch Functions ====================

export function parseSearchFundingRate(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLighterSearchFundingRow(
  item: { timestamp?: unknown; rate?: unknown; value?: unknown; direction?: unknown },
  cutoffTime: number,
): { time: number; rate: number } | null {
  const timestampSeconds = Number(item.timestamp);
  if (!Number.isFinite(timestampSeconds)) return null;
  const time = timestampSeconds * 1000;
  if (time < cutoffTime) return null;
  const rawRate = item.rate !== undefined && item.rate !== null ? item.rate : item.value;
  const unsignedRate = parseSearchFundingRate(rawRate);
  if (unsignedRate === null) return null;
  const signedRate = item.direction === "short" ? -unsignedRate : unsignedRate;
  return { time, rate: signedRate / 100 };
}

async function fetchHyperliquidFundingHistory(
  symbol: string,
  startTimeMs: number,
  endTimeMs: number,
  signal?: AbortSignal,
): Promise<{ time: number; rate: number }[]> {
  try {
    const history = await hlGetFundingHistoryRange(symbol, startTimeMs, endTimeMs, signal);
    return history.flatMap((h) => {
      const time = Number(h.time);
      const rate = parseSearchFundingRate(h.fundingRate);
      return Number.isFinite(time) && rate !== null && time >= startTimeMs && time < endTimeMs
        ? [{ time, rate }]
        : [];
    });
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Hyperliquid funding history failed:", error);
    return [];
  }
}

async function fetchBinanceFundingHistory(
  symbol: string,
  cutoffTime: number = 0,
  signal?: AbortSignal,
): Promise<{ time: number; rate: number }[]> {
  try {
    const allData: { time: number; rate: number }[] = [];
    const seen = new Set<number>();
    const now = Date.now();
    let currentEndTime = now;
    const batchMs = 90 * 24 * 60 * 60 * 1000; // 每次请求最多 90 天的数据，避免超过 1000 条限制
    const maxLoops = cutoffTime > 0
      ? Math.max(20, Math.ceil((now - cutoffTime) / batchMs) + 2)
      : 20;

    for (let i = 0; i < maxLoops; i++) {
      throwIfAborted(signal);

      const startTime = Math.max(cutoffTime, currentEndTime - batchMs);
      const response = await binanceFetch("fundingRate", `symbol=${encodeURIComponent(symbol)}&limit=1000&startTime=${startTime}&endTime=${currentEndTime}`, { signal });
      if (!response.ok) break;

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      let newCount = 0;
      for (const item of data) {
        const time = Number(item.fundingTime);
        const rate = parseSearchFundingRate(item.fundingRate);
        if (!Number.isFinite(time) || rate === null || seen.has(time)) continue;
        seen.add(time);
        allData.push({ time, rate });
        newCount++;
      }

      if (newCount === 0) break;

      // 继续获取更早的数据
      const earliestTime = Math.min(...data.map((d: any) => Number(d.fundingTime)));
      if (!Number.isFinite(earliestTime)) return [];
      currentEndTime = earliestTime - 1;

      // The walk reached the requested cutoff (or the API's retention edge
      // returned no older rows); either way this page budget is done.
      if (earliestTime <= cutoffTime || currentEndTime <= cutoffTime) break;
    }

    return allData
      .filter((item) => item.time >= cutoffTime && item.time < now)
      .sort((a, b) => a.time - b.time);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Binance funding history failed:", error);
    return [];
  }
}

async function fetchGateFundingHistory(
  symbol: string,
  cutoffTime: number = 0,
  signal?: AbortSignal,
): Promise<{ time: number; rate: number }[]> {
  try {
    const contract = `${symbol}_USDT`;
    const pageSize = 1000;
    const pageWindowSeconds = 90 * 24 * 60 * 60;
    const cutoffSeconds = Math.floor(cutoffTime / 1000);
    let currentTo = Math.floor(Date.now() / 1000);
    const history: { time: number; rate: number }[] = [];
    const seen = new Set<number>();
    const maxLoops = cutoffTime > 0
      ? Math.max(1, Math.ceil((Date.now() - cutoffTime) / (pageWindowSeconds * 1000)) + 2)
      : 30;

    for (let page = 0; page < maxLoops && currentTo > cutoffSeconds; page += 1) {
      throwIfAborted(signal);
      const currentFrom = Math.max(cutoffSeconds, currentTo - pageWindowSeconds);
      const response = await requestGate("funding-rate", {
        contract,
        limit: String(pageSize),
        from: String(currentFrom),
        to: String(currentTo),
      }, signal);
      if (!response.ok) break;
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      let earliestTime = Number.POSITIVE_INFINITY;
      for (const item of data as Array<{ t: number; r: string | number }>) {
        const time = Number(item.t) * 1000;
        if (!Number.isFinite(time)) continue;
        earliestTime = Math.min(earliestTime, time);
        const rate = parseSearchFundingRate(item.r);
        if (time < cutoffTime || rate === null || seen.has(time)) continue;
        seen.add(time);
        history.push({ time, rate });
      }
      if (!Number.isFinite(earliestTime)) return [];
      // Reached the requested cutoff, or Gate's 180-day retention edge returned
      // nothing older; both end the page walk with the data collected so far.
      if (earliestTime <= cutoffTime) break;
      const nextTo = Math.floor(earliestTime / 1000) - 1;
      if (nextTo >= currentTo) break;
      currentTo = nextTo;
    }

    return history.sort((a, b) => a.time - b.time);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Gate.io funding history failed:", error);
    return [];
  }
}

async function fetchOkxFundingHistory(
  rawSymbol: string,
  fundingIntervalSeconds: number,
  cutoffTime: number = Date.now() - 365 * 24 * 60 * 60 * 1000,
  signal?: AbortSignal,
): Promise<{ time: number; rate: number }[]> {
  try {
    const now = Date.now();
    const days = Math.max(1, Math.ceil((now - cutoffTime) / (24 * 60 * 60 * 1000)) + 1);
    const history = await fetchOkxFundingHistoryCanonical(
      rawSymbol,
      fundingIntervalSeconds,
      signal,
      days,
      cutoffTime,
      false,
    );
    const mapped = history.map((h) => ({ time: h.timestamp, rate: h.fundingRate }));
    return mapped.filter((h) => h.time >= cutoffTime && h.time < now);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] OKX funding history failed:", error);
    return [];
  }
}

async function fetchLighterFundingHistory(
  marketId: number | undefined,
  symbol: string,
  cutoffTime: number = Date.now() - 365 * 24 * 60 * 60 * 1000,
  signal?: AbortSignal,
): Promise<{ time: number; rate: number }[]> {
  try {
    let resolvedMarketId = marketId ?? null;
    if (resolvedMarketId === null) {
      try {
        const fundingRes = await lighterFetch("funding-rates", "", { signal });
        if (fundingRes.ok) {
          const fundingData = await fundingRes.json();
          const entry = (fundingData.funding_rates || []).find(
            (e: { exchange: string; symbol: string; market_id: number }) => e.exchange === "lighter" && e.symbol === symbol,
          );
          if (entry) resolvedMarketId = entry.market_id;
        }
      } catch { /* ignore */ }
    }
    if (resolvedMarketId === null) return [];

    const batchSize = 500;
    const intervalSeconds = 60 * 60;
    const launchSeconds = Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000);
    let currentEndSeconds = Math.floor(Date.now() / 1000);
    const cutoffSeconds = Math.floor(cutoffTime / 1000);
    const history: { time: number; rate: number }[] = [];
    const seen = new Set<number>();
    const maxLoops = cutoffTime > 0
      ? Math.max(1, Math.ceil((Date.now() - cutoffTime) / (batchSize * intervalSeconds * 1000)) + 2)
      : 20;

    // The adapter's all-history helper has a fixed page cap.  This local walk
    // instead stops at the returned candle cutoff so long weekly chart ranges
    // are not silently truncated. Coverage is soft: if the venue's retained
    // hourly settlements end before the candle cutoff, the overlay simply
    // starts at the oldest settlement actually returned.
    for (let page = 0; page < maxLoops && currentEndSeconds > cutoffSeconds; page += 1) {
      throwIfAborted(signal);
      const startSeconds = Math.max(launchSeconds, cutoffSeconds, currentEndSeconds - batchSize * intervalSeconds);
      const response = await lighterFetch(
        "fundings",
        `market_id=${resolvedMarketId}&resolution=1h&start_timestamp=${startSeconds}&end_timestamp=${currentEndSeconds}&count_back=${batchSize}`,
        { signal },
      );
      if (!response.ok) break;
      const data = await response.json();
      const rows = data?.fundings ?? data;
      if (!Array.isArray(rows) || rows.length === 0) break;

      let earliestSeconds = Number.POSITIVE_INFINITY;
      for (const item of rows as Array<{ timestamp: number; rate?: string | number; value?: string | number; direction?: string }>) {
        const timestampSeconds = Number(item.timestamp);
        if (!Number.isFinite(timestampSeconds)) continue;
        earliestSeconds = Math.min(earliestSeconds, timestampSeconds);
        const point = normalizeLighterSearchFundingRow(item, cutoffTime);
        if (!point || seen.has(point.time)) continue;
        seen.add(point.time);
        // Lighter's source value is hourly percentage points; preserve the
        // existing decimal contract used by chart funding overlays.
        history.push(point);
      }
      if (!Number.isFinite(earliestSeconds)) return [];
      if (earliestSeconds * 1000 <= cutoffTime || earliestSeconds <= launchSeconds) {
        break;
      }
      const nextEndSeconds = Math.floor(earliestSeconds) - 1;
      if (nextEndSeconds >= currentEndSeconds) break;
      currentEndSeconds = nextEndSeconds;
    }

    return history.sort((a, b) => a.time - b.time);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) return [];
    console.error("[SearchCandles] Lighter funding history failed:", error);
    return [];
  }
}

export async function fetchBitgetSearchFundingHistory(
  rawSymbol: string,
  cutoffTime: number,
  signal?: AbortSignal,
  fetchFundingHistory: typeof fetchBitgetFundingHistory = fetchBitgetFundingHistory,
): Promise<{ time: number; rate: number }[]> {
  const history = await fetchFundingHistory(rawSymbol, {
    cutoffTime,
    signal,
    priority: "interactive",
  });
  return history.map((item) => ({ time: item.timestamp, rate: item.fundingRate }));
}

export async function fetchBybitSearchFundingHistory(
  rawSymbol: string,
  cutoffTime: number,
  options: { signal?: AbortSignal; windowMs?: number; maxPages?: number; requireCutoffCoverage?: boolean } = {},
  fetchFundingHistory: typeof fetchBybitFundingHistory = fetchBybitFundingHistory,
): Promise<{ time: number; rate: number }[]> {
  const history = await fetchFundingHistory(rawSymbol, {
    cutoffTime,
    signal: options.signal,
    ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    requireCutoffCoverage: options.requireCutoffCoverage,
  } as Parameters<typeof fetchBybitFundingHistory>[1] & { requireCutoffCoverage?: boolean });
  return history.map((item) => ({ time: item.timestamp, rate: item.fundingRate }));
}

export interface BitgetSearchChartDependencies {
  fetchCandles: (rawSymbol: string, interval: SearchChartInterval, signal?: AbortSignal, window?: CandleFetchOptions["window"]) => Promise<SearchCandlePoint[]>;
  fetchFundingHistory: typeof fetchBitgetSearchFundingHistory;
}

const BITGET_SEARCH_CHART_DEPENDENCIES: BitgetSearchChartDependencies = {
  fetchCandles: (rawSymbol, interval, signal, window) => fetchBitgetSearchCandles(
    rawSymbol,
    interval,
    signal,
    fetchBitgetCandles,
    window,
  ),
  fetchFundingHistory: fetchBitgetSearchFundingHistory,
};

/** Candle-first Bitget chart flow; funding is bounded to the returned candle range. */
export async function fetchBitgetSearchChart(
  rate: SearchExchangeRate,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  dependencies: BitgetSearchChartDependencies = BITGET_SEARCH_CHART_DEPENDENCIES,
  window?: CandleFetchOptions["window"],
): Promise<Pick<SearchCandleResult, "candles" | "fundingRates">> {
  const rawSymbol = requireBitgetRawSymbol(rate);
  const candles = await dependencies.fetchCandles(rawSymbol, interval, signal, window);
  throwIfAborted(signal);
  if (candles.length === 0) return { candles: [], fundingRates: [] };

  const cutoffTime = Math.min(...candles.map((candle) => candle.openTime));
  const fundingHistory = await dependencies.fetchFundingHistory(rawSymbol, cutoffTime, signal);
  return {
    candles,
    fundingRates: aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval),
  };
}

export interface BybitSearchChartDependencies {
  fetchCandles: typeof fetchBybitSearchCandles;
  fetchFundingHistory: typeof fetchBybitSearchFundingHistory;
  /**
   * Interval-aware funding-history window resolver. Defaults to the adapter
   * contract helper (resolveBybitFundingHistoryWindowMs); tests inject a
   * deterministic resolver to assert window/maxPages propagation.
   */
  resolveFundingWindowMs?: (fundingIntervalSeconds: number, pageSize?: number) => number;
}

const BYBIT_SEARCH_CHART_DEPENDENCIES: BybitSearchChartDependencies = {
  fetchCandles: fetchBybitSearchCandles,
  fetchFundingHistory: fetchBybitSearchFundingHistory,
};

/** @deprecated Retained for consumers that imported the former overlay cap. */
export const BYBIT_SEARCH_FUNDING_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
/** One full V5 funding-history page (200 rows), matching the adapter default. */
export const BYBIT_SEARCH_FUNDING_PAGE_SIZE = 200;
/** Strict adapter request budget; coverage is proven by the timestamp cutoff. */
export const BYBIT_SEARCH_FUNDING_MAX_PAGES = 100;

/**
 * Candle-first Bybit chart flow. The funding request covers the complete
 * returned candle range. `windowMs` remains interval-aware because it is the
 * duration of one API page, but maxPages is a strict adapter budget independent
 * of the current funding interval. Cutoff coverage is required before the
 * adapter result can be used as a complete overlay.
 */
export async function fetchBybitSearchChart(
  rate: SearchExchangeRate,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  dependencies: BybitSearchChartDependencies = BYBIT_SEARCH_CHART_DEPENDENCIES,
): Promise<Pick<SearchCandleResult, "candles" | "fundingRates">> {
  const rawSymbol = requireBybitRawSymbol(rate);
  const candles = await dependencies.fetchCandles(rawSymbol, interval, signal);
  throwIfAborted(signal);
  if (candles.length === 0) return { candles: [], fundingRates: [] };

  const oldestCandleTime = Math.min(...candles.map((candle) => candle.openTime));
  const cutoffTime = oldestCandleTime;

  const resolveWindowMs = dependencies.resolveFundingWindowMs ?? resolveBybitFundingHistoryWindowMs;
  const windowMs = resolveWindowMs(rate.fundingInterval, BYBIT_SEARCH_FUNDING_PAGE_SIZE);
  const maxPages = BYBIT_SEARCH_FUNDING_MAX_PAGES;

  // Soft coverage: the walk paginates until the cutoff is reached or the API
  // stops returning older rows, then returns every settlement collected. A
  // chart overlay does not need the funding history to reach the oldest
  // candle; it simply starts where the retained funding history starts.
  const fundingHistory = await dependencies.fetchFundingHistory(rawSymbol, cutoffTime, {
    signal,
    windowMs,
    maxPages,
  });
  return {
    candles,
    fundingRates: aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval),
  };
}

// ==================== Unified Fetch Dispatcher ====================

export async function fetchSearchCandles(
  rate: SearchExchangeRate,
  interval: SearchChartInterval,
  signal?: AbortSignal,
  options: CandleFetchOptions = {},
): Promise<SearchCandleResult> {
  const purpose = options.purpose ?? "single";
  const source = rate.exchange === "Hyperliquid" || rate.exchange === "Lighter"
    ? resolvePerpCandleSource(rate.exchange, interval, purpose)
    : { sourceInterval: interval, aggregateWeekly: false };
  const empty: SearchCandleResult = {
    candles: [],
    fundingRates: [],
    interval,
    exchange: rate.exchange,
    symbol: rate.symbol,
    provenance: createCandleSourceProvenance(rate.exchange, interval, source.sourceInterval, source.aggregateWeekly),
  };

  switch (rate.exchange) {
    case "Hyperliquid": {
      const hlSymbol = rate.rawSymbol ?? rate.symbol;
      const candles = await fetchHyperliquidCandles(hlSymbol, interval, signal, purpose);
      const oldestCandleTime = candles.length > 0 ? Math.min(...candles.map((candle) => candle.openTime)) : 0;
      const latestCandleClose = candles.length > 0 ? Math.max(...candles.map((candle) => candle.closeTime)) : 0;
      const fundingEndTime = Math.min(Date.now(), latestCandleClose);
      const fundingHistory = candles.length > 0
        ? await fetchHyperliquidFundingHistory(hlSymbol, oldestCandleTime, fundingEndTime, signal)
        : [];
      const fundingRates = aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval);
      return { ...empty, candles, fundingRates };
    }
    case "Gate.io": {
      const candles = await fetchGateCandles(rate.symbol, interval, signal);
      const cutoffTime = candles.length > 0 ? Math.min(...candles.map((candle) => candle.openTime)) : 0;
      const fundingHistory = candles.length > 0
        ? await fetchGateFundingHistory(rate.symbol, cutoffTime, signal)
        : [];
      const fundingRates = aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval);
      return { ...empty, candles, fundingRates };
    }
    case "Binance": {
      const rawSymbol = rate.rawSymbol || `${rate.symbol}USDT`;
      const candles = await fetchBinanceCandles(rawSymbol, interval, signal);
      const cutoffTime = candles.length > 0 ? Math.min(...candles.map((candle) => candle.openTime)) : 0;
      const fundingHistory = candles.length > 0
        ? await fetchBinanceFundingHistory(rawSymbol, cutoffTime, signal)
        : [];
      const fundingRates = aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval);
      return { ...empty, candles, fundingRates };
    }
    case "OKX": {
      const rawSymbol = rate.rawSymbol || `${rate.symbol}-USDT-SWAP`;
      const candles = await fetchOkxCandles(rawSymbol, interval, signal);
      const cutoffTime = candles.length > 0 ? Math.min(...candles.map((candle) => candle.openTime)) : 0;
      const fundingHistory = candles.length > 0
        ? await fetchOkxFundingHistory(rawSymbol, rate.fundingInterval, cutoffTime, signal)
        : [];
      const fundingRates = aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval);
      return { ...empty, candles, fundingRates };
    }
    case "Lighter": {
      const candles = await fetchLighterCandles(rate.marketId, rate.symbol, interval, signal, purpose);
      const cutoffTime = candles.length > 0 ? Math.min(...candles.map((candle) => candle.openTime)) : 0;
      const fundingHistory = candles.length > 0
        ? await fetchLighterFundingHistory(rate.marketId, rate.symbol, cutoffTime, signal)
        : [];
      const fundingRates = aggregateFundingRatesToCandles(fundingHistory, candles, rate.fundingInterval);
      return { ...empty, candles, fundingRates };
    }
    case "Bitget": {
      const result = await fetchBitgetSearchChart(rate, interval, signal, BITGET_SEARCH_CHART_DEPENDENCIES, options.window);
      return { ...empty, ...result };
    }
    case "Bybit": {
      const result = await fetchBybitSearchChart(rate, interval, signal);
      return { ...empty, ...result };
    }
    default:
      return empty;
  }
}
