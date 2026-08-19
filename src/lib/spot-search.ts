import { fetchSpotCandlesWithLimit, type SpotCandlePoint } from "./spot-search-candles";
import { spotFetch } from "./spot-fetch";

export type SpotExchangeName =
  | "Hyperliquid"
  | "Gate.io"
  | "Binance"
  | "Lighter"
  | "OKX"
  | "Bitget"
  | "Bybit";

export interface SpotMarketRow {
  exchange: SpotExchangeName;
  exchangeColor: string;
  pair: string;
  baseAsset: string;
  quoteAsset: string;
  rawSymbol: string;
  marketKey: string;
  marketId?: number;
  midPrice: number;
  lastPrice?: number;
  bestBid?: number;
  bestAsk?: number;
  change24h: number;
  quoteVolume: number;
  baseVolume: number;
  fetchedAt: number;
}

export interface SpotDetailResult {
  historicalVolatility: number | null;
  topSpread: number | null;
  topSpreadSource: SpotTopSpreadSource | null;
  bestBid?: number;
  bestAsk?: number;
}

export type SpotTopSpreadSource = "orderbook" | "ticker-bbo";

const EXCHANGE_COLORS: Record<SpotExchangeName, string> = {
  Hyperliquid: "blue",
  "Gate.io": "cyan",
  Binance: "yellow",
  Lighter: "purple",
  OKX: "emerald",
  Bitget: "teal",
  Bybit: "orange",
};

