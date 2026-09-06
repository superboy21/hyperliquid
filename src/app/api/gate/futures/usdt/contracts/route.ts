import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return NextResponse.json({ error: "Unknown query parameter" }, { status: 400 });
  }

  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    try {
      console.log(`[Gate API] Trying contracts: ${baseUrl}/futures/usdt/contracts`);

      const url = new URL(`${baseUrl}/futures/usdt/contracts`);
      const response = await proxyFetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10_000,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Invalid contracts response format");
      console.log(`[Gate API] Success, got ${data.length} contracts`);
      return NextResponse.json(data);
    } catch (error) {
      if (request.signal.aborted) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      if (isAbortLikeError(error)) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      lastError = error as Error;
      console.error(`[Gate API] Failed:`, error);
      continue;
    }
  }

  return NextResponse.json(
    { error: lastError?.message || "Failed to fetch contracts" },
    { status: 500 }
  );
}
