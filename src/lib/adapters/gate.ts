import {
  getAllFundingRates,
  getAverageFundingRatesByInterval,
  getBatchFundingHistory,
  getCandleSnapshot,
  getFundingHistoryForDays,
} from "@/lib/gateio";
import { getExchangeTransportFlags } from "@/lib/exchange-flags";
import type {
  CanonicalFundingDetail,
  CanonicalFundingHistoryPoint,
  CanonicalFundingRateRow,
} from "@/lib/types";

export type GateChartInterval = "1d" | "4h" | "1h";

export interface GateFundingMonitorRow {
  symbol: string;
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

async function fetchNativeCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  const rates = await getAllFundingRates();
  return rates.map((rate) => ({
    exchange: "gateio",
    transportMode: "native",
    symbol: rate.coin,
    rawSymbol: `${rate.coin}_USDT`,
    marketKey: `${rate.coin}_USDT`,
    fundingRate: Number.parseFloat(rate.fundingRateIndicative || rate.fundingRate),
    predictedFundingRate: Number.parseFloat(rate.fundingRateIndicative || rate.fundingRate),
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
  }));
}

async function fetchCcxtCanonicalBaseRates(): Promise<CanonicalFundingRateRow[]> {
  const response = await fetch("/api/gate/futures/usdt/ccxt?mode=list", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch Gate CCXT base list data");
  }
  return (await response.json()) as CanonicalFundingRateRow[];
}

async function fetchCcxtCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  const [ccxtRows, nativeRows] = await Promise.all([
    fetchCcxtCanonicalBaseRates(),
    fetchNativeCanonicalRates(),
  ]);

  const ccxtBySymbol = new Map(ccxtRows.map((row) => [row.symbol, row]));

  return nativeRows.map((native) => {
    const ccxt = ccxtBySymbol.get(native.symbol);
    if (!ccxt) {
      return native;
    }

    return {
      ...ccxt,
      predictedFundingRate: native.predictedFundingRate,
      fundingRate: native.fundingRate,
      fundingIntervalSeconds: native.fundingIntervalSeconds,
      assetCategory: native.assetCategory,
      notionalValue: native.notionalValue,
      openInterest: native.openInterest,
      rawSymbol: native.rawSymbol,
      marketKey: native.marketKey,
    } satisfies CanonicalFundingRateRow;
  });
}

export async function fetchGateCanonicalRates(): Promise<CanonicalFundingRateRow[]> {
  const mode = getExchangeTransportFlags().gateio;
  if (mode === "native") {
    return fetchNativeCanonicalRates();
  }

  try {
    return await fetchCcxtCanonicalRates();
  } catch {
    return fetchNativeCanonicalRates();
  }
}

export async function fetchGateFundingMonitorRates(): Promise<GateFundingMonitorRow[]> {
  return (await fetchGateCanonicalRates()).map((row) => ({
    symbol: row.symbol,
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

export async function hydrateGateLatestSettlementRates(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const contractMap = new Map(symbols.map((symbol) => [`${symbol}_USDT`, symbol]));
  const histories = await getBatchFundingHistory(Array.from(contractMap.keys()));

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
): Promise<CanonicalFundingDetail> {
  const [candles, history] = await Promise.all([
    getCandleSnapshot(symbol, interval, 30, signal),
    getFundingHistoryForDays(symbol, 30, fundingIntervalSeconds, signal),
  ]);

  const fundingHistory: CanonicalFundingHistoryPoint[] = history.map((item) => ({
    timestamp: item.time,
    fundingRate: Number.parseFloat(item.fundingRate),
  }));
  const latest = history.length > 0 ? Number.parseFloat(history[0].fundingRate) : null;
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
