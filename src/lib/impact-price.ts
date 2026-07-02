// ==================== Impact Price (VWAP) Calculation ====================
// Computes volume-weighted average price by sweeping order book depth
// across a configurable notional threshold (default $1000) for all 5 exchanges.

import { fetchL2Book } from "./hyperliquid";
import { lighterFetch, getMarketMap } from "./lighter";
import { binanceFetch } from "./adapters/binance";

export const DEFAULT_IMPACT_NOTIONAL = 1000;
export const IMPACT_NOTIONAL_PRESETS = [200, 1000, 5000, 10000] as const;

// ==================== Types ====================

interface BookLevel {
  price: number;
  qty: number; // in base asset units
}

interface NormalizedBook {
  bids: BookLevel[]; // sorted descending by price
  asks: BookLevel[]; // sorted ascending by price
}

// ==================== VWAP Computation ====================

/**
 * Compute VWAP impact price by sweeping order book levels
 * until cumulative notional >= notionalUsd.
 * Returns null if total depth < notionalUsd.
 */
function computeImpactPrice(book: NormalizedBook, side: "bid" | "ask", notionalUsd: number): number | null {
  const levels = side === "bid" ? book.bids : book.asks;
  if (levels.length === 0 || notionalUsd <= 0) return null;

  let cumulativeNotional = 0;
  let cumulativeQty = 0;

  for (const level of levels) {
    const levelNotional = level.price * level.qty;

    if (cumulativeNotional + levelNotional >= notionalUsd) {
      const remaining = notionalUsd - cumulativeNotional;
      const partialQty = remaining / level.price;
      cumulativeQty += partialQty;
      cumulativeNotional = notionalUsd;
      break;
    }

    cumulativeQty += level.qty;
    cumulativeNotional += levelNotional;
  }

  if (cumulativeNotional < notionalUsd || cumulativeQty <= 0) {
    return null; // insufficient depth
  }

  return notionalUsd / cumulativeQty;
}

/**
 * Compute impact spread from a normalized book.
 * Returns spread percentage, or null if insufficient depth on either side.
 */
function computeImpactSpread(book: NormalizedBook, notionalUsd: number): number | null {
  const impactBid = computeImpactPrice(book, "bid", notionalUsd);
  const impactAsk = computeImpactPrice(book, "ask", notionalUsd);

  if (impactBid == null || impactAsk == null || impactBid <= 0 || impactAsk <= 0) {
    return null;
  }

  const midPrice = (impactBid + impactAsk) / 2;
  if (midPrice <= 0) return null;

  return ((impactAsk - impactBid) / midPrice) * 100;
}

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

// ==================== Per-Exchange Fetchers ====================

