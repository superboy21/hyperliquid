// ==================== RPI (Retail Price Improvement) Book Mode ====================
// RPI 订单是改进散户成交价的特殊挂单，各交易所的普通 order book 均剔除 RPI 订单。
// 读取含 RPI 的盘口必须走各所专用 RPI 端点；端点失败时回退普通端点并提示用户。
// 端点格式详见 docs/rpi-mechanism-research-binance-bybit-gate.md。

import type { NormalizedBookLevel, NormalizedOrderBook } from "./order-book-impact";

/** 盘口数据源模式：普通盘口（剔除 RPI）或 RPI 盘口（含 RPI 订单）。 */
export type BookMode = "normal" | "rpi";

/**
 * 产品是否有 RPI book 端点。
 * 无端点的产品（Hyperliquid、Lighter、Binance 现货）在 RPI 模式下直接使用普通
 * 盘口，且不触发任何 RPI 回退提示（产品本身就不提供含 RPI 的盘口）。
 */
export function hasRpiEndpoint(exchange: string, kind: "spot" | "perp"): boolean {
  switch (exchange) {
    case "Binance":
      // USDⓈ-M 合约有 /fapi/v1/rpiDepth；现货无 RPI（/api/v3/rpiDepth 实测 404）。
      return kind === "perp";
    case "Gate.io":
    case "Bitget":
    case "Bybit":
    case "OKX":
      return true;
    default:
      return false; // Hyperliquid、Lighter
  }
}

// 各所 RPI 端点的最大深度档数（超过会被上游拒绝或截断）。
const RPI_DEPTH_CAPS: Record<string, number> = {
  "Binance:perp": 1000, // rpiDepth limit 固定 1000（官方仅支持 [1000]）
  "Bybit:spot": 50,     // rpi_orderbook limit ∈ [1, 50]
  "Bybit:perp": 50,
  "Bitget:spot": 200,   // rpi-orderbook spot 最大 200（官方文档 default 5）
  "Bitget:perp": 200,   // rpi-orderbook 合约最大 200
  "OKX:spot": 400,      // books-rpi sz 最大 400
  "OKX:perp": 400,
};

/** 将请求深度限制在 RPI 端点的档位上限内；无 RPI 端点的产品原样返回。 */
export function clampRpiDepth(exchange: string, kind: "spot" | "perp", depth: number): number {
  const cap = RPI_DEPTH_CAPS[`${exchange}:${kind}`];
  return cap !== undefined ? Math.min(depth, cap) : depth;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 解析普通两列档位 [price, qty]，按 side 排序（Gate/OKX/Binance 的 RPI 端点同构）。 */
function normalizePlainLevels(levels: unknown, side: "bid" | "ask"): NormalizedBookLevel[] {
  if (!Array.isArray(levels)) return [];
  const parsed: NormalizedBookLevel[] = [];
  for (const value of levels) {
    if (!Array.isArray(value)) continue;
    const price = Number(value[0]);
    const quantity = Number(value[1]);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0) {
      parsed.push({ price, quantity });
    }
  }
  return parsed.sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
}

/**
 * 合并三列 RPI 盘口档位：Bybit/Bitget 的 RPI 端点每档为
 * [price, 非RPI数量, RPI数量]，含 RPI 的总数量 = 非RPI + RPI。
 */
export function normalizeRpiSplitLevels(levels: unknown, side: "bid" | "ask"): NormalizedBookLevel[] {
  if (!Array.isArray(levels)) return [];
  const parsed: NormalizedBookLevel[] = [];
  for (const value of levels) {
    if (!Array.isArray(value) || value.length < 2) continue;
    const price = Number(value[0]);
    const nonRpi = Number(value[1]);
    const rpi = Number(value[2]);
    const quantity = (Number.isFinite(nonRpi) ? nonRpi : 0) + (Number.isFinite(rpi) ? rpi : 0);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0) {
      parsed.push({ price, quantity });
    }
  }
  return parsed.sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
}

/**
 * 解析现货 RPI 盘口响应（按交易所处理不同的 envelope 与档位结构）：
 * - Gate.io  /api/v4/spot/rpi_order_book：与普通盘口同构 [price, qty]
 * - OKX      /api/v5/market/books-rpi：data[0].bids/asks，每档 [price, totalQty, nonRpiQty, count]，[1] 即含 RPI 总量
 * - Bybit    /v5/market/rpi_orderbook：result.b/a，三列 [price, 非RPI量, RPI量]
 * - Bitget   /api/v3/market/rpi-orderbook：data.b/a，三列 [price, 非RPI量, RPI量]
 * 解析失败（结构不符）返回 null，由调用方回退普通盘口。
 */
export function normalizeSpotRpiOrderBook(exchange: string, payload: unknown): NormalizedOrderBook | null {
  const root = object(payload);
  if (!root) return null;
  if (exchange === "Gate.io") {
    if (!Array.isArray(root.bids) || !Array.isArray(root.asks)) return null;
    return { bids: normalizePlainLevels(root.bids, "bid"), asks: normalizePlainLevels(root.asks, "ask") };
  }
  if (exchange === "OKX") {
    if (!Array.isArray(root.data)) return null;
    const book = object(root.data[0]);
    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return null;
    return { bids: normalizePlainLevels(book.bids, "bid"), asks: normalizePlainLevels(book.asks, "ask") };
  }
  if (exchange === "Bybit") {
    const result = object(root.result);
    if (!result || !Array.isArray(result.b) || !Array.isArray(result.a)) return null;
    return { bids: normalizeRpiSplitLevels(result.b, "bid"), asks: normalizeRpiSplitLevels(result.a, "ask") };
  }
  if (exchange === "Bitget") {
    const data = object(root.data);
    if (!data || !Array.isArray(data.b) || !Array.isArray(data.a)) return null;
    return { bids: normalizeRpiSplitLevels(data.b, "bid"), asks: normalizeRpiSplitLevels(data.a, "ask") };
  }
  return null;
}

/** 从盘口取最优一档（best bid / best ask）。 */
export function bookTopBbo(book: NormalizedOrderBook): { bestBid?: number; bestAsk?: number } | null {
  const bestBid = book.bids.length > 0 ? book.bids[0].price : undefined;
  const bestAsk = book.asks.length > 0 ? book.asks[0].price : undefined;
  return bestBid !== undefined || bestAsk !== undefined ? { bestBid, bestAsk } : null;
}
