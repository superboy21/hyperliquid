import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const BINANCE_API_BASE = "https://fapi.binance.com";
const BINANCE_TIMEOUT_MS = 10_000;
const SYMBOL_RE = /^[A-Z0-9]{1,40}$/;
const INTERVALS = new Set([
  "1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "3d", "1w", "1M",
]);

type EndpointSpec = {
  path: string;
  allowed: readonly string[];
  required: readonly string[];
  limitMax?: number;
  fixedLimit?: string;
};

const ENDPOINTS: Record<string, EndpointSpec> = {
  premiumIndex: { path: "/fapi/v1/premiumIndex", allowed: ["symbol"], required: [] },
  "ticker/24hr": { path: "/fapi/v1/ticker/24hr", allowed: ["symbol"], required: [] },
  fundingInfo: { path: "/fapi/v1/fundingInfo", allowed: ["symbol"], required: [] },
  "ticker/bookTicker": { path: "/fapi/v1/ticker/bookTicker", allowed: ["symbol"], required: [] },
  fundingRate: {
    path: "/fapi/v1/fundingRate",
    allowed: ["symbol", "startTime", "endTime", "limit"],
    required: [],
    limitMax: 1000,
  },
  openInterest: { path: "/fapi/v1/openInterest", allowed: ["symbol"], required: ["symbol"] },
  depth: { path: "/fapi/v1/depth", allowed: ["symbol", "limit"], required: ["symbol"], limitMax: 1000 },
  rpiDepth: {
    path: "/fapi/v1/rpiDepth",
    allowed: ["symbol", "limit"],
    required: ["symbol"],
    fixedLimit: "1000",
  },
  premiumIndexKlines: {
    path: "/fapi/v1/premiumIndexKlines",
    allowed: ["symbol", "interval", "startTime", "endTime", "limit"],
    required: ["symbol", "interval"],
    limitMax: 1500,
  },
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function validPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validLimit(value: string, max: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;
}

function withRetryAfter(response: Response): Headers {
  const headers = new Headers();
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return headers;
}

export function binanceEndpointPath(endpoint: string): string | null {
  return Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint].path : null;
}

export function buildBinanceUrl(endpoint: string, params: URLSearchParams): URL | null {
  const spec = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!spec) return null;
  const url = new URL(spec.path, BINANCE_API_BASE);
  for (const key of spec.allowed) {
    const value = params.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  return url;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const endpoint = params.get("endpoint");
  const spec = endpoint && Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!spec) return badRequest("Unknown or missing endpoint");

  const allowed = new Set(["endpoint", ...spec.allowed]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return badRequest("Unknown or repeated parameter");
    }
  }
  for (const key of spec.required) {
    if (!params.get(key)) return badRequest(`Missing required parameter: ${key}`);
  }

  const symbol = params.get("symbol");
  if (symbol !== null && !SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");

  const interval = params.get("interval");
  if (interval !== null && !INTERVALS.has(interval)) return badRequest("Invalid interval");

  const limit = params.get("limit");
  if (limit !== null) {
    if (spec.fixedLimit && limit !== spec.fixedLimit) return badRequest("Invalid limit");
    if (spec.limitMax && !validLimit(limit, spec.limitMax)) return badRequest("Invalid limit");
  }

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  if ((startTime !== null && !validPositiveInteger(startTime)) || (endTime !== null && !validPositiveInteger(endTime))) {
    return badRequest("Invalid timestamp");
  }
  if (startTime && endTime && Number(startTime) > Number(endTime)) {
    return badRequest("startTime must not exceed endTime");
  }

  const upstream = buildBinanceUrl(endpoint as string, params);
  if (!upstream) return badRequest("Unknown or missing endpoint");

  try {
    const response = await proxyFetch(upstream, {
      timeout: BINANCE_TIMEOUT_MS,
      signal: request.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: "Failed to fetch data from Binance" },
        { status: response.status, headers: withRetryAfter(response) },
      );
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    console.error("Error proxying Binance request:", error);
    return NextResponse.json({ error: "Failed to proxy request" }, { status: 500 });
  }
}
