import type { CanonicalCandlePoint, CanonicalFundingDetail, CanonicalFundingHistoryPoint, CanonicalFundingRateRow } from "@/lib/types";
import { getAbortReason, isAbortLikeError } from "@/lib/utils/abort";
import { computeOrderBookImpactDetail, resolvePerpImpactDepth, type OrderBookImpactDetailResult } from "@/lib/order-book-impact";

export type BybitCandleInterval = "1m" | "5m" | "1h" | "4h" | "1d" | "1w";
export type BybitAction = "instruments" | "tickers" | "funding-history" | "kline" | "premium-index-price-kline" | "orderbook";

export interface BybitInstrument {
  symbol?: string;
  baseCoin?: string;
  quoteCoin?: string;
  contractType?: string;
  status?: string;
  settleCoin?: string;
  /** V5 linear instruments-info reports the funding interval in minutes (e.g. "480"). */
  fundingInterval?: string | number;
}

export interface BybitTicker {
  symbol?: string;
  lastPrice?: string;
  indexPrice?: string;
  markPrice?: string;
  prevPrice24h?: string;
  price24hPcnt?: string;
  turnover24h?: string;
  openInterest?: string;
  openInterestValue?: string;
  fundingRate?: string;
  /** V5 tickers report the funding interval in hours for linear perps (e.g. "8"). */
  fundingIntervalHour?: string | number;
  bid1Price?: string;
  ask1Price?: string;
}

export interface BybitFundingHistoryEntry {
  symbol?: string;
  fundingRate?: string;
  fundingRateTimestamp?: string | number;
}

/** V5 kline tuple: [startTime, open, high, low, close, volume, turnover]. */
export type BybitCandleTuple = [string | number, string, string, string, string, string, string?];
export interface NormalizedBybitBookLevel { price: number; baseQty: number }
export interface NormalizedBybitOrderBook { asks: NormalizedBybitBookLevel[]; bids: NormalizedBybitBookLevel[] }

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;
type SchedulerOptions = {
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
  /** Overrides BYBIT_SCHEDULER_PROFILE.maxInFlight (tuning/tests only). */
  maxInFlight?: number;
  /** Overrides BYBIT_SCHEDULER_PROFILE.minStartSpacingMs (tuning/tests only). */
  minStartSpacingMs?: number;
};

/**
 * Controlled-throughput profile for the shared Bybit scheduler. Deliberately
 * conservative: at most maxInFlight requests execute concurrently and
 * successive request starts are spaced at least minStartSpacingMs apart, so
 * the sustained start rate is at most 1000 / minStartSpacingMs requests per
 * second (10 req/s) with <= 2 active requests — far below Bybit's official
 * 600 requests / 5 seconds / IP public cap. Rollback or tuning is a single
 * constant change; unlimited concurrency is never permitted.
 */
export const BYBIT_SCHEDULER_PROFILE = {
  maxInFlight: 2,
  minStartSpacingMs: 100,
} as const;

const abortError = () => new DOMException("The operation was aborted.", "AbortError");
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

const defaultSleep: Sleep = (ms, signal) => new Promise((resolve, reject) => {
  throwIfAborted(signal);
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener("abort", aborted); resolve(); }
  function aborted() { clearTimeout(timer); signal?.removeEventListener("abort", aborted); reject(abortError()); }
  signal?.addEventListener("abort", aborted, { once: true });
});

type Waiter = { signal?: AbortSignal; wake: () => void };

/**
 * FIFO slot acquisition: takes a slot synchronously while one is free,
 * otherwise queues in arrival order. A slot is incremented exactly once per
 * acquired slot (free path here, wake path for queued requests), so the
 * in-flight bound holds even for synchronous bursts.
 */
function acquireSlot(
  waiters: Waiter[],
  active: () => number,
  incrementActive: () => void,
  maxInFlight: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (active() < maxInFlight) {
    incrementActive();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { signal, wake: () => undefined };
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    waiter.wake = () => {
      signal?.removeEventListener("abort", onAbort);
      incrementActive();
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
  });
}

/** Hands a freed slot to the oldest queued request (FIFO) or releases it when the queue is empty. */
function releaseSlot(waiters: Waiter[], decrementActive: () => void) {
  const waiter = waiters.shift();
  // Always decrement; a woken waiter re-increments synchronously, so the
  // handoff leaves the active count unchanged.
  decrementActive();
  waiter?.wake();
}

class BybitHttpError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number | null,
    public apiCode?: string,
    public apiMessage?: string,
  ) {
    const diagnostic = apiCode ? `; API code ${apiCode}${apiMessage ? `: ${apiMessage}` : ""}` : "";
    super(`Bybit request failed (${status}${diagnostic})`);
  }
  get transient() { return this.status === 429 || this.status >= 500; }
}
class BybitTimeoutError extends Error { constructor() { super("Bybit client request timed out"); this.name = "TimeoutError"; } }

export function statusForBybitCode(code: string): number {
  if (["10004", "10005"].includes(code)) return 429;
  if (code === "10001") return 400;
  if (code === "10002") return 401;
  if (code === "10003") return 403;
  if (code === "10009") return 404;
  return 502;
}

