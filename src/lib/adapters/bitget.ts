import type { AssetCategory, CanonicalCandlePoint, CanonicalFundingDetail, CanonicalFundingHistoryPoint, CanonicalFundingRateRow } from "@/lib/types";
import { getAbortReason, isAbortLikeError } from "@/lib/utils/abort";

export type BitgetCandleInterval = "1m" | "5m" | "1h" | "4h" | "1d" | "1w";
export type BitgetAction = "instruments" | "tickers" | "current-fund-rate" | "history-fund-rate" | "candles" | "history-candles" | "orderbook";

export interface BitgetInstrument {
  symbol?: string;
  baseCoin?: string;
  type?: string;
  status?: string;
  category?: string;
  assetType?: string;
  symbolType?: string;
  fundInterval?: string | number;
  fundingInterval?: string | number;
}

export interface BitgetTicker {
  symbol?: string;
  lastPr?: string;
  lastPrice?: string;
  markPrice?: string;
  indexPrice?: string;
  bid1Pr?: string;
  ask1Pr?: string;
  bid1Price?: string;
  ask1Price?: string;
  open24h?: string;
  openPrice24h?: string;
  price24hPcnt?: string;
  turnover24h?: string;
  openInterest?: string;
}

export interface BitgetCurrentFunding {
  symbol?: string;
  fundingRate?: string;
  fundingRateInterval?: string | number;
}

export interface BitgetFundingHistoryEntry {
  symbol?: string;
  fundingRate?: string;
  fundingRateTimestamp?: string | number;
  fundingTime?: string | number;
}

export type BitgetCandleTuple = [string | number, string, string, string, string, string, string?];
export interface NormalizedBitgetBookLevel { price: number; baseQty: number }
export interface NormalizedBitgetOrderBook { asks: NormalizedBitgetBookLevel[]; bids: NormalizedBitgetBookLevel[] }

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
type SchedulerOptions = {
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
};

const abortError = () => new DOMException("The operation was aborted.", "AbortError");
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

const defaultSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  throwIfAborted(signal);
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener("abort", aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(abortError()); }
  signal?.addEventListener("abort", aborted, { once: true });
});

function waitForTurn(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return turn;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(abortError()); };
    signal.addEventListener("abort", aborted, { once: true });
    turn.then(() => { signal.removeEventListener("abort", aborted); resolve(); }, reject);
  });
}

class BitgetHttpError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number | null,
    public apiCode?: string,
    public apiMessage?: string,
  ) {
    const diagnostic = apiCode ? `; API code ${apiCode}${apiMessage ? `: ${apiMessage}` : ""}` : "";
    super(`Bitget request failed (${status}${diagnostic})`);
  }
  get transient() { return this.status === 429 || this.status >= 500; }
}
class BitgetTimeoutError extends Error { constructor() { super("Bitget client request timed out"); this.name = "TimeoutError"; } }

function statusForBitgetCode(code: string): number {
  if (code === "25004") return 429;
  if (code === "25100") return 404;
  if (["25000", "25001", "25003", "25101", "25102", "25104", "25108", "40725"].includes(code)) return 503;
  if (["25200", "40017", "40034"].includes(code)) return 400;
  return 502;
}

function unwrapBitgetEnvelope(payload: unknown, retryAfter: number | null): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("code" in payload)) {
    throw new TypeError("Malformed Bitget response envelope");
  }
  const envelope = payload as { code?: unknown; data?: unknown; msg?: unknown; message?: unknown };
  if (envelope.code === "00000") {
    if (!("data" in envelope)) throw new TypeError("Malformed Bitget success envelope");
    return envelope.data;
  }
  const code = String(envelope.code);
  const rawMessage = envelope.msg ?? envelope.message;
  const message = typeof rawMessage === "string" ? rawMessage : undefined;
  throw new BitgetHttpError(statusForBitgetCode(code), retryAfter, code, message);
}

function bitgetEnvelopeDiagnostics(payload: unknown): { apiCode?: string; apiMessage?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("code" in payload)) return {};
  const envelope = payload as { code?: unknown; msg?: unknown; message?: unknown };
  const rawMessage = envelope.msg ?? envelope.message;
  return {
    ...(envelope.code === undefined ? {} : { apiCode: String(envelope.code) }),
    ...(typeof rawMessage === "string" ? { apiMessage: rawMessage } : {}),
  };
}

