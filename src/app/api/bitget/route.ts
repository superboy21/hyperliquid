import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

const API_BASE = "https://api.bitget.com";
const TIMEOUT_MS = 10_000;
const MAX_HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const SYMBOL_RE = /^[A-Z0-9]{1,40}$/;
const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1H", "4H", "6H", "12H", "1D"]);
const CANDLE_TYPES = new Set(["market", "mark", "index", "premium"]);

type ActionSpec = { path: string; allowed: readonly string[]; required: readonly string[] };
const ACTIONS: Record<string, ActionSpec> = {
  instruments: { path: "/api/v3/market/instruments", allowed: ["symbol"], required: [] },
  tickers: { path: "/api/v3/market/tickers", allowed: ["symbol"], required: [] },
  "current-fund-rate": { path: "/api/v3/market/current-fund-rate", allowed: ["symbol"], required: [] },
  "history-fund-rate": { path: "/api/v3/market/history-fund-rate", allowed: ["symbol", "cursor", "limit"], required: ["symbol"] },
  candles: { path: "/api/v3/market/candles", allowed: ["symbol", "interval", "startTime", "endTime", "type", "limit"], required: ["symbol", "interval"] },
  "history-candles": { path: "/api/v3/market/history-candles", allowed: ["symbol", "interval", "startTime", "endTime", "type", "limit"], required: ["symbol", "interval"] },
  orderbook: { path: "/api/v3/market/orderbook", allowed: ["symbol", "limit"], required: ["symbol"] },
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function integerInRange(value: string | null, min: number, max: number): boolean {
  return value !== null && /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}

function positiveTimestamp(value: string | null): boolean {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function mappedBitgetStatus(httpStatus: number, code?: string): number {
  if (httpStatus === 429 || code === "25004") return 429;
  if (code === "25100") return 404;
  if (["25000", "25001", "25003", "25101", "25102", "25104", "25108", "40725"].includes(code ?? "")) return 503;
  if (["25200", "40017", "40034"].includes(code ?? "")) return 400;
  return 502;
}

export function bitgetActionPath(action: string): string | null {
  return ACTIONS[action]?.path ?? null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const action = params.get("action");
  const spec = action ? ACTIONS[action] : undefined;
  if (!spec) return badRequest("Unknown or missing action");
  const actionName = action as string;

  const allowed = new Set(["action", ...spec.allowed]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) return badRequest("Unknown or repeated parameter");
  }
  for (const key of spec.required) {
    if (!params.get(key)) return badRequest(`Missing required parameter: ${key}`);
  }

  const symbol = params.get("symbol");
  if (symbol !== null && !SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");
  const interval = params.get("interval");
  if (interval !== null && !INTERVALS.has(interval)) return badRequest("Invalid interval");
  const type = params.get("type") ?? (actionName.includes("candles") ? "market" : null);
  if (type !== null && !CANDLE_TYPES.has(type)) return badRequest("Invalid candle type");

  const cursor = params.get("cursor") ?? (actionName === "history-fund-rate" ? "1" : null);
  const defaultLimit = ["history-fund-rate", "candles", "history-candles", "orderbook"].includes(actionName) ? "100" : null;
  const limit = params.get("limit") ?? defaultLimit;
  if (cursor !== null && !integerInRange(cursor, 1, 100)) return badRequest("Invalid cursor");
  if (limit !== null && !integerInRange(limit, 1, actionName === "orderbook" ? 1000 : 100)) return badRequest("Invalid limit");

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  if ((startTime !== null && !positiveTimestamp(startTime)) || (endTime !== null && !positiveTimestamp(endTime))) {
    return badRequest("Invalid timestamp");
  }
  if (startTime && endTime && Number(startTime) > Number(endTime)) return badRequest("startTime must not exceed endTime");
  if (actionName === "history-candles" && startTime && endTime && Number(endTime) - Number(startTime) > MAX_HISTORY_WINDOW_MS) {
    return badRequest("History window exceeds 90 days");
  }

  const upstream = new URL(spec.path, API_BASE);
  upstream.searchParams.set("category", "USDT-FUTURES");
  for (const key of spec.allowed) {
    const value = key === "cursor" ? cursor : key === "limit" ? limit : key === "type" ? type : params.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await proxyFetch(upstream, { cache: "no-store", signal: controller.signal, timeout: TIMEOUT_MS });
    let envelope: unknown;
    try { envelope = await response.json(); } catch { envelope = null; }
    const object = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : null;
    const code = typeof object?.code === "string" ? object.code : undefined;
    const msg = typeof object?.msg === "string" ? object.msg : undefined;
    const success = response.ok && code === "00000" && msg !== undefined && object && Object.prototype.hasOwnProperty.call(object, "data");
    if (success) return NextResponse.json(object.data);

    const status = mappedBitgetStatus(response.status, code);
    const headers = new Headers();
    if (status === 429) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) headers.set("Retry-After", retryAfter);
    }
    return NextResponse.json({ error: status === 429 ? "Rate limited" : status === 404 ? "Symbol not found" : "Bitget upstream request failed" }, { status, headers });
  } catch {
    if (request.signal.aborted) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    if (timedOut) return NextResponse.json({ error: "Bitget upstream timed out" }, { status: 504 });
    return NextResponse.json({ error: "Bitget upstream request failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
}
