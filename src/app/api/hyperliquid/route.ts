import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";
import { proxyFailureResponse, retryAfterHeaders } from "@/lib/utils/proxy-error";
import { InflightJsonCache } from "@/lib/utils/inflight-json-cache";

const API_URL = "https://api.hyperliquid.xyz/info";
const TIMEOUT_MS = 10_000;
const MAX_BODY_LENGTH = 64 * 1024;
const MAX_COIN_LENGTH = 64;
const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"]);
const LIVE_DEXES = new Set(["xyz", "para", "hyna"]);
const COIN_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

type JsonObject = Record<string, unknown>;

function badRequest(message = "Invalid request body") {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function validString(value: unknown, maxLength: number, pattern: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && pattern.test(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTimeRange(value: JsonObject, startKey = "startTime", endKey = "endTime") {
  const hasStart = Object.prototype.hasOwnProperty.call(value, startKey);
  const hasEnd = Object.prototype.hasOwnProperty.call(value, endKey);
  if (hasStart && !validTimestamp(value[startKey])) return false;
  if (hasEnd && !validTimestamp(value[endKey])) return false;
  if (hasEnd && !hasStart) return false;
  return !hasStart || !hasEnd || (value[startKey] as number) <= (value[endKey] as number);
}

function validateBody(body: unknown): body is JsonObject {
  if (!isObject(body) || typeof body.type !== "string") return false;

  switch (body.type) {
    case "predictedFundings":
      return hasOnlyKeys(body, ["type"]);
    case "metaAndAssetCtxs":
      return hasOnlyKeys(body, ["type"], ["dex"]) &&
        (!Object.prototype.hasOwnProperty.call(body, "dex") ||
          (typeof body.dex === "string" && LIVE_DEXES.has(body.dex)));
    case "fundingHistory":
      return hasOnlyKeys(body, ["type", "coin"], ["startTime", "endTime"]) &&
        validString(body.coin, MAX_COIN_LENGTH, COIN_RE) && validTimeRange(body);
    case "candleSnapshot": {
      if (!hasOnlyKeys(body, ["type", "req"]) || !isObject(body.req)) return false;
      if (!hasOnlyKeys(body.req, ["coin", "interval", "startTime", "endTime"])) return false;
      return validString(body.req.coin, MAX_COIN_LENGTH, COIN_RE) &&
        typeof body.req.interval === "string" && INTERVALS.has(body.req.interval) &&
        validTimestamp(body.req.startTime) && validTimestamp(body.req.endTime) &&
        body.req.startTime <= body.req.endTime;
    }
    case "l2Book":
      return hasOnlyKeys(body, ["type", "coin"]) && validString(body.coin, MAX_COIN_LENGTH, COIN_RE);
    case "meta":
      return hasOnlyKeys(body, ["type"]);
    default:
      return false;
  }
}

/** JSON.parse discards duplicate keys, so detect them before parsing. */
class DuplicateKeyScanner {
  private position = 0;
  private duplicate = false;

  constructor(private readonly source: string) {}

  scan() {
    this.parseValue();
    this.skipWhitespace();
    return this.duplicate;
  }

  private skipWhitespace() {
    while (/\s/.test(this.source[this.position] ?? "")) this.position += 1;
  }

  private parseString() {
    if (this.source[this.position] !== '"') return "";
    const start = this.position;
    this.position += 1;
    while (this.position < this.source.length) {
      const character = this.source[this.position++];
      if (character === "\\") {
        this.position += 1;
      } else if (character === '"') {
        return this.source.slice(start, this.position);
      }
    }
    return "";
  }

  private parseValue() {
    this.skipWhitespace();
    const token = this.source[this.position];
    if (token === "{") return this.parseObject();
    if (token === "[") return this.parseArray();
    if (token === '"') {
      this.parseString();
      return;
    }
    while (this.position < this.source.length && !",]}".includes(this.source[this.position])) this.position += 1;
  }

  private parseObject() {
    this.position += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.position] === "}") {
      this.position += 1;
      return;
    }
    while (this.position < this.source.length) {
      this.skipWhitespace();
      const rawKey = this.parseString();
      if (!rawKey) return;
      try {
        const key = JSON.parse(rawKey) as string;
        if (keys.has(key)) this.duplicate = true;
        keys.add(key);
      } catch {
        return;
      }
      this.skipWhitespace();
      if (this.source[this.position++] !== ":") return;
      this.parseValue();
      this.skipWhitespace();
      if (this.source[this.position] === "}") {
        this.position += 1;
        return;
      }
      if (this.source[this.position++] !== ",") return;
    }
  }

  private parseArray() {
    this.position += 1;
    this.skipWhitespace();
    if (this.source[this.position] === "]") {
      this.position += 1;
      return;
    }
    while (this.position < this.source.length) {
      this.parseValue();
      this.skipWhitespace();
      if (this.source[this.position] === "]") {
        this.position += 1;
        return;
      }
      if (this.source[this.position++] !== ",") return;
    }
  }
}

function upstreamStatus(status: number) {
  return status >= 400 && status <= 599 ? status : 502;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const hyperliquidCache = new InflightJsonCache({ now: () => Date.now() });
const hyperliquidCoalescingCache = new InflightJsonCache({ maxEntries: 0, now: () => Date.now() });

class HyperliquidResponseError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    readonly retryHeaders: Headers,
  ) {
    super("Hyperliquid upstream returned an error");
    this.name = "HyperliquidResponseError";
  }
}
class InvalidHyperliquidResponseError extends Error {
  constructor() {
    super("Invalid Hyperliquid upstream response");
    this.name = "InvalidHyperliquidResponseError";
  }
}

