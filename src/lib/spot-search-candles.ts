import type { SpotExchangeName, SpotMarketRow } from "./spot-search";
import { spotFetch } from "./spot-fetch";
import { createBitgetRTokenProvenance, createCandleSourceProvenance, type CandleSourceProvenance } from "./candle-provenance";

export type SpotChartInterval = "1w" | "1d" | "4h" | "1h" | "5m" | "1m";
export type SpotCandlePurpose = "single" | "combo";
export interface SpotCandleFetchOptions { purpose?: SpotCandlePurpose }

export interface SpotCandlePoint {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume?: string;
}

export interface SpotCandleResult {
  candles: SpotCandlePoint[];
  interval: SpotChartInterval;
  exchange: SpotExchangeName;
  symbol: string;
  provenance?: CandleSourceProvenance;
}

const INTERVAL_MS: Record<SpotChartInterval, number> = {
  "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000,
  "1h": 3_600_000, "5m": 300_000, "1m": 60_000,
};

const MAX_CANDLES: Record<SpotExchangeName, number> = {
  Binance: 1000, OKX: 300, "Gate.io": 1000, Bitget: 1000, Hyperliquid: 5000, Lighter: 500, Bybit: 1000,
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? (parsed < 10_000_000_000 ? parsed * 1000 : parsed) : 0;
}

function candle(openTime: unknown, values: unknown[], interval: SpotChartInterval): SpotCandlePoint | null {
  const time = timestamp(openTime);
  const [open, high, low, close, volume, quoteVolume] = values.map((value) => String(value ?? "0"));
  if (!time || ![open, high, low, close, volume].every((value) => Number.isFinite(Number(value)))) return null;
  return {
    openTime: time, closeTime: time + INTERVAL_MS[interval], open, high, low, close, volume,
    ...(quoteVolume !== undefined && Number.isFinite(Number(quoteVolume)) ? { quoteVolume } : {}),
  };
}

export function normalizeSpotCandles(
  exchange: SpotExchangeName,
  payload: unknown,
  interval: SpotChartInterval,
): SpotCandlePoint[] {
  const root = object(payload);
  let rows: unknown[] = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : [];
  if (exchange === "Lighter") {
    rows = Array.isArray(root?.candles) ? root.candles : Array.isArray(root?.c) ? root.c : rows;
  }
  if (exchange === "Bybit") {
    // V5 envelope: { retCode, result: { list: [[start,open,high,low,close,volume,turnover], ...] } }
    const result = object(root?.result);
    rows = Array.isArray(result?.list) ? result.list : rows;
  }
  const result: SpotCandlePoint[] = [];
  for (const value of rows) {
    let normalized: SpotCandlePoint | null = null;
    if (Array.isArray(value)) {
      if (exchange === "Gate.io") {
        // [timestamp, quote volume, close, high, low, open, base volume]
        normalized = candle(value[0], [value[5], value[3], value[4], value[2], value[6], value[1]], interval);
      } else if (exchange === "Bitget") {
        // [timestamp, open, high, low, close, base volume, quote volume, USDT volume]
        normalized = candle(value[0], [value[1], value[2], value[3], value[4], value[5], value[6]], interval);
      } else if (exchange === "Bybit") {
        // [start, open, high, low, close, volume, turnover] — turnover is quote currency
        normalized = candle(value[0], [value[1], value[2], value[3], value[4], value[5], value[6]], interval);
      } else {
        normalized = candle(value[0], [value[1], value[2], value[3], value[4], value[5], value[7] ?? value[6]], interval);
      }
    } else {
      const row = object(value);
      if (row) normalized = candle(row.t ?? row.timestamp ?? row.time, [
        row.o ?? row.open, row.h ?? row.high, row.l ?? row.low, row.c ?? row.close,
        row.v ?? row.volume ?? row.base_volume, row.q ?? row.quoteVolume ?? row.quote_volume,
      ], interval);
    }
    if (normalized) result.push(normalized);
  }
  const byTime = new Map<number, SpotCandlePoint>();
  for (const point of result) byTime.set(point.openTime, point);
  return [...byTime.values()].sort((a, b) => a.openTime - b.openTime);
}

function monday(timestampMs: number): number {
  const date = new Date(timestampMs);
  const days = date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - days);
}

