import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";

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

  try {
    const data = await Promise.any(
      GATE_API_URLS.map(async (baseUrl) => {
        const url = `${baseUrl}/futures/usdt/funding_rate?contract=${contract}&limit=${limit}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      }),
    );

    return NextResponse.json(data);
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json(
        { error: "Request cancelled" },
        { status: 499 }
      );
    }

    const message = error instanceof AggregateError
      ? error.errors?.[0]?.message || "Failed to fetch funding rate history"
      : error instanceof Error
        ? error.message
        : "Failed to fetch funding rate history";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
