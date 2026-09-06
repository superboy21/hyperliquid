import { NextRequest, NextResponse } from "next/server";
import { createInflightJsonCache } from "@/lib/utils/inflight-json-cache";
import { proxyFetch } from "@/lib/utils/proxy";
import { proxyFailureResponse, retryAfterHeaders } from "@/lib/utils/proxy-error";

const LIGHTER_API_BASE = "https://mainnet.zklighter.elliot.ai";
const MARKET_ID_RE = /^\d+$/;
const RESOLUTIONS = new Set(["1m", "1h", "4h", "1d"]);
const FILTERS = new Set(["perp", "spot"]);
const LIGHTER_CACHE = createInflightJsonCache();
const LIGHTER_TTL_MS = 5 * 60 * 1000;

type EndpointSpec = {
  path: string;
  allowed: readonly string[];
  required: readonly string[];
  countBack?: boolean;
  limitMax?: number;
};

const ENDPOINTS: Record<string, EndpointSpec> = {
  orderBooks: { path: "/api/v1/orderBooks", allowed: [], required: [] },
  "funding-rates": { path: "/api/v1/funding-rates", allowed: [], required: [] },
  fundings: {
    path: "/api/v1/fundings",
    allowed: ["market_id", "resolution", "start_timestamp", "end_timestamp", "count_back"],
    required: ["market_id", "resolution"],
    countBack: true,
  },
  candles: {
    path: "/api/v1/candles",
    allowed: ["market_id", "resolution", "start_timestamp", "end_timestamp", "count_back"],
    required: ["market_id", "resolution"],
    countBack: true,
  },
  orderBookDetails: { path: "/api/v1/orderBookDetails", allowed: ["filter"], required: [] },
  exchangeStats: { path: "/api/v1/exchangeStats", allowed: [], required: [] },
  orderBookOrders: {
    path: "/api/v1/orderBookOrders",
    allowed: ["market_id", "limit"],
    required: ["market_id"],
    limitMax: 250,
  },
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

class UpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super("Lighter returned an error response");
  }
}

class InvalidLighterResponseError extends Error {
  constructor() {
    super("Invalid Lighter upstream response");
    this.name = "InvalidLighterResponseError";
  }
}

function proxyErrorResponse(signal: AbortSignal, error?: unknown): NextResponse {
  const response = proxyFailureResponse(signal, error);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function cacheTtl(endpoint: string): number | null {
  if (endpoint === "orderBooks") return LIGHTER_TTL_MS;
  if (new Set(["funding-rates", "exchangeStats", "orderBookDetails"]).has(endpoint)) return 0;
  return null;
}

export function clearLighterCaches(): void {
  LIGHTER_CACHE.clear();
}

function isLighterSuccessEnvelope(payload: unknown): boolean {
  if (payload === null || (typeof payload !== "object" && !Array.isArray(payload))) return false;
  if (Array.isArray(payload)) return true;

  const object = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(object, "error") || object.success === false) return false;
  if (typeof object.status === "string" && ["error", "failed", "failure"].includes(object.status.toLowerCase())) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(object, "code")) {
    return object.code === 0 || object.code === "0" || object.code === 200 || object.code === "200";
  }
  return true;
}

async function loadJson(upstream: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await proxyFetch(upstream, {
    timeout: 15_000,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Lighter API] Error: ${response.status} - ${errorText}`);
    throw new UpstreamHttpError(response.status, retryAfterHeaders(response));
  }
  const payload = await response.json();
  if (!isLighterSuccessEnvelope(payload)) throw new InvalidLighterResponseError();
  return payload;
}

function validPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function lighterEndpointPath(endpoint: string): string | null {
  return Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint].path : null;
}

export function buildLighterUrl(endpoint: string, params: URLSearchParams): URL | null {
  const spec = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!spec) return null;
  const url = new URL(spec.path, LIGHTER_API_BASE);
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

  const marketId = params.get("market_id");
  if (marketId !== null && (!MARKET_ID_RE.test(marketId) || Number(marketId) <= 0 || !Number.isSafeInteger(Number(marketId)))) {
    return badRequest("Invalid market_id");
  }

  const resolution = params.get("resolution");
  if (resolution !== null && !RESOLUTIONS.has(resolution)) return badRequest("Invalid resolution");

  for (const key of ["start_timestamp", "end_timestamp"] as const) {
    const value = params.get(key);
    if (value !== null && !validPositiveInteger(value)) return badRequest("Invalid timestamp");
  }
  const start = params.get("start_timestamp");
  const end = params.get("end_timestamp");
  if (start && end && Number(start) > Number(end)) return badRequest("start_timestamp must not exceed end_timestamp");

  const countBack = params.get("count_back");
  if (countBack !== null && (!spec.countBack || !validPositiveInteger(countBack) || Number(countBack) > 1000)) {
    return badRequest("Invalid count_back");
  }

  const limit = params.get("limit");
  if (limit !== null && (!spec.limitMax || !validPositiveInteger(limit) || Number(limit) > spec.limitMax)) {
    return badRequest("Invalid limit");
  }

  const filter = params.get("filter");
  if (filter !== null && !FILTERS.has(filter)) return badRequest("Invalid filter");

  const upstream = buildLighterUrl(endpoint as string, params);
  if (!upstream) return badRequest("Unknown or missing endpoint");

  const ttl = cacheTtl(endpoint as string);
  const load = (signal?: AbortSignal) => loadJson(upstream, signal);

  try {
    const value = ttl === null
      ? await load(request.signal)
      : await LIGHTER_CACHE.getOrLoad(upstream.toString(), ttl, () => load(), request.signal);
    if (request.signal.aborted) return proxyErrorResponse(request.signal);
    return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Lighter API] Error proxying request:", error);
    if (request.signal.aborted) return proxyErrorResponse(request.signal, error);
    if (error instanceof UpstreamHttpError) {
      return NextResponse.json(
        { error: `Failed to fetch data from Lighter: ${error.status}` },
        { status: error.status, headers: noStoreHeaders(error.headers) },
      );
    }
    return proxyErrorResponse(request.signal, error);
  }
}

function noStoreHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return result;
}
