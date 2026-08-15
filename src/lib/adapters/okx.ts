import type {
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";

export type OkxChartInterval = "1d" | "4h" | "1h" | "1m";

export const OKX_MIN_INTERVAL_MS = 200;
const OKX_MAX_ATTEMPTS = 3;
const OKX_DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;
const OKX_FUNDING_SNAPSHOT_TTL_MS = 10_000;
const OKX_API_BASE = "https://www.okx.com/api/v5";

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
  const run = async (): Promise<T> => {
    if (signal?.aborted) throw abortError();
    await waitWithSignal(Math.max(0, OKX_MIN_INTERVAL_MS - (Date.now() - lastOkxFetchAt)), signal);
    if (signal?.aborted) throw abortError();
    lastOkxFetchAt = Date.now();
    return task();
  };

  const next = okxFetchQueue.then(run, run);
  okxFetchQueue = next.catch(() => undefined);
  return rejectImmediatelyOnAbort(next, signal);
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

/**
 * Fetch once for a resolved OKX request: try the direct URL first, and only
 * fall back to the proxy when the direct request throws (CORS/network).
 * Direct HTTP responses are authoritative so the retry loop sees the real
 * upstream status.
 */
async function okxFetchOnce(direct: string, proxy: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(direct, init);
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return fetch(proxy, { ...init, cache: "no-store" });
  }
}

