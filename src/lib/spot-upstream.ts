// ==================== Spot Upstream Request Builder ====================
// Shared by the server proxy (`/api/spot/[exchange]`) and the client-side
// direct-first fetcher (`spot-fetch.ts`). Pure URL/init construction with no
// Next.js or server dependencies so it can run in the browser bundle.

export type SpotAction = "list" | "candles" | "book" | "instrument";
export type SpotUpstreamRequest = { url: string; init: RequestInit & { timeout?: number } };
export type ExchangeSlug = "hyperliquid" | "gateio" | "binance" | "lighter" | "okx" | "bitget" | "bybit";

const HOSTS: Record<string, string> = {
  hyperliquid: "https://api.hyperliquid.xyz",
  gateio: "https://api.gateio.ws",
  binance: "https://api.binance.com",
  lighter: "https://mainnet.zklighter.elliot.ai",
  okx: "https://www.okx.com",
  bitget: "https://api.bitget.com",
  bybit: "https://api.bybit.com",
};
const EXCHANGES = new Set(Object.keys(HOSTS));
const ACTION_PARAMS: Record<SpotAction, readonly string[]> = {
  list: [],
  candles: ["symbol", "marketId", "interval", "limit", "startTime", "endTime"],
  book: ["symbol", "marketId", "limit"],
  instrument: ["symbol"],
};
const INTERVALS = new Set(["1w", "1d", "4h", "1h", "5m", "1m"]);
const SYMBOL_RE = /^[A-Za-z0-9@._:/-]{1,80}$/;
const CANDLE_MAX: Record<ExchangeSlug, number> = { hyperliquid: 5000, gateio: 1000, binance: 1000, lighter: 500, okx: 300, bitget: 1000, bybit: 1000 };
const BOOK_MAX: Record<ExchangeSlug, number> = { hyperliquid: 20, gateio: 100, binance: 5000, lighter: 250, okx: 5000, bitget: 150, bybit: 200 };
const INTERVAL_MS: Record<string, number> = { "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000, "1h": 3_600_000, "5m": 300_000, "1m": 60_000 };

function integer(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function mapInterval(exchange: ExchangeSlug, interval: string): string {
  if (exchange === "gateio") return interval === "1w" ? "7d" : interval;
  if (exchange === "okx") return interval === "1w" ? "1Wutc" : interval === "1d" ? "1Dutc" : interval.endsWith("h") ? interval.replace("h", "H") : interval;
  if (exchange === "bitget") return ({ "1w": "1Wutc", "1d": "1Dutc", "4h": "4h", "1h": "1h", "5m": "5min", "1m": "1min" } as Record<string, string>)[interval];
  // V5 kline interval values: 1|3|5|15|30|60|120|240|360|720|D|W|M
  if (exchange === "bybit") return ({ "1w": "W", "1d": "D", "4h": "240", "1h": "60", "5m": "5", "1m": "1" } as Record<string, string>)[interval];
  return interval;
}

export function buildSpotUpstreamRequest(exchangeValue: string, params: URLSearchParams): SpotUpstreamRequest | string {
  if (!EXCHANGES.has(exchangeValue)) return "Unknown exchange";
  const exchange = exchangeValue as ExchangeSlug;
  const actionValue = params.get("action");
  if (actionValue !== "list" && actionValue !== "candles" && actionValue !== "book" && actionValue !== "instrument") return "Unknown or missing action";
  const action = actionValue as SpotAction;
  if (action === "instrument" && exchange !== "bitget") return "Unknown or missing action";
  const allowed = new Set(["action", ...ACTION_PARAMS[action]]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return "Unknown or repeated parameter";
  const symbol = params.get("symbol");
  const marketId = integer(params.get("marketId"));
  if (symbol !== null && !SYMBOL_RE.test(symbol)) return "Invalid symbol";
  if (params.has("marketId") && marketId === null) return "Invalid marketId";
  if (action !== "list") {
    if (exchange === "lighter" ? marketId === null : !symbol) return exchange === "lighter" ? "Missing marketId" : "Missing symbol";
    if (exchange === "lighter" && symbol !== null) return "Unknown parameter for Lighter";
    if (exchange !== "lighter" && marketId !== null) return "Unknown parameter for exchange";
  }
  const interval = params.get("interval");
  if (action === "candles" && (!interval || !INTERVALS.has(interval))) return "Invalid or missing interval";
  const rawLimit = params.get("limit");
  if (rawLimit !== null && integer(rawLimit) === null) return "Invalid limit";
  const max = action === "book" ? BOOK_MAX[exchange] : CANDLE_MAX[exchange];
  const limit = Math.min(integer(rawLimit) ?? (action === "book" ? max : Math.min(500, max)), max);
  const start = params.get("startTime");
  const end = params.get("endTime");
  if ((start !== null && integer(start) === null) || (end !== null && integer(end) === null)) return "Invalid timestamp";
  if (start && end && Number(start) > Number(end)) return "startTime must not exceed endTime";

  const query = new URLSearchParams();
  let path = "";
  let init: RequestInit & { timeout?: number } = { method: "GET", timeout: 15_000 };
  if (action === "instrument") {
    path = "/api/v3/market/instruments";
    query.set("category", "SPOT");
    query.set("symbol", symbol!);
  } else if (action === "list") {
    if (exchange === "hyperliquid") {
      path = "/info"; init = { ...init, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }) };
    } else if (exchange === "gateio") path = "/api/v4/spot/tickers";
    else if (exchange === "binance") path = "/api/v3/ticker/24hr";
    else if (exchange === "lighter") { path = "/api/v1/orderBookDetails"; query.set("filter", "spot"); }
    else if (exchange === "okx") { path = "/api/v5/market/tickers"; query.set("instType", "SPOT"); }
    else if (exchange === "bybit") { path = "/v5/market/tickers"; query.set("category", "spot"); }
    else path = "/api/v2/spot/market/tickers";
  } else if (action === "candles") {
    const mapped = mapInterval(exchange, interval!);
    if (exchange === "hyperliquid") {
      const endTime = Number(end ?? Date.now());
      const startTime = Number(start ?? Math.max(1, endTime - limit * INTERVAL_MS[interval!]));
      path = "/info"; init = { ...init, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin: symbol, interval: mapped, startTime, endTime } }) };
    } else if (exchange === "gateio") { path = "/api/v4/spot/candlesticks"; query.set("currency_pair", symbol!); query.set("interval", mapped); query.set("limit", String(limit)); }
    else if (exchange === "binance") { path = "/api/v3/klines"; query.set("symbol", symbol!); query.set("interval", mapped); query.set("limit", String(limit)); }
    else if (exchange === "lighter") {
      path = "/api/v1/candles"; query.set("market_id", String(marketId)); query.set("resolution", mapped);
      const endTime = Number(end ?? Date.now()); query.set("end_timestamp", String(endTime)); query.set("start_timestamp", String(Number(start ?? endTime - limit * INTERVAL_MS[interval!]))); query.set("count_back", String(limit));
    } else if (exchange === "okx") { path = "/api/v5/market/history-candles"; query.set("instId", symbol!); query.set("bar", mapped); query.set("limit", String(limit)); }
    else if (exchange === "bybit") { path = "/v5/market/kline"; query.set("category", "spot"); query.set("symbol", symbol!); query.set("interval", mapped); query.set("limit", String(limit)); }
    else { path = "/api/v2/spot/market/candles"; query.set("symbol", symbol!); query.set("granularity", mapped); query.set("limit", String(limit)); }
    if (exchange === "binance" || exchange === "bitget") { if (start) query.set("startTime", start); if (end) query.set("endTime", end); }
    if (exchange === "okx") { if (start) query.set("after", start); if (end) query.set("before", end); }
    if (exchange === "bybit") { if (start) query.set("start", start); if (end) query.set("end", end); }
  } else {
    if (exchange === "hyperliquid") { path = "/info"; init = { ...init, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "l2Book", coin: symbol }) }; }
    else if (exchange === "gateio") { path = "/api/v4/spot/order_book"; query.set("currency_pair", symbol!); query.set("limit", String(limit)); query.set("interval", "0"); }
    else if (exchange === "binance") { path = "/api/v3/depth"; query.set("symbol", symbol!); query.set("limit", String(limit)); }
    else if (exchange === "lighter") { path = "/api/v1/orderBookOrders"; query.set("market_id", String(marketId)); query.set("limit", String(limit)); }
    else if (exchange === "okx") { path = "/api/v5/market/books-full"; query.set("instId", symbol!); query.set("sz", String(limit)); }
    else if (exchange === "bybit") { path = "/v5/market/orderbook"; query.set("category", "spot"); query.set("symbol", symbol!); query.set("limit", String(limit)); }
    else { path = "/api/v2/spot/market/orderbook"; query.set("symbol", symbol!); query.set("limit", String(limit)); query.set("type", "step0"); }
  }
  return { url: `${HOSTS[exchange]}${path}${query.size ? `?${query}` : ""}`, init };
}