function isHyperliquidSuccessEnvelope(type: string, payload: unknown): boolean {
  if (type !== "meta" && type !== "metaAndAssetCtxs") return true;
  if (payload === null || (typeof payload !== "object" && !Array.isArray(payload))) return false;
  if (Array.isArray(payload)) {
    return !payload.some((item) => isObject(item) && (
      Object.prototype.hasOwnProperty.call(item, "error") ||
      Object.prototype.hasOwnProperty.call(item, "code") ||
      Object.prototype.hasOwnProperty.call(item, "message") ||
      Object.prototype.hasOwnProperty.call(item, "msg")
    ));
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "error") ||
    Object.prototype.hasOwnProperty.call(payload, "code") ||
    Object.prototype.hasOwnProperty.call(payload, "message") ||
    Object.prototype.hasOwnProperty.call(payload, "msg") ||
    (payload as JsonObject).success === false
  ) return false;
  return true;
}

function canonicalBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalBody);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalBody(value[key])]));
  return value;
}
function hyperliquidCachePolicy(type: string): { cache: InflightJsonCache; ttlMs: number } | null {
  if (type === "meta") return { cache: hyperliquidCache, ttlMs: CACHE_TTL_MS };
  if (type === "metaAndAssetCtxs") return { cache: hyperliquidCoalescingCache, ttlMs: 0 };
  return null;
}
export function clearHyperliquidCaches(): void {
  hyperliquidCache.clear();
  hyperliquidCoalescingCache.clear();
}

async function loadHyperliquid(body: JsonObject, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await proxyFetch(API_URL, {
      method: "POST",
      timeout: TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[Hyperliquid API] Fetch error");
    throw error;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new InvalidHyperliquidResponseError();
    throw new HyperliquidResponseError(upstreamStatus(response.status), null, response.status === 429 || response.status === 503 ? retryAfterHeaders(response) : new Headers());
  }
  const jsonPayload = Array.isArray(payload) || isObject(payload) ? payload : null;
  const status = response.ok ? response.status : upstreamStatus(response.status);
  const headers = status === 429 || status === 503 ? retryAfterHeaders(response) : new Headers();
  if (jsonPayload !== null && response.ok) {
    if (!isHyperliquidSuccessEnvelope(String(body.type), jsonPayload)) {
      throw new InvalidHyperliquidResponseError();
    }
    return jsonPayload;
  }
  if (jsonPayload !== null) throw new HyperliquidResponseError(status, jsonPayload, headers);
  if (response.ok) throw new InvalidHyperliquidResponseError();
  throw new HyperliquidResponseError(status, null, headers);
}

function hyperliquidFailureResponse(request: NextRequest, error: unknown): NextResponse {
  if (request.signal.aborted) return proxyFailureResponse(request.signal);
  if (error instanceof HyperliquidResponseError) {
    if (error.payload !== null) return NextResponse.json(error.payload, { status: error.status, headers: error.retryHeaders });
    return NextResponse.json({ error: "Upstream returned non-JSON" }, { status: error.status, headers: error.retryHeaders });
  }
  if (error instanceof InvalidHyperliquidResponseError) return proxyFailureResponse(request.signal);
  return proxyFailureResponse(request.signal, error);
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    return badRequest();
  }

  if (rawBody.length === 0 || rawBody.length > MAX_BODY_LENGTH || new DuplicateKeyScanner(rawBody).scan()) {
    return badRequest();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  if (!validateBody(body)) return badRequest();

  const bodyType = body.type as string;
  const policy = hyperliquidCachePolicy(bodyType);
  try {
    const payload = policy
      ? await policy.cache.getOrLoad(`hyperliquid:${JSON.stringify(canonicalBody(body))}`, policy.ttlMs, () => loadHyperliquid(body), request.signal)
      : await loadHyperliquid(body, request.signal);
    if (request.signal.aborted) return proxyFailureResponse(request.signal);
    return NextResponse.json(payload);
  } catch (error) {
    return hyperliquidFailureResponse(request, error);
  }
}
