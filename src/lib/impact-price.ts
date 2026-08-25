// ==================== Impact Price (VWAP) Calculation ====================
// Computes volume-weighted average price by sweeping order book depth
// across a configurable notional threshold (default $1000) for all 6 exchanges.

import { fetchL2Book } from "./hyperliquid";
import { lighterFetch, getMarketMap } from "./lighter";
import { binanceFetch } from "./adapters/binance";
import { okxFetch } from "./adapters/okx";
import { fetchBitgetImpactSpread, fetchBitgetImpactSpreadDetail, fetchBitgetOrderBook } from "./adapters/bitget";
import { fetchBybitImpactSpread, fetchBybitImpactSpreadDetail, fetchBybitOrderBook, type BybitRequest } from "./adapters/bybit";
import { bookTopBbo, clampRpiDepth, type BookMode } from "./rpi-book";
import { requireBitgetRawSymbol, type SearchExchangeRate } from "./search";
import {
  computeOrderBookImpactDetail,
  computeOrderBookImpactSpread,
  resolvePerpImpactDepth,
  type ImpactDepthMode,
  type NormalizedBookLevel,
  type NormalizedOrderBook,
  type OrderBookImpactDetail,
  type OrderBookImpactDetailResult,
} from "./order-book-impact";

export const DEFAULT_IMPACT_NOTIONAL = 3000;
export const IMPACT_NOTIONAL_PRESETS = [200, 1000, 3000, 5000, 10000] as const;

export const DEFAULT_PREMIUM_INDEX_NOTIONAL = 5000;
export const PREMIUM_INDEX_NOTIONAL_PRESETS = [2000, 4000, 5000, 10000, 25000] as const;

/**
 * Binance-style premium index from impact prices and the venue index price.
 *
 * premiumIndex = [ max(0, bidPrice − indexPrice) − max(0, indexPrice − askPrice) ] / indexPrice
 *
 * `bidPrice` / `askPrice` are the impact bid/ask VWAP prices (冲击买价/冲击卖价)
 * for a given quote notional; `indexPrice` is the exchange index price.
 * Returns null when any input is missing/invalid or the index price is non-positive.
 */
export function computePremiumIndex(
  bidPrice: number,
  askPrice: number,
  indexPrice: number,
): number | null {
  if (
    !Number.isFinite(bidPrice)
    || !Number.isFinite(askPrice)
    || !Number.isFinite(indexPrice)
    || indexPrice <= 0
  ) {
    return null;
  }
  const numerator = Math.max(0, bidPrice - indexPrice) - Math.max(0, indexPrice - askPrice);
  return numerator / indexPrice;
}

// ==================== Types ====================

/** Result of an impact spread computation. */
export type ImpactSpreadResult = number | "insufficient" | "no_ctVal" | "no_multiplier" | null;
export type ImpactSpreadDetailResult = OrderBookImpactDetail | "insufficient" | "no_ctVal" | "no_multiplier" | null;

// ==================== Gate.io Multiplier Cache ====================

const gateMultiplierCache = new Map<string, number>();

/**
 * Cache Gate.io quanto_multipliers from tickers.
 * Call this once when tickers are fetched.
 */
export function cacheGateMultipliers(
  tickers: Array<{ contract: string; quanto_multiplier: string }>,
): void {
  for (const t of tickers) {
    const mult = Number.parseFloat(t.quanto_multiplier);
    if (Number.isFinite(mult) && mult > 0) {
      gateMultiplierCache.set(t.contract, mult);
    }
  }
}

// ==================== OKX ctVal Cache ====================

const okxCtValCache = new Map<string, number>();
let okxCtValFetchPromise: Promise<void> | null = null;