const QUOTES = [
  "USDT", "USDC", "USD1", "FDUSD", "TUSD", "USDE", "DAI", "USD", "BTC", "ETH", "BNB", "EUR", "TRY", "BRL", "U",
] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = object(payload);
  if (!root) return [];
  if (Array.isArray(root.data)) return root.data;
  return [];
}

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positive(value: unknown): number | undefined {
  const parsed = number(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function splitPair(symbol: string): [string, string] {
  const clean = symbol.trim().toUpperCase();
  for (const separator of ["/", "_", "-"]) {
    const index = clean.lastIndexOf(separator);
    if (index > 0 && index < clean.length - 1) return [clean.slice(0, index), clean.slice(index + 1)];
  }
  const quote = [...QUOTES].sort((a, b) => b.length - a.length)
    .find((candidate) => clean.length > candidate.length && clean.endsWith(candidate));
  return quote ? [clean.slice(0, -quote.length), quote] : [clean, ""];
}

function makeRow(
  exchange: SpotExchangeName,
  rawSymbol: string,
  fields: {
    baseAsset?: string;
    quoteAsset?: string;
    marketKey?: string;
    marketId?: number;
    midPrice?: number;
    lastPrice?: number;
    bestBid?: number;
    bestAsk?: number;
    change24h?: number;
    quoteVolume?: number;
    baseVolume?: number;
  },
  fetchedAt: number,
): SpotMarketRow | null {
  const split = splitPair(rawSymbol);
  const baseAsset = (fields.baseAsset || split[0]).toUpperCase();
  const quoteAsset = (fields.quoteAsset || split[1]).toUpperCase();
  if (!baseAsset || !quoteAsset) return null;
  const bestBid = positive(fields.bestBid);
  const bestAsk = positive(fields.bestAsk);
  const lastPrice = positive(fields.lastPrice);
  const suppliedMid = positive(fields.midPrice);
  const midPrice = suppliedMid ?? (bestBid && bestAsk ? (bestBid + bestAsk) / 2 : lastPrice);
  if (!midPrice) return null;
  return {
    exchange,
    exchangeColor: EXCHANGE_COLORS[exchange],
    pair: `${baseAsset}/${quoteAsset}`,
    baseAsset,
    quoteAsset,
    rawSymbol,
    marketKey: fields.marketKey ?? rawSymbol,
    ...(fields.marketId === undefined ? {} : { marketId: fields.marketId }),
    midPrice,
    ...(lastPrice === undefined ? {} : { lastPrice }),
    ...(bestBid === undefined ? {} : { bestBid }),
    ...(bestAsk === undefined ? {} : { bestAsk }),
    change24h: number(fields.change24h) ?? 0,
    quoteVolume: Math.max(0, number(fields.quoteVolume) ?? 0),
    baseVolume: Math.max(0, number(fields.baseVolume) ?? 0),
    fetchedAt,
  };
}

/** Stable identity for rendering, selection and caches. */
export function spotMarketIdentity(row: Pick<SpotMarketRow, "exchange" | "marketKey">): string {
  return `${row.exchange}:${row.marketKey}`;
}

export const getSpotMarketIdentity = spotMarketIdentity;
export const spotMarketKey = spotMarketIdentity;

export function filterSpotMarkets(rows: readonly SpotMarketRow[], keyword: string): SpotMarketRow[] {
  const query = keyword.trim().toLowerCase();
  if (!query) return [...rows];
  return rows.filter((row) => [row.pair, row.baseAsset, row.quoteAsset]
    .some((value) => value.toLowerCase().includes(query)));
}

function normalizeHyperliquid(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  if (!Array.isArray(payload) || payload.length < 2) return [];
  const meta = object(payload[0]);
  const contexts = Array.isArray(payload[1]) ? payload[1] : [];
  const universe = Array.isArray(meta?.universe) ? meta.universe : [];
  const tokenNames = new Map<number, string>();
  for (const tokenValue of Array.isArray(meta?.tokens) ? meta.tokens : []) {
    const token = object(tokenValue);
    const index = number(token?.index);
    if (index !== undefined && typeof token?.name === "string") tokenNames.set(index, token.name.toUpperCase());
  }
  const result: SpotMarketRow[] = [];
  universe.forEach((marketValue, position) => {
    const market = object(marketValue);
    const marketIndex = number(market?.index) ?? position;
    // assetCtxs is indexed by market index, not universe position (indices have gaps after delistings)
    const context = object(contexts[marketIndex]);
    const tokens = Array.isArray(market?.tokens) ? market.tokens : [];
    const base = tokenNames.get(number(tokens[0]) ?? -1);
    const quote = tokenNames.get(number(tokens[1]) ?? -1);
    const fallback = typeof market?.name === "string" ? splitPair(market.name) : ["", ""];
    const baseAsset = base ?? fallback[0];
    const quoteAsset = quote ?? fallback[1];
    const transportSymbol = baseAsset === "PURR" && quoteAsset === "USDC"
      ? "PURR/USDC"
      : `@${marketIndex}`;
    const mid = positive(context?.midPx) ?? positive(context?.markPx);
    const previous = positive(context?.prevDayPx);
    const row = makeRow("Hyperliquid", transportSymbol, {
      baseAsset,
      quoteAsset,
      marketKey: transportSymbol,
      midPrice: mid,
      change24h: mid && previous ? ((mid - previous) / previous) * 100 : 0,
      quoteVolume: number(context?.dayNtlVlm),
      baseVolume: number(context?.dayBaseVlm),
    }, fetchedAt);
    if (row) result.push(row);
  });
  return result;
}

function normalizeGate(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  return arrayPayload(payload).flatMap((value) => {
    const row = object(value);
    if (!row || typeof row.currency_pair !== "string") return [];
    const normalized = makeRow("Gate.io", row.currency_pair, {
      lastPrice: number(row.last), bestBid: number(row.highest_bid), bestAsk: number(row.lowest_ask),
      change24h: number(row.change_percentage), quoteVolume: number(row.quote_volume), baseVolume: number(row.base_volume),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

function normalizeBinance(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  return arrayPayload(payload).flatMap((value) => {
    const row = object(value);
    if (!row || typeof row.symbol !== "string") return [];
    const normalized = makeRow("Binance", row.symbol, {
      lastPrice: number(row.lastPrice), bestBid: number(row.bidPrice), bestAsk: number(row.askPrice),
      change24h: number(row.priceChangePercent), quoteVolume: number(row.quoteVolume), baseVolume: number(row.volume),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

function normalizeOkx(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  return arrayPayload(payload).flatMap((value) => {
    const row = object(value);
    if (!row || typeof row.instId !== "string") return [];
    const last = positive(row.last);
    const open = positive(row.open24h);
    const normalized = makeRow("OKX", row.instId, {
      lastPrice: last, bestBid: number(row.bidPx), bestAsk: number(row.askPx),
      change24h: last && open ? ((last - open) / open) * 100 : 0,
      quoteVolume: number(row.volCcy24h), baseVolume: number(row.vol24h),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

function normalizeBitget(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  return arrayPayload(payload).flatMap((value) => {
    const row = object(value);
    if (!row || typeof row.symbol !== "string") return [];
    const normalized = makeRow("Bitget", row.symbol, {
      baseAsset: typeof row.baseCoin === "string" ? row.baseCoin : undefined,
      quoteAsset: typeof row.quoteCoin === "string" ? row.quoteCoin : undefined,
      lastPrice: number(row.lastPr ?? row.last),
      bestBid: number(row.bidPr ?? row.bid1Pr), bestAsk: number(row.askPr ?? row.ask1Pr),
      change24h: (number(row.change24h) ?? 0) * 100,
      quoteVolume: number(row.quoteVolume ?? row.usdtVolume), baseVolume: number(row.baseVolume),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

function normalizeLighter(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  const root = object(payload);
  const values = Array.isArray(root?.spot_order_book_details)
    ? root.spot_order_book_details
    : Array.isArray(root?.order_book_details) ? root.order_book_details : arrayPayload(payload);
  return values.flatMap((value) => {
    const row = object(value);
    const marketId = number(row?.market_id);
    const symbol = typeof row?.symbol === "string" ? row.symbol : typeof row?.market_symbol === "string" ? row.market_symbol : "";
    if (!row || marketId === undefined || !symbol) return [];
    const normalized = makeRow("Lighter", symbol, {
      marketId, marketKey: String(marketId), lastPrice: number(row.last_trade_price),
      bestBid: number(row.best_bid ?? row.bid_price), bestAsk: number(row.best_ask ?? row.ask_price),
      change24h: number(row.daily_price_change), quoteVolume: number(row.daily_quote_token_volume),
      baseVolume: number(row.daily_base_token_volume),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

/** V5 spot tickers envelope: `{ retCode, result: { list: [...] } }`. */
function bybitSpotList(payload: unknown): unknown[] {
  const result = object(object(payload)?.result);
  return Array.isArray(result?.list) ? result.list : [];
}

function normalizeBybit(payload: unknown, fetchedAt: number): SpotMarketRow[] {
  return bybitSpotList(payload).flatMap((value) => {
    const row = object(value);
    if (!row || typeof row.symbol !== "string") return [];
    const normalized = makeRow("Bybit", row.symbol, {
      lastPrice: number(row.lastPrice),
      bestBid: number(row.bid1Price), bestAsk: number(row.ask1Price),
      // V5 price24hPcnt is a fraction (e.g. "0.025" = 2.5%), same as the perp adapter.
      change24h: (number(row.price24hPcnt) ?? 0) * 100,
      quoteVolume: number(row.turnover24h), baseVolume: number(row.volume24h),
    }, fetchedAt);
    return normalized ? [normalized] : [];
  });
}

export function normalizeSpotMarkets(exchange: SpotExchangeName, payload: unknown, fetchedAt = Date.now()): SpotMarketRow[] {
  switch (exchange) {
    case "Hyperliquid": return normalizeHyperliquid(payload, fetchedAt);
    case "Gate.io": return normalizeGate(payload, fetchedAt);
    case "Binance": return normalizeBinance(payload, fetchedAt);
    case "Lighter": return normalizeLighter(payload, fetchedAt);
    case "OKX": return normalizeOkx(payload, fetchedAt);
    case "Bitget": return normalizeBitget(payload, fetchedAt);
    case "Bybit": return normalizeBybit(payload, fetchedAt);
  }
}

const EXCHANGES: SpotExchangeName[] = ["Hyperliquid", "Gate.io", "Binance", "Lighter", "OKX", "Bitget", "Bybit"];

export async function fetchAllSpotMarkets(signal?: AbortSignal): Promise<SpotMarketRow[]> {
  const settled = await Promise.allSettled(EXCHANGES.map(async (exchange) => {
    const response = await spotFetch(exchange, new URLSearchParams({ action: "list" }), { signal });
    if (!response.ok) throw new Error(`${exchange} spot list failed (${response.status})`);
    return normalizeSpotMarkets(exchange, await response.json());
  }));
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export function calculateSpotHistoricalVolatility(candles: readonly Pick<SpotCandlePoint, "close">[]): number | null {
  const closes = candles.map((candle) => Number(candle.close)).filter((close) => Number.isFinite(close) && close > 0);
  if (closes.length < 3) return null;
  const returns = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

export const computeSpotHistoricalVolatility = calculateSpotHistoricalVolatility;

function spread(bestBid?: number, bestAsk?: number): number | null {
  if (!bestBid || !bestAsk) return null;
  const mid = (bestBid + bestAsk) / 2;
  return mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : null;
}

function bookQuery(row: SpotMarketRow, limit: number): string {
  const params = new URLSearchParams({ action: "book", limit: String(limit) });
  if (row.exchange === "Lighter" && row.marketId !== undefined) params.set("marketId", String(row.marketId));
  else params.set("symbol", row.rawSymbol);
  return params.toString();
}

function readBestPrices(exchange: SpotExchangeName, payload: unknown): { bestBid?: number; bestAsk?: number } {
  const root = object(payload);
  let bids: unknown = root?.bids;
  let asks: unknown = root?.asks;
  if (exchange === "Hyperliquid" && Array.isArray(root?.levels)) [bids, asks] = root.levels;
  if (exchange === "OKX" && Array.isArray(root?.data)) {
    const first = object(root.data[0]); bids = first?.bids; asks = first?.asks;
  }
  if (exchange === "Bitget" && root?.data) {
    const data = object(root.data); bids = data?.bids; asks = data?.asks;
  }
  if (exchange === "Bybit" && root?.result) {
    const result = object(root.result); bids = result?.b; asks = result?.a;
  }
  const priceAt = (levels: unknown): number | undefined => {
    if (!Array.isArray(levels) || levels.length === 0) return undefined;
    const first = levels[0];
    return positive(Array.isArray(first) ? first[0] : object(first)?.price ?? object(first)?.px);
  };
  return { bestBid: priceAt(bids), bestAsk: priceAt(asks) };
}

function hasCompleteBbo(prices: { bestBid?: number; bestAsk?: number }): boolean {
  return positive(prices.bestBid) !== undefined && positive(prices.bestAsk) !== undefined;
}

async function readBitgetReality(row: SpotMarketRow, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await spotFetch(
      row.exchange,
      new URLSearchParams({ action: "instrument", symbol: row.rawSymbol }),
      { signal },
    );
    if (!response.ok) return false;
    const payload = await response.json();
    return arrayPayload(payload).some((value) => {
      const instrument = object(value);
      return instrument?.symbol === row.rawSymbol && instrument?.isReality === "yes";
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

export async function fetchSpotDetail(row: SpotMarketRow, signal?: AbortSignal): Promise<SpotDetailResult> {
  const [candles, bookResponse] = await Promise.all([
    fetchSpotCandlesWithLimit(row, "1d", 30, signal),
    spotFetch(row.exchange, new URLSearchParams(bookQuery(row, 1)), { signal }),
  ]);
  if (!bookResponse.ok) throw new Error(`${row.exchange} spot book failed (${bookResponse.status})`);
  let prices = readBestPrices(row.exchange, await bookResponse.json());
  let topSpreadSource: SpotTopSpreadSource | null = hasCompleteBbo(prices) ? "orderbook" : null;
  if (row.exchange === "Bitget" && topSpreadSource === null && await readBitgetReality(row, signal)) {
    const tickerPrices = { bestBid: positive(row.bestBid), bestAsk: positive(row.bestAsk) };
    if (hasCompleteBbo(tickerPrices)) {
      prices = tickerPrices;
      topSpreadSource = "ticker-bbo";
    }
  }
  return {
    historicalVolatility: calculateSpotHistoricalVolatility(candles.candles),
    topSpread: spread(prices.bestBid, prices.bestAsk),
    topSpreadSource,
    ...prices,
  };
}
