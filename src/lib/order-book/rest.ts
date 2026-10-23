import { normalizeBookLevels } from "../order-book-impact";
import { spotFetch } from "../spot-fetch";
import { buildSpotUpstreamRequest } from "../spot-upstream";
import { fetchL2Book } from "../hyperliquid";
import { getGateOrderBook } from "../gateio";
import { binanceFetch } from "../adapters/binance";
import { okxFetch } from "../adapters/okx";
import { lighterFetch } from "../lighter";
import { fetchBitgetOrderBook } from "../adapters/bitget";
import { fetchBybitOrderBook } from "../adapters/bybit";
import { throwIfAborted } from "../utils/abort";
import { clampRpiDepth, normalizeSpotRpiOrderBook } from "../rpi-book";
import type { BookFrame, BookTarget, BookMode } from "./types";
import { BookError } from "./types";
import { getBookQuantityMultiplier } from "./metadata";

const slugs: Record<BookTarget["exchange"], string> = { Hyperliquid: "hyperliquid", "Gate.io": "gateio", Binance: "binance", Lighter: "lighter", OKX: "okx", Bitget: "bitget", Bybit: "bybit" };
type RawBook = { bids: unknown; asks: unknown; time?: unknown; sequence?: unknown; route: string };
type PerpAdapterBook = { bids: Array<{ price: number; baseQty: number }>; asks: Array<{ price: number; baseQty: number }> } | null;
export interface OrderBookRestDependencies {
  fetchBitgetOrderBook?: (symbol: string, limit: number, signal: AbortSignal | undefined, request: undefined, mode: BookMode) => Promise<PerpAdapterBook>;
  fetchBybitOrderBook?: (symbol: string, limit: number, signal: AbortSignal | undefined, request: undefined, mode: BookMode) => Promise<PerpAdapterBook>;
}
type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as JsonObject : null;
function fail(_message: string): never { throw new BookError("invalid-payload", "交易所返回的盘口数据格式无效"); }
function httpError(response: Response): never {
  throw new BookError(response.status === 401 || response.status === 403 ? "unauthorized" : "network", response.status === 401 || response.status === 403 ? "交易所拒绝了盘口请求" : "盘口请求失败，请稍后重试");
}
function aggregateSamePrice(levels: ReturnType<typeof normalizeBookLevels>): ReturnType<typeof normalizeBookLevels> {
  const byPrice = new Map<number, number>();
  for (const level of levels) byPrice.set(level.price, (byPrice.get(level.price) ?? 0) + level.quantity);
  return [...byPrice].map(([price, quantity]) => ({ price, quantity }));
}
async function fetchSpot(target: BookTarget, mode: BookMode, signal?: AbortSignal): Promise<RawBook> {
  const exchange = target.exchange;
  if (exchange === "Hyperliquid") {
    if (mode === "rpi") throw new BookError("unsupported", "Hyperliquid 不支持 RPI 盘口");
    const data = await fetchL2Book(target.rawSymbol, signal);
    if (!data) return fail("Hyperliquid returned no order book");
    return { bids: data.levels[0], asks: data.levels[1], route: "/info" };
  }
  if (mode === "rpi" && ["Hyperliquid", "Lighter", "Binance"].includes(exchange)) throw new BookError("unsupported", `${exchange} 不支持 RPI 盘口`);
  if (target.isRealityToken && exchange === "Bitget") {
    if (mode === "rpi") throw new BookError("unsupported", "Bitget Reality Token 不支持 RPI 盘口");
    const params = new URLSearchParams({ action: "realityBook", symbol: target.rawSymbol, limit: "50" });
    const response = await spotFetch(exchange, params, { signal });
    throwIfAborted(signal); if (!response.ok) httpError(response);
    const body: unknown = await response.json(); const root = object(body); const data = object(root?.data);
    if (root?.code !== "00000") return fail("Bitget Reality response error");
    return { bids: data?.b, asks: data?.a, time: data?.ts, sequence: data?.seq, route: "/api/v3/market/orderbook" };
  }
  const limit = exchange === "Lighter" ? 250 : exchange === "Bybit" ? (mode === "rpi" ? clampRpiDepth(exchange, "spot", 100) : 50) : exchange === "Bitget" ? 50 : 100;
  if (exchange === "Lighter" && (!Number.isSafeInteger(target.marketId) || (target.marketId ?? -1) < 0)) throw new BookError("unsupported", "Lighter 盘口需要有效的 marketId");
  const params = new URLSearchParams({ action: "book", ...(exchange === "Lighter" ? { marketId: String(target.marketId) } : { symbol: target.rawSymbol }), limit: String(limit), ...(mode === "rpi" ? { rpi: "1" } : {}) });
  const built = buildSpotUpstreamRequest(slugs[exchange], params);
  if (typeof built === "string") throw new BookError("unsupported", built);
  const response = await spotFetch(exchange, params, { signal });
  throwIfAborted(signal); if (!response.ok) httpError(response);
  const body: unknown = await response.json(); const root = object(body);
  if (!root) return fail("Invalid order book payload");
  if (exchange === "Bitget" && root.code !== "00000") return fail("Bitget returned an error envelope");
  if (exchange === "OKX" && root.code !== "0") return fail("OKX returned an error envelope");
  if (exchange === "Bybit" && root.retCode !== 0) return fail("Bybit returned an error envelope");
  if (mode === "rpi") {
    const normalized = normalizeSpotRpiOrderBook(exchange, root);
    if (!normalized) return fail(`${exchange} RPI returned an invalid order book envelope`);
    const data = object(root.data);
    const row = Array.isArray(root.data) ? object(root.data[0]) : data;
    const time = exchange === "Bybit" ? object(root.result)?.ts : row?.ts ?? root.current ?? root.update;
    const sequence = exchange === "Bybit" ? object(root.result)?.u : row?.seqId ?? row?.seq ?? root.id;
    return { bids: normalized.bids, asks: normalized.asks, time, sequence, route: built.url.replace(/^https?:\/\/[^/]+/, "") };
  }
  let bids: unknown, asks: unknown, time: unknown, sequence: unknown;
  if (exchange === "Bitget") { const data = object(root.data); bids = data?.bids; asks = data?.asks; time = data?.ts; sequence = data?.seq; }
  else if (exchange === "OKX") { const data = Array.isArray(root.data) ? object(root.data[0]) : null; bids = data?.bids; asks = data?.asks; time = data?.ts; sequence = data?.seqId; }
  else if (exchange === "Bybit") { const result = object(root.result); bids = result?.b; asks = result?.a; time = result?.ts; sequence = result?.u; if (root.retCode !== 0) return fail("Bybit returned an error envelope"); }
  else if (exchange === "Lighter") { bids = root.bids; asks = root.asks; time = root.timestamp; sequence = root.block_height; }
  else if (exchange === "Gate.io") { bids = root.bids; asks = root.asks; time = root.update ?? root.current; sequence = root.id; }
  else { bids = root.bids; asks = root.asks; time = root.E; sequence = root.lastUpdateId; }
  return { bids, asks, time, sequence, route: built.url.replace(/^https?:\/\/[^/]+/, "") };
}

