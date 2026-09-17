import type {
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";
import { runDirectFirst } from "@/lib/utils/direct-first";

export type OkxChartInterval = "1d" | "4h" | "1h" | "1m";

export const OKX_MIN_INTERVAL_MS = 200;
const OKX_MAX_ATTEMPTS = 3;
const OKX_DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;
const OKX_FUNDING_SNAPSHOT_TTL_MS = 10_000;
const OKX_API_BASE = "https://www.okx.com/api/v5";
export const OKX_DIRECT_TIMEOUT_MS = 10_000;

let okxFetchQueue: Promise<unknown> = Promise.resolve();
let lastOkxFetchAt = 0;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    function cleanup() {
      signal?.removeEventListener("abort", aborted);
    }
    function done() {
      cleanup();
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function rejectImmediatelyOnAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    function cleanup() {
      signal?.removeEventListener("abort", aborted);
    }
    function aborted() {
      cleanup();
      reject(abortError());
    }
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function throttleOkxFetch<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = async (): Promise<void> => {
    if (signal?.aborted) throw abortError();
    await waitWithSignal(Math.max(0, OKX_MIN_INTERVAL_MS - (Date.now() - lastOkxFetchAt)), signal);
    if (signal?.aborted) throw abortError();
    lastOkxFetchAt = Date.now();
  };

  const next = okxFetchQueue.then(run, run);
  okxFetchQueue = next.catch(() => undefined);
  await rejectImmediatelyOnAbort(next, signal);
  return task();
}

function parseOkxRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (retryAfterHeader !== null && retryAfterHeader.trim() !== "") {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 60_000);
    }
  }
  return null;
}

/** `attempt` is the zero-based retry index (0 for the first retry). */
export function computeOkxRetryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  return parseOkxRetryAfterMs(retryAfterHeader) ?? (attempt <= 0 ? 1_000 : 2_000);
}

function shouldRetryOkxResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

/**
 * Resolve the direct and proxy URLs for an OKX request.
 * Relative `/api/okx?endpoint=...` URLs are translated to the direct public
 * API so the browser can call OKX straight from the user's network (OKX
 * rejects some server egress IPs), while absolute URLs are used as-is.
 */
function resolveOkxEndpoints(input: RequestInfo | URL): { direct: string; proxy: string } {
  const raw = typeof input === "string" ? input : input.toString();
  if (!raw.startsWith("/api/okx")) return { direct: raw, proxy: raw };
  const question = raw.indexOf("?");
  const query = question >= 0 ? raw.slice(question + 1) : "";
  const params = new URLSearchParams(query);
  const endpoint = params.get("endpoint") ?? "";
  params.delete("endpoint");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return { direct: `${OKX_API_BASE}/${endpoint}${suffix}`, proxy: raw };
}

/** Gate all OKX HTTP attempt starts and retry direct responses. */
export async function okxFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retryDelays: readonly number[] = OKX_DEFAULT_RETRY_DELAYS_MS,
  directTimeoutMs = OKX_DIRECT_TIMEOUT_MS,
): Promise<Response> {
  const signal = init.signal ?? undefined;
  const { direct, proxy } = resolveOkxEndpoints(input);

  return runDirectFirst({
    signal,
    directTimeoutMs,
    direct: async (directSignal, reportResponse) => {
      for (let attempt = 0; attempt < OKX_MAX_ATTEMPTS; attempt += 1) {
        const directInit = { ...init, signal: directSignal };
        const response = await throttleOkxFetch(() => fetch(direct, directInit), directSignal);
        reportResponse?.(response);

        if (!shouldRetryOkxResponse(response) || attempt === OKX_MAX_ATTEMPTS - 1) {
          return response;
        }

        const retryAfterDelay = parseOkxRetryAfterMs(response.headers.get("Retry-After"));
        const delay = retryAfterDelay ?? retryDelays[attempt] ?? computeOkxRetryDelayMs(null, attempt);
        await waitWithSignal(Math.max(0, delay), directSignal);
        throwIfOkxAborted(directSignal);
      }

      throw new Error("OKX fetch exhausted unexpectedly");
    },
    // This is deliberately outside the direct retry loop: a direct 5xx, a
    // network failure, or a client timeout can cause at most one proxy call.
    proxy: () => throttleOkxFetch(() => fetch(proxy, { ...init, cache: "no-store" }), signal),
  });
}

function throwIfOkxAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

export interface OkxFundingMonitorRow {
  symbol: string;
  rawSymbol: string;
  marketKey: string;
  fundingRate: number;
  lastSettlementRate: number;
  settlementHydrationKey?: string;
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

export interface OkxDetailMetrics {
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

type OkxNativeFundingRateEntry = {
  instId?: string;
  instType?: string;
  fundingRate?: string;
  nextFundingRate?: string;
  fundingTime?: string;
  nextFundingTime?: string;
  settState?: string;
  settFundingRate?: string;
  markPx?: string;
  indexPx?: string;
  premium?: string;
  impactValue?: string;
};

type OkxNativeInstrumentEntry = {
  instId?: string;
  instType?: string;
  instCategory?: string;
  settleCcy?: string;
  quoteCcy?: string;
  baseCcy?: string;
  ctVal?: string;
  ctValCcy?: string;
  state?: string;
};

type OkxNativeTickerEntry = {
  instId?: string;
  last?: string;
  bidPx?: string;
  askPx?: string;
  vol24h?: string;
  volCcy24h?: string;
  open24h?: string;
};

type OkxNativeOpenInterestEntry = {
  instId?: string;
  oi?: string;
  oiUsd?: string;
};

type OkxNativeHistoryEntry = {
  instId?: string;
  fundingRate?: string;
  realizedRate?: string;
  fundingTime?: string;
};

type OkxNativeCandleRow = [string, string, string, string, string, string, string?, string?, string?];

type OkxNativeIndexTickerEntry = {
  instId?: string;
  idxPx?: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseFundingIntervalSecondsFromNative(entry: OkxNativeFundingRateEntry): number {
  const fundingTime = toNumber(entry.fundingTime);
  const nextFundingTime = toNumber(entry.nextFundingTime);
  if (fundingTime > 0 && nextFundingTime > fundingTime) {
    return Math.round((nextFundingTime - fundingTime) / 1000);
  }
  return 8 * 60 * 60;
}

function computeChangePercent(last: number, open24h: number): number {
  if (!Number.isFinite(last) || !Number.isFinite(open24h) || open24h === 0) {
    return 0;
  }
  return ((last - open24h) / open24h) * 100;
}

const OKX_INST_CATEGORY_LABELS: Record<string, string> = {
  "1": "Crypto",
  "3": "股票/指数",
  "4": "商品",
  "5": "外汇",
  "6": "债券",
};

const OKX_COMMODITY_OVERRIDES = new Set(["XAU", "XAG", "BZ", "CL"]);

function getOkxAssetCategory(instId: string, instCategory?: string): string {
  const base = instId.split("-")[0]?.toUpperCase() ?? instId.toUpperCase();
  if (OKX_COMMODITY_OVERRIDES.has(base)) {
    return "商品";
  }

  const key = (instCategory ?? "").trim();
  if (!key) {
    return "其他";
  }

  return OKX_INST_CATEGORY_LABELS[key] ?? key;
}

function computeOkxQuoteAmount(
  ticker: OkxNativeTickerEntry | undefined,
  instrument: OkxNativeInstrumentEntry | undefined,
  lastPrice: number,
): number {
  const baseAmount = parseOptionalNumber(ticker?.volCcy24h);
  if (baseAmount !== null && Number.isFinite(lastPrice)) {
    return baseAmount * lastPrice;
  }

  const contractVolume = parseOptionalNumber(ticker?.vol24h);
  const contractValue = parseOptionalNumber(instrument?.ctVal);
  if (contractVolume !== null && contractValue !== null && Number.isFinite(lastPrice)) {
    return contractVolume * contractValue * lastPrice;
  }

  if (contractVolume !== null && Number.isFinite(lastPrice)) {
    return contractVolume * lastPrice;
  }

  return 0;
}

function toOkxBar(interval: OkxChartInterval): string {
  if (interval === "4h") return "4H";
  if (interval === "1h") return "1H";
  if (interval === "1m") return "1m";
  return "1Dutc";
}

export const OKX_FUNDING_HISTORY_PAGE_SIZE = 400;
export const OKX_FUNDING_HISTORY_MAX_PAGES = 100;
const DEFAULT_OKX_FUNDING_HISTORY_DAYS = 30;

export async function fetchOkxFundingHistory(
  rawSymbol: string,
  fundingIntervalSeconds?: number,
  signal?: AbortSignal,
  days?: number,
  cutoffTimestampMs?: number,
  requireCutoffCoverage = false,
  asOfTimestampMs?: number,
): Promise<CanonicalFundingHistoryPoint[]> {
  // Keep the interval argument for call-site compatibility, but history
  // coverage must be based on elapsed time. A symbol can change from 8h to 1h
  // funding without the detail request changing its shape.
  void fundingIntervalSeconds;
  const targetDays = days && days > 0 ? days : DEFAULT_OKX_FUNDING_HISTORY_DAYS;
  const requestStartedAt = Number.isFinite(asOfTimestampMs) ? asOfTimestampMs as number : Date.now();
  const cutoff = Number.isFinite(cutoffTimestampMs)
    ? (cutoffTimestampMs as number)
    : requestStartedAt - targetDays * 24 * 60 * 60 * 1000;
  const collected = new Map<number, number>();
  let cursor: string | null = null;
  let previousOldestTimestamp: number | null = null;
  let reachedCutoff = false;

  for (let page = 0; page < OKX_FUNDING_HISTORY_MAX_PAGES; page += 1) {
    const search = new URLSearchParams({
      endpoint: "public/funding-rate-history",
      instId: rawSymbol,
      limit: String(OKX_FUNDING_HISTORY_PAGE_SIZE),
    });

    if (cursor) {
      search.set("after", cursor);
    }

    let response: Response;
    try {
      response = await okxFetch(`/api/okx?${search.toString()}`, { cache: "no-store", signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requireCutoffCoverage) return [];
      throw error;
    }
    if (!response.ok) {
      if (requireCutoffCoverage) return [];
      throw okxEndpointError("public/funding-rate-history", `request failed (HTTP ${response.status})`);
    }

    let payload: { data?: OkxNativeHistoryEntry[] };
    try {
      payload = (await response.json()) as { data?: OkxNativeHistoryEntry[] };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requireCutoffCoverage) return [];
      throw error;
    }
    if (!Array.isArray(payload.data)) {
      if (requireCutoffCoverage) return [];
      throw okxEndpointError("public/funding-rate-history", "response malformed (expected data array)");
    }
    const rows = payload.data;
    if (rows.length === 0) {
      break;
    }

    let oldestTimestamp: number | null = null;

    for (const item of rows) {
      const timestamp = toNumber(item.fundingTime);
      if (timestamp <= 0) {
        continue;
      }

      if (oldestTimestamp === null || timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
      }

      if (!collected.has(timestamp)) {
        const rate = parseOptionalNumber(item.realizedRate) ?? parseOptionalNumber(item.fundingRate);
        if (rate === null) continue;
        collected.set(timestamp, rate);
      }
    }

    if (oldestTimestamp !== null && oldestTimestamp <= cutoff) {
      reachedCutoff = true;
      break;
    }

    if (oldestTimestamp === null) {
      break;
    }

    // Gate/OKX-style cursor endpoints can return the boundary row again. If
    // the cursor did not move, stop rather than spending the whole page budget
    // on identical responses.
    if (previousOldestTimestamp !== null && oldestTimestamp >= previousOldestTimestamp) {
      break;
    }
    previousOldestTimestamp = oldestTimestamp;

    if (rows.length < OKX_FUNDING_HISTORY_PAGE_SIZE) {
      break;
    }

    cursor = String(oldestTimestamp);
  }

  if (requireCutoffCoverage && !reachedCutoff) {
    return [];
  }

  return Array.from(collected.entries())
    .filter(([timestamp]) => timestamp >= cutoff && timestamp <= requestStartedAt)
    .map(([timestamp, fundingRate]) => ({ timestamp, fundingRate }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

let fundingSnapshotCache: { value: Map<string, OkxNativeFundingRateEntry>; expiresAt: number } | null = null;
let fundingSnapshotInFlight: Promise<Map<string, OkxNativeFundingRateEntry>> | null = null;

function okxEndpointError(endpoint: string, detail: string): Error {
  return new Error(`OKX ${endpoint} ${detail}`);
}

async function readOkxDataArray<T>(response: Response, endpoint: string): Promise<T[]> {
  if (!response.ok) {
    throw okxEndpointError(endpoint, `request failed (HTTP ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw okxEndpointError(endpoint, "response malformed (invalid JSON)");
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw okxEndpointError(endpoint, "response malformed (expected data array)");
  }

  return (payload as { data: T[] }).data;
}

function warnOkxOptionalDegradation(endpoint: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[OKX] ${endpoint} degraded: ${detail}`);
}

function requireUsableOkxRows<T>(
  rows: T[],
  endpoint: string,
  isUsable: (row: T) => boolean,
  detail: string,
): T[] {
  const usableRows = rows.filter(isUsable);
  if (usableRows.length === 0) {
    throw okxEndpointError(endpoint, detail);
  }
  return usableRows;
}

export function clearOkxFundingSnapshotCache(): void {
  fundingSnapshotCache = null;
  fundingSnapshotInFlight = null;
}

export async function fetchNativeFundingSnapshot(
  signal?: AbortSignal,
  ttlMs: number = OKX_FUNDING_SNAPSHOT_TTL_MS,
): Promise<Map<string, OkxNativeFundingRateEntry>> {
  if (signal?.aborted) throw abortError();
  if (fundingSnapshotCache && Date.now() < fundingSnapshotCache.expiresAt) {
    return rejectImmediatelyOnAbort(Promise.resolve(fundingSnapshotCache.value), signal);
  }
  if (fundingSnapshotInFlight) {
    return rejectImmediatelyOnAbort(fundingSnapshotInFlight, signal);
  }

  const request = (async () => {
    // This request intentionally has no caller signal: it is shared by all
    // snapshot consumers, while each consumer races it against its own signal.
    const response = await okxFetch("/api/okx?endpoint=public/funding-rate&instId=ANY", { cache: "no-store" });
    const rows = await readOkxDataArray<OkxNativeFundingRateEntry>(response, "public/funding-rate");
    const usableRows = requireUsableOkxRows(
      rows,
      "public/funding-rate",
      (row) => typeof row.instId === "string" && row.instId.length > 0,
      "response contained no usable funding rows",
    );
    return new Map(usableRows.map((row) => [row.instId as string, row]));
  })();
  fundingSnapshotInFlight = request;
  void request.then(
    (value) => {
      // A cache clear invalidates an older in-flight request as well.
      if (fundingSnapshotInFlight === request) {
        fundingSnapshotCache = { value, expiresAt: Date.now() + Math.max(0, ttlMs) };
      }
    },
    () => {
      if (fundingSnapshotInFlight === request) fundingSnapshotCache = null;
    },
  ).then(() => {
    if (fundingSnapshotInFlight === request) fundingSnapshotInFlight = null;
  }).catch(() => undefined);
  return rejectImmediatelyOnAbort(request, signal);
}

async function fetchNativeInstruments(signal?: AbortSignal): Promise<Map<string, OkxNativeInstrumentEntry>> {
  const response = await okxFetch("/api/okx?endpoint=public/instruments&instType=SWAP", { cache: "no-store", signal });
  const rows = await readOkxDataArray<OkxNativeInstrumentEntry>(response, "public/instruments");
  throwIfOkxAborted(signal);
  const usableRows = requireUsableOkxRows(
    rows,
    "public/instruments",
    (row) => row.instId?.endsWith("-USDT-SWAP") === true && row.state === "live",
    "response contained no live USDT swap instruments",
  );
  return new Map(
    usableRows
      .map((row) => [row.instId as string, row]),
  );
}

async function fetchNativeTickers(signal?: AbortSignal): Promise<Map<string, OkxNativeTickerEntry>> {
  const response = await okxFetch("/api/okx?endpoint=market/tickers&instType=SWAP", { cache: "no-store", signal });
  const rows = await readOkxDataArray<OkxNativeTickerEntry>(response, "market/tickers");
  throwIfOkxAborted(signal);
  const usableRows = requireUsableOkxRows(
    rows,
    "market/tickers",
    (row) => row.instId?.endsWith("-USDT-SWAP") === true,
    "response contained no usable USDT swap tickers",
  );
  return new Map(usableRows.map((row) => [row.instId as string, row]));
}

async function fetchNativeOpenInterest(signal?: AbortSignal): Promise<Map<string, OkxNativeOpenInterestEntry>> {
  try {
    const response = await okxFetch("/api/okx?endpoint=public/open-interest&instType=SWAP", { cache: "no-store", signal });
    const rows = await readOkxDataArray<OkxNativeOpenInterestEntry>(response, "public/open-interest");
    return new Map(rows.filter((row) => row.instId).map((row) => [row.instId as string, row]));
  } catch (error) {
    if (signal?.aborted) throwIfOkxAborted(signal);
    warnOkxOptionalDegradation("public/open-interest", error);
    return new Map();
  }
}

async function fetchNativeIndexPrices(signal?: AbortSignal): Promise<Map<string, number>> {
  try {
    const response = await okxFetch("/api/okx?endpoint=market/index-tickers&quoteCcy=USDT", {
      cache: "no-store",
      signal,
    });
    const rows = await readOkxDataArray<OkxNativeIndexTickerEntry>(response, "market/index-tickers");
    const result = new Map<string, number>();
    for (const row of rows) {
      if (!row.instId || !row.idxPx) continue;
      const price = parseOptionalNumber(row.idxPx);
      if (price != null && price > 0) {
        result.set(row.instId, price);
      }
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throwIfOkxAborted(signal);
    warnOkxOptionalDegradation("market/index-tickers", error);
    return new Map();
  }
}

async function fetchNativeRates(signal?: AbortSignal): Promise<CanonicalFundingRateRow[]> {
  const [fundingSnapshot, instruments, tickers, openInterest, indexPrices] = await Promise.all([
    fetchNativeFundingSnapshot(signal),
    fetchNativeInstruments(signal),
    fetchNativeTickers(signal),
    fetchNativeOpenInterest(signal),
    fetchNativeIndexPrices(signal),
  ]);
  throwIfOkxAborted(signal);

  return Array.from(fundingSnapshot.entries())
    .filter(([instId, row]) => (
      instId.endsWith("-USDT-SWAP")
      && row.instType === "SWAP"
      && parseOptionalNumber(row.fundingRate) !== null
    ))
    .map(([instId, funding]) => {
      const instrument = instruments.get(instId);
      const ticker = tickers.get(instId);
      const oi = openInterest.get(instId);
      const symbol = instId.replace(/-USDT-SWAP$/i, "");
      const markPrice = parseOptionalNumber(funding.markPx) ?? parseOptionalNumber(ticker?.last) ?? 0;
      const lastPrice = parseOptionalNumber(ticker?.last) ?? markPrice;
      const open24h = parseOptionalNumber(ticker?.open24h) ?? 0;

      const indexPrice = indexPrices.get(`${symbol}-USDT`) ?? parseOptionalNumber(funding.indexPx);

      return {
        exchange: "okx",
        transportMode: "native",
        symbol,
        rawSymbol: instId,
        marketKey: instId,
        settlementHydrationKey: `okx:${instId}`,
        fundingRate: parseOptionalNumber(funding.fundingRate) as number,
        // fundingRate is the rate for the upcoming settlement at fundingTime.
        // nextFundingRate describes the following period and is not the
        // next-settlement estimate requested by Search.
        predictedFundingRate: parseOptionalNumber(funding.fundingRate),
        lastSettlementRate: funding.settState === "settled" ? parseOptionalNumber(funding.settFundingRate) : null,
        markPrice,
        indexPrice,
        lastPrice,
        change24h: computeChangePercent(lastPrice, open24h),
        quoteVolume: computeOkxQuoteAmount(ticker, instrument, lastPrice),
        openInterest: parseOptionalNumber(oi?.oi) ?? 0,
        notionalValue: parseOptionalNumber(oi?.oiUsd) ?? ((parseOptionalNumber(oi?.oi) ?? 0) * markPrice),
        fundingIntervalSeconds: parseFundingIntervalSecondsFromNative(funding),
        assetCategory: getOkxAssetCategory(instId, instrument?.instCategory),
        bestBid: parseOptionalNumber(ticker?.bidPx),
        bestAsk: parseOptionalNumber(ticker?.askPx),
      } satisfies CanonicalFundingRateRow;
    });
}

export async function fetchOkxCanonicalRates(signal?: AbortSignal): Promise<CanonicalFundingRateRow[]> {
  return fetchNativeRates(signal);
}

export async function fetchOkxFundingMonitorRates(): Promise<OkxFundingMonitorRow[]> {
  return (await fetchOkxCanonicalRates()).map((row) => ({
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingRate: row.fundingRate,
    lastSettlementRate: Number.isFinite(row.lastSettlementRate) ? (row.lastSettlementRate as number) : Number.NaN,
    settlementHydrationKey: row.settlementHydrationKey,
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
  }));
}

export async function hydrateOkxLatestSettlementRates(symbols: string[], signal?: AbortSignal): Promise<Map<string, number>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const rows = await fetchOkxCanonicalRates(signal);
  const targetSet = new Set(symbols);
  return new Map(
    rows
      .filter((row) => targetSet.has(row.symbol) && Number.isFinite(row.lastSettlementRate))
      .map((row) => [row.symbol, row.lastSettlementRate as number]),
  );
}

export async function fetchOkxCanonicalDetail(
  rawSymbol: string,
  interval: OkxChartInterval,
  fundingIntervalSeconds?: number,
  signal?: AbortSignal,
  options: { now?: number; asOf?: number } | number = {},
): Promise<CanonicalFundingDetail> {
  const asOf = typeof options === "number"
    ? options
    : options.asOf ?? options.now;
  const asOfMs = Number.isFinite(asOf) ? asOf as number : Date.now();
  const historicalSettlementBufferMs = 8 * 60 * 60 * 1000;
  const cutoffTimestamp = asOfMs - 30 * 24 * 60 * 60 * 1000 - historicalSettlementBufferMs;
  const [historyResult, candlesResult, snapshotResult] = await rejectImmediatelyOnAbort(Promise.allSettled([
    fetchOkxFundingHistory(rawSymbol, fundingIntervalSeconds, signal, 30, cutoffTimestamp, false, asOfMs),
    okxFetch(`/api/okx?endpoint=market/history-candles&instId=${encodeURIComponent(rawSymbol)}&bar=${encodeURIComponent(toOkxBar(interval))}&limit=300`, { cache: "no-store", signal }),
    fetchNativeFundingSnapshot(signal),
  ]), signal);
  throwIfOkxAborted(signal);

  const fundingHistory = historyResult.status === "fulfilled" ? historyResult.value : [];
  if (historyResult.status === "rejected") {
    console.warn("[OKX] public/funding-rate-history detail branch failed:", historyResult.reason);
  }

  let candleRows: OkxNativeCandleRow[] = [];
  if (candlesResult.status === "fulfilled") {
    try {
      candleRows = await readOkxDataArray<OkxNativeCandleRow>(candlesResult.value, "market/history-candles");
    } catch (error) {
      throwIfOkxAborted(signal);
      console.warn("[OKX] market/history-candles detail branch failed:", error);
    }
  } else {
    console.warn("[OKX] market/history-candles detail branch failed:", candlesResult.reason);
  }
  throwIfOkxAborted(signal);

  const candles = candleRows
    .map((item) => ({
      openTime: toNumber(item[0]),
      closeTime: toNumber(item[0]),
      open: String(item[1] ?? 0),
      high: String(item[2] ?? 0),
      low: String(item[3] ?? 0),
      close: String(item[4] ?? 0),
      volume: String(item[6] ?? 0),
      ...(item[7] === undefined || item[7] === null ? {} : { quoteVolume: String(item[7]) }),
    }))
    .filter((item) => item.openTime > 0)
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-30);

  const native = snapshotResult.status === "fulfilled" ? snapshotResult.value.get(rawSymbol) : undefined;
  if (snapshotResult.status === "rejected") {
    console.warn("[OKX] public/funding-rate detail branch failed:", snapshotResult.reason);
  }
  const latestHistory = fundingHistory.length > 0 ? fundingHistory[fundingHistory.length - 1] : null;

  return {
    exchange: "okx",
    transportMode: "native",
    symbol: rawSymbol.replace(/-USDT-SWAP$/i, ""),
    rawSymbol,
    marketKey: rawSymbol,
    fundingHistory,
    candles,
    // The history endpoint is the source of truth for the latest settled
    // point.  Snapshot settlement is only a fallback when history is empty.
    lastSettlementRate:
      latestHistory?.fundingRate
      ?? (native && native.settState === "settled" ? parseOptionalNumber(native.settFundingRate) : null),
    bidAskSpread: null,
  } satisfies CanonicalFundingDetail;
}

export function computeOkxAverageFundingRatesByInterval(
  history: CanonicalFundingHistoryPoint[],
  interval: OkxChartInterval,
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

export function mapOkxDetailToMetrics(detail: CanonicalFundingDetail): OkxDetailMetrics {
  return {
    candles: detail.candles,
    fundingHistory: detail.fundingHistory,
    lastSettlementRate: detail.lastSettlementRate,
  };
}