export function unwrapBybitEnvelope(payload: unknown, retryAfter: number | null): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("retCode" in payload)) {
    throw new TypeError("Malformed Bybit response envelope");
  }
  const envelope = payload as { retCode?: unknown; retMsg?: unknown; result?: unknown };
  if (Number(envelope.retCode) === 0) {
    if (!("result" in envelope)) throw new TypeError("Malformed Bybit success envelope");
    return envelope.result;
  }
  const code = String(envelope.retCode);
  const rawMessage = envelope.retMsg;
  const message = typeof rawMessage === "string" ? rawMessage : undefined;
  throw new BybitHttpError(statusForBybitCode(code), retryAfter, code, message);
}

function bybitEnvelopeDiagnostics(payload: unknown): { apiCode?: string; apiMessage?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("retCode" in payload)) return {};
  const envelope = payload as { retCode?: unknown; retMsg?: unknown };
  const rawMessage = envelope.retMsg;
  return {
    ...(envelope.retCode === undefined ? {} : { apiCode: String(envelope.retCode) }),
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

/** A FIFO, globally shared, controlled-throughput scheduler for every Bybit adapter request. */
export function createBybitScheduler(options: SchedulerOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  const maxInFlight = Math.max(1, Math.trunc(options.maxInFlight ?? BYBIT_SCHEDULER_PROFILE.maxInFlight));
  const minStartSpacingMs = Math.max(0, Math.trunc(options.minStartSpacingMs ?? BYBIT_SCHEDULER_PROFILE.minStartSpacingMs));
  let active = 0;
  let nextStart = 0;
  const waiters: Waiter[] = [];

  async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const signal = init.signal ?? undefined;
    await acquireSlot(waiters, () => active, () => { active += 1; }, maxInFlight, signal);
    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        throwIfAborted(signal);
        const scheduleDelay = Math.max(0, nextStart - now()) + Math.floor(random() * 76);
        if (scheduleDelay > 0) await sleep(scheduleDelay, signal);
        nextStart = now() + minStartSpacingMs;

        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const callerSignal = signal;
        const callerAbort = () => controller.abort();
        callerSignal?.addEventListener("abort", callerAbort, { once: true });
        try {
          const response = await fetchImpl(url, { ...init, cache: "no-store", signal: controller.signal });
          const retryAfter = response.status === 429 ? retryAfterMs(response, now()) : null;
          const payload: unknown = await response.json().catch(() => undefined);
          if (!response.ok) {
            const diagnostics = bybitEnvelopeDiagnostics(payload);
            throw new BybitHttpError(response.status, retryAfter, diagnostics.apiCode, diagnostics.apiMessage);
          }
          return unwrapBybitEnvelope(payload, retryAfter);
        } catch (error) {
          if (callerSignal?.aborted) throw abortError();
          const failure = timedOut ? new BybitTimeoutError() : error;
          const retryable = failure instanceof BybitTimeoutError || (failure instanceof BybitHttpError && failure.transient);
          if (!retryable || attempt === 3) throw failure;
          const exponential = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
          const honored = failure instanceof BybitHttpError ? failure.retryAfterMs : null;
          await sleep(Math.max(exponential, honored ?? 0) + Math.floor(random() * 251), callerSignal);
        } finally {
          clearTimeout(timer);
          callerSignal?.removeEventListener("abort", callerAbort);
        }
      }
      throw new Error("Unreachable Bybit retry state");
    } finally {
      releaseSlot(waiters, () => { active -= 1; });
    }
  }

  return { fetchJson };
}

export const bybitScheduler = createBybitScheduler();

export function parseBybitList<T extends object>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload.filter((item): item is T => item !== null && typeof item === "object");
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if ("retCode" in payload) throw new TypeError("Unexpected or malformed Bybit envelope");
    const list = (payload as { list?: unknown }).list;
    if (Array.isArray(list)) return list.filter((item): item is T => item !== null && typeof item === "object");
  }
  throw new TypeError("Malformed Bybit successful payload");
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

/** V5 linear instruments report fundingInterval in minutes; validate the documented 1h/4h/8h set. */
export function parseBybitFundingIntervalSeconds(value: unknown): number | null {
  const minutes = numberOrNull(value);
  return minutes !== null && [60, 240, 480].includes(minutes) ? minutes * 60 : null;
}

/** Ticker fallback reports the funding interval in hours; validate the documented 1h/4h/8h set. */
export function parseBybitFundingIntervalHours(value: unknown): number | null {
  const hours = numberOrNull(value);
  return hours !== null && [1, 4, 8].includes(hours) ? hours * 3600 : null;
}

/** Retains exactly Trading LinearPerpetual contracts settled in USDT. */
export function isBybitLinearPerp(row: BybitInstrument): row is BybitInstrument & { symbol: string } {
  return row.contractType === "LinearPerpetual"
    && row.status === "Trading"
    && row.settleCoin === "USDT"
    && typeof row.symbol === "string"
    && row.symbol.length > 0;
}

export function filterBybitInstruments(rows: BybitInstrument[]): Array<BybitInstrument & { symbol: string }> {
  return rows.filter(isBybitLinearPerp);
}

export type BybitInstrumentCacheOptions = {
  ttlMs?: number;
  now?: () => number;
  maxPages?: number;
};