function retryAfterMs(response: Response, now: number): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(60_000, parsed)) : null;
}

/** A FIFO, single-concurrency scheduler shared by every Bitget adapter request. */
export function createBitgetScheduler(options: SchedulerOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  let tail = Promise.resolve();
  let nextStart = 0;

  async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    let release!: () => void;
    const ownGate = new Promise<void>((resolve) => { release = resolve; });
    const turn = tail;
    tail = turn.catch(() => undefined).then(() => ownGate);
    try {
      await waitForTurn(turn, init.signal ?? undefined);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        throwIfAborted(init.signal ?? undefined);
        const scheduleDelay = Math.max(0, nextStart - now()) + Math.floor(random() * 76);
        if (scheduleDelay > 0) await sleep(scheduleDelay, init.signal ?? undefined);
        nextStart = now() + 250;

        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const callerSignal = init.signal ?? undefined;
        const callerAbort = () => controller.abort();
        callerSignal?.addEventListener("abort", callerAbort, { once: true });
        try {
          const response = await fetchImpl(url, { ...init, cache: "no-store", signal: controller.signal });
          const retryAfter = response.status === 429 ? retryAfterMs(response, now()) : null;
          const payload: unknown = await response.json().catch(() => undefined);
          if (!response.ok) {
            const diagnostics = bitgetEnvelopeDiagnostics(payload);
            throw new BitgetHttpError(response.status, retryAfter, diagnostics.apiCode, diagnostics.apiMessage);
          }
          return unwrapBitgetEnvelope(payload, retryAfter);
        } catch (error) {
          if (callerSignal?.aborted) throw abortError();
          const failure = timedOut ? new BitgetTimeoutError() : error;
          const retryable = failure instanceof BitgetTimeoutError || (failure instanceof BitgetHttpError && failure.transient);
          if (!retryable || attempt === 3) throw failure;
          const exponential = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
          const honored = failure instanceof BitgetHttpError ? failure.retryAfterMs : null;
          await sleep(Math.max(exponential, honored ?? 0) + Math.floor(random() * 251), callerSignal);
        } finally {
          clearTimeout(timer);
          callerSignal?.removeEventListener("abort", callerAbort);
        }
      }
      throw new Error("Unreachable Bitget retry state");
    } finally {
      release();
    }
  }

  return { fetchJson };
}

export const bitgetScheduler = createBitgetScheduler();

export function parseBitgetList<T extends object>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload.filter((item): item is T => item !== null && typeof item === "object");
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if ("code" in payload) throw new TypeError("Unexpected or malformed Bitget envelope");
    const resultList = (payload as { resultList?: unknown }).resultList;
    if (Array.isArray(resultList)) return resultList.filter((item): item is T => item !== null && typeof item === "object");
  }
  throw new TypeError("Malformed Bitget successful payload");
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function numberOrZero(value: unknown) { return numberOrNull(value) ?? 0; }
function symbolMap<T extends { symbol?: string }>(rows: T[]) {
  return new Map(rows.filter((row): row is T & { symbol: string } => typeof row.symbol === "string" && row.symbol.length > 0).map((row) => [row.symbol, row]));
}

export function parseBitgetFundingIntervalSeconds(value: unknown): number | null {
  const hours = numberOrNull(value);
  return hours !== null && [1, 2, 4, 8].includes(hours) ? hours * 3600 : null;
}

export function mapBitgetAssetCategory(value: unknown): AssetCategory {
  const category = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (category === "crypto") return "Crypto";
  if (category === "stock" || category === "index") return "股票/指数";
  if (category === "metal" || category === "commodity") return "商品";
  return "其他";
}

