import { isAbortLikeError, sleep, throwIfAborted } from "./utils/abort";
import { runDirectFirst } from "./utils/direct-first";

export interface FundingRate {
  coin: string;
  fundingRate: string;
  predictedFundingRate?: string | number;
  markPrice: string;
  indexPrice: string;
  premium: string;
  openInterest: string;
  dayVolume: string;
  prevDayPx: string;
  isSpot?: boolean;
  avg7d?: number;
  avg30d?: number;
  bestBid?: string;  // 最佳买价
  bestAsk?: string;  // 最佳卖价
  midPrice?: string; // 中间价
}

export interface FundingHistoryItem {
  time: number;
  coin: string;
  fundingRate: string;
  premium: string;
  markPrice?: string;
  indexPrice?: string;
}

export interface CandleSnapshotItem {
  openTime: number;
  closeTime: number;
  coin: string;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
}

export interface DailyFundingRateItem {
  dayStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

export type ChartInterval = "1d" | "4h" | "1h" | "1m";

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

export interface MarketInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

interface AssetContext {
  funding: string | number;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: string[] | null;
  dayBaseVlm: string;
}

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const HYPERLIQUID_PROXY_URL = "/api/hyperliquid";
const DIRECT_TIMEOUT_MS = 10_000;

function createDirectSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(DIRECT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function hyperliquidHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * The direct leg owns retries for transient upstream responses. Keeping the
 * final response (rather than throwing it) is important: runDirectFirst can
 * then distinguish a final 429 (no proxy) from a final 5xx (proxy).
 */
async function fetchHyperliquidResponse(
  body: Record<string, unknown>,
  maxAttempts: number,
  signal?: AbortSignal,
): Promise<Response> {
  const serializedBody = JSON.stringify(body);
  const init = {
    method: "POST",
    headers: hyperliquidHeaders(),
    body: serializedBody,
  } satisfies RequestInit;

  const direct = async (directSignal?: AbortSignal, reportResponse?: (response: Response) => void): Promise<Response> => {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(directSignal);
      const requestSignal = createDirectSignal(directSignal);

      try {
        const response = await fetch(HYPERLIQUID_INFO_URL, {
          ...init,
          signal: requestSignal,
        });
        reportResponse?.(response);

        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < maxAttempts - 1
        ) {
          await sleep(250 * (attempt + 1), directSignal);
          continue;
        }

        return response;
      } catch (error) {
        if (directSignal?.aborted) {
          throwIfAborted(directSignal);
        }

        lastError = error;
        if (attempt >= maxAttempts - 1) {
          throw error;
        }

        // Preserve the old retry count for network and client-timeout errors.
        await sleep(250 * (attempt + 1), directSignal);
      }
    }

    throw lastError ?? new Error("Hyperliquid direct request failed");
  };

  return runDirectFirst({
    signal,
    direct,
    proxy: () => fetch(HYPERLIQUID_PROXY_URL, { ...init, signal, cache: "no-store" }),
  });
}

export async function fetchHyperliquidInfo<T>(
  body: Record<string, unknown>,
  maxAttempts: number = 3,
  signal?: AbortSignal,
): Promise<T | null> {
  if (maxAttempts <= 0) {
    return null;
  }

  try {
    throwIfAborted(signal);
    const response = await fetchHyperliquidResponse(body, maxAttempts, signal);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return null;
    }

    console.error("Error fetching Hyperliquid info:", error);
    return null;
  }
}

/**
 * Fetch the full L2 order book for a coin.
 */
export async function fetchL2Book(
  coin: string,
  signal?: AbortSignal,
): Promise<{ levels: Array<Array<{ px: string; sz: string; n: number }>> } | null> {
  try {
    const data = await fetchHyperliquidInfo<{
      coin: string;
      levels: Array<Array<{ px: string; sz: string; n: number }>>;
    }>({ type: "l2Book", coin }, 3, signal);

    if (!data?.levels || data.levels.length < 2) {
      return null;
    }

    return { levels: data.levels };
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return null;
    }
    console.error(`Error fetching full l2Book for ${coin}:`, error);
    return null;
  }
}

/**
 * Fetch the real top-of-book best bid/ask from the l2Book endpoint.
 * Returns { bestBid, bestAsk } or null if the request fails.
 * Unlike impactPxs (which are depth-weighted prices), this gives the true
 * top-of-book prices matching what the Hyperliquid website displays.
 */
