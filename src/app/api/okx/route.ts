import { NextRequest, NextResponse } from "next/server";
import { createInflightJsonCache } from "@/lib/utils/inflight-json-cache";
import { proxyFetch } from "@/lib/utils/proxy";
import { proxyFailureResponse, retryAfterHeaders } from "@/lib/utils/proxy-error";

const OKX_API_BASE = "https://www.okx.com";
const ID_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+){0,7}$/;
const INST_TYPES = new Set(["SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION"]);
const BARS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D",
  "1W", "1M", "3M", "6M", "1Y", "1Dutc",
]);
const OKX_CACHE = createInflightJsonCache();
const OKX_TTL_MS = 5 * 60 * 1000;

type EndpointSpec = {
  path: string;
  allowed: readonly string[];
  required: readonly string[];
  limitMax?: number;
  sizeMax?: number;
};

const ENDPOINTS: Record<string, EndpointSpec> = {
  "public/funding-rate": {
    path: "/api/v5/public/funding-rate",
    allowed: ["instId"],
    required: ["instId"],
  },
  "public/funding-rate-history": {
    path: "/api/v5/public/funding-rate-history",
    allowed: ["instId", "after", "before", "limit"],
    required: ["instId"],
    limitMax: 400,
  },
  "public/instruments": {
    path: "/api/v5/public/instruments",
    allowed: ["instType", "uly", "instFamily", "instId"],
    required: ["instType"],
  },
  "public/open-interest": {
    path: "/api/v5/public/open-interest",
    allowed: ["instType", "instId", "uly", "instFamily"],
    required: ["instType"],
  },
  "market/tickers": {
    path: "/api/v5/market/tickers",
    allowed: ["instType", "uly", "instFamily"],
    required: ["instType"],
  },
  "market/index-tickers": {
    path: "/api/v5/market/index-tickers",
    allowed: ["instType", "quoteCcy", "instId"],
    required: [],
  },
  "market/history-candles": {
    path: "/api/v5/market/history-candles",
    allowed: ["instId", "after", "before", "bar", "limit"],
    required: ["instId", "bar"],
    limitMax: 300,
  },
  "market/books": {
    path: "/api/v5/market/books",
    allowed: ["instId", "sz"],
    required: ["instId"],
    sizeMax: 400,
  },
  "market/books-full": {
    path: "/api/v5/market/books-full",
    allowed: ["instId", "sz"],
    required: ["instId"],
    sizeMax: 5000,
  },
  "market/books-rpi": {
    path: "/api/v5/market/books-rpi",
    allowed: ["instId", "sz"],
    required: ["instId"],
    sizeMax: 400,
  },
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly message: string,
    readonly headers: Headers,
  ) {
    super(message);
  }
}

class InvalidOkxResponseError extends Error {
  constructor() {
    super("Invalid OKX upstream response");
    this.name = "InvalidOkxResponseError";
  }
}

function proxyErrorResponse(signal: AbortSignal, error?: unknown): NextResponse {
  const response = proxyFailureResponse(signal, error);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function cacheTtl(endpoint: string, params: URLSearchParams): number | null {
  if (
    endpoint === "public/instruments"
    && params.get("instType") === "SWAP"
    && params.get("instId") === null
  ) {
    return OKX_TTL_MS;
  }
  if (endpoint === "public/funding-rate" && params.get("instId") === "ANY") return 0;
  if (endpoint === "market/tickers") return 0;
  if (endpoint === "market/index-tickers" && params.get("instId") === null) return 0;
  if (endpoint === "public/open-interest" && params.get("instId") === null) return 0;
  return null;
}

function isOkxSuccessEnvelope(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const object = payload as Record<string, unknown>;
  return (object.code === "0" || object.code === 0) && Object.prototype.hasOwnProperty.call(object, "data");
}

async function loadJson(upstream: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await proxyFetch(upstream, {
    timeout: 10_000,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { /* Error bodies need not be JSON. */ }
    const message = body && typeof body === "object"
      ? String(
          (body as { error?: unknown; message?: unknown; msg?: unknown }).error
            ?? (body as { message?: unknown }).message
            ?? (body as { msg?: unknown }).msg
            ?? `HTTP ${response.status}`,
        )
      : `HTTP ${response.status}`;
    throw new UpstreamHttpError(response.status, message, retryAfterHeaders(response));
  }
  const payload = await response.json();
  if (!isOkxSuccessEnvelope(payload)) throw new InvalidOkxResponseError();
  return payload;
}

function validPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validId(value: string | null): boolean {
  return value === null || ID_RE.test(value);
}

export function okxEndpointPath(endpoint: string): string | null {
  return Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint].path : null;
}

export function buildOkxUrl(endpoint: string, params: URLSearchParams): URL | null {
  const spec = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!spec) return null;
  const url = new URL(spec.path, OKX_API_BASE);
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

  const instId = params.get("instId");
  if (!validId(instId)) return badRequest("Invalid instrument id");
  const uly = params.get("uly");
  if (!validId(uly)) return badRequest("Invalid underlying");
  const instFamily = params.get("instFamily");
  if (!validId(instFamily)) return badRequest("Invalid instrument family");

  const instType = params.get("instType");
  if (instType !== null && !INST_TYPES.has(instType)) return badRequest("Invalid instrument type");
  const quoteCcy = params.get("quoteCcy");
  if (quoteCcy !== null && !/^[A-Z0-9]{1,20}$/.test(quoteCcy)) return badRequest("Invalid quote currency");

  const bar = params.get("bar");
  if (bar !== null && !BARS.has(bar)) return badRequest("Invalid bar");

  for (const key of ["after", "before"] as const) {
    const value = params.get(key);
    if (value !== null && !validPositiveInteger(value)) return badRequest("Invalid timestamp");
  }

  const limit = params.get("limit");
  if (limit !== null && (!spec.limitMax || !validPositiveInteger(limit) || Number(limit) > spec.limitMax)) {
    return badRequest("Invalid limit");
  }
  const size = params.get("sz");
  if (size !== null && (!spec.sizeMax || !validPositiveInteger(size) || Number(size) > spec.sizeMax)) {
    return badRequest("Invalid size");
  }

  const upstream = buildOkxUrl(endpoint as string, params);
  if (!upstream) return badRequest("Unknown or missing endpoint");

  const ttl = cacheTtl(endpoint as string, params);
  const load = (signal?: AbortSignal) => loadJson(upstream, signal);

  try {
    const value = ttl === null
      ? await load(request.signal)
      : await OKX_CACHE.getOrLoad(upstream.toString(), ttl, () => load(), request.signal);
    if (request.signal.aborted) return proxyErrorResponse(request.signal);
    return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[OKX API] Error:", error);
    if (request.signal.aborted) return proxyErrorResponse(request.signal, error);
    if (error instanceof UpstreamHttpError) {
      return NextResponse.json(
        { error: error.message, upstreamStatus: error.status },
        { status: error.status, headers: noStoreHeaders(error.headers) },
      );
    }
    const message = error instanceof Error ? error.message : "Failed to fetch OKX data";
    console.error("[OKX API] Error:", message);
    return proxyErrorResponse(request.signal, error);
  }
}

function noStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return result;
}