/** Serialize and retry all OKX HTTP attempts to smooth client-side request bursts. */
export async function okxFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retryDelays: readonly number[] = OKX_DEFAULT_RETRY_DELAYS_MS,
): Promise<Response> {
  const signal = init.signal ?? undefined;
  const { direct, proxy } = resolveOkxEndpoints(input);

  for (let attempt = 0; attempt < OKX_MAX_ATTEMPTS; attempt += 1) {
    const response = await throttleOkxFetch(() => okxFetchOnce(direct, proxy, init), signal);
    if (!shouldRetryOkxResponse(response) || attempt === OKX_MAX_ATTEMPTS - 1) {
      return response;
    }

    const retryAfterDelay = parseOkxRetryAfterMs(response.headers.get("Retry-After"));
    const delay = retryAfterDelay ?? retryDelays[attempt] ?? computeOkxRetryDelayMs(null, attempt);
    await waitWithSignal(Math.max(0, delay), signal);
  }

  throw new Error("OKX fetch exhausted unexpectedly");
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
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
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

function getRequiredOkxFundingHistoryRows(fundingIntervalSeconds?: number, days?: number): number {
  const interval = fundingIntervalSeconds && fundingIntervalSeconds > 0 ? fundingIntervalSeconds : 8 * 60 * 60;
  const targetDays = days && days > 0 ? days : 30;
  return Math.ceil((targetDays * 24 * 60 * 60) / interval) + 1;
}

export async function fetchOkxFundingHistory(
  rawSymbol: string,
  fundingIntervalSeconds?: number,
  signal?: AbortSignal,
  days?: number,
): Promise<CanonicalFundingHistoryPoint[]> {
  const pageSize = 400;
  const requiredRows = getRequiredOkxFundingHistoryRows(fundingIntervalSeconds, days);
  const pagesNeeded = Math.max(1, Math.ceil(requiredRows / pageSize));
  const collected = new Map<number, number>();
  let cursor: string | null = null;

  for (let page = 0; page < pagesNeeded; page += 1) {
    const search = new URLSearchParams({
      endpoint: "public/funding-rate-history",
      instId: rawSymbol,
      limit: String(pageSize),
    });

    if (cursor) {
      search.set("after", cursor);
    }

    const response = await okxFetch(`/api/okx?${search.toString()}`, { cache: "no-store", signal });
    if (!response.ok) {
      throw new Error("Failed to fetch OKX funding history");
    }

    const payload = (await response.json()) as { data?: OkxNativeHistoryEntry[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];
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
        const rate = parseOptionalNumber(item.realizedRate) ?? parseOptionalNumber(item.fundingRate) ?? 0;
        collected.set(timestamp, rate);
      }
    }

    if (rows.length < pageSize || oldestTimestamp === null) {
      break;
    }

    cursor = String(oldestTimestamp);
  }

  return Array.from(collected.entries())
    .map(([timestamp, fundingRate]) => ({ timestamp, fundingRate }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

let fundingSnapshotCache: { value: Map<string, OkxNativeFundingRateEntry>; expiresAt: number } | null = null;
let fundingSnapshotInFlight: Promise<Map<string, OkxNativeFundingRateEntry>> | null = null;

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
    return fundingSnapshotCache.value;
  }
  if (fundingSnapshotInFlight) {
    return rejectImmediatelyOnAbort(fundingSnapshotInFlight, signal);
  }

  let cacheable = false;
  const request = (async () => {
    const response = await okxFetch("/api/okx?endpoint=public/funding-rate&instId=ANY", { cache: "no-store", signal });
    if (!response.ok) return new Map<string, OkxNativeFundingRateEntry>();

    const payload = (await response.json()) as { data?: OkxNativeFundingRateEntry[] };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    cacheable = true;
    return new Map(rows.filter((row) => row.instId).map((row) => [row.instId as string, row]));
  })();
  fundingSnapshotInFlight = request;
  void request.then(
    (value) => {
      if (cacheable) fundingSnapshotCache = { value, expiresAt: Date.now() + Math.max(0, ttlMs) };
    },
    () => {
      fundingSnapshotCache = null;
    },
  ).finally(() => {
    if (fundingSnapshotInFlight === request) fundingSnapshotInFlight = null;
  });
  return request;
}

async function fetchNativeInstruments(signal?: AbortSignal): Promise<Map<string, OkxNativeInstrumentEntry>> {
  const response = await okxFetch("/api/okx?endpoint=public/instruments&instType=SWAP", { cache: "no-store", signal });
  if (!response.ok) {
    return new Map();
  }

  const payload = (await response.json()) as { data?: OkxNativeInstrumentEntry[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return new Map(
    rows
      .filter((row) => row.instId?.endsWith("-SWAP") && row.state === "live")
      .map((row) => [row.instId as string, row]),
  );
}

async function fetchNativeTickers(signal?: AbortSignal): Promise<Map<string, OkxNativeTickerEntry>> {
  const response = await okxFetch("/api/okx?endpoint=market/tickers&instType=SWAP", { cache: "no-store", signal });
  if (!response.ok) {
    return new Map();
  }

  const payload = (await response.json()) as { data?: OkxNativeTickerEntry[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return new Map(rows.filter((row) => row.instId).map((row) => [row.instId as string, row]));
}

async function fetchNativeOpenInterest(signal?: AbortSignal): Promise<Map<string, OkxNativeOpenInterestEntry>> {
  const response = await okxFetch("/api/okx?endpoint=public/open-interest&instType=SWAP", { cache: "no-store", signal });
  if (!response.ok) {
    return new Map();
  }

  const payload = (await response.json()) as { data?: OkxNativeOpenInterestEntry[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return new Map(rows.filter((row) => row.instId).map((row) => [row.instId as string, row]));
}

async function fetchNativeIndexPrices(signal?: AbortSignal): Promise<Map<string, number>> {
  const response = await okxFetch("/api/okx?endpoint=market/index-tickers&quoteCcy=USDT", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    return new Map();
  }

  const payload = (await response.json()) as { data?: OkxNativeIndexTickerEntry[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.instId || !row.idxPx) continue;
    const price = parseOptionalNumber(row.idxPx);
    if (price != null && price > 0) {
      result.set(row.instId, price);
    }
  }
  return result;
}

async function fetchNativeRates(signal?: AbortSignal): Promise<CanonicalFundingRateRow[]> {
  const [fundingSnapshot, instruments, tickers, openInterest, indexPrices] = await Promise.all([
    fetchNativeFundingSnapshot(signal),
    fetchNativeInstruments(signal),
    fetchNativeTickers(signal),
    fetchNativeOpenInterest(signal),
    fetchNativeIndexPrices(signal),
  ]);

  return Array.from(fundingSnapshot.entries())
    .filter(([instId, row]) => instId.endsWith("-USDT-SWAP") && row.instType === "SWAP")
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
        fundingRate: parseOptionalNumber(funding.fundingRate) ?? 0,
        predictedFundingRate: parseOptionalNumber(funding.nextFundingRate),
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
): Promise<CanonicalFundingDetail> {
  const [fundingHistory, candlesRes, snapshot] = await Promise.all([
    fetchOkxFundingHistory(rawSymbol, fundingIntervalSeconds, signal),
    okxFetch(`/api/okx?endpoint=market/history-candles&instId=${encodeURIComponent(rawSymbol)}&bar=${encodeURIComponent(toOkxBar(interval))}&limit=300`, { cache: "no-store", signal }),
    fetchNativeFundingSnapshot(signal),
  ]);

  if (!candlesRes.ok) {
    throw new Error("Failed to fetch OKX native detail data");
  }

  const candlePayload = (await candlesRes.json()) as { data?: OkxNativeCandleRow[] };
  const candleRows = Array.isArray(candlePayload.data) ? candlePayload.data : [];

  const candles = candleRows
    .map((item) => ({
      openTime: toNumber(item[0]),
      closeTime: toNumber(item[0]),
      open: String(item[1] ?? 0),
      high: String(item[2] ?? 0),
      low: String(item[3] ?? 0),
      close: String(item[4] ?? 0),
      volume: String(item[7] ?? item[6] ?? item[5] ?? 0),
    }))
    .filter((item) => item.openTime > 0)
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-30);

  const native = snapshot.get(rawSymbol);
  const latestHistory = fundingHistory.length > 0 ? fundingHistory[fundingHistory.length - 1] : null;

  return {
    exchange: "okx",
    transportMode: "native",
    symbol: rawSymbol.replace(/-USDT-SWAP$/i, ""),
    rawSymbol,
    marketKey: rawSymbol,
    fundingHistory,
    candles,
    lastSettlementRate:
      native && native.settState === "settled"
        ? parseOptionalNumber(native.settFundingRate) ?? latestHistory?.fundingRate ?? null
        : latestHistory?.fundingRate ?? null,
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