async function getRaw(target: BookTarget, mode: BookMode, signal?: AbortSignal, dependencies: OrderBookRestDependencies = {}): Promise<RawBook> {
  if (target.kind === "spot") return fetchSpot(target, mode, signal);
  if (mode === "rpi" && ["Hyperliquid", "Lighter"].includes(target.exchange)) throw new BookError("unsupported", `${target.exchange} 不支持 RPI 盘口`);
  const exchange = target.exchange;
  if (exchange === "Hyperliquid") {
    const data = await fetchL2Book(target.rawSymbol, signal); if (!data) return fail("Hyperliquid returned no order book");
    return { bids: data.levels[0], asks: data.levels[1], route: "/info" };
  }
  if (exchange === "Gate.io") {
    const data = await getGateOrderBook(target.rawSymbol, 100, signal, mode === "rpi"); if (!data) return fail("Gate.io returned no order book");
    const payload = data as unknown as Record<string, unknown>;
    const seconds = Number(payload.update ?? payload.current);
    return { bids: data.bids, asks: data.asks, time: Number.isFinite(seconds) ? seconds * 1000 : null, sequence: payload.id, route: mode === "rpi" ? "/api/v4/futures/usdt/rpi_order_book" : "/api/v4/futures/usdt/order_book" };
  }
  if (exchange === "Binance") {
    const endpoint = mode === "rpi" ? "rpiDepth" : "depth"; const response = await binanceFetch(endpoint, `symbol=${encodeURIComponent(target.rawSymbol)}&limit=${mode === "rpi" ? 1000 : 100}`, { signal });
    throwIfAborted(signal); if (!response.ok) httpError(response); const d = await response.json(); return { bids: d.bids, asks: d.asks, time: d.E, sequence: d.lastUpdateId, route: `/fapi/v1/${endpoint}` };
  }
  if (exchange === "OKX") {
    const endpoint = mode === "rpi" ? "market/books-rpi" : "market/books"; const response = await okxFetch(`/api/okx?endpoint=${endpoint}&instId=${encodeURIComponent(target.rawSymbol)}&sz=${mode === "rpi" ? 50 : 5}`, { signal });
    throwIfAborted(signal); if (!response.ok) httpError(response); const raw: unknown = await response.json(); const d = object(raw); const rows = d && Array.isArray(d.data) ? d.data : []; const row = d?.code === "0" ? object(rows[0]) : null; if (!row) return fail("OKX returned an error envelope"); return { bids: row.bids, asks: row.asks, time: row.ts, sequence: row.seqId, route: `/api/v5/${endpoint}` };
  }
  if (exchange === "Lighter") {
    if (!Number.isSafeInteger(target.marketId) || (target.marketId ?? -1) < 0) throw new BookError("unsupported", "Lighter 盘口需要有效的 marketId");
    const response = await lighterFetch("orderBookOrders", `market_id=${encodeURIComponent(String(target.marketId))}&limit=250`, { signal }); throwIfAborted(signal); if (!response.ok) httpError(response); const raw: unknown = await response.json(); const d = object(raw); if (!d) return fail("Lighter returned an invalid order book envelope"); return { bids: d.bids, asks: d.asks, time: d.timestamp, sequence: d.block_height, route: "/api/v1/orderBookOrders" };
  }
  const limit = mode === "rpi" ? clampRpiDepth(exchange, "perp", 100) : 100;
  const book = exchange === "Bitget"
    ? await (dependencies.fetchBitgetOrderBook ?? fetchBitgetOrderBook)(target.rawSymbol, limit, signal, undefined, mode)
    : await (dependencies.fetchBybitOrderBook ?? fetchBybitOrderBook)(target.rawSymbol, limit, signal, undefined, mode);
  if (!book) return fail(`${exchange} returned no order book`);
  return { bids: book.bids.map(level => [level.price, level.baseQty]), asks: book.asks.map(level => [level.price, level.baseQty]), route: exchange === "Bybit" ? (mode === "rpi" ? "/v5/market/rpi_orderbook" : "/v5/market/orderbook") : (mode === "rpi" ? "/api/v3/market/rpi-orderbook" : "/api/v3/market/orderbook") };
}