export async function fetchL2BookBestBidAsk(
  coin: string,
  signal?: AbortSignal,
): Promise<{ bestBid: number; bestAsk: number } | null> {
  try {
    const data = await fetchL2Book(coin, signal);

    if (!data?.levels || data.levels.length < 2) {
      return null;
    }

    const bestBidStr = data.levels[0]?.[0]?.px;
    const bestAskStr = data.levels[1]?.[0]?.px;

    if (!bestBidStr || !bestAskStr) {
      return null;
    }

    const bestBid = Number.parseFloat(bestBidStr);
    const bestAsk = Number.parseFloat(bestAskStr);

    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
      return null;
    }

    return { bestBid, bestAsk };
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return null;
    }
    console.error(`Error fetching l2Book for ${coin}:`, error);
    return null;
  }
}

// HIP-3 assets are now discovered dynamically from the API response.
// No hardcoded list needed — all assets returned by metaAndAssetCtxs are included automatically.

const INTERVAL_MS: Record<ChartInterval, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1m": 60 * 1000,
};

function isValidLiveFundingRate(value: unknown): value is string | number {
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value !== "string" && typeof value !== "number") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

function getHlPerpPredictions(data: unknown): Map<string, string | number> {
  if (!Array.isArray(data)) return new Map();

  const result = new Map<string, string | number>();

  for (const entry of data) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].trim() === "") continue;
    if (!Array.isArray(entry[1])) continue;

    const hlPerp = entry[1].find((venue) =>
      Array.isArray(venue) && venue[0] === "HlPerp" && venue[1] !== null && typeof venue[1] === "object",
    );
    if (!Array.isArray(hlPerp)) continue;
    const prediction = hlPerp[1] as Record<string, unknown>;
    if (!isValidLiveFundingRate(prediction.fundingRate)) continue;
    result.set(entry[0], prediction.fundingRate);
  }

  return result;
}

export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const [data, predictedFundings] = await Promise.all([
      fetchHyperliquidInfo<any[]>({ type: "metaAndAssetCtxs" }, 2),
      fetchHyperliquidInfo<unknown[]>({ type: "predictedFundings" }, 2),
    ]);

    if (!data) {
      throw new Error("Failed to fetch funding rates");
    }
    const hlPerpPredictions = getHlPerpPredictions(predictedFundings);
    const meta = data[0];
    const assetCtxs: AssetContext[] = data[1];

    if (!meta?.universe || !assetCtxs) {
      throw new Error("Invalid response format");
    }

    return meta.universe.flatMap((market: MarketInfo, index: number) => {
      const ctx = assetCtxs[index];
      if (!isValidLiveFundingRate(ctx?.funding)) return [];

      const predictedFundingRate = hlPerpPredictions.get(market.name);
      return [{
        coin: market.name,
        fundingRate: String(ctx.funding),
        ...(predictedFundingRate === undefined ? {} : { predictedFundingRate }),
        markPrice: ctx?.markPx || "0",
        indexPrice: ctx?.oraclePx || "0",
        premium: ctx?.premium || "0",
        openInterest: ctx?.openInterest || "0",
        dayVolume: ctx?.dayNtlVlm || "0",
        prevDayPx: ctx?.prevDayPx || "0",
        isSpot: false,
        bestBid: ctx?.impactPxs?.[0] || undefined,
        bestAsk: ctx?.impactPxs?.[1] || undefined,
        midPrice: ctx?.midPx || undefined,
      }];
    });
  } catch (error) {
    console.error("Error fetching funding rates:", error);
    return [];
  }
}

