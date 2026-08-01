import type { SpotExchangeName, SpotMarketRow } from "./spot-search";

export type SpotChartInterval = "1w" | "1d" | "4h" | "1h" | "5m" | "1m";

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
}

const INTERVAL_MS: Record<SpotChartInterval, number> = {
  "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000,
  "1h": 3_600_000, "5m": 300_000, "1m": 60_000,
};

const MAX_CANDLES: Record<SpotExchangeName, number> = {
  Binance: 1000, OKX: 300, "Gate.io": 1000, Bitget: 1000, Hyperliquid: 5000, Lighter: 500,
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

export function aggregateSpotDailyToWeekly(points: readonly SpotCandlePoint[]): SpotCandlePoint[] {
  const groups = new Map<number, SpotCandlePoint[]>();
  for (const point of points) {
    const key = monday(point.openTime);
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([openTime, values]) => {
    values.sort((a, b) => a.openTime - b.openTime);
    const quoteValues = values.map((value) => value.quoteVolume).filter((value): value is string => value !== undefined);
    return {
      openTime, closeTime: openTime + INTERVAL_MS["1w"], open: values[0].open,
      high: String(Math.max(...values.map((value) => Number(value.high)))),
      low: String(Math.min(...values.map((value) => Number(value.low)))),
      close: values[values.length - 1].close,
      volume: String(values.reduce((sum, value) => sum + Number(value.volume), 0)),
      ...(quoteValues.length === values.length ? { quoteVolume: String(quoteValues.reduce((sum, value) => sum + Number(value), 0)) } : {}),
    };
  });
}

const SLUGS: Record<SpotExchangeName, string> = {
  Hyperliquid: "hyperliquid", "Gate.io": "gateio", Binance: "binance",
  Lighter: "lighter", OKX: "okx", Bitget: "bitget",
};

export async function fetchSpotCandlesWithLimit(
  row: SpotMarketRow,
  interval: SpotChartInterval,
  requestedLimit: number,
  signal?: AbortSignal,
): Promise<SpotCandleResult> {
  const effectiveInterval = row.exchange === "Lighter" && interval === "1w" ? "1d" : interval;
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), MAX_CANDLES[row.exchange]));
  const params = new URLSearchParams({ action: "candles", interval: effectiveInterval, limit: String(limit) });
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  const response = await fetch(`/api/spot/${SLUGS[row.exchange]}?${params}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${row.exchange} spot candles failed (${response.status})`);
  let candles = normalizeSpotCandles(row.exchange, await response.json(), effectiveInterval);
  if (row.exchange === "Lighter" && interval === "1w") candles = aggregateSpotDailyToWeekly(candles);
  return { candles, interval, exchange: row.exchange, symbol: row.pair };
}

export function fetchSpotCandles(
  row: SpotMarketRow,
  interval: SpotChartInterval,
  signal?: AbortSignal,
): Promise<SpotCandleResult> {
  return fetchSpotCandlesWithLimit(row, interval, MAX_CANDLES[row.exchange], signal);
}