/** Pure universe-master intersection and normalization. */
export function normalizeBitgetFundingRows(
  instrumentsPayload: unknown,
  tickersPayload: unknown,
  fundingPayload: unknown,
): CanonicalFundingRateRow[] {
  const instruments = parseBitgetList<BitgetInstrument>(instrumentsPayload);
  const tickers = symbolMap(parseBitgetList<BitgetTicker>(tickersPayload));
  const fundings = symbolMap(parseBitgetList<BitgetCurrentFunding>(fundingPayload));
  const result: CanonicalFundingRateRow[] = [];

  for (const instrument of instruments) {
    if (instrument.type !== "perpetual" || instrument.status !== "online" || !instrument.symbol || !instrument.baseCoin) continue;
    const ticker = tickers.get(instrument.symbol);
    const funding = fundings.get(instrument.symbol);
    if (!ticker || !funding) continue;
    const markPrice = numberOrZero(ticker.markPrice);
    const lastPrice = numberOrNull(ticker.lastPr ?? ticker.lastPrice) ?? markPrice;
    const open = numberOrNull(ticker.open24h ?? ticker.openPrice24h);
    const officialChange = numberOrNull(ticker.price24hPcnt);
    const openInterest = numberOrZero(ticker.openInterest);
    result.push({
      exchange: "bitget",
      transportMode: "native",
      symbol: instrument.baseCoin,
      rawSymbol: instrument.symbol,
      marketKey: instrument.symbol,
      fundingRate: numberOrZero(funding.fundingRate),
      predictedFundingRate: null,
      lastSettlementRate: null,
      markPrice,
      indexPrice: numberOrNull(ticker.indexPrice),
      lastPrice,
      change24h: officialChange !== null ? officialChange * 100 : open && open !== 0 ? ((lastPrice - open) / open) * 100 : 0,
      quoteVolume: numberOrZero(ticker.turnover24h),
      openInterest,
      notionalValue: openInterest * markPrice,
      fundingIntervalSeconds: parseBitgetFundingIntervalSeconds(funding.fundingRateInterval)
        ?? parseBitgetFundingIntervalSeconds(instrument.fundInterval ?? instrument.fundingInterval)
        ?? 8 * 3600,
      assetCategory: mapBitgetAssetCategory(instrument.assetType ?? instrument.symbolType ?? instrument.category),
      bestBid: numberOrNull(ticker.bid1Pr ?? ticker.bid1Price),
      bestAsk: numberOrNull(ticker.ask1Pr ?? ticker.ask1Price),
    });
  }
  return result;
}

