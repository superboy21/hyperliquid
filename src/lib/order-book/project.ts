import { marketId, type ArbitrageMarket } from "../spot-perp-arbitrage/model";
import { isUsdQuote } from "./quote";
import type { BookTarget, NormalizedOrderBook, ProjectedBook, ProjectedBookLevel, SpotExchangeName } from "./types";

const EXCHANGES: readonly SpotExchangeName[] = ["Hyperliquid", "Gate.io", "Binance", "Lighter", "OKX", "Bitget", "Bybit"];
/**
 * Known USD-pegged quote names for *contiguous* symbols only. Longest first so
 * `BTCFDUSD` splits on FDUSD instead of on the trailing USD.
 */
const CONTIGUOUS_USD_QUOTES = ["FDUSD", "USDT", "USDC", "USD1", "BUSD", "USDE", "TUSD", "USD"]
  .sort((a, b) => b.length - a.length);

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pairAssets(value: string): [string, string] | null {
  const pair = value.replace(/-SWAP$/i, "");
  const separator = Math.max(pair.lastIndexOf("_"), pair.lastIndexOf("-"), pair.lastIndexOf("/"));
  // An explicit separator states where the pair splits, so any USD-pegged quote
  // name is accepted (FDUSD, USDD, USD1, USDE, ...) without maintaining a list.
  // A separated pair whose quote is not USD stays unresolved rather than being
  // re-interpreted as a contiguous symbol.
  if (separator > 0 && separator < pair.length - 1) {
    const quote = pair.slice(separator + 1);
    return isUsdQuote(quote) ? [pair.slice(0, separator), quote] : null;
  }
  // Contiguous symbols state no boundary. Only strip a known USD quote name;
  // never invent a base/quote split from an arbitrary `USD` substring.
  const upper = pair.toUpperCase();
  const quote = CONTIGUOUS_USD_QUOTES.find(
    (candidate) => upper.length > candidate.length && upper.endsWith(candidate),
  );
  return quote ? [pair.slice(0, -quote.length), pair.slice(-quote.length)] : null;
}

function fallbackPerpSymbol(exchange: SpotExchangeName, symbol: string): string | null {
  if (!present(symbol)) return null;
  if (exchange === "Hyperliquid" || exchange === "Lighter") return symbol;
  if (exchange === "Bitget" || exchange === "Bybit") return null;
  const assets = pairAssets(symbol) ?? [symbol, "USDT"];
  if (exchange === "Gate.io") return `${assets[0]}_${assets[1]}`;
  if (exchange === "OKX") return `${assets[0]}-${assets[1]}-SWAP`;
  return `${assets[0]}${assets[1]}`;
}

/** Resolve selected market identity, never normalize away a venue-native prefix. */
export function toBookTarget(market: ArbitrageMarket): BookTarget | null {
  const source = market.source;
  const exchange = source.exchange;
  if (!EXCHANGES.includes(exchange)) return null;
  const numericId = source.marketId;
  const validMarketId = typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId >= 0;
  if (exchange === "Lighter" && !validMarketId) return null;
  let rawSymbol = present(source.rawSymbol) ? source.rawSymbol : null;
  if ((exchange === "Bitget" || exchange === "Bybit") && rawSymbol === null) return null;

  let assets: [string, string] | null;
  if (market.kind === "spot") {
    const spot = market.source;
    if (!present(spot.baseAsset) || !present(spot.quoteAsset)) return null;
    assets = [spot.baseAsset, spot.quoteAsset];
    if (rawSymbol === null) {
      if (exchange === "Gate.io") rawSymbol = `${assets[0]}_${assets[1]}`;
      else if (exchange === "Binance") rawSymbol = `${assets[0]}${assets[1]}`;
      else if (exchange === "OKX") rawSymbol = `${assets[0]}-${assets[1]}`;
      else if (exchange === "Lighter") rawSymbol = assets[0];
      else return null; // Hyperliquid spot @index cannot be recovered from a display pair.
    }
  } else {
    const perp = market.source;
    rawSymbol ??= fallbackPerpSymbol(exchange, perp.symbol);
    if (rawSymbol === null) return null;
    if (exchange === "Hyperliquid") {
      const base = rawSymbol.slice(rawSymbol.lastIndexOf(":") + 1);
      assets = present(base) ? [base, "USDC"] : null;
    } else if (exchange === "Lighter") {
      assets = pairAssets(rawSymbol) ?? (present(perp.symbol) && !/^Market \d+$/i.test(perp.symbol)
        ? [perp.symbol, "USDC"] : null);
    } else assets = pairAssets(rawSymbol);
  }
  if (rawSymbol === null || assets === null || !present(assets[0]) || !present(assets[1])) return null;
  return {
    id: marketId(market), exchange, kind: market.kind, rawSymbol,
    ...(validMarketId ? { marketId: numericId } : {}),
    baseAsset: assets[0], quoteAsset: assets[1],
    ...(market.kind === "spot" && market.source.isRealityToken !== undefined
      ? { isRealityToken: market.source.isRealityToken } : {}),
  };
}

/** Aggregate actual price levels before selecting the five nearest levels. */
export function projectOrderBook(book: NormalizedOrderBook): ProjectedBook {
  const side = (levels: NormalizedOrderBook["bids"], bid: boolean): ProjectedBookLevel[] => {
    const byPrice = new Map<number, number>();
    for (const { price, quantity } of levels) {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
      const total = (byPrice.get(price) ?? 0) + quantity;
      byPrice.set(price, total);
    }
    let cumulativeQuantity = 0;
    return [...byPrice]
      .filter(([, quantity]) => Number.isFinite(quantity))
      .sort(([a], [b]) => bid ? b - a : a - b)
      .slice(0, 5)
      .flatMap(([price, quantity], index) => {
        cumulativeQuantity += quantity;
        return Number.isFinite(cumulativeQuantity)
          ? [{ price, quantity, cumulativeQuantity, rank: index + 1 }]
          : [];
      });
  };
  return { bids: side(book.bids, true), asks: side(book.asks, false) };
}

/** Designer-facing name; retains the original core export for compatibility. */
export const projectFiveLevels = projectOrderBook;