function utcDayStart(timestampMs: number): number {
  return Math.floor(timestampMs / INTERVAL_MS["1d"]) * INTERVAL_MS["1d"];
}

/**
 * Generic OHLC aggregation. Groups points by a bucket key (e.g. UTC Monday for
 * weeks, UTC midnight for days) and reduces each bucket into one candle: first
 * open, last close, extreme high/low, summed volume and quote volume.
 */
export function aggregateSpotCandles(
  points: readonly SpotCandlePoint[],
  bucketKey: (openTime: number) => number,
  bucketMs: number,
): SpotCandlePoint[] {
  const groups = new Map<number, SpotCandlePoint[]>();
  for (const point of points) {
    const key = bucketKey(point.openTime);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([openTime, values]) => {
    values.sort((a, b) => a.openTime - b.openTime);
    const quoteValues = values.map((value) => value.quoteVolume).filter((value): value is string => value !== undefined);
    return {
      openTime, closeTime: openTime + bucketMs, open: values[0].open,
      high: String(Math.max(...values.map((value) => Number(value.high)))),
      low: String(Math.min(...values.map((value) => Number(value.low)))),
      close: values[values.length - 1].close,
      volume: String(values.reduce((sum, value) => sum + Number(value.volume), 0)),
      ...(quoteValues.length === values.length ? { quoteVolume: String(quoteValues.reduce((sum, value) => sum + Number(value), 0)) } : {}),
    };
  });
}

export function aggregateSpotDailyToWeekly(points: readonly SpotCandlePoint[]): SpotCandlePoint[] {
  return aggregateSpotCandles(points, monday, INTERVAL_MS["1w"]);
}

/**
 * Aggregates UTC-aligned 4h candles into UTC daily candles. Bitget rTokens only
 * expose non-UTC `1day`/`1week` (UTC+8 aligned) but their `4h` candles are UTC
 * aligned, so daily/weekly candles must be rebuilt from 4h buckets to line up
 * with other exchanges' UTC boundaries.
 */
export function aggregateSpot4hToDaily(points: readonly SpotCandlePoint[]): SpotCandlePoint[] {
  return aggregateSpotCandles(points, utcDayStart, INTERVAL_MS["1d"]);
}

export function aggregateSpot4hToWeekly(points: readonly SpotCandlePoint[]): SpotCandlePoint[] {
  return aggregateSpotCandles(points, monday, INTERVAL_MS["1w"]);
}

/** Aggregated candles are ascending (oldest first); keep the most recent `limit`. */
export function takeMostRecentCandles<T>(points: readonly T[], limit: number): T[] {
  return points.slice(-limit);
}

export function resolveSpotCandleSource(
  exchange: SpotExchangeName,
  interval: SpotChartInterval,
  purpose: SpotCandlePurpose = "single",
): { sourceInterval: SpotChartInterval; aggregateWeekly: boolean } {
  if (interval === "1w" && exchange === "Lighter") {
    return { sourceInterval: "1d", aggregateWeekly: true };
  }
  if (interval === "1w" && exchange === "Hyperliquid" && purpose === "combo") {
    return { sourceInterval: "1d", aggregateWeekly: true };
  }
  return { sourceInterval: interval, aggregateWeekly: false };
}

// ==================== Bitget rToken 4h 聚合 ====================
// Bitget 现货里的 rToken（代币化美股，如 RTSLAUSDT）只支持非 UTC 粒度
// （1day/1week 为 UTC+8 对齐），且拒绝 1Dutc/1Wutc（返回 400 code 48001）。
// 但其 4h 粒度是 UTC 对齐的，因此日线/周线必须从 4h 分桶重建，
// 才能与其他交易所的 UTC 边界对齐。

const BITGET_4H_PAGE_SIZE = 1000;
const BITGET_4H_MAX_PAGES = 8;
const FOUR_HOURS_PER_DAY = 6;
const FOUR_HOURS_PER_WEEK = 42;

/** 缓存已知的 rToken symbol，避免每次切换都先踩一次 400。 */
const bitgetRTokenCache = new Set<string>();

