import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const BINANCE_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines";
const SYMBOL_RE = /^[A-Z0-9]{1,40}$/;
const INTERVALS = new Set([
  "1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "3d", "1w", "1M",
]);

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function validPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export function buildBinanceKlinesUrl(params: URLSearchParams): URL {
  const url = new URL(BINANCE_KLINES_URL);
  for (const key of ["symbol", "interval", "limit", "startTime", "endTime"] as const) {
    const value = params.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  return url;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const allowed = new Set(["symbol", "interval", "limit", "startTime", "endTime"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return badRequest("Unknown or repeated parameter");
    }
  }

  const symbol = params.get("symbol");
  if (!symbol) return badRequest("Symbol is required");
  if (!SYMBOL_RE.test(symbol)) return badRequest("Invalid symbol");

  const interval = params.get("interval") ?? "1d";
  if (!INTERVALS.has(interval)) return badRequest("Invalid interval");

  const limit = params.get("limit") ?? "30";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1500) {
    return badRequest("Invalid limit");
  }

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  if ((startTime !== null && !validPositiveInteger(startTime)) || (endTime !== null && !validPositiveInteger(endTime))) {
    return badRequest("Invalid timestamp");
  }
  if (startTime && endTime && Number(startTime) > Number(endTime)) {
    return badRequest("startTime must not exceed endTime");
  }

  const upstream = buildBinanceKlinesUrl(params);
  try {
    const response = await proxyFetch(upstream, {
      timeout: 15_000,
      signal: request.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status} - ${errorText}`);
      const headers = new Headers();
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) headers.set("Retry-After", retryAfter);
      return NextResponse.json(
        { error: "Failed to fetch data from Binance" },
        { status: response.status, headers },
      );
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    console.error("Error proxying Binance klines request:", error);
    return NextResponse.json({ error: "Failed to proxy request" }, { status: 500 });
  }
}