export type BitgetRequest = (action: BitgetAction, params: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;

const BITGET_API_ORIGIN = "https://api.bitget.com";
const BITGET_ACTION_PATHS: Record<BitgetAction, string> = {
  instruments: "/api/v3/market/instruments",
  tickers: "/api/v3/market/tickers",
  "current-fund-rate": "/api/v3/market/current-fund-rate",
  "history-fund-rate": "/api/v3/market/history-fund-rate",
  candles: "/api/v3/market/candles",
  "history-candles": "/api/v3/market/history-candles",
  orderbook: "/api/v3/market/orderbook",
};
const BITGET_ACTION_DEFAULTS: Partial<Record<BitgetAction, Record<string, string>>> = {
  "history-fund-rate": { cursor: "1", limit: "100" },
  candles: { type: "market", limit: "100" },
  "history-candles": { type: "market", limit: "100" },
  orderbook: { limit: "100" },
};

export function buildBitgetUrl(action: BitgetAction, params: Record<string, string> = {}): string {
  const url = new URL(BITGET_ACTION_PATHS[action], BITGET_API_ORIGIN);
  const merged = { ...BITGET_ACTION_DEFAULTS[action], ...params, category: "USDT-FUTURES" };
  for (const [key, value] of Object.entries(merged)) url.searchParams.set(key, value);
  return url.toString();
}

export const requestBitget: BitgetRequest = (action, params, signal) => {
  return bitgetScheduler.fetchJson(buildBitgetUrl(action, params), { signal });
};

export async function fetchBitgetCanonicalRates(signal?: AbortSignal, request: BitgetRequest = requestBitget) {
  const [instruments, tickers, funding] = await Promise.all([
    request("instruments", {}, signal),
    request("tickers", {}, signal),
    request("current-fund-rate", {}, signal),
  ]);
  return normalizeBitgetFundingRows(instruments, tickers, funding);
}

export function normalizeBitgetFundingHistory(payload: unknown): CanonicalFundingHistoryPoint[] {
  const deduped = new Map<number, number>();
  for (const row of parseBitgetList<BitgetFundingHistoryEntry>(payload)) {
    // fundingRateTimestamp is the V3 field. fundingTime is retained for the
    // legacy array payload consumed by the original adapter implementation.
    const timestamp = numberOrNull(row.fundingRateTimestamp ?? row.fundingTime);
    const rate = numberOrNull(row.fundingRate);
    if (timestamp !== null && timestamp > 0 && rate !== null && !deduped.has(timestamp)) deduped.set(timestamp, rate);
  }
  return Array.from(deduped, ([timestamp, fundingRate]) => ({ timestamp, fundingRate })).sort((a, b) => a.timestamp - b.timestamp);
}

export function latestBitgetFundingPoint(history: CanonicalFundingHistoryPoint[]) {
  return history.reduce<CanonicalFundingHistoryPoint | null>((latest, point) => !latest || point.timestamp > latest.timestamp ? point : latest, null);
}

export async function fetchBitgetFundingHistory(
  rawSymbol: string,
  options: { cutoffTime?: number; signal?: AbortSignal; pageSize?: number; maxPages?: number; request?: BitgetRequest } = {},
): Promise<CanonicalFundingHistoryPoint[]> {
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 100));
  const maxPages = Math.max(1, Math.min(100, Math.trunc(options.maxPages ?? 100)));
  const request = options.request ?? requestBitget;
  const collected = new Map<number, number>();
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let cursor = 1; cursor <= maxPages; cursor += 1) {
    throwIfAborted(options.signal);
    const payload = await request("history-fund-rate", { symbol: rawSymbol, cursor: String(cursor), limit: String(pageSize) }, options.signal);
    const rawRows = parseBitgetList<BitgetFundingHistoryEntry>(payload);
    const rows = normalizeBitgetFundingHistory(payload);
    for (const row of rows) if (options.cutoffTime === undefined || row.timestamp >= options.cutoffTime) collected.set(row.timestamp, row.fundingRate);
    const oldest = rows.length ? rows[0].timestamp : Number.POSITIVE_INFINITY;
    if (!rawRows.length || rawRows.length < pageSize || oldest >= previousOldest) break;
    if (options.cutoffTime !== undefined && oldest <= options.cutoffTime) break;
    previousOldest = oldest;
  }
  return Array.from(collected, ([timestamp, fundingRate]) => ({ timestamp, fundingRate })).sort((a, b) => a.timestamp - b.timestamp);
}

/** Fetches the latest settlement with one and only one history request. */
export async function fetchLatestBitgetSettlement(
  rawSymbol: string,
  options: { signal?: AbortSignal; request?: BitgetRequest } = {},
): Promise<CanonicalFundingHistoryPoint | null> {
  const history = await fetchBitgetFundingHistory(rawSymbol, {
    signal: options.signal,
    request: options.request,
    pageSize: 1,
    maxPages: 1,
  });
  return latestBitgetFundingPoint(history);
}

const INTERVAL_CONFIG: Record<BitgetCandleInterval, { api: string; ms: number; cap: number; pages: number }> = {
  "1m": { api: "1m", ms: 60_000, cap: 1_500, pages: 15 },
  "5m": { api: "5m", ms: 300_000, cap: 9_000, pages: 90 },
  "1h": { api: "1H", ms: 3_600_000, cap: 9_000, pages: 90 },
  "4h": { api: "4H", ms: 14_400_000, cap: 6_600, pages: 66 },
  "1d": { api: "1D", ms: 86_400_000, cap: 3_000, pages: 34 },
  "1w": { api: "1D", ms: 86_400_000, cap: 3_000, pages: 34 },
};
const MAX_HISTORY_WINDOW = 90 * 86_400_000;

export function normalizeBitgetCandles(payload: unknown, interval: Exclude<BitgetCandleInterval, "1w"> | "1D" = "1d"): CanonicalCandlePoint[] {
  if (!Array.isArray(payload)) throw new TypeError("Malformed Bitget candle payload");
  const intervalKey = interval === "1D" ? "1d" : interval;
  const duration = INTERVAL_CONFIG[intervalKey].ms;
  const deduped = new Map<number, CanonicalCandlePoint>();
  for (const item of payload) {
    if (!Array.isArray(item) || item.length < 6) continue;
    const timestamp = numberOrNull(item[0]);
    if (timestamp === null || timestamp <= 0) continue;
    deduped.set(timestamp, {
      openTime: timestamp,
      closeTime: timestamp + duration - 1,
      open: String(item[1]), high: String(item[2]), low: String(item[3]), close: String(item[4]),
      volume: String(item[5]),
      ...(item[6] === undefined ? {} : { quoteVolume: String(item[6]) }),
    });
  }
  return Array.from(deduped.values()).sort((a, b) => a.openTime - b.openTime);
}

function mondayUtc(timestamp: number) {
  const date = new Date(timestamp);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const offset = (date.getUTCDay() + 6) % 7;
  return dayStart - offset * 86_400_000;
}

export function aggregateBitgetWeeklyCandles(daily: CanonicalCandlePoint[]): CanonicalCandlePoint[] {
  const groups = new Map<number, CanonicalCandlePoint[]>();
  for (const candle of daily) {
    const key = mondayUtc(candle.openTime);
    const group = groups.get(key) ?? [];
    group.push(candle);
    groups.set(key, group);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).map(([openTime, unordered]) => {
    const rows = unordered.sort((a, b) => a.openTime - b.openTime);
    const quoteValues = rows.map((row) => row.quoteVolume === undefined ? null : numberOrNull(row.quoteVolume));
    const hasCompleteOfficialTurnover = quoteValues.every((value) => value !== null && value >= 0);
    return {
      openTime,
      closeTime: openTime + 7 * 86_400_000 - 1,
      open: rows[0].open,
      high: String(Math.max(...rows.map((row) => numberOrZero(row.high)))),
      low: String(Math.min(...rows.map((row) => numberOrZero(row.low)))),
      close: rows[rows.length - 1].close,
      volume: String(rows.reduce((sum, row) => sum + numberOrZero(row.volume), 0)),
      ...(hasCompleteOfficialTurnover
        ? { quoteVolume: String(quoteValues.reduce<number>((sum, value) => sum + (value as number), 0)) }
        : {}),
    };
  }).slice(-430);
}