async function fetchBitget4hPaginated(
  row: SpotMarketRow,
  needed4h: number,
  signal?: AbortSignal,
): Promise<SpotCandlePoint[]> {
  const collected = new Map<number, SpotCandlePoint>();
  const maxPages = Math.min(BITGET_4H_MAX_PAGES, Math.ceil(needed4h / BITGET_4H_PAGE_SIZE));
  let endTime: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ action: "candles", interval: "4h", limit: String(BITGET_4H_PAGE_SIZE) });
    params.set("symbol", row.rawSymbol);
    if (endTime !== undefined) params.set("endTime", String(endTime));
    const response = await spotFetch(row.exchange, params, { signal });
    if (!response.ok) throw new Error(`Bitget spot 4h candles failed (${response.status})`);
    const batch = normalizeSpotCandles(row.exchange, await response.json(), "4h");
    if (batch.length === 0) break;
    for (const candle of batch) collected.set(candle.openTime, candle);
    if (batch.length < BITGET_4H_PAGE_SIZE) break; // 历史已到尽头
    endTime = batch[0].openTime; // 升序，最老一根作为下一页的 endTime
    if (collected.size >= needed4h) break;
  }
  return [...collected.values()].sort((a, b) => a.openTime - b.openTime);
}

async function fetchBitgetSpotCandles(
  row: SpotMarketRow,
  interval: "1d" | "1w",
  limit: number,
  signal?: AbortSignal,
): Promise<SpotCandleResult> {
  // 1. 先探测官方 UTC 粒度（普通币可用，rToken 会 400）
  if (!bitgetRTokenCache.has(row.rawSymbol)) {
    const officialParams = new URLSearchParams({ action: "candles", interval, limit: String(limit) });
    officialParams.set("symbol", row.rawSymbol);
    const official = await spotFetch(row.exchange, officialParams, { signal });
    if (official.ok) {
      const candles = normalizeSpotCandles(row.exchange, await official.json(), interval);
      return {
        candles, interval, exchange: row.exchange, symbol: row.pair,
        provenance: createCandleSourceProvenance(row.exchange, interval, interval, false),
      };
    }
    bitgetRTokenCache.add(row.rawSymbol);
  }

  // 2. rToken 降级：从 UTC 对齐的 4h 分桶重建日/周线
  const needed4h = limit * (interval === "1d" ? FOUR_HOURS_PER_DAY : FOUR_HOURS_PER_WEEK);
  const fourHour = await fetchBitget4hPaginated(row, needed4h, signal);
  const candles = interval === "1d" ? aggregateSpot4hToDaily(fourHour) : aggregateSpot4hToWeekly(fourHour);
  return {
    // 聚合结果是升序（最早在前），需取最近 limit 根，否则拿到的是最旧数据
    candles: takeMostRecentCandles(candles, limit),
    interval,
    exchange: row.exchange,
    symbol: row.pair,
    provenance: createBitgetRTokenProvenance(interval, "4h"),
  };
}

export async function fetchSpotCandlesWithLimit(
  row: SpotMarketRow,
  interval: SpotChartInterval,
  requestedLimit: number,
  signal?: AbortSignal,
  options: SpotCandleFetchOptions = {},
): Promise<SpotCandleResult> {
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), MAX_CANDLES[row.exchange]));

  // Bitget 现货的日线/周线需要 rToken 探测降级。
  if (row.exchange === "Bitget" && (interval === "1d" || interval === "1w")) {
    return fetchBitgetSpotCandles(row, interval, limit, signal);
  }

  const { sourceInterval: effectiveInterval, aggregateWeekly } = resolveSpotCandleSource(row.exchange, interval, options.purpose ?? "single");
  const params = new URLSearchParams({ action: "candles", interval: effectiveInterval, limit: String(limit) });
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  const response = await spotFetch(row.exchange, params, { signal });
  if (!response.ok) throw new Error(`${row.exchange} spot candles failed (${response.status})`);
  let candles = normalizeSpotCandles(row.exchange, await response.json(), effectiveInterval);
  if (aggregateWeekly) candles = aggregateSpotDailyToWeekly(candles);
  return {
    candles, interval, exchange: row.exchange, symbol: row.pair,
    provenance: createCandleSourceProvenance(row.exchange, interval, effectiveInterval, aggregateWeekly),
  };
}

export function fetchSpotCandles(
  row: SpotMarketRow,
  interval: SpotChartInterval,
  signal?: AbortSignal,
  options: SpotCandleFetchOptions = {},
): Promise<SpotCandleResult> {
  return fetchSpotCandlesWithLimit(row, interval, MAX_CANDLES[row.exchange], signal, options);
}
