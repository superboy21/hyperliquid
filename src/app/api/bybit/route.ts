import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";
import { proxyFailureResponse, retryAfterHeaders } from "@/lib/utils/proxy-error";
import { InflightJsonCache } from "@/lib/utils/inflight-json-cache";

const API_BASE = "https://api.bybit.com";
const TIMEOUT_MS = 10_000;
/** V5 kline returns at most 1000 rows per request, so the window cap is interval-aware. */
const MAX_KLINE_LIMIT = 1000;
const MAX_FUNDING_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const SYMBOL_RE = /^[A-Z0-9]{1,40}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,200}$/;
const INTERVALS = new Set(["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"]);
/** Duration of every accepted kline interval, used for the bounded window cap. */
const INTERVAL_MS: Record<string, number> = {
  "1": 60_000, "3": 180_000, "5": 300_000, "15": 900_000, "30": 1_800_000,
  "60": 3_600_000, "120": 7_200_000, "240": 14_400_000, "360": 21_600_000,
  "720": 43_200_000, D: 86_400_000, W: 604_800_000, M: 31 * 86_400_000,
};

type ActionSpec = { path: string; allowed: readonly string[]; required: readonly string[] };
const ACTIONS: Record<string, ActionSpec> = {
  instruments: { path: "/v5/market/instruments-info", allowed: ["cursor", "limit"], required: [] },
  tickers: { path: "/v5/market/tickers", allowed: [], required: [] },
  "funding-history": { path: "/v5/market/funding/history", allowed: ["symbol", "startTime", "endTime", "limit"], required: ["symbol"] },
  kline: { path: "/v5/market/kline", allowed: ["symbol", "interval", "start", "end", "limit"], required: ["symbol", "interval"] },
  "premium-index-price-kline": { path: "/v5/market/premium-index-price-kline", allowed: ["symbol", "interval", "start", "end", "limit"], required: ["symbol", "interval"] },
  orderbook: { path: "/v5/market/orderbook", allowed: ["symbol", "limit"], required: ["symbol"] },
  "rpi-orderbook": { path: "/v5/market/rpi_orderbook", allowed: ["symbol", "limit"], required: ["symbol"] },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const bybitCache = new InflightJsonCache({ now: () => Date.now() });
const bybitCoalescingCache = new InflightJsonCache({ maxEntries: 0, now: () => Date.now() });

class BybitUpstreamError extends Error {
  constructor(readonly httpStatus: number, readonly code?: number | string, readonly retryAfter?: string) {
    super("Bybit upstream request failed");
    this.name = "BybitUpstreamError";
  }
}
class InvalidBybitResponseError extends Error {
  constructor() {
    super("Invalid Bybit upstream response");
    this.name = "InvalidBybitResponseError";
  }
}

function badRequest(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function integerInRange(value: string | null, min: number, max: number): boolean {
  return value !== null && /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
}
function positiveTimestamp(value: string | null): boolean {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function mappedBybitStatus(httpStatus: number, code?: number | string): number {
  if (httpStatus === 429 || code === 10004 || code === "10004" || code === 10005 || code === "10005") return 429;
  if (code === 10001 || code === "10001") return 400;
  if (code === 10002 || code === "10002") return 401;
  if (code === 10003 || code === "10003") return 403;
  if (code === 10009 || code === "10009") return 404;
  return 502;
}
export function bybitActionPath(action: string): string | null { return ACTIONS[action]?.path ?? null; }

function canonicalBybitKey(action: string, spec: ActionSpec, values: Record<string, string | null>): string {
  return JSON.stringify(["bybit", action, spec.allowed.map((key) => [key, values[key] ?? null])]);
}
function bybitCachePolicy(action: string): { cache: InflightJsonCache; ttlMs: number } | null {
  if (action === "instruments") return { cache: bybitCache, ttlMs: CACHE_TTL_MS };
  if (action === "tickers") return { cache: bybitCoalescingCache, ttlMs: 0 };
  return null;
}
export function clearBybitCaches(): void {
  bybitCache.clear();
  bybitCoalescingCache.clear();
}

async function loadBybit(upstream: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await proxyFetch(upstream, {
      timeout: TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });
  } catch (error) {
    console.error(`[Bybit API] Fetch error, url=${upstream.toString()}`);
    throw error;
  }
  let envelope: unknown;
  try { envelope = await response.json(); } catch {
    if (response.ok) throw new InvalidBybitResponseError();
    throw new BybitUpstreamError(response.status, undefined, retryAfterHeaders(response).get("Retry-After") ?? undefined);
  }
  const object = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : null;
  const code = object?.retCode;
  const msg = typeof object?.retMsg === "string" ? object.retMsg : undefined;
  const success = response.ok && (code === 0 || code === "0") && msg !== undefined && object && Object.prototype.hasOwnProperty.call(object, "result");
  if (success) return object;
  if (response.ok && (code === undefined || msg === undefined)) throw new InvalidBybitResponseError();
  throw new BybitUpstreamError(response.status, code as number | string | undefined, retryAfterHeaders(response).get("Retry-After") ?? undefined);
}
function bybitFailureResponse(request: NextRequest, error: unknown, action: string): NextResponse {
  if (request.signal.aborted) return proxyFailureResponse(request.signal);
  if (error instanceof BybitUpstreamError) {
    const status = mappedBybitStatus(error.httpStatus, error.code);
    const headers = new Headers();
    if (status === 429 && error.retryAfter) headers.set("Retry-After", error.retryAfter);
    const errorBody = `Upstream HTTP ${error.httpStatus}, retCode=${error.code ?? "none"}`;
    console.error(`[Bybit API] ${errorBody}, action=${action}`);
    return NextResponse.json({ error: errorBody }, { status, headers });
  }
  if (error instanceof InvalidBybitResponseError) return proxyFailureResponse(request.signal);
  return proxyFailureResponse(request.signal, error);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const action = params.get("action");
  const spec = action ? ACTIONS[action] : undefined;
  if (!spec) return badRequest("Unknown or missing action");
  const actionName = action as string;
  const allowed = new Set(["action", ...spec.allowed]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return badRequest("Unknown or repeated parameter");
  for (const key of spec.required) if (!params.get(key)) return badRequest(`Missing required parameter: ${key}`);

  const symbol = params.get("symbol");
  if (symbol !== null && !SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");
  const interval = params.get("interval");
  if (interval !== null && !INTERVALS.has(interval)) return badRequest("Invalid interval");
  const cursor = params.get("cursor");
  if (cursor !== null && !CURSOR_RE.test(cursor)) return badRequest("Invalid cursor");
  const limitDefaults: Record<string, string> = { instruments: "1000", "funding-history": "200", kline: "1000", "premium-index-price-kline": "200", orderbook: "100", "rpi-orderbook": "50" };
  const limitMax: Record<string, number> = { instruments: 1000, "funding-history": 200, kline: 1000, "premium-index-price-kline": 1000, orderbook: 1000, "rpi-orderbook": 50 };
  const limit = params.get("limit") ?? limitDefaults[actionName] ?? null;
  if (limit !== null && !integerInRange(limit, 1, limitMax[actionName] ?? 1000)) return badRequest("Invalid limit");

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  if (actionName === "funding-history") {
    if ((startTime === null) !== (endTime === null)) return badRequest("startTime and endTime must be provided together");
    if ((startTime !== null && !positiveTimestamp(startTime)) || (endTime !== null && !positiveTimestamp(endTime))) return badRequest("Invalid timestamp");
    if (startTime && endTime && Number(startTime) > Number(endTime)) return badRequest("startTime must not exceed endTime");
    if (startTime && endTime && Number(endTime) - Number(startTime) > MAX_FUNDING_WINDOW_MS) return badRequest("Funding history window exceeds 90 days");
  }
  const start = params.get("start");
  const end = params.get("end");
  if ((start !== null && !positiveTimestamp(start)) || (end !== null && !positiveTimestamp(end))) return badRequest("Invalid timestamp");
  if (start && end && Number(start) > Number(end)) return badRequest("start must not exceed end");
  if (actionName === "kline" && start && end) {
    const intervalMs = interval ? INTERVAL_MS[interval] : undefined;
    if (intervalMs !== undefined && Number(end) - Number(start) > (MAX_KLINE_LIMIT - 1) * intervalMs) return badRequest("Kline window exceeds the V5 limit for this interval");
  }

  const upstream = new URL(spec.path, API_BASE);
  upstream.searchParams.set("category", "linear");
  if (actionName === "instruments") upstream.searchParams.set("status", "Trading");
  const values: Record<string, string | null> = {};
  for (const key of spec.allowed) {
    const value = key === "cursor" ? cursor : key === "limit" ? limit : params.get(key);
    values[key] = value;
    if (value !== null) upstream.searchParams.set(key, value);
  }
  const policy = bybitCachePolicy(actionName);
  try {
    const envelope = policy
      ? await policy.cache.getOrLoad(canonicalBybitKey(actionName, spec, values), policy.ttlMs, () => loadBybit(upstream), request.signal)
      : await loadBybit(upstream, request.signal);
    if (request.signal.aborted) return proxyFailureResponse(request.signal);
    // Pass the full V5 envelope through unchanged and create a fresh response per caller.
    return NextResponse.json(envelope);
  } catch (error) {
    return bybitFailureResponse(request, error, actionName);
  }
}