/** Pages through instruments-info, filters the linear-USDT universe, and caches it for 1h. */
export function createBybitInstrumentCache(options: BybitInstrumentCacheOptions = {}) {
  const ttlMs = options.ttlMs ?? 3_600_000;
  const now = options.now ?? Date.now;
  const maxPages = options.maxPages ?? 200;
  let state: { expiresAt: number; bySymbol: Map<string, BybitInstrument> } | null = null;
  let inflight: Promise<Map<string, BybitInstrument>> | null = null;

  async function loadInstruments(request: BybitRequest, signal?: AbortSignal): Promise<Map<string, BybitInstrument>> {
    const collected = new Map<string, BybitInstrument>();
    let cursor = "";
    for (let page = 0; page < maxPages; page += 1) {
      throwIfAborted(signal);
      const params: Record<string, string> = { limit: "1000" };
      if (cursor) params.cursor = cursor;
      const payload = await request("instruments", params, signal);
      const rawList = parseBybitList<BybitInstrument>(payload);
      for (const row of filterBybitInstruments(rawList)) collected.set(row.symbol, row);
      const rawCursor = (payload as { nextPageCursor?: unknown } | null)?.nextPageCursor;
      const nextCursor = typeof rawCursor === "string" && rawCursor.length > 0 ? rawCursor : null;
      if (!nextCursor || rawList.length < 1000) break;
      cursor = nextCursor;
    }
    return collected;
  }

  return {
    async getInstruments(request: BybitRequest, signal?: AbortSignal): Promise<Map<string, BybitInstrument>> {
      const current = now();
      if (state && state.expiresAt > current) return state.bySymbol;
      if (inflight) return inflight;
      inflight = loadInstruments(request, signal)
        .then((bySymbol) => {
          state = { expiresAt: now() + ttlMs, bySymbol };
          return bySymbol;
        })
        .finally(() => { inflight = null; });
      return inflight;
    },
    clear() { state = null; },
  };
}

export const bybitInstrumentCache = createBybitInstrumentCache();

