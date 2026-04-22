import { isAbortLikeError, sleep, throwIfAborted } from "./utils/abort";

export interface FundingRate {
  coin: string;
  fundingRate: string;
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

export type ChartInterval = "1d" | "4h" | "1h";

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
  funding: string;
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

async function fetchHyperliquidInfo<T>(
  body: Record<string, unknown>,
  maxAttempts: number = 3,
  signal?: AbortSignal,
): Promise<T | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      throwIfAborted(signal);

      const response = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.hyperliquid.xyz",
          Referer: "https://app.hyperliquid.xyz/",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
        await sleep(250 * (attempt + 1), signal);
        continue;
      }

      return null;
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        return null;
      }

      if (attempt >= maxAttempts - 1) {
        console.error("Error fetching Hyperliquid info:", error);
        return null;
      }

      await sleep(250 * (attempt + 1), signal);
    }
  }

  return null;
}

const KNOWN_XYZ_HIP3_ASSETS = [
  "xyz:SILVER",
  "xyz:GOLD",
  "xyz:MSTR",
  "xyz:COIN",
  "xyz:NVDA",
  "xyz:AMD",
  "xyz:TSLA",
  "xyz:AAPL",
  "xyz:GOOGL",
  "xyz:AMZN",
  "xyz:MSFT",
  "xyz:META",
  "xyz:NFLX",
  "xyz:XYZ100",
  "xyz:PLATINUM",
  "xyz:COPPER",
  "xyz:CL",
  "xyz:NATGAS",
  "xyz:JPY",
  "xyz:EUR",
  "xyz:URNM",
  "xyz:INTC",
  "xyz:MU",
  "xyz:PLTR",
  "xyz:ORCL",
  "xyz:HOOD",
  "xyz:CRCL",
  "xyz:SNDK",
  "xyz:RIVN",
  "xyz:USAR",
  "xyz:TSM",
  "xyz:SKHX",
  "xyz:SMSN",
  "xyz:HYUNDAI",
  "xyz:BRENTOIL",
  "xyz:PALLADIUM",
  "xyz:EWY",
  "xyz:EWJ",
  "xyz:BABA",
  "xyz:SP500",
  "xyz:CRWV",
  "xyz:DKNG",
  "xyz:HIMS",
  "xyz:COST",
  "xyz:LLY",
];

const KNOWN_VNTL_HIP3_ASSETS = [
  "vntl:SPACEX",
  "vntl:OPENAI",
  "vntl:ANTHROPIC",
  "vntl:MAG7",
  "vntl:SEMIS",
  "vntl:ROBOT",
  "vntl:INFOTECH",
  "vntl:NUCLEAR",
  "vntl:DEFENSE",
  "vntl:ENERGY",
  "vntl:BIOTECH",
];

const INTERVAL_MS: Record<ChartInterval, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const data = await fetchHyperliquidInfo<any[]>(
      { type: "metaAndAssetCtxs" },
      2,
    );

    if (!data) {
      throw new Error("Failed to fetch funding rates");
    }
    const meta = data[0];
    const assetCtxs: AssetContext[] = data[1];

    if (!meta?.universe || !assetCtxs) {
      throw new Error("Invalid response format");
    }

    return meta.universe.map((market: MarketInfo, index: number) => {
      const ctx = assetCtxs[index];

      return {
        coin: market.name,
        fundingRate: ctx?.funding || "0",
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
      };
    });
  } catch (error) {
    console.error("Error fetching funding rates:", error);
    return [];
  }
}

async function getHip3MarketData(dex: "xyz" | "vntl"): Promise<Map<string, Partial<FundingRate>>> {
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

      marketData.set(market.name, {
        coin: market.name,
        fundingRate: ctx?.funding || "0",
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

async function getDexFundingRates(dex: "xyz" | "vntl", knownAssets: string[]): Promise<FundingRate[]> {
  const marketData = await getHip3MarketData(dex);
  const rates: FundingRate[] = [];

  for (const coin of knownAssets) {
    const marketInfo = marketData.get(coin);
    if (!marketInfo) {
      continue;
    }

    rates.push({
      coin,
      fundingRate: marketInfo.fundingRate || "0",
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
  const xyzRates = await getDexFundingRates("xyz", KNOWN_XYZ_HIP3_ASSETS);
  await sleep(150);
  const vntlRates = await getDexFundingRates("vntl", KNOWN_VNTL_HIP3_ASSETS);

  return [...xyzRates, ...vntlRates];
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
    };

    if (startTimeSeconds) {
      body.startTime = startTimeSeconds * 1000;
    }

    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://app.hyperliquid.xyz",
        Referer: "https://app.hyperliquid.xyz/",
        },
        body: JSON.stringify(body),
        signal,
      });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
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
  const endTimeSeconds = Math.floor(Date.now() / 1000);
  const midpointSeconds = endTimeSeconds - 15 * 24 * 60 * 60;
  const startTimeSeconds = endTimeSeconds - days * 24 * 60 * 60;

  const [olderHistory, recentHistory] = await Promise.all([
    getFundingHistory(coin, startTimeSeconds, signal),
    getFundingHistory(coin, midpointSeconds, signal),
  ]);

  const uniqueHistory = Array.from(
    new Map(
      [...olderHistory, ...recentHistory].map((item) => [`${item.time}-${item.fundingRate}`, item]),
    ).values(),
  ).sort((a, b) => a.time - b.time);

  const startTimeMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return uniqueHistory.filter((item) => item.time >= startTimeMs);
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

    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin,
          interval,
          startTime,
          endTime,
        },
      }),
      signal,
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
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
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch meta");
    }

    const data = await response.json();
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
