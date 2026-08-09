import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

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
  "1": 60_000,
  "3": 180_000,
  "5": 300_000,
  "15": 900_000,
  "30": 1_800_000,
  "60": 3_600_000,
  "120": 7_200_000,
  "240": 14_400_000,
  "360": 21_600_000,
  "720": 43_200_000,
  D: 86_400_000,
  W: 604_800_000,
  M: 31 * 86_400_000,
};

type ActionSpec = { path: string; allowed: readonly string[]; required: readonly string[] };
const ACTIONS: Record<string, ActionSpec> = {
  instruments: { path: "/v5/market/instruments-info", allowed: ["cursor", "limit"], required: [] },
  tickers: { path: "/v5/market/tickers", allowed: [], required: [] },
  "funding-history": { path: "/v5/market/funding/history", allowed: ["symbol", "startTime", "endTime", "limit"], required: ["symbol"] },
  kline: { path: "/v5/market/kline", allowed: ["symbol", "interval", "start", "end", "limit"], required: ["symbol", "interval"] },
  orderbook: { path: "/v5/market/orderbook", allowed: ["symbol", "limit"], required: ["symbol"] },
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

export function mappedBybitStatus(httpStatus: number, code?: number | string): number {
  if (httpStatus === 429 || code === 10004 || code === "10004" || code === 10005 || code === "10005") return 429;
  if (code === 10001 || code === "10001") return 400;
  if (code === 10002 || code === "10002") return 401;
  if (code === 10003 || code === "10003") return 403;
  if (code === 10009 || code === "10009") return 404;
  return 502;
}

export function bybitActionPath(action: string): string | null {
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

  const cursor = params.get("cursor");
  if (cursor !== null && !CURSOR_RE.test(cursor)) return badRequest("Invalid cursor");

  const limitDefaults: Record<string, string> = {
    instruments: "1000",
    "funding-history": "200",
    kline: "1000",
    orderbook: "100",
  };
  const limitMax: Record<string, number> = {
    instruments: 1000,
    "funding-history": 200,
    kline: 1000,
    orderbook: 1000,
  };
  const limit = params.get("limit") ?? limitDefaults[actionName] ?? null;
  if (limit !== null && !integerInRange(limit, 1, limitMax[actionName] ?? 1000)) return badRequest("Invalid limit");

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  if (actionName === "funding-history") {
    // The adapter's time-window pagination depends on paired boundaries;
    // a lone startTime is never a valid V5 funding-history request.
    if ((startTime === null) !== (endTime === null)) return badRequest("startTime and endTime must be provided together");
    if ((startTime !== null && !positiveTimestamp(startTime)) || (endTime !== null && !positiveTimestamp(endTime))) {
      return badRequest("Invalid timestamp");
    }
    if (startTime && endTime && Number(startTime) > Number(endTime)) return badRequest("startTime must not exceed endTime");
    if (startTime && endTime && Number(endTime) - Number(startTime) > MAX_FUNDING_WINDOW_MS) {
      return badRequest("Funding history window exceeds 90 days");
    }
  }

  const start = params.get("start");
  const end = params.get("end");
  if ((start !== null && !positiveTimestamp(start)) || (end !== null && !positiveTimestamp(end))) {
    return badRequest("Invalid timestamp");
  }
  if (start && end && Number(start) > Number(end)) return badRequest("start must not exceed end");
  if (actionName === "kline" && start && end) {
    // One V5 kline request returns at most MAX_KLINE_LIMIT rows; a window wider
    // than (limit - 1) intervals cannot be served in a single page and is
    // rejected instead of silently truncating the caller's range.
    const intervalMs = interval ? INTERVAL_MS[interval] : undefined;
    if (intervalMs !== undefined && Number(end) - Number(start) > (MAX_KLINE_LIMIT - 1) * intervalMs) {
      return badRequest("Kline window exceeds the V5 limit for this interval");
    }
  }

  const upstream = new URL(spec.path, API_BASE);
  upstream.searchParams.set("category", "linear");
  if (actionName === "instruments") upstream.searchParams.set("status", "Trading");
  for (const key of spec.allowed) {
    const value = key === "cursor" ? cursor : key === "limit" ? limit : params.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }

  try {
    const response = await proxyFetch(upstream, {
      timeout: TIMEOUT_MS,
      signal: request.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    let envelope: unknown;
    try { envelope = await response.json(); } catch { envelope = null; }
    const object = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : null;
    const code = object?.retCode;
    const msg = typeof object?.retMsg === "string" ? object.retMsg : undefined;
    const success = response.ok && (code === 0 || code === "0") && msg !== undefined && object && Object.prototype.hasOwnProperty.call(object, "result");
    if (success) {
      // Pass the full V5 envelope through unchanged: the adapter's envelope
      // parser (unwrapBybitEnvelope) expects retCode/retMsg/result and unwraps
      // the result itself, so direct and proxied responses share one contract.
      return NextResponse.json(object);
    }

    const status = mappedBybitStatus(response.status, code as number | string | undefined);
    const errorBody = `Upstream HTTP ${response.status}, retCode=${code ?? "none"}`;
    console.error(`[Bybit API] ${errorBody}, action=${action}`);
    const headers = new Headers();
    if (status === 429) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) headers.set("Retry-After", retryAfter);
    }
    return NextResponse.json({ error: errorBody }, { status, headers });
  } catch (error) {
    if (request.signal?.aborted) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[Bybit API] Fetch error: ${message}, action=${action}, url=${upstream.toString()}`);
    return NextResponse.json({ error: `Fetch error: ${message}` }, { status: 502 });
  }
}