async function getHip3MarketData(dex: "xyz" | "para" | "hyna"): Promise<Map<string, Partial<FundingRate>>> {
  try {
    const data = await fetchHyperliquidInfo<any[]>(
      { type: "metaAndAssetCtxs", dex },
      2,
    );

    if (!data) {
      throw new Error(`Failed to fetch ${dex} HIP-3 market data`);
    }
    const meta = data[0];
    const assetCtxs: AssetContext[] = data[1];

    if (!meta?.universe || !assetCtxs) {
      throw new Error("Invalid HIP-3 response format");
    }

    const marketData = new Map<string, Partial<FundingRate>>();

    meta.universe.forEach((market: MarketInfo, index: number) => {
      const ctx = assetCtxs[index];

      if (!isValidLiveFundingRate(ctx?.funding)) return;
      marketData.set(market.name, {
        coin: market.name,
        fundingRate: String(ctx.funding),
        markPrice: ctx?.markPx || "0",
        indexPrice: ctx?.oraclePx || "0",
        premium: ctx?.premium || "0",
        openInterest: ctx?.openInterest || "0",
        dayVolume: ctx?.dayNtlVlm || "0",
        prevDayPx: ctx?.prevDayPx || "0",
        isSpot: true,
        bestBid: ctx?.impactPxs?.[0] || undefined,
        bestAsk: ctx?.impactPxs?.[1] || undefined,
        midPrice: ctx?.midPx || undefined,
      });
    });

    return marketData;
  } catch (error) {
    console.error(`Error fetching HIP-3 market data for ${dex}:`, error);
    return new Map();
  }
}

async function getDexFundingRates(dex: "xyz" | "para" | "hyna"): Promise<FundingRate[]> {
  const marketData = await getHip3MarketData(dex);
  const rates: FundingRate[] = [];

  for (const [coin, marketInfo] of marketData) {
    if (!isValidLiveFundingRate(marketInfo.fundingRate)) continue;
    rates.push({
      coin,
      fundingRate: String(marketInfo.fundingRate),
      markPrice: marketInfo.markPrice || "0",
      indexPrice: marketInfo.indexPrice || "0",
      premium: marketInfo.premium || "0",
      openInterest: marketInfo.openInterest || "0",
      dayVolume: marketInfo.dayVolume || "0",
      prevDayPx: marketInfo.prevDayPx || "0",
      isSpot: true,
      bestBid: marketInfo.bestBid,
      bestAsk: marketInfo.bestAsk,
      midPrice: marketInfo.midPrice,
    });
  }

  return rates;
}

export async function getHip3FundingRates(): Promise<FundingRate[]> {
  const xyzRates = await getDexFundingRates("xyz");
  await sleep(150);
  const paraRates = await getDexFundingRates("para");
  await sleep(150);
  const hynaRates = await getDexFundingRates("hyna");

  return [...xyzRates, ...paraRates, ...hynaRates];
}

export async function getSpotFundingRates(): Promise<FundingRate[]> {
  return getHip3FundingRates();
}

export async function getAllFundingRatesWithHistory(): Promise<FundingRate[]> {
  try {
    const [perpRates, hip3Rates] = await Promise.all([
      getAllFundingRates(),
      getSpotFundingRates().catch(() => []),
    ]);

    if (perpRates.length === 0 && hip3Rates.length === 0) {
      return [];
    }

    const mergedRates = new Map<string, FundingRate>();
    for (const rate of [...perpRates, ...hip3Rates]) {
      mergedRates.set(rate.coin, rate);
    }

    return Array.from(mergedRates.values());
  } catch (error) {
    console.error("Error fetching all funding rates:", error);
    return [];
  }
}

export async function getFundingHistory(
  coin: string,
  startTimeSeconds?: number,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  try {
    throwIfAborted(signal);

    const body: Record<string, unknown> = {
      type: "fundingHistory",
      coin,
      startTime: startTimeSeconds === undefined
        ? Date.now() - HYPERLIQUID_FUNDING_PAGE_MS
        : startTimeSeconds * 1000,
      endTime: Date.now(),
    };

    const data = await fetchHyperliquidInfo<unknown[]>(body, 1, signal);
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      time: item.time,
      coin: item.coin,
      fundingRate: item.fundingRate,
      premium: item.premium || "0",
      markPrice: item.markPrice || "0",
      indexPrice: item.indexPrice || "0",
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return [];
    }

    console.error(`[API] Error fetching funding history for ${coin}:`, error);
    return [];
  }
}

async function fetchLatestSettledFundingRateInWindow(
  coin: string,
  lookbackHours: number,
  signal?: AbortSignal,
): Promise<number> {
  const endTime = Date.now();
  const startTime = endTime - lookbackHours * 60 * 60 * 1000;

  const data = await fetchHyperliquidInfo<any[]>(
    {
      type: "fundingHistory",
      coin,
      startTime,
      endTime,
    },
    2,
    signal,
  );

  if (!Array.isArray(data) || data.length === 0) {
    return Number.NaN;
  }

  const latestEntry = data[data.length - 1];
  const latestRate = Number.parseFloat(latestEntry?.fundingRate ?? "");
  return Number.isFinite(latestRate) ? latestRate : Number.NaN;
}

