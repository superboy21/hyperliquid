import { NextRequest, NextResponse } from "next/server";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

interface BatchFundingRatesRequest {
  contracts: string[];
}

export async function POST(request: NextRequest) {
  let body: BatchFundingRatesRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (!Array.isArray(body.contracts) || body.contracts.length === 0) {
    return NextResponse.json({ error: "contracts is required" }, { status: 400 });
  }

  try {
    const data = await Promise.any(
      GATE_API_URLS.map(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/futures/usdt/funding_rates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      }),
    );

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof AggregateError
      ? error.errors?.[0]?.message || "Failed to fetch batch funding rates"
      : error instanceof Error
        ? error.message
        : "Failed to fetch batch funding rates";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