function stripUsdtSuffix(symbol: string): string {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

/** Pure universe intersection and normalization: instruments + ONE bulk linear tickers call. */
export function normalizeBybitFundingRows(instruments: BybitInstrument[], tickersPayload: unknown): CanonicalFundingRateRow[] {
  const tickers = symbolMap(parseBybitList<BybitTicker>(tickersPayload));
  const result: CanonicalFundingRateRow[] = [];

  for (const instrument of filterBybitInstruments(instruments)) {
    const ticker = tickers.get(instrument.symbol);
    if (!ticker) continue;
    const markPrice = numberOrZero(ticker.markPrice);
    const lastPrice = numberOrNull(ticker.lastPrice) ?? markPrice;
    const prevPrice24h = numberOrNull(ticker.prevPrice24h);
    const officialChange = numberOrNull(ticker.price24hPcnt);
    const openInterest = numberOrZero(ticker.openInterest);
    const openInterestValue = numberOrZero(ticker.openInterestValue);
    result.push({
      exchange: "bybit",
      transportMode: "native",
      symbol: instrument.baseCoin ?? stripUsdtSuffix(instrument.symbol),
      rawSymbol: instrument.symbol,
      marketKey: instrument.symbol,
      fundingRate: numberOrZero(ticker.fundingRate),
      predictedFundingRate: null,
      lastSettlementRate: null,
      markPrice,
      indexPrice: numberOrNull(ticker.indexPrice),
      lastPrice,
      change24h: officialChange !== null
        ? officialChange * 100
        : prevPrice24h && prevPrice24h !== 0 ? ((lastPrice - prevPrice24h) / prevPrice24h) * 100 : 0,
      quoteVolume: numberOrZero(ticker.turnover24h),
      openInterest,
      notionalValue: openInterestValue > 0 ? openInterestValue : openInterest * markPrice,
      fundingIntervalSeconds: parseBybitFundingIntervalSeconds(instrument.fundingInterval)
        ?? parseBybitFundingIntervalHours(ticker.fundingIntervalHour)
        ?? 8 * 3600,
      assetCategory: "Crypto",
      bestBid: numberOrNull(ticker.bid1Price),
      bestAsk: numberOrNull(ticker.ask1Price),
    });
  }
  return result;
}

export type BybitRequest = (action: BybitAction, params: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;

const BYBIT_API_ORIGIN = "https://api.bybit.com";
const BYBIT_ACTION_PATHS: Record<BybitAction, string> = {
  instruments: "/v5/market/instruments-info",
  tickers: "/v5/market/tickers",
  "funding-history": "/v5/market/funding/history",
  kline: "/v5/market/kline",
  "premium-index-price-kline": "/v5/market/premium-index-price-kline",
  orderbook: "/v5/market/orderbook",
};
const BYBIT_ACTION_DEFAULTS: Partial<Record<BybitAction, Record<string, string>>> = {
  instruments: { status: "Trading", limit: "1000" },
  "funding-history": { limit: "200" },
  kline: { limit: "1000" },
  "premium-index-price-kline": { limit: "200" },
  orderbook: { limit: "100" },
};

export function buildBybitUrl(action: BybitAction, params: Record<string, string> = {}): string {
  const url = new URL(BYBIT_ACTION_PATHS[action], BYBIT_API_ORIGIN);
  const merged = { ...BYBIT_ACTION_DEFAULTS[action], ...params, category: "linear" };
  for (const [key, value] of Object.entries(merged)) url.searchParams.set(key, value);
  return url.toString();
}

/** Local same-origin proxy route for the allowlisted Bybit actions (see app/api/bybit/route.ts). */
const BYBIT_PROXY_PATH = "/api/bybit";
/** Params the proxy route accepts per action; anything else would be rejected as unknown. */
const BYBIT_PROXY_ALLOWED_PARAMS: Record<BybitAction, readonly string[]> = {
  instruments: ["cursor", "limit"],
  tickers: [],
  "funding-history": ["symbol", "startTime", "endTime", "limit"],
  kline: ["symbol", "interval", "start", "end", "limit"],
  "premium-index-price-kline": ["symbol", "interval", "start", "end", "limit"],
  orderbook: ["symbol", "limit"],
};

/** Builds the same-origin proxy URL with exactly the allowlisted params (never category/status). */
export function buildBybitProxyUrl(action: BybitAction, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(params)) {
    if (BYBIT_PROXY_ALLOWED_PARAMS[action].includes(key)) search.set(key, value);
  }
  return `${BYBIT_PROXY_PATH}?${search.toString()}`;
}

/**
 * Classifies whether a direct-request failure may be retried through the
 * same-origin proxy. Only transport-level problems qualify: client timeouts,
 * network/CORS rejections, geo-block statuses (403/451), and transient 5xx.
 * Validation and business failures (4xx codes, 429 rate limits, malformed
 * envelopes) and caller aborts are never routed to the proxy, which shares
 * the same upstream.
 */
export function isBybitProxyEligibleFailure(error: unknown): boolean {
  if (isAbortLikeError(error)) return false;
  if (error instanceof BybitTimeoutError) return true;
  if (error instanceof BybitHttpError) {
    return error.status === 403 || error.status === 451 || error.status >= 500;
  }
  if (error instanceof TypeError && error.message.includes("Malformed Bybit")) return false;
  // Network-level rejections (CORS, DNS, connection) surface as plain errors.
  return error instanceof Error || error instanceof DOMException;
}

/**
 * Direct-first transport with a same-origin proxy fallback. The direct URL is
 * always attempted first; the proxy is only consulted for transport failures
 * (see isBybitProxyEligibleFailure). Both legs run through the shared FIFO
 * scheduler, preserving throttling, retries, envelope validation, and abort
 * semantics.
 */
export function createBybitRequest(
  scheduler: Pick<ReturnType<typeof createBybitScheduler>, "fetchJson"> = bybitScheduler,
): BybitRequest {
  return async (action, params, signal) => {
    try {
      return await scheduler.fetchJson(buildBybitUrl(action, params), { signal });
    } catch (error) {
      if (!isBybitProxyEligibleFailure(error)) throw error;
      return scheduler.fetchJson(buildBybitProxyUrl(action, params), { signal });
    }
  };
}

export const requestBybit: BybitRequest = createBybitRequest();

/** One bulk linear tickers request intersected with the cached linear-USDT instrument map. */
export async function fetchBybitCanonicalRates(signal?: AbortSignal, request: BybitRequest = requestBybit) {
  const [instruments, tickers] = await Promise.all([
    bybitInstrumentCache.getInstruments(request, signal),
    request("tickers", {}, signal),
  ]);
  return normalizeBybitFundingRows(Array.from(instruments.values()), tickers);
}

export function normalizeBybitFundingHistory(payload: unknown): CanonicalFundingHistoryPoint[] {
  const deduped = new Map<number, number>();
  for (const row of parseBybitList<BybitFundingHistoryEntry>(payload)) {
    const timestamp = numberOrNull(row.fundingRateTimestamp);
    const rate = numberOrNull(row.fundingRate);
    if (timestamp !== null && timestamp > 0 && rate !== null && !deduped.has(timestamp)) deduped.set(timestamp, rate);
  }
  return Array.from(deduped, ([timestamp, fundingRate]) => ({ timestamp, fundingRate })).sort((a, b) => a.timestamp - b.timestamp);
}

export function latestBybitFundingPoint(history: CanonicalFundingHistoryPoint[]) {
  return history.reduce<CanonicalFundingHistoryPoint | null>((latest, point) => !latest || point.timestamp > latest.timestamp ? point : latest, null);
}

const DAY_MS = 86_400_000;
const DEFAULT_FUNDING_WINDOW_MS = 7 * DAY_MS;
/** Hard cap shared with the /api/bybit proxy route; a window wider than this is rejected. */
export const MAX_FUNDING_WINDOW_MS = 90 * DAY_MS;
const MAX_FUNDING_PAGE_SIZE = 200;

/**
 * Interval-aware funding-history window contract. One V5 funding-history
 * request holds at most `pageSize` settlement rows (200 by default), so the
 * ms span of a full page at the given settlement interval is
 * `fundingIntervalSeconds * 1000 * pageSize`. Callers paginating a fixed
 * overlay horizon (e.g. the search chart's 90-day funding overlay) derive
 * their window and page budget from this helper so the number of sequential
 * history requests scales with the interval, not with an arbitrary small
 * window (8h funding ≈ 2 requests for 90 days, 4h ≈ 3, 1h ≈ 11). The window
 * is capped at MAX_FUNDING_WINDOW_MS so a full 1d-funding page (200 days)
 * still fits the proxy route's 90-day validation.
 */
export function resolveBybitFundingHistoryWindowMs(
  fundingIntervalSeconds: number,
  pageSize: number = MAX_FUNDING_PAGE_SIZE,
): number {
  const intervalMs = Math.max(60_000, Math.trunc(fundingIntervalSeconds) * 1000);
  const size = Math.max(1, Math.min(MAX_FUNDING_PAGE_SIZE, Math.trunc(pageSize)));
  return Math.min(MAX_FUNDING_WINDOW_MS, intervalMs * size);
}

/**
 * Module-level funding-history cache contract. Keys are raw symbols; the
 * entry remembers how far back its points reach (coverageStart), so a hit is
 * only served when the cached range fully contains the caller's requested
 * range (requested start >= coverageStart). Coverage starts at the oldest row
 * actually fetched (not the oldest row retained after cutoff filtering), so
 * repeat requests at the same cutoff hit even when the page walk drifts off
 * the settlement grid. A recency guard mirrors the candle cache: the cached
 * coverage must reach within one TTL of the requested end, so latest-
 * settlement reads never serve stale tails. Expiry is a TTL, never a request
 * count. Consumers receive defensive copies, and writes only happen after a
 * successful fetch (an aborted or failed fetch never poisons the cache).
 */
export interface BybitFundingHistoryCache {
  get(rawSymbol: string, reqStart: number, reqEnd: number): CanonicalFundingHistoryPoint[] | null;
  set(rawSymbol: string, points: CanonicalFundingHistoryPoint[], coverageStart: number, coverageEnd: number): void;
}

export function createBybitFundingHistoryCache(
  options: { ttlMs?: number; now?: () => number; maxEntries?: number } = {},
): BybitFundingHistoryCache {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 2000;
  const entries = new Map<string, { points: CanonicalFundingHistoryPoint[]; coverageStart: number; coverageEnd: number; expiresAt: number }>();
  return {
    get(rawSymbol, reqStart, reqEnd) {
      const entry = entries.get(rawSymbol);
      if (!entry || entry.expiresAt <= now()) return null;
      if (entry.coverageStart > reqStart) return null;
      if (entry.coverageEnd < reqEnd - ttlMs) return null;
      return entry.points.slice();
    },
    set(rawSymbol, points, coverageStart, coverageEnd) {
      entries.delete(rawSymbol);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(rawSymbol, { points: points.slice(), coverageStart, coverageEnd, expiresAt: now() + ttlMs });
    },
  };
}

export const bybitFundingHistoryCache = createBybitFundingHistoryCache();

/**
 * Time-window backward pagination for funding history. Every request pairs
 * startTime with endTime (never startTime alone); windows default to 7 days,
 * are capped at MAX_FUNDING_WINDOW_MS, and are always bounded by maxPages.
 * Callers may pass an explicit interval-aware window larger than 7 days (see
 * resolveBybitFundingHistoryWindowMs) for overlay pagination; the default
 * stays 7 days so existing callers are unchanged. The optional `cache`
 * defaults to the module-level bybitFundingHistoryCache (pass null to bypass
 * reads and writes, e.g. in request-count tests).
 */
export async function fetchBybitFundingHistory(
  rawSymbol: string,
  options: { cutoffTime?: number; endTime?: number; signal?: AbortSignal; pageSize?: number; maxPages?: number; windowMs?: number; request?: BybitRequest; cache?: BybitFundingHistoryCache | null } = {},
): Promise<CanonicalFundingHistoryPoint[]> {
  const pageSize = Math.max(1, Math.min(MAX_FUNDING_PAGE_SIZE, Math.trunc(options.pageSize ?? MAX_FUNDING_PAGE_SIZE)));
  const maxPages = Math.max(1, Math.min(100, Math.trunc(options.maxPages ?? 100)));
  const windowMs = Math.max(60_000, Math.min(MAX_FUNDING_WINDOW_MS, Math.trunc(options.windowMs ?? DEFAULT_FUNDING_WINDOW_MS)));
  const request = options.request ?? requestBybit;
  const cache = options.cache === undefined ? bybitFundingHistoryCache : options.cache;
  let end = Math.trunc(options.endTime ?? Date.now());
  const requestedEnd = end;
  const reqStart = options.cutoffTime ?? end - windowMs;
  const collected = new Map<number, number>();
  let previousOldest = Number.POSITIVE_INFINITY;
  let fetchedOldest = end - windowMs;

  if (cache !== null) {
    throwIfAborted(options.signal);
    const cached = cache.get(rawSymbol, reqStart, requestedEnd);
    if (cached !== null) {
      return cached.filter((point) =>
        (options.cutoffTime === undefined || point.timestamp >= options.cutoffTime) && point.timestamp <= requestedEnd,
      );
    }
  }

  for (let page = 0; page < maxPages; page += 1) {
    throwIfAborted(options.signal);
    const start = end - windowMs;
    const payload = await request("funding-history", {
      symbol: rawSymbol,
      startTime: String(start),
      endTime: String(end),
      limit: String(pageSize),
    }, options.signal);
    const rows = normalizeBybitFundingHistory(payload);
    if (rows.length) fetchedOldest = rows[0].timestamp;
    for (const row of rows) {
      if (options.cutoffTime === undefined || row.timestamp >= options.cutoffTime) collected.set(row.timestamp, row.fundingRate);
    }
    const oldest = rows.length ? rows[0].timestamp : Number.POSITIVE_INFINITY;
    if (options.cutoffTime !== undefined && oldest <= options.cutoffTime) break;
    if (!rows.length || oldest >= previousOldest) break;
    // Without a cutoff, one window (or the first short page) is the full answer.
    if (options.cutoffTime === undefined && rows.length < pageSize) break;
    previousOldest = oldest;
    end = oldest - 1;
    if (end <= 0) break;
  }
  const result = Array.from(collected, ([timestamp, fundingRate]) => ({ timestamp, fundingRate })).sort((a, b) => a.timestamp - b.timestamp);
  if (cache !== null) {
    cache.set(rawSymbol, result, fetchedOldest, requestedEnd);
  }
  return result;
}

/** Fetches the latest settlement with one and only one history request. */
export async function fetchLatestBybitSettlement(
  rawSymbol: string,
  options: { endTime?: number; signal?: AbortSignal; request?: BybitRequest; cache?: BybitFundingHistoryCache | null } = {},
): Promise<CanonicalFundingHistoryPoint | null> {
  const history = await fetchBybitFundingHistory(rawSymbol, {
    endTime: options.endTime,
    signal: options.signal,
    request: options.request,
    pageSize: 1,
    maxPages: 1,
    cache: options.cache,
  });
  return latestBybitFundingPoint(history);
}

/**
 * Hydrates exact raw Bybit symbols (e.g. "BTCUSDT") with their latest settled
 * funding rate. Bybit has no bulk funding-history endpoint, so each raw symbol
 * costs exactly one request (limit=1) unless the shared funding cache already
 * covers its range (detail fetches fill the cache with 30-day coverage, so
 * hydration after a detail load is request-free). The returned Map is keyed
 * by the raw symbol passed in, so callers must pass and read raw symbols
 * (never reconstructed displays).
 */
export async function hydrateBybitLatestSettlementRates(
  rawSymbols: string[],
  signal?: AbortSignal,
  request: BybitRequest = requestBybit,
  cache: BybitFundingHistoryCache | null = bybitFundingHistoryCache,
): Promise<Map<string, number>> {
  throwIfAborted(signal);
  if (rawSymbols.length === 0) return new Map();
  const entries = await Promise.all(rawSymbols.map(async (rawSymbol) => {
    const latest = await fetchLatestBybitSettlement(rawSymbol, { signal, request, cache });
    return latest ? [rawSymbol, latest.fundingRate] as const : null;
  }));
  return new Map(entries.filter((entry): entry is readonly [string, number] => entry !== null));
}

const INTERVAL_CONFIG: Record<BybitCandleInterval, { api: string; ms: number; cap: number; pages: number }> = {
  "1m": { api: "1", ms: 60_000, cap: 1_000, pages: 90 },
  "5m": { api: "5", ms: 300_000, cap: 1_000, pages: 90 },
  "1h": { api: "60", ms: 3_600_000, cap: 1_000, pages: 90 },
  "4h": { api: "240", ms: 14_400_000, cap: 1_000, pages: 90 },
  "1d": { api: "D", ms: 86_400_000, cap: 1_000, pages: 90 },
  "1w": { api: "W", ms: 7 * 86_400_000, cap: 1_000, pages: 90 },
};

export function normalizeBybitCandles(payload: unknown, interval: BybitCandleInterval): CanonicalCandlePoint[] {
  const duration = INTERVAL_CONFIG[interval].ms;
  const deduped = new Map<number, CanonicalCandlePoint>();
  for (const item of parseBybitList<BybitCandleTuple>(payload)) {
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

/**
 * Module-level candle cache contract. Keys pair the V5 interval with the raw
 * symbol (e.g. "1m:BTCUSDT") so different intervals never collide. A hit
 * requires the cached range to contain the requested range on both ends: the
 * coverage must reach back to (or before) the requested start, and the newest
 * cached candle must be within one interval of the requested end (so
 * latest-candle callers never receive stale tails). Same contract as the
 * funding cache: defensive copies, TTL expiry, writes only after success.
 */
export interface BybitCandleCache {
  get(interval: BybitCandleInterval, rawSymbol: string, reqStart: number, reqEnd: number): CanonicalCandlePoint[] | null;
  set(interval: BybitCandleInterval, rawSymbol: string, points: CanonicalCandlePoint[], coverageStart: number, coverageEnd: number): void;
}

export function createBybitCandleCache(
  options: { ttlMs?: number; now?: () => number; maxEntries?: number } = {},
): BybitCandleCache {
  const ttlMs = options.ttlMs ?? 120_000;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 2000;
  const entries = new Map<string, { points: CanonicalCandlePoint[]; coverageStart: number; coverageEnd: number; expiresAt: number }>();
  return {
    get(interval, rawSymbol, reqStart, reqEnd) {
      const entry = entries.get(`${interval}:${rawSymbol}`);
      if (!entry || entry.expiresAt <= now()) return null;
      const intervalMs = INTERVAL_CONFIG[interval].ms;
      if (entry.coverageStart > reqStart) return null;
      if (entry.coverageEnd < reqEnd - intervalMs) return null;
      return entry.points.slice();
    },
    set(interval, rawSymbol, points, coverageStart, coverageEnd) {
      const key = `${interval}:${rawSymbol}`;
      entries.delete(key);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(key, { points: points.slice(), coverageStart, coverageEnd, expiresAt: now() + ttlMs });
    },
  };
}

export const bybitCandleCache = createBybitCandleCache();

/** Backward-windowed V5 kline pagination; each window is at most 1000 rows. */
export async function fetchBybitCandles(
  rawSymbol: string,
  interval: BybitCandleInterval,
  options: { startTime?: number; endTime?: number; signal?: AbortSignal; request?: BybitRequest; cache?: BybitCandleCache | null } = {},
): Promise<CanonicalCandlePoint[]> {
  const config = INTERVAL_CONFIG[interval];
  const request = options.request ?? requestBybit;
  const cache = options.cache === undefined ? bybitCandleCache : options.cache;
  const collected = new Map<number, CanonicalCandlePoint>();
  const requestedStart = options.startTime;
  const alignedRequestedStart = requestedStart === undefined ? undefined : Math.floor(requestedStart / config.ms) * config.ms;
  const alignedEnd = Math.floor((options.endTime ?? Date.now()) / config.ms) * config.ms;
  const reqStart = requestedStart === undefined
    ? Math.max(1, alignedEnd - (config.cap - 1) * config.ms)
    : Math.max(1, alignedRequestedStart ?? 1);
  let end = alignedEnd;
  let previousOldest = Number.POSITIVE_INFINITY;
  let fetchedOldest = alignedEnd;

  if (cache !== null) {
    throwIfAborted(options.signal);
    const cached = cache.get(interval, rawSymbol, reqStart, alignedEnd);
    if (cached !== null) {
      return cached
        .filter((point) => (requestedStart === undefined || point.openTime >= requestedStart) && point.openTime <= alignedEnd)
        .sort((a, b) => a.openTime - b.openTime)
        .slice(-config.cap);
    }
  }

  const addRows = (rows: CanonicalCandlePoint[]) => {
    for (const row of rows) {
      if ((requestedStart === undefined || row.openTime >= requestedStart) && row.openTime <= alignedEnd) {
        collected.set(row.openTime, row);
      }
    }
  };

  for (let page = 0; page < config.pages; page += 1) {
    throwIfAborted(options.signal);
    const start = Math.max(1, alignedRequestedStart ?? 1, end - (config.cap - 1) * config.ms);
    if (start >= end) break;
    const payload = await request("kline", {
      symbol: rawSymbol,
      interval: config.api,
      limit: String(config.cap),
      start: String(start),
      end: String(end),
    }, options.signal);
    const rows = normalizeBybitCandles(payload, interval);
    if (rows.length) fetchedOldest = rows[0].openTime;
    addRows(rows);
    const oldest = rows.length ? rows[0].openTime : Number.POSITIVE_INFINITY;
    // Without a cutoff, the first window already holds the newest 1000 rows.
    if (requestedStart === undefined || !rows.length || oldest >= previousOldest) break;
    if (oldest <= requestedStart) break;
    previousOldest = oldest;
    end = oldest - config.ms;
    if (end <= 0) break;
  }

  const result = Array.from(collected.values()).sort((a, b) => a.openTime - b.openTime).slice(-config.cap);
  if (cache !== null) {
    cache.set(interval, rawSymbol, result, fetchedOldest, alignedEnd);
  }
  return result;
}

export function normalizeBybitOrderBook(payload: unknown): NormalizedBybitOrderBook {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("Malformed Bybit order book");
  const object = payload as { a?: unknown; b?: unknown; asks?: unknown; bids?: unknown };
  const parseSide = (side: unknown): NormalizedBybitBookLevel[] => {
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

/**
 * Bybit perpetual depth policy, delegated to the shared impact-depth registry
 * (STANDARD_PERP_IMPACT_DEPTH_LIMITS.Bybit = 100, MAX = 500), which documents
 * the V5 linear orderbook's accepted level set. Kept as thin compatibility
 * wrappers so adapter and impact callers resolve from one source of truth.
 */
export const BYBIT_STANDARD_PERP_IMPACT_DEPTH = resolvePerpImpactDepth("Bybit");
export const BYBIT_MAX_PERP_IMPACT_DEPTH = resolvePerpImpactDepth("Bybit", "max");

export function resolveBybitImpactDepth(mode: "standard" | "max" = "standard"): number {
  return resolvePerpImpactDepth("Bybit", mode);
}

export async function fetchBybitOrderBook(rawSymbol: string, limit = resolveBybitImpactDepth(), signal?: AbortSignal, request: BybitRequest = requestBybit) {
  return normalizeBybitOrderBook(await request("orderbook", { symbol: rawSymbol, limit: String(Math.max(1, Math.min(1000, Math.trunc(limit)))) }, signal));
}

export function computeBybitBboSpread(bestBid?: number | null, bestAsk?: number | null): number | null {
  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) return null;
  const midpoint = (bestBid + bestAsk) / 2;
  return midpoint > 0 ? ((bestAsk - bestBid) / midpoint) * 100 : null;
}

export function computeBybitFundingRatesByInterval(
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

const BYBIT_DETAIL_CANDLE_LIMITS = {
  "1d": 30,
  "4h": 180,
  "1h": 720,
} as const;

/** Keeps the complete 30-day candle budget for the selected chart interval. */
export function selectBybitDetailCandles(
  candles: CanonicalCandlePoint[],
  interval: keyof typeof BYBIT_DETAIL_CANDLE_LIMITS,
): CanonicalCandlePoint[] {
  return candles.slice(-BYBIT_DETAIL_CANDLE_LIMITS[interval]);
}

export async function fetchBybitCanonicalDetail(
  row: Pick<CanonicalFundingRateRow, "symbol" | "rawSymbol" | "marketKey" | "fundingIntervalSeconds" | "bestBid" | "bestAsk">,
  interval: "1d" | "4h" | "1h",
  options: { now?: number; signal?: AbortSignal; request?: BybitRequest; fundingCache?: BybitFundingHistoryCache | null; candleCache?: BybitCandleCache | null } = {},
): Promise<CanonicalFundingDetail> {
  const now = options.now ?? Date.now();
  const cutoffTime = now - 30 * DAY_MS;
  // Interval-aware windows (capped at MAX_FUNDING_WINDOW_MS) keep the 30-day
  // funding fetch to one request for 4h/8h/1d funding and ~4 for 1h funding.
  const windowMs = resolveBybitFundingHistoryWindowMs(row.fundingIntervalSeconds);
  const maxHistoryPages = Math.max(1, Math.min(100, Math.ceil((30 * DAY_MS) / windowMs)));
  const [fundingHistory, candles] = await Promise.all([
    fetchBybitFundingHistory(row.rawSymbol, {
      cutoffTime,
      endTime: now,
      maxPages: maxHistoryPages,
      windowMs,
      signal: options.signal,
      request: options.request,
      cache: options.fundingCache,
    }),
    fetchBybitCandles(row.rawSymbol, interval, {
      startTime: cutoffTime,
      endTime: now,
      signal: options.signal,
      request: options.request,
      cache: options.candleCache,
    }).catch((error): CanonicalCandlePoint[] => {
      if (options.signal?.aborted) throw getAbortReason(options.signal);
      if (isAbortLikeError(error)) throw error;
      console.warn(`Bybit candle detail request failed for ${row.rawSymbol}; returning funding-only detail`, error);
      return [];
    }),
  ]);

  return {
    exchange: "bybit",
    transportMode: "native",
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingHistory,
    candles,
    lastSettlementRate: latestBybitFundingPoint(fundingHistory)?.fundingRate ?? null,
    bidAskSpread: computeBybitBboSpread(row.bestBid, row.bestAsk),
  };
}

export type BybitImpactSpreadResult = number | "insufficient" | null;

export function computeBybitImpactSpreadDetail(
  book: NormalizedBybitOrderBook,
  notionalUsd: number,
): OrderBookImpactDetailResult {
  return computeOrderBookImpactDetail({
    bids: book.bids.map((level) => ({ price: level.price, quantity: level.baseQty })),
    asks: book.asks.map((level) => ({ price: level.price, quantity: level.baseQty })),
  }, notionalUsd);
}

export function computeBybitImpactSpread(
  book: NormalizedBybitOrderBook,
  notionalUsd: number,
): BybitImpactSpreadResult {
  const detail = computeBybitImpactSpreadDetail(book, notionalUsd);
  if (detail === null || detail === "insufficient") return detail;
  return detail.spread;
}

export function fetchBybitImpactSpreadDetail(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  request?: BybitRequest,
  requestedLimit?: number,
): Promise<OrderBookImpactDetailResult>;
export function fetchBybitImpactSpreadDetail(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  requestedLimit?: number,
): Promise<OrderBookImpactDetailResult>;
export async function fetchBybitImpactSpreadDetail(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  requestOrLimit: BybitRequest | number = requestBybit,
  requestedLimit: number = resolveBybitImpactDepth(),
): Promise<OrderBookImpactDetailResult> {
  const request = typeof requestOrLimit === "function" ? requestOrLimit : requestBybit;
  const limit = typeof requestOrLimit === "number" ? requestOrLimit : requestedLimit;
  const book = await fetchBybitOrderBook(rawSymbol, limit, signal, request);
  return computeBybitImpactSpreadDetail(book, notionalUsd);
}

export function fetchBybitImpactSpread(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  request?: BybitRequest,
  requestedLimit?: number,
): Promise<BybitImpactSpreadResult>;
export function fetchBybitImpactSpread(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  requestedLimit?: number,
): Promise<BybitImpactSpreadResult>;
export async function fetchBybitImpactSpread(
  rawSymbol: string,
  notionalUsd: number,
  signal?: AbortSignal,
  requestOrLimit: BybitRequest | number = requestBybit,
  requestedLimit: number = resolveBybitImpactDepth(),
): Promise<BybitImpactSpreadResult> {
  const request = typeof requestOrLimit === "function" ? requestOrLimit : requestBybit;
  const limit = typeof requestOrLimit === "number" ? requestOrLimit : requestedLimit;
  const detail = await fetchBybitImpactSpreadDetail(rawSymbol, notionalUsd, signal, request, limit);
  if (detail === null || detail === "insufficient") return detail;
  return detail.spread;
}
