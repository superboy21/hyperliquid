import { NextRequest, NextResponse } from "next/server";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const contract = searchParams.get("contract");
  const limit = searchParams.get("limit") || "100";

  if (!contract) {
    return NextResponse.json(
      { error: "contract parameter is required" },
      { status: 400 }
    );
  }

  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    try {
      const url = `${baseUrl}/futures/usdt/funding_rate?contract=${contract}&limit=${limit}`;
      console.log(`[Gate API] Trying: ${url}`);
      
      const response = await fetch(url, {
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
      console.log(`[Gate API] Success, got ${data.length} records`);
      return NextResponse.json(data);
    } catch (error) {
      lastError = error as Error;
      console.error(`[Gate API] Failed:`, error);
      continue;
    }
  }

  return NextResponse.json(
    { error: lastError?.message || "Failed to fetch funding rate history" },
    { status: 500 }
  );
}