export async function getLatestSettledFundingRate(
  coin: string,
  lookbackHours: number = 12,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const latestRate = await fetchLatestSettledFundingRateInWindow(coin, lookbackHours, signal);
    if (Number.isFinite(latestRate)) {
      return latestRate;
    }

    if (lookbackHours >= 72) {
      return Number.NaN;
    }

    return await fetchLatestSettledFundingRateInWindow(coin, 72, signal);
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return Number.NaN;
    }

    console.error(`[API] Error fetching latest settled funding for ${coin}:`, error);
    return Number.NaN;
  }
}

export async function getFundingHistoryForDays(
  coin: string,
  days: number = 30,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  const endTimeMs = Date.now();
  const startTimeMs = endTimeMs - days * 24 * 60 * 60 * 1000;
  return getFundingHistoryRange(coin, startTimeMs, endTimeMs, signal);
}

/** Maximum safe Hyperliquid funding-history request span (499 hourly settlements). */
export const HYPERLIQUID_FUNDING_PAGE_MS = 499 * 60 * 60 * 1000;
export const HYPERLIQUID_FUNDING_MAX_PAGES = 80;

/**
 * Fetch settled funding in the Search caller's half-open millisecond range.
 * Hyperliquid's upstream bounds are inclusive, so each fixed page is sent as
 * [startTime, endTime] and the caller-visible result is filtered back to
 * [startTimeMs, endTimeMs). Adjacent pages are disjoint; duplicate source
 * rows are still deduplicated and page boundaries never use returned
 * timestamps as cursors.
 */
export async function getFundingHistoryRange(
  coin: string,
  startTimeMs: number,
  endTimeMs: number,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    throw new RangeError("Hyperliquid funding history bounds must be finite");
  }

  const start = Math.floor(startTimeMs);
  const end = Math.floor(endTimeMs);
  if (end <= start) return [];

  const pageCount = Math.ceil((end - start) / HYPERLIQUID_FUNDING_PAGE_MS);
  if (pageCount > HYPERLIQUID_FUNDING_MAX_PAGES) {
    throw new RangeError("Hyperliquid funding history range exceeds the page budget");
  }

  const collected = new Map<number, FundingHistoryItem>();
  for (let page = 0; page < pageCount; page += 1) {
    throwIfAborted(signal);
    const pageEndExclusive = end - page * HYPERLIQUID_FUNDING_PAGE_MS;
    const pageStart = Math.max(start, pageEndExclusive - HYPERLIQUID_FUNDING_PAGE_MS);
    const pageEndInclusive = pageEndExclusive - 1;
    const data = await fetchHyperliquidInfo<unknown[]>(
      {
        type: "fundingHistory",
        coin,
        startTime: pageStart,
        endTime: pageEndInclusive,
      },
      1,
      signal,
    );
    throwIfAborted(signal);
    if (!Array.isArray(data)) {
      throw new Error("Invalid Hyperliquid funding history response");
    }

    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const time = Number(row.time);
      if (!Number.isFinite(time) || time < start || time >= end) continue;
      if (!collected.has(time)) {
        collected.set(time, {
          time,
          coin: String(row.coin ?? coin),
          fundingRate: String(row.fundingRate ?? ""),
          premium: String(row.premium ?? "0"),
          markPrice: row.markPrice === undefined ? "0" : String(row.markPrice),
          indexPrice: row.indexPrice === undefined ? "0" : String(row.indexPrice),
        });
      }
    }
  }

  return Array.from(collected.values()).sort((a, b) => a.time - b.time);
}

/**
 * 获取指定币种的有界历史资金费率。
 * 保留此入口供旧调用方使用；Search 使用 getFundingHistoryRange 获取其蜡烛范围。
 */
export async function getFundingHistoryAll(
  coin: string,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  const endTimeMs = Date.now();
  const startTimeMs = Math.max(0, endTimeMs - HYPERLIQUID_FUNDING_PAGE_MS * HYPERLIQUID_FUNDING_MAX_PAGES);
  return getFundingHistoryRange(coin, startTimeMs, endTimeMs, signal);
}

