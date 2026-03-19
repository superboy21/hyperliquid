import { NextRequest, NextResponse } from "next/server";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

export async function GET(request: NextRequest) {
  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    try {
      console.log(`[Gate API] Trying contracts: ${baseUrl}/futures/usdt/contracts`);
      
      const response = await fetch(`${baseUrl}/futures/usdt/contracts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`[Gate API] Success, got ${data.length} contracts`);
      return NextResponse.json(data);
    } catch (error) {
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
