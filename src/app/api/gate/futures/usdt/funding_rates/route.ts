import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;
const MAX_BATCH_CONTRACTS = 50;

export async function POST(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return NextResponse.json({ error: "Unknown query parameter" }, { status: 400 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "contracts")) {
    return NextResponse.json({ error: "contracts is required" }, { status: 400 });
  }
  const contracts = (body as { contracts?: unknown }).contracts;
  if (!Array.isArray(contracts) || contracts.length === 0 || contracts.length > MAX_BATCH_CONTRACTS) {
    return NextResponse.json({ error: "contracts is required" }, { status: 400 });
  }
  if (contracts.some((contract) => typeof contract !== "string" || !CONTRACT_RE.test(contract))) {
    return NextResponse.json({ error: "contracts must contain Gate USDT contracts" }, { status: 400 });
  }

  try {
    const uniqueContracts = Array.from(new Set(contracts as string[]));
    const data = await Promise.all(
      uniqueContracts.map(async (contract) => {
        try {
          for (const baseUrl of GATE_API_URLS) {
            if (request.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
            try {
              const url = new URL(`${baseUrl}/futures/usdt/funding_rate`);
              url.searchParams.set("contract", contract);
              url.searchParams.set("limit", "1");
              const response = await proxyFetch(url, {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
                timeout: 5_000,
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
              });

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const payload = await response.json();
              if (!Array.isArray(payload)) throw new Error("Invalid funding history payload");
              return { contract, data: payload };
            } catch (error) {
              if (request.signal.aborted) throw error;
            }
          }

          return { contract, data: [] };
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
