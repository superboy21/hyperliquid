import { NextRequest, NextResponse } from "next/server";
import { buildSpotUpstreamRequest } from "@/lib/spot-upstream";
import { proxyFetch } from "@/lib/utils/proxy";
import { proxyFailureResponse } from "@/lib/utils/proxy-error";
import { InflightJsonCache } from "@/lib/utils/inflight-json-cache";

export { buildSpotUpstreamRequest } from "@/lib/spot-upstream";

type Fetcher = (url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>;

function bad(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }

const CACHE_TTL_MS = 5 * 60 * 1000;
const spotCache = new InflightJsonCache({ now: () => Date.now() });
const spotCoalescingCache = new InflightJsonCache({ maxEntries: 0, now: () => Date.now() });

class SpotHttpError extends Error {
  constructor(readonly status: number) {
    super("Spot upstream request failed");
    this.name = "SpotHttpError";
  }
}
class InvalidSpotResponseError extends Error {
  constructor() {
    super("Invalid spot upstream response");
    this.name = "InvalidSpotResponseError";
  }
}
class UncacheableSpotResponseError extends Error {
  constructor(readonly payload: unknown) {
    super("Spot response is not a cacheable semantic envelope");
    this.name = "UncacheableSpotResponseError";
  }
}

function spotCachePolicy(exchange: string, action: string): { cache: InflightJsonCache; ttlMs: number } | null {
  if (exchange === "bitget" && action === "instruments") return { cache: spotCache, ttlMs: CACHE_TTL_MS };
  if (exchange !== "gateio" && action === "list") return { cache: spotCoalescingCache, ttlMs: 0 };
  return null;
}
export function clearSpotCaches(): void {
  spotCache.clear();
  spotCoalescingCache.clear();
}

function canonicalSpotKey(exchange: string, action: string, built: { url: string; init: RequestInit }): string {
  return JSON.stringify(["spot", exchange, action, built.url, built.init.body ?? null]);
}

function isCacheableSpotPayload(exchange: string, action: string, payload: unknown): boolean {
  if (action === "instruments" && exchange === "bitget") {
    const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    return object?.code === "00000" && typeof object.msg === "string" && Object.prototype.hasOwnProperty.call(object, "data");
  }
  if (action !== "list") return true;
  if (Array.isArray(payload)) return true;
  if (payload === null || typeof payload !== "object") return false;
  const object = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(object, "error")) return false;
  if (Object.prototype.hasOwnProperty.call(object, "retCode")) {
    return (object.retCode === 0 || object.retCode === "0") && typeof object.retMsg === "string" && Object.prototype.hasOwnProperty.call(object, "result");
  }
  if (Object.prototype.hasOwnProperty.call(object, "code")) {
    return (object.code === "0" || object.code === "00000") && typeof object.msg === "string" && Object.prototype.hasOwnProperty.call(object, "data");
  }
  return true;
}

async function loadSpot(
  built: { url: string; init: RequestInit & { timeout?: number } },
  fetcher: Fetcher,
  exchange: string,
  action: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetcher(built.url, {
    ...built.init,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new SpotHttpError(response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InvalidSpotResponseError();
  }
  if (!isCacheableSpotPayload(exchange, action, payload)) throw new UncacheableSpotResponseError(payload);
  return payload;
}

function spotFailureResponse(request: NextRequest, exchange: string, error: unknown): NextResponse {
  if (request.signal.aborted) return proxyFailureResponse(request.signal);
  if (error instanceof SpotHttpError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return NextResponse.json({ error: "Upstream request failed", status: error.status }, { status });
  }
  if (error instanceof InvalidSpotResponseError) {
    if (exchange === "gateio") return NextResponse.json({ error: "Invalid upstream response" }, { status: 502 });
    const failure = proxyFailureResponse(request.signal);
    if (failure.status !== 502) return failure;
    return NextResponse.json({ error: "Invalid upstream response" }, { status: 502 });
  }
  if (error instanceof UncacheableSpotResponseError) return NextResponse.json(error.payload);
  if (exchange === "gateio") {
    if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    return NextResponse.json({ error: "Failed to fetch upstream" }, { status: 502 });
  }
  return proxyFailureResponse(request.signal, error);
}

export async function handleSpotRequest(request: NextRequest, exchange: string, fetcher: Fetcher = proxyFetch): Promise<NextResponse> {
  const built = buildSpotUpstreamRequest(exchange, request.nextUrl.searchParams);
  if (typeof built === "string") return bad(built);
  const action = request.nextUrl.searchParams.get("action")!;
  const policy = spotCachePolicy(exchange, action);
  try {
    const payload = policy
      ? await policy.cache.getOrLoad(canonicalSpotKey(exchange, action, built), policy.ttlMs, () => loadSpot(built, fetcher, exchange, action), request.signal)
      : await loadSpot(built, fetcher, exchange, action, request.signal);
    if (request.signal.aborted) return proxyFailureResponse(request.signal);
    // Responses are deliberately not shared; only the parsed JSON value is.
    return NextResponse.json(payload);
  } catch (error) {
    return spotFailureResponse(request, exchange, error);
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ exchange: string }> }) {
  const { exchange } = await context.params;
  return handleSpotRequest(request, exchange);
}
