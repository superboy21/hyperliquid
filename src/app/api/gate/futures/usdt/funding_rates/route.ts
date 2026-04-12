import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";

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
    const uniqueContracts = Array.from(new Set(body.contracts.filter((contract): contract is string => typeof contract === "string" && contract.length > 0)));
    const data = await Promise.all(
      uniqueContracts.map(async (contract) => {
        try {
          const history = await Promise.any(
            GATE_API_URLS.map(async (baseUrl) => {
              const url = `${baseUrl}/futures/usdt/funding_rate?contract=${encodeURIComponent(contract)}&limit=1`;
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

              const payload = await response.json();
              if (!Array.isArray(payload)) {
                throw new Error("Invalid funding history payload");
              }

              return payload;
            }),
          );

          return { contract, data: history };
        } catch (error) {
          if (request.signal.aborted || isAbortLikeError(error)) {
            throw error;
          }

          return { contract, data: [] };
        }
      }),
    );

    return NextResponse.json(data);
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }

    const message = error instanceof AggregateError
      ? error.errors?.[0]?.message || "Failed to fetch batch funding rates"
      : error instanceof Error
        ? error.message
        : "Failed to fetch batch funding rates";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