export async function fetchBitgetCandles(
  rawSymbol: string,
  interval: BitgetCandleInterval,
  options: { startTime?: number; endTime?: number; signal?: AbortSignal; request?: BitgetRequest } = {},
): Promise<CanonicalCandlePoint[]> {
  const config = INTERVAL_CONFIG[interval];
  const request = options.request ?? requestBitget;
  const collected = new Map<number, CanonicalCandlePoint>();
  const requestedStart = options.startTime;
  const alignedRequestedStart = requestedStart === undefined ? undefined : Math.floor(requestedStart / config.ms) * config.ms;
  const alignedEnd = Math.floor((options.endTime ?? Date.now()) / config.ms) * config.ms;
  let previousOldest = Number.POSITIVE_INFINITY;

  const normalizePayload = (payload: unknown) => {
    if (!Array.isArray(payload)) throw new TypeError("Malformed Bitget candle payload");
    return normalizeBitgetCandles(payload, interval === "1w" ? "1D" : interval);
  };
  const addRows = (rows: CanonicalCandlePoint[]) => {
    for (const row of rows) {
      if ((requestedStart === undefined || row.openTime >= requestedStart) && row.openTime <= alignedEnd) {
        collected.set(row.openTime, row);
      }
    }
  };

  // V3's recent endpoint is always the first and exactly one request. Its
  // explicit aligned window also makes a supplied historical end deterministic.
  throwIfAborted(options.signal);
  const alignedRecentStart = Math.floor(Math.min(alignedEnd, Math.max(
    1,
    alignedRequestedStart ?? alignedEnd - 99 * config.ms,
    alignedEnd - MAX_HISTORY_WINDOW + config.ms,
  )) / config.ms) * config.ms;
  const recentStart = alignedRecentStart === alignedEnd
    ? Math.max(0, alignedEnd - config.ms)
    : alignedRecentStart;
  if (recentStart >= alignedEnd) return [];
  const recentPayload = await request("candles", {
    symbol: rawSymbol, interval: config.api, type: "market", limit: "100",
    startTime: String(recentStart), endTime: String(alignedEnd),
  }, options.signal);
  const recentRows = normalizePayload(recentPayload);
  addRows(recentRows);
  let oldest = recentRows.length ? recentRows[0].openTime : Number.POSITIVE_INFINITY;

  const cutoffMet = requestedStart !== undefined && oldest <= requestedStart;
  previousOldest = oldest;
  let end = Number.isFinite(oldest)
    ? Math.floor((oldest - config.ms) / config.ms) * config.ms
    : alignedEnd - config.ms;

  // The recent request consumes one request from the interval's page budget.
  for (let page = 1; page < config.pages && collected.size < config.cap && !cutoffMet; page += 1) {
    throwIfAborted(options.signal);
    if (end <= 0) break;
    const start = Math.max(1, alignedRequestedStart ?? 1, end - MAX_HISTORY_WINDOW + config.ms);
    const alignedStart = Math.floor(start / config.ms) * config.ms;
    if (alignedStart > end || (alignedStart === end && requestedStart !== undefined && end < requestedStart)) break;
    const transportStart = alignedStart === end ? Math.max(0, end - config.ms) : alignedStart;
    if (transportStart >= end) break;
    const maximumRowsForWindow = Math.min(100, Math.max(0, Math.floor((end - alignedStart) / config.ms) + 1));
    const payload = await request("history-candles", {
      symbol: rawSymbol, interval: config.api, type: "market", limit: "100",
      startTime: String(transportStart), endTime: String(end),
    }, options.signal);
    const rows = normalizePayload(payload);
    addRows(rows.filter((row) => row.openTime >= alignedStart));
    oldest = rows.length ? rows[0].openTime : Number.POSITIVE_INFINITY;
    const rawRowCount = (payload as unknown[]).length;
    if (rawRowCount === 0 || rawRowCount < maximumRowsForWindow || oldest >= previousOldest || (requestedStart !== undefined && oldest <= requestedStart)) break;
    previousOldest = oldest;
    end = Math.floor((oldest - config.ms) / config.ms) * config.ms;
    if (end <= 0) break;
  }

  const dailyOrNative = Array.from(collected.values()).sort((a, b) => a.openTime - b.openTime).slice(-config.cap);
  return interval === "1w" ? aggregateBitgetWeeklyCandles(dailyOrNative) : dailyOrNative;
}

export function normalizeBitgetOrderBook(payload: unknown): NormalizedBitgetOrderBook {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Malformed Bitget order book");
  const object = payload as { a?: unknown; b?: unknown; asks?: unknown; bids?: unknown };
  const parseSide = (side: unknown): NormalizedBitgetBookLevel[] => {
    if (!Array.isArray(side)) return [];
    return side.flatMap((level) => {
      if (!Array.isArray(level)) return [];
      const price = numberOrNull(level[0]);
      const baseQty = numberOrNull(level[1]);
      return price !== null && price > 0 && baseQty !== null && baseQty >= 0 ? [{ price, baseQty }] : [];
    });
  };
  return { asks: parseSide(object.a ?? object.asks), bids: parseSide(object.b ?? object.bids) };
}

export async function fetchBitgetOrderBook(rawSymbol: string, limit = 100, signal?: AbortSignal, request: BitgetRequest = requestBitget) {
  return normalizeBitgetOrderBook(await request("orderbook", { symbol: rawSymbol, limit: String(Math.max(1, Math.min(1000, Math.trunc(limit)))) }, signal));
}

export function computeBitgetBboSpread(bestBid?: number | null, bestAsk?: number | null): number | null {
  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) return null;
  const midpoint = (bestBid + bestAsk) / 2;
  return midpoint > 0 ? ((bestAsk - bestBid) / midpoint) * 100 : null;
}

export function computeBitgetFundingRatesByInterval(
  history: CanonicalFundingHistoryPoint[],
  interval: "1d" | "4h" | "1h",
) {
  const intervalMs = interval === "1d" ? 86_400_000 : interval === "4h" ? 14_400_000 : 3_600_000;
  const buckets = new Map<number, { total: number; count: number }>();
  for (const point of history) {
    const bucketStartTime = Math.floor(point.timestamp / intervalMs) * intervalMs;
    const bucket = buckets.get(bucketStartTime) ?? { total: 0, count: 0 };
    bucket.total += point.fundingRate;
    bucket.count += 1;
    buckets.set(bucketStartTime, bucket);
  }
  return Array.from(buckets, ([bucketStartTime, bucket]) => ({
    bucketStartTime,
    averageFundingRate: bucket.total / bucket.count,
    sampleCount: bucket.count,
  })).sort((a, b) => a.bucketStartTime - b.bucketStartTime);
}