export async function getCandleSnapshot(
  coin: string,
  interval: ChartInterval = "1d",
  days: number = 30,
  signal?: AbortSignal,
): Promise<CandleSnapshotItem[]> {
  try {
    throwIfAborted(signal);

    const endTime = Date.now();
    const startTime = Math.max(0, endTime - days * 24 * 60 * 60 * 1000);

    const data = await fetchHyperliquidInfo<unknown[]>(
      {
        type: "candleSnapshot",
        req: {
          coin,
          interval,
          startTime,
          endTime,
        },
      },
      1,
      signal,
    );
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: any) => ({
      openTime: item.t,
      closeTime: item.T,
      coin: item.s,
      interval: item.i,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
      trades: item.n,
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      return [];
    }

    console.error(`[API] Error fetching candles for ${coin}:`, error);
    return [];
  }
}

export function getDailyAverageFundingRates(history: FundingHistoryItem[]): DailyFundingRateItem[] {
  const grouped = new Map<number, { total: number; count: number }>();

  for (const item of history) {
    const dayStartTime = Math.floor(item.time / INTERVAL_MS["1d"]) * INTERVAL_MS["1d"];
    const existing = grouped.get(dayStartTime) ?? { total: 0, count: 0 };
    existing.total += parseFloat(item.fundingRate);
    existing.count += 1;
    grouped.set(dayStartTime, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([dayStartTime, value]) => ({
      dayStartTime,
      averageFundingRate: value.count > 0 ? value.total / value.count : 0,
      sampleCount: value.count,
    }));
}

export function getAverageFundingRatesByInterval(
  history: FundingHistoryItem[],
  interval: ChartInterval,
): IntervalFundingRateItem[] {
  const intervalMs = INTERVAL_MS[interval];
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

export async function getFundingAverages(
  coin: string,
): Promise<{ avg7d: number; avg30d: number } | null> {
  try {
    const history = await getFundingHistoryForDays(coin, 30);
    if (history.length === 0) {
      return null;
    }

    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const last7Days = history.filter((item) => item.time >= sevenDaysAgoMs);

    const avg7d =
      last7Days.length > 0
        ? last7Days.reduce((sum, item) => sum + parseFloat(item.fundingRate), 0) / last7Days.length
        : 0;

    const avg30d = history.reduce((sum, item) => sum + parseFloat(item.fundingRate), 0) / history.length;
    return { avg7d, avg30d };
  } catch (error) {
    console.error(`Error fetching averages for ${coin}:`, error);
    return null;
  }
}

export async function getMeta(): Promise<MarketInfo[]> {
  try {
    const data = await fetchHyperliquidInfo<{ universe?: MarketInfo[] }>({ type: "meta" }, 1);
    if (!data) {
      throw new Error("Failed to fetch meta");
    }
    return data.universe || [];
  } catch (error) {
    console.error("Error fetching meta:", error);
    return [];
  }
}

export function toAnnualizedRate(rate: string | number): number {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return rateNumber * 24 * 365 * 100;
}

export function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

export function formatAnnualizedRate(rate: string | number): string {
  const annualized = toAnnualizedRate(rate);
  const absRate = Math.abs(annualized);

  if (absRate >= 100) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  }

  if (absRate >= 10) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  }

  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

export function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;

  if (priceNumber >= 1000) {
    return priceNumber.toFixed(2);
  }
  if (priceNumber >= 1) {
    return priceNumber.toFixed(4);
  }
  return priceNumber.toFixed(6);
}

export function formatVolume(volume: string | number): string {
  const volumeNumber = typeof volume === "string" ? parseFloat(volume) : volume;

  if (volumeNumber >= 1e9) {
    return `${(volumeNumber / 1e9).toFixed(2)}B`;
  }
  if (volumeNumber >= 1e6) {
    return `${(volumeNumber / 1e6).toFixed(2)}M`;
  }
  if (volumeNumber >= 1e3) {
    return `${(volumeNumber / 1e3).toFixed(2)}K`;
  }
  return volumeNumber.toFixed(2);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
}

export function formatIntervalLabel(timestamp: number, interval: ChartInterval): string {
  if (interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

export function formatAxisIntervalLabel(timestamp: number, interval: ChartInterval): string {
  if (interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).replace(" ", "\n");
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).replace(" ", "\n");
}