async function fetchOrderBookRestWithDependencies(target: BookTarget, options: { bookMode: BookMode; signal?: AbortSignal }, dependencies: OrderBookRestDependencies): Promise<BookFrame> {
  const { bookMode, signal } = options; throwIfAborted(signal);
  try {
    const raw = await getRaw(target, bookMode, signal, dependencies); throwIfAborted(signal);
    const multiplier = await getBookQuantityMultiplier(target, signal);
    const normalize = (levels: unknown, side: "bid" | "ask") => {
      const normalized = normalizeBookLevels(levels, side);
      return (target.exchange === "Lighter" ? aggregateSamePrice(normalized) : normalized).map(x => ({ ...x, quantity: x.quantity * multiplier }));
    };
    const bids = normalize(raw.bids, "bid");
    const asks = normalize(raw.asks, "ask");
    if (!Array.isArray(raw.bids) || !Array.isArray(raw.asks) || (!bids.length && !asks.length)) return fail("Order book has no valid levels");
    const time = raw.time == null ? null : Number(raw.time);
    return { targetId: target.id, book: { bids, asks }, quantityUnit: "base", baseAsset: target.baseAsset, source: { transport: "rest", bookMode, route: raw.route }, exchangeTimeMs: time !== null && Number.isFinite(time) ? time : null, receivedAtMs: Date.now(), sequence: raw.sequence == null ? null : String(raw.sequence) };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (error instanceof BookError) throw error;
    throw new BookError("network", "盘口请求失败，请检查网络后重试");
  }
}

export function createOrderBookRestFetcher(dependencies: OrderBookRestDependencies) {
  return (target: BookTarget, options: { bookMode: BookMode; signal?: AbortSignal }) =>
    fetchOrderBookRestWithDependencies(target, options, dependencies);
}

export function fetchOrderBookRest(target: BookTarget, options: { bookMode: BookMode; signal?: AbortSignal }): Promise<BookFrame> {
  return fetchOrderBookRestWithDependencies(target, options, {});
}
