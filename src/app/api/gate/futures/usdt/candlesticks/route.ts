import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];
const INTERVALS = new Set(["1m", "5m", "1h", "4h", "1d", "1w"]);
const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;
const MAX_LIMIT = 2_000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const allowed = new Set(["contract", "interval", "limit"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = searchParams.get("contract");
  const interval = searchParams.get("interval") || "1d";
  const limit = searchParams.get("limit") || "30";

  if (!contract || !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }
  if (!INTERVALS.has(interval)) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }
  if (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    try {
      if (request.signal.aborted) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      const url = new URL(`${baseUrl}/futures/usdt/candlesticks`);
      url.searchParams.set("contract", contract);
      url.searchParams.set("interval", interval);
      url.searchParams.set("limit", limit);

      const response = await proxyFetch(url, {
        timeout: 10_000,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (request.signal.aborted) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const message = lastError?.message || "Failed to fetch candlesticks from all Gate.io endpoints";
  return NextResponse.json({ error: message }, { status: 500 });
}