async function fetchHyperliquidBook(
  coin: string,
  signal?: AbortSignal,
): Promise<NormalizedBook | null> {
  try {
    const fullData = await fetchL2Book(coin, signal);
    if (!fullData?.levels || fullData.levels.length < 2) return null;

    const bids: BookLevel[] = fullData.levels[0].map((l) => ({
      price: Number.parseFloat(l.px),
      qty: Number.parseFloat(l.sz),
    })).filter((l) => l.price > 0 && l.qty > 0);

    const asks: BookLevel[] = fullData.levels[1].map((l) => ({
      price: Number.parseFloat(l.px),
      qty: Number.parseFloat(l.sz),
    })).filter((l) => l.price > 0 && l.qty > 0);

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

async function fetchGateioBook(
  contract: string,
  signal?: AbortSignal,
): Promise<NormalizedBook | null> {
  try {
    const response = await fetch(
      `/api/gate/futures/usdt/order_book?contract=${encodeURIComponent(contract)}&limit=20`,
      { signal, cache: "no-store" },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids: Array<{ p: string; s: number }>;
      asks: Array<{ p: string; s: number }>;
    };

    const multiplier = gateMultiplierCache.get(contract) ?? (await getGateMultiplier(contract, signal)) ?? 1;

    const bids: BookLevel[] = (data.bids ?? []).map((l) => ({
      price: Number.parseFloat(l.p),
      qty: l.s * multiplier, // contracts → base asset
    })).filter((l) => l.price > 0 && l.qty > 0);

    const asks: BookLevel[] = (data.asks ?? []).map((l) => ({
      price: Number.parseFloat(l.p),
      qty: l.s * multiplier,
    })).filter((l) => l.price > 0 && l.qty > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

async function fetchBinanceBook(
  symbol: string,
  signal?: AbortSignal,
): Promise<NormalizedBook | null> {
  try {
    const response = await binanceFetch(
      "depth",
      `symbol=${encodeURIComponent(symbol)}&limit=20`,
      { signal },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
    };

    const bids: BookLevel[] = (data.bids ?? []).map(([px, qty]) => ({
      price: Number.parseFloat(px),
      qty: Number.parseFloat(qty),
    })).filter((l) => l.price > 0 && l.qty > 0);

    const asks: BookLevel[] = (data.asks ?? []).map(([px, qty]) => ({
      price: Number.parseFloat(px),
      qty: Number.parseFloat(qty),
    })).filter((l) => l.price > 0 && l.qty > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

async function fetchOkxBook(
  instId: string,
  signal?: AbortSignal,
): Promise<NormalizedBook | null> {
  try {
    const response = await fetch(
      `/api/okx?endpoint=market/books&instId=${encodeURIComponent(instId)}&sz=20`,
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

    const bids: BookLevel[] = (book.bids ?? []).map(([px, sz]) => ({
      price: Number.parseFloat(px),
      qty: Number.parseFloat(sz),
    })).filter((l) => l.price > 0 && l.qty > 0);

    const asks: BookLevel[] = (book.asks ?? []).map(([px, sz]) => ({
      price: Number.parseFloat(px),
      qty: Number.parseFloat(sz),
    })).filter((l) => l.price > 0 && l.qty > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

async function fetchLighterBook(
  symbol: string,
  signal?: AbortSignal,
): Promise<NormalizedBook | null> {
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
      `market_id=${marketId}&limit=20`,
      { signal },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      bids?: Array<Record<string, unknown>>;
      asks?: Array<Record<string, unknown>>;
    };

    const parseLevel = (l: Record<string, unknown>): BookLevel | null => {
      const price = Number.parseFloat(String(l.price ?? ""));
      const qtyRaw = l.remaining_base_amount ?? l.size ?? l.base_amount ?? 0;
      const qty = Number.parseFloat(String(qtyRaw));
      if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) {
        return null;
      }
      return { price, qty };
    };

    const bids: BookLevel[] = (data.bids ?? []).map(parseLevel).filter((l): l is BookLevel => l !== null);
    const asks: BookLevel[] = (data.asks ?? []).map(parseLevel).filter((l): l is BookLevel => l !== null);

    return { bids, asks };
  } catch {
    return null;
  }
}

// ==================== Unified Entry Point ====================

/**
 * Fetch order book depth and compute impact spread for any exchange.
 *
 * @returns spread percentage (number), "insufficient" if book is available
 *          but total depth < notionalUsd on either side, or null if the
 *          book could not be fetched at all.
 */
export async function fetchImpactSpread(
  exchange: string,
  rawSymbol: string,
  signal?: AbortSignal,
  notionalUsd: number = DEFAULT_IMPACT_NOTIONAL,
): Promise<number | "insufficient" | null> {
  let book: NormalizedBook | null = null;

  switch (exchange) {
    case "Hyperliquid":
      book = await fetchHyperliquidBook(rawSymbol, signal);
      break;
    case "Gate.io":
      book = await fetchGateioBook(rawSymbol, signal);
      break;
    case "Binance":
      book = await fetchBinanceBook(rawSymbol, signal);
      break;
    case "OKX":
      book = await fetchOkxBook(rawSymbol, signal);
      break;
    case "Lighter":
      book = await fetchLighterBook(rawSymbol, signal);
      break;
    default:
      return null;
  }

  if (!book) return null; // fetch error
  const spread = computeImpactSpread(book, notionalUsd);
  if (spread === null) return "insufficient"; // book ok, depth < notional
  return spread;
}