const BITGET_DETAIL_CANDLE_LIMITS = {
  "1d": 30,
  "4h": 180,
  "1h": 720,
} as const;

/** Keeps the complete 30-day candle budget for the selected chart interval. */
export function selectBitgetDetailCandles(
  candles: CanonicalCandlePoint[],
  interval: keyof typeof BITGET_DETAIL_CANDLE_LIMITS,
): CanonicalCandlePoint[] {
  return candles.slice(-BITGET_DETAIL_CANDLE_LIMITS[interval]);
}

export async function fetchBitgetCanonicalDetail(
  row: Pick<CanonicalFundingRateRow, "symbol" | "rawSymbol" | "marketKey" | "fundingIntervalSeconds" | "bestBid" | "bestAsk">,
  interval: "1d" | "4h" | "1h",
  options: { now?: number; signal?: AbortSignal; request?: BitgetRequest } = {},
): Promise<CanonicalFundingDetail> {
  const now = options.now ?? Date.now();
  const cutoffTime = now - 30 * 86_400_000;
  const settlementCount = Math.ceil((now - cutoffTime) / row.fundingIntervalSeconds) + 1;
  const maxHistoryPages = Math.max(1, Math.min(100, Math.ceil(settlementCount / 100)));
  const [fundingHistory, candles] = await Promise.all([
    fetchBitgetFundingHistory(row.rawSymbol, {
      cutoffTime,
      maxPages: maxHistoryPages,
      signal: options.signal,
      request: options.request,
    }),
    fetchBitgetCandles(row.rawSymbol, interval, {
      startTime: cutoffTime,
      endTime: now,
      signal: options.signal,
      request: options.request,
    }).catch((error): CanonicalCandlePoint[] => {
      if (options.signal?.aborted) throw getAbortReason(options.signal);
      if (isAbortLikeError(error)) throw error;
      console.warn(`Bitget candle detail request failed for ${row.rawSymbol}; returning funding-only detail`, error);
      return [];
    }),
  ]);

  return {
    exchange: "bitget",
    transportMode: "native",
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingHistory,
    candles,
    lastSettlementRate: latestBitgetFundingPoint(fundingHistory)?.fundingRate ?? null,
    bidAskSpread: computeBitgetBboSpread(row.bestBid, row.bestAsk),
  };
}

export type BitgetImpactSpreadResult = number | "insufficient" | null;

export function computeBitgetImpactSpread(
  book: NormalizedBitgetOrderBook,
  notionalUsd: number,
): BitgetImpactSpreadResult {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;

  const impactPrice = (levels: NormalizedBitgetBookLevel[]): number | null => {
    let filledNotional = 0;
    let filledBaseQty = 0;
    for (const level of levels) {
      if (level.price <= 0 || level.baseQty <= 0) continue;
      const availableNotional = level.price * level.baseQty;
      const usedNotional = Math.min(availableNotional, notionalUsd - filledNotional);
      filledNotional += usedNotional;
      filledBaseQty += usedNotional / level.price;
      if (filledNotional >= notionalUsd) break;
    }
    return filledNotional >= notionalUsd && filledBaseQty > 0 ? notionalUsd / filledBaseQty : null;
  };

  const impactBid = impactPrice([...book.bids].sort((a, b) => b.price - a.price));
  const impactAsk = impactPrice([...book.asks].sort((a, b) => a.price - b.price));
  if (impactBid === null || impactAsk === null) return "insufficient";
  const midpoint = (impactBid + impactAsk) / 2;
  return midpoint > 0 ? ((impactAsk - impactBid) / midpoint) * 100 : null;
}

export async function fetchBitgetImpactSpread(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  request: BitgetRequest = requestBitget,
): Promise<BitgetImpactSpreadResult> {
  const book = await fetchBitgetOrderBook(rawSymbol, 100, signal, request);
  return computeBitgetImpactSpread(book, notionalUsd);
}
