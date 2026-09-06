import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

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

  try {
    const response = await proxyFetch(API_URL, {
      method: "POST",
      timeout: TIMEOUT_MS,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (request.signal.aborted) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    const jsonPayload = Array.isArray(payload) || isObject(payload) ? payload : null;
    const status = response.ok ? response.status : upstreamStatus(response.status);
    const headers = new Headers();
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && (status === 429 || status === 503)) headers.set("Retry-After", retryAfter);
    if (jsonPayload !== null) return NextResponse.json(jsonPayload, { status, headers });
    return NextResponse.json({ error: "Upstream returned non-JSON" }, { status: response.ok ? 502 : status, headers });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[Hyperliquid API] Fetch error: ${message}`);
    return NextResponse.json({ error: `Fetch error: ${message}` }, { status: 502 });
  }
}
