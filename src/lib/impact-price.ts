// ==================== Impact Price (VWAP) Calculation ====================
// Computes volume-weighted average price for a $1000 notional sweep
// across order book depth for all 5 exchanges.

import { fetchL2BookBestBidAsk } from "./hyperliquid";
import { lighterFetch, getMarketMap } from "./lighter";
import { binanceFetch } from "./adapters/binance";

const IMPACT_NOTIONAL_USD = 1000;

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
 * until cumulative notional >= $1000.
 * Returns null if total depth < $1000.
 */
function computeImpactPrice(book: NormalizedBook, side: "bid" | "ask"): number | null {
  const levels = side === "bid" ? book.bids : book.asks;
  if (levels.length === 0) return null;

  let cumulativeNotional = 0;
  let cumulativeQty = 0;

  for (const level of levels) {
    const levelNotional = level.price * level.qty;

    if (cumulativeNotional + levelNotional >= IMPACT_NOTIONAL_USD) {
      const remaining = IMPACT_NOTIONAL_USD - cumulativeNotional;
      const partialQty = remaining / level.price;
      cumulativeQty += partialQty;
      cumulativeNotional = IMPACT_NOTIONAL_USD;
      break;
    }

    cumulativeQty += level.qty;
    cumulativeNotional += levelNotional;
  }

  if (cumulativeNotional < IMPACT_NOTIONAL_USD || cumulativeQty <= 0) {
    return null; // insufficient depth
  }

  return IMPACT_NOTIONAL_USD / cumulativeQty;
}

/**
 * Compute impact spread from a normalized book.
 * Returns spread percentage, or null if insufficient depth on either side.
 */
function computeImpactSpread(book: NormalizedBook): number | null {
  const impactBid = computeImpactPrice(book, "bid");
  const impactAsk = computeImpactPrice(book, "ask");

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
  const data = await fetchL2BookBestBidAsk(coin, signal);
  if (!data) return null;

  // fetchL2BookBestBidAsk only returns top level, but we need full depth
  // Re-fetch with full levels
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin }),
      signal,
    });

    if (!response.ok) return null;

    const fullData = (await response.json()) as {
      levels: Array<Array<{ px: string; sz: string }>>;
    };

    if (!fullData.levels || fullData.levels.length < 2) return null;

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

    const multiplier = gateMultiplierCache.get(contract) ?? 1;

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
      `/api/okx?endpoint=market/books&instId=${encodeURIComponent(instId)}&sz=5`,
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
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    };

    const bids: BookLevel[] = (data.bids ?? []).map((l) => ({
      price: Number.parseFloat(l.price),
      qty: Number.parseFloat(l.size),
    })).filter((l) => l.price > 0 && l.qty > 0);

    const asks: BookLevel[] = (data.asks ?? []).map((l) => ({
      price: Number.parseFloat(l.price),
      qty: Number.parseFloat(l.size),
    })).filter((l) => l.price > 0 && l.qty > 0);

    return { bids, asks };
  } catch {
    return null;
  }
}

// ==================== Unified Entry Point ====================

/**
 * Fetch order book depth and compute impact spread for any exchange.
 * Returns spread percentage, or null if insufficient depth (< $1000).
 *
 * @param exchange - Exchange name: "Hyperliquid", "Gate.io", "Binance", "OKX", "Lighter"
 * @param rawSymbol - Raw API symbol: e.g. "BTC", "BTC_USDT", "BTCUSDT", "BTC-USDT-SWAP"
 * @param signal - Optional abort signal
 */
export async function fetchImpactSpread(
  exchange: string,
  rawSymbol: string,
  signal?: AbortSignal,
): Promise<number | null> {
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

  if (!book) return null;
  return computeImpactSpread(book);
}
