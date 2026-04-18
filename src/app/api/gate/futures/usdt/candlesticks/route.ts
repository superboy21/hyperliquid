import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const contract = searchParams.get("contract");
  const interval = searchParams.get("interval") || "1d";
  const limit = searchParams.get("limit") || "30";

  if (!contract) {
    return NextResponse.json(
      { error: "contract parameter is required" },
      { status: 400 },
    );
  }

  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    try {
      const url = `${baseUrl}/futures/usdt/candlesticks?contract=${contract}&interval=${interval}&limit=${limit}`;

      const response = await proxyFetch(url, {
        timeout: 10_000,
        signal: request.signal,
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
      if (request.signal.aborted || isAbortLikeError(error)) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const message = lastError?.message || "Failed to fetch candlesticks from all Gate.io endpoints";
  return NextResponse.json({ error: message }, { status: 500 });
}