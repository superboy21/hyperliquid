import {
  getAllFundingRates,
  getAverageFundingRatesByInterval,
  getBatchFundingHistory,
  getCandleSnapshot,
  getFundingHistoryForDays,
} from "@/lib/gateio";
import { throwIfAborted } from "@/lib/utils/abort";
import type {
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";

export type GateChartInterval = "1d" | "4h" | "1h";

export interface GateFundingMonitorRow {
  symbol: string;
  rawSymbol: string;
  marketKey: string;
  fundingRate: number;
  lastSettlementRate: number;
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

export interface GateSearchRate {
  exchange: "Gate.io";
  exchangeColor: string;
  symbol: string;
  rawSymbol: string;
  fundingRate: number;
  predictedFundingRate: number | null;
  markPrice: number;
  indexPrice: number | null;
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

async function fetchNativeCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  const rates = await getAllFundingRates();
  return rates.flatMap((rate) => {
    const fundingRate = parseLiveFundingRate(rate.fundingRate);
    if (fundingRate === null) return [];
    const predictedFundingRate = parseLiveFundingRate(rate.fundingRateIndicative);
    return [{
      exchange: "gateio",
      transportMode: "native",
      symbol: rate.coin,
      rawSymbol: `${rate.coin}_USDT`,
      marketKey: `${rate.coin}_USDT`,
      fundingRate,
      predictedFundingRate,
      lastSettlementRate: null,
      markPrice: Number.parseFloat(rate.markPrice),
      indexPrice: Number.parseFloat(rate.indexPrice),
      lastPrice: Number.parseFloat(rate.lastPrice),
      change24h: Number.parseFloat(rate.change24h),
      quoteVolume: Number.parseFloat(rate.dayVolume),
      openInterest: Number.parseFloat(rate.openInterest),
      notionalValue: Number.parseFloat(rate.notionalValue) || 0,
      fundingIntervalSeconds: rate.fundingInterval || 28800,
      assetCategory: rate.assetCategory || "其他",
      bestBid: rate.bestBid ? Number.parseFloat(rate.bestBid) : null,
      bestAsk: rate.bestAsk ? Number.parseFloat(rate.bestAsk) : null,
    }];
  });
}

function parseLiveFundingRate(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchGateCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  return fetchNativeCanonicalRates();
}

export async function fetchGateFundingMonitorRates(): Promise<GateFundingMonitorRow[]> {
  return (await fetchGateCanonicalRates()).map((row) => ({
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    marketKey: row.marketKey,
    fundingRate: row.fundingRate,
    lastSettlementRate: Number.NaN,
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

export async function fetchGateSearchRates(): Promise<GateSearchRate[]> {
  return (await fetchGateCanonicalRates()).map((row) => ({
    exchange: "Gate.io",
    exchangeColor: "cyan",
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    fundingRate: row.fundingRate,
    predictedFundingRate: row.predictedFundingRate ?? null,
    markPrice: row.markPrice,
    indexPrice: row.indexPrice ?? null,
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

export async function hydrateGateLatestSettlementRates(symbols: string[], signal?: AbortSignal): Promise<Map<string, number>> {
  throwIfAborted(signal);
  if (symbols.length === 0) {
    return new Map();
  }

  const contractMap = new Map(symbols.map((symbol) => [`${symbol}_USDT`, symbol]));
  const histories = await getBatchFundingHistory(Array.from(contractMap.keys()), signal);
  throwIfAborted(signal);

  return new Map(
    Array.from(histories.entries())
      .map(([contract, history]) => {
        const symbol = contractMap.get(contract);
        const latest = history[0];
        if (!symbol || !latest) {
          return null;
        }

        const value = Number.parseFloat(latest.fundingRate);
        return Number.isFinite(value) ? ([symbol, value] as const) : null;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null),
  );
}

export async function fetchGateCanonicalDetail(
  symbol: string,
  interval: GateChartInterval,
  fundingIntervalSeconds: number,
  bestBid?: number,
  bestAsk?: number,
  signal?: AbortSignal,
  options: { now?: number; asOf?: number } | number = {},
): Promise<CanonicalFundingDetail> {
  // requestGate applies a per-direct-leg client timeout and can then fall back
  // through the proxy. Do not combine that timeout into the caller signal: an
  // internal direct timeout must not look like caller cancellation to the
  // direct-first transport policy.
  const asOf = typeof options === "number"
    ? options
    : options.asOf ?? options.now;
  const asOfMs = Number.isFinite(asOf) ? asOf as number : Date.now();
  const historicalSettlementBufferSeconds = 8 * 60 * 60;
  // Fetch one native settlement interval beyond the 30-day window.  The
  // helper's strict mode remains reserved for callers that need a complete
  // window; canonical detail keeps valid partial history for new markets.
  const historyDays = 30 + historicalSettlementBufferSeconds / (24 * 60 * 60);
  const [candles, history] = await Promise.all([
    getCandleSnapshot(symbol, interval, 30, signal),
    getFundingHistoryForDays(symbol, historyDays, fundingIntervalSeconds, signal, false, asOfMs),
  ]);
  throwIfAborted(signal);

  const fundingHistory: CanonicalFundingHistoryPoint[] = history.flatMap((item) => {
    const fundingRate = parseLiveFundingRate(item.fundingRate);
    return Number.isFinite(item.time) && item.time > 0 && fundingRate !== null
      ? [{ timestamp: item.time, fundingRate }]
      : [];
  });
  const latest = fundingHistory.reduce<CanonicalFundingHistoryPoint | null>(
    (current, point) => !current || point.timestamp > current.timestamp ? point : current,
    null,
  )?.fundingRate ?? null;
  const bidAskSpread =
    bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0
      ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100
      : null;

  return {
    exchange: "gateio",
    transportMode: "native",
    symbol,
    rawSymbol: `${symbol}_USDT`,
    marketKey: `${symbol}_USDT`,
    candles,
    fundingHistory,
    lastSettlementRate: latest,
    bidAskSpread,
  };
}

export function computeGateFundingRatesByInterval(history: CanonicalFundingHistoryPoint[], interval: GateChartInterval) {
  return getAverageFundingRatesByInterval(
    history.map((item) => ({
      time: item.timestamp,
      fundingRate: String(item.fundingRate),
    })),
    interval,
  );
}