async function getOkxCtVal(instId: string, signal?: AbortSignal): Promise<number | null> {
  // Check cache first
  if (okxCtValCache.has(instId)) {
    return okxCtValCache.get(instId)!;
  }

  // Dedup concurrent fetches — only one flight at a time
  if (!okxCtValFetchPromise) {
    okxCtValFetchPromise = (async () => {
      try {
        const response = await okxFetch(
          "/api/okx?endpoint=public/instruments&instType=SWAP",
          { signal, cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: Array<{ instId: string; ctVal: string }>;
        };
        for (const inst of payload.data ?? []) {
          const ctVal = Number.parseFloat(inst.ctVal ?? "");
          if (Number.isFinite(ctVal) && ctVal > 0) {
            okxCtValCache.set(inst.instId, ctVal);
          }
        }
      } catch {
        // ignore — cache stays empty, individual lookups will return null
      } finally {
        okxCtValFetchPromise = null;
      }
    })();
  }

  await okxCtValFetchPromise;
  return okxCtValCache.get(instId) ?? null;
}

// ==================== Per-Exchange Fetchers ====================

async function fetchHyperliquidBook(
  coin: string,
  signal?: AbortSignal,
): Promise<NormalizedOrderBook | null> {
  try {
    const fullData = await fetchL2Book(coin, signal);
    if (!fullData?.levels || fullData.levels.length < 2) return null;

    const bids: NormalizedBookLevel[] = fullData.levels[0].map((l) => ({
      price: Number.parseFloat(l.px),
      quantity: Number.parseFloat(l.sz),
    })).filter((l) => l.price > 0 && l.quantity > 0);

    const asks: NormalizedBookLevel[] = fullData.levels[1].map((l) => ({
      price: Number.parseFloat(l.px),
      quantity: Number.parseFloat(l.sz),
    })).filter((l) => l.price > 0 && l.quantity > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

async function getGateMultiplier(contract: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(
      `/api/gate/futures/usdt/tickers?contract=${encodeURIComponent(contract)}`,
      { signal, cache: "no-store" },
    );
    if (!response.ok) return null;

    const rows = (await response.json()) as Array<{ contract?: string; quanto_multiplier?: string }>;
    const row = Array.isArray(rows) ? rows.find((item) => item.contract === contract) : null;
    const multiplier = row?.quanto_multiplier ? Number.parseFloat(row.quanto_multiplier) : Number.NaN;
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return null;
    }

    gateMultiplierCache.set(contract, multiplier);
    return multiplier;
  } catch {
    return null;
  }
}

export interface GatePerpOrderBookPayload {
  bids?: Array<{ p: string; s: number }>;
  asks?: Array<{ p: string; s: number }>;
}

/** Convert Gate contracts to base quantity, failing closed without a valid multiplier. */
export function normalizeGatePerpOrderBook(
  data: GatePerpOrderBookPayload,
  multiplier: number | null | undefined,
): NormalizedOrderBook | "no_multiplier" {
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) return "no_multiplier";
  const convert = (levels: Array<{ p: string; s: number }> = []): NormalizedBookLevel[] => levels
    .map((level) => ({
      price: Number.parseFloat(level.p),
      quantity: Number(level.s) * multiplier,
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.quantity) && level.price > 0 && level.quantity > 0);
  return { bids: convert(data.bids), asks: convert(data.asks) };
}

async function fetchGateioBook(
  contract: string,
  depthLimit: number,
  signal?: AbortSignal,
  bookMode: BookMode = "normal",
): Promise<NormalizedOrderBook | "no_multiplier" | null> {
  try {
    const rpi = bookMode === "rpi" ? "&rpi=1" : "";
    const response = await fetch(
      `/api/gate/futures/usdt/order_book?contract=${encodeURIComponent(contract)}&limit=${depthLimit}${rpi}`,
      { signal, cache: "no-store" },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as GatePerpOrderBookPayload;

    const multiplier = gateMultiplierCache.get(contract) ?? await getGateMultiplier(contract, signal);
    return normalizeGatePerpOrderBook(data, multiplier);
  } catch {
    return null;
  }
}

function normalizeBinanceDepthPayload(data: { bids?: Array<[string, string]>; asks?: Array<[string, string]> }): NormalizedOrderBook {
  const bids: NormalizedBookLevel[] = (data.bids ?? []).map(([px, qty]) => ({
    price: Number.parseFloat(px),
    quantity: Number.parseFloat(qty),
  })).filter((l) => l.price > 0 && l.quantity > 0);

  const asks: NormalizedBookLevel[] = (data.asks ?? []).map(([px, qty]) => ({
    price: Number.parseFloat(px),
    quantity: Number.parseFloat(qty),
  })).filter((l) => l.price > 0 && l.quantity > 0);

  return { bids, asks };
}

async function fetchBinanceBook(
  symbol: string,
  depthLimit: number,
  signal?: AbortSignal,
): Promise<NormalizedOrderBook | null> {
  try {
    const response = await binanceFetch(
      "depth",
      `symbol=${encodeURIComponent(symbol)}&limit=${depthLimit}`,
      { signal },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
    };

    return normalizeBinanceDepthPayload(data);
  } catch {
    return null;
  }
}

/**
 * Binance USDⓈ-M RPI 盘口（/fapi/v1/rpiDepth）：RPI 订单已聚合进价位，响应与普通
 * depth 同构；limit 仅支持 1000（权重 20）。对无 RPI 白名单的合约返回的即普通盘口。
 */
async function fetchBinanceRpiBook(
  symbol: string,
  signal?: AbortSignal,
): Promise<NormalizedOrderBook | null> {
  try {
    const response = await binanceFetch(
      "rpiDepth",
      `symbol=${encodeURIComponent(symbol)}&limit=1000`,
      { signal },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
    };

    return normalizeBinanceDepthPayload(data);
  } catch {
    return null;
  }
}

async function fetchOkxBook(
  instId: string,
  ctVal: number,
  depthLimit: number,
  signal?: AbortSignal,
  bookMode: BookMode = "normal",
): Promise<NormalizedOrderBook | null> {
  try {
    const endpoint = bookMode === "rpi"
      ? "market/books-rpi"
      : depthLimit > 400 ? "market/books-full" : "market/books";
    const response = await okxFetch(
      `/api/okx?endpoint=${endpoint}&instId=${encodeURIComponent(instId)}&sz=${depthLimit}`,
      { signal, cache: "no-store" },
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: Array<{
        bids: Array<[string, string, string, string]>;
        asks: Array<[string, string, string, string]>;
      }>;
    };

    const book = payload.data?.[0];
    if (!book) return null;

    // OKX order book sz is in contracts — multiply by ctVal to get base asset qty
    const bids: NormalizedBookLevel[] = (book.bids ?? []).map(([px, sz]) => ({
      price: Number.parseFloat(px),
      quantity: Number.parseFloat(sz) * ctVal,
    })).filter((l) => l.price > 0 && l.quantity > 0);

    const asks: NormalizedBookLevel[] = (book.asks ?? []).map(([px, sz]) => ({
      price: Number.parseFloat(px),
      quantity: Number.parseFloat(sz) * ctVal,
    })).filter((l) => l.price > 0 && l.quantity > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

async function fetchLighterBook(
  symbol: string,
  depthLimit: number,
  signal?: AbortSignal,
): Promise<NormalizedOrderBook | null> {
  try {
    const marketMap = await getMarketMap();
    let marketId: number | undefined;

    for (const [id, market] of marketMap) {
      if (market.symbol === symbol) {
        marketId = id;
        break;
      }
    }

    if (marketId === undefined) return null;

    const response = await lighterFetch(
      "orderBookOrders",
      `market_id=${marketId}&limit=${depthLimit}`,
      { signal },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids?: Array<Record<string, unknown>>;
      asks?: Array<Record<string, unknown>>;
    };

    const parseLevel = (l: Record<string, unknown>): NormalizedBookLevel | null => {
      const price = Number.parseFloat(String(l.price ?? ""));
      const qtyRaw = l.remaining_base_amount ?? l.size ?? l.base_amount ?? 0;
      const quantity = Number.parseFloat(String(qtyRaw));
      if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) {
        return null;
      }
      return { price, quantity };
    };

    const bids: NormalizedBookLevel[] = (data.bids ?? []).map(parseLevel).filter((l): l is NormalizedBookLevel => l !== null);
    const asks: NormalizedBookLevel[] = (data.asks ?? []).map(parseLevel).filter((l): l is NormalizedBookLevel => l !== null);

    return { bids, asks };
  } catch {
    return null;
  }
}

// ==================== Unified Entry Point ====================

/** Fetches the normalized order book for the book-based exchanges. */
async function fetchImpactOrderBook(
  exchange: string,
  rawSymbol: string,
  signal: AbortSignal | undefined,
  depthMode: ImpactDepthMode,
  bookMode: BookMode = "normal",
): Promise<NormalizedOrderBook | "no_ctVal" | "no_multiplier" | null> {
  switch (exchange) {
    case "Hyperliquid": return fetchHyperliquidBook(rawSymbol, signal);
    case "Gate.io": { const b = await fetchGateioBook(rawSymbol, resolvePerpImpactDepth("Gate.io", depthMode), signal, bookMode); return b === "no_multiplier" ? b : b; }
    case "Binance":
      // rpiDepth limit 固定 1000，无需按 depthMode 缩放。
      return bookMode === "rpi" ? fetchBinanceRpiBook(rawSymbol, signal) : fetchBinanceBook(rawSymbol, resolvePerpImpactDepth("Binance", depthMode), signal);
    case "OKX": {
      const ctVal = await getOkxCtVal(rawSymbol, signal);
      if (ctVal === null) return "no_ctVal";
      const depth = bookMode === "rpi"
        ? clampRpiDepth("OKX", "perp", resolvePerpImpactDepth("OKX", depthMode))
        : resolvePerpImpactDepth("OKX", depthMode);
      return fetchOkxBook(rawSymbol, ctVal, depth, signal, bookMode);
    }
    case "Lighter": return fetchLighterBook(rawSymbol, resolvePerpImpactDepth("Lighter", depthMode), signal);
    default: return null;
  }
}

/**
 * 拉取单市场的最优一档（best bid/ask），供 RPI 模式下覆盖 perp 的 Top 价差与中间价。
 * bookMode 为 "rpi" 时走各所 RPI 端点；失败（端点不可用/解析失败）返回 null，
 * 由调用方回退普通盘口数据并提示用户。
 */
export async function fetchBookModeTopBbo(
  exchange: string,
  rawSymbol: string,
  signal?: AbortSignal,
  bookMode: BookMode = "normal",
): Promise<{ bestBid?: number; bestAsk?: number } | null> {
  const toBbo = (book: NormalizedOrderBook | "no_ctVal" | "no_multiplier" | null) => {
    if (book === null || book === "no_ctVal" || book === "no_multiplier") return null;
    return bookTopBbo(book);
  };
  if (exchange === "Bitget") {
    try {
      const book = await fetchBitgetOrderBook(rawSymbol, 1, signal, undefined, bookMode);
      return toBbo({ bids: book.bids.map((l) => ({ price: l.price, quantity: l.baseQty })), asks: book.asks.map((l) => ({ price: l.price, quantity: l.baseQty })) });
    } catch {
      return null;
    }
  }
  if (exchange === "Bybit") {
    try {
      const book = await fetchBybitOrderBook(rawSymbol, 1, signal, undefined, bookMode);
      return toBbo({ bids: book.bids.map((l) => ({ price: l.price, quantity: l.baseQty })), asks: book.asks.map((l) => ({ price: l.price, quantity: l.baseQty })) });
    } catch {
      return null;
    }
  }
  return toBbo(await fetchImpactOrderBook(exchange, rawSymbol, signal, "standard", bookMode));
}

/**
 * Fetch order book depth and compute impact spread for any exchange.
 *
 * @returns spread percentage (number), "insufficient" if book is available
 *          but total depth < notionalUsd on either side, "no_ctVal" if the
 *          OKX contract multiplier is unavailable, "no_multiplier" if Gate's
 *          multiplier is unavailable, or null if the book could not be fetched.
 */
export async function fetchImpactSpread(
  exchange: string,
  rawSymbol: string,
  signal?: AbortSignal,
  notionalUsd: number = DEFAULT_IMPACT_NOTIONAL,
  depthMode: ImpactDepthMode = "standard",
  bybitRequest?: BybitRequest,
  bookMode: BookMode = "normal",
): Promise<ImpactSpreadResult> {
  if (exchange === "Bitget") return fetchBitgetImpactSpread(rawSymbol, notionalUsd, signal, resolvePerpImpactDepth("Bitget", depthMode), bookMode);
  if (exchange === "Bybit") return fetchBybitImpactSpread(rawSymbol, notionalUsd, signal, bybitRequest, resolvePerpImpactDepth("Bybit", depthMode), bookMode);
  const book = await fetchImpactOrderBook(exchange, rawSymbol, signal, depthMode, bookMode);
  if (book === "no_ctVal" || book === "no_multiplier") return book;
  if (!book) return null; // fetch error
  return computeOrderBookImpactSpread(book, notionalUsd);
}

/** Fetch order book depth and compute the full impact detail for any exchange. */
export async function fetchImpactSpreadDetail(
  exchange: string,
  rawSymbol: string,
  signal?: AbortSignal,
  notionalUsd: number = DEFAULT_IMPACT_NOTIONAL,
  depthMode: ImpactDepthMode = "standard",
  bybitRequest?: BybitRequest,
  bookMode: BookMode = "normal",
): Promise<ImpactSpreadDetailResult> {
  if (exchange === "Bitget") return fetchBitgetImpactSpreadDetail(rawSymbol, notionalUsd, signal, resolvePerpImpactDepth("Bitget", depthMode), bookMode);
  if (exchange === "Bybit") return fetchBybitImpactSpreadDetail(rawSymbol, notionalUsd, signal, bybitRequest, resolvePerpImpactDepth("Bybit", depthMode), bookMode);
  const book = await fetchImpactOrderBook(exchange, rawSymbol, signal, depthMode, bookMode);
  if (book === "no_ctVal" || book === "no_multiplier") return book;
  if (!book) return null; // fetch error
  return computeOrderBookImpactDetail(book, notionalUsd);
}

/** Search dispatch for the impact detail fetcher that prevents display-symbol fallback for Bitget. */
export function fetchSearchImpactSpreadDetail(
  rate: Pick<SearchExchangeRate, "exchange" | "symbol" | "rawSymbol">,
  signal?: AbortSignal,
  notionalUsd?: number,
  depthMode?: ImpactDepthMode,
  bookMode?: BookMode,
): Promise<ImpactSpreadDetailResult>;
export function fetchSearchImpactSpreadDetail(
  rate: Pick<SearchExchangeRate, "exchange" | "symbol" | "rawSymbol">,
  signal?: AbortSignal,
  notionalUsd?: number,
  fetcher?: typeof fetchImpactSpreadDetail,
  depthMode?: ImpactDepthMode,
  bookMode?: BookMode,
): Promise<ImpactSpreadDetailResult>;
export async function fetchSearchImpactSpreadDetail(
  rate: Pick<SearchExchangeRate, "exchange" | "symbol" | "rawSymbol">,
  signal?: AbortSignal,
  notionalUsd: number = DEFAULT_IMPACT_NOTIONAL,
  depthModeOrFetcher: ImpactDepthMode | BookMode | typeof fetchImpactSpreadDetail = "standard",
  depthModeOrBookMode: ImpactDepthMode | BookMode = "standard",
  bookMode: BookMode = "normal",
): Promise<ImpactSpreadDetailResult> {
  const rawSymbol = requireBitgetRawSymbol(rate);
  const isMode = (value: unknown): value is ImpactDepthMode => value === "standard" || value === "max";
  const isBookMode = (value: unknown): value is BookMode => value === "normal" || value === "rpi";
  const fetcher = typeof depthModeOrFetcher === "function" ? depthModeOrFetcher : fetchImpactSpreadDetail;
  let depthMode: ImpactDepthMode;
  let resolvedBookMode: BookMode;
  if (typeof depthModeOrFetcher === "function") {
    depthMode = isMode(depthModeOrBookMode) ? depthModeOrBookMode : "standard";
    resolvedBookMode = isBookMode(depthModeOrBookMode) ? depthModeOrBookMode : bookMode;
  } else {
    depthMode = isMode(depthModeOrFetcher) ? depthModeOrFetcher : "standard";
    resolvedBookMode = isBookMode(depthModeOrFetcher)
      ? depthModeOrFetcher
      : isBookMode(depthModeOrBookMode) ? depthModeOrBookMode : bookMode;
  }
  return fetcher(rate.exchange, rawSymbol, signal, notionalUsd, depthMode, undefined, resolvedBookMode);
}
