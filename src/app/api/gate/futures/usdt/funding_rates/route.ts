import { NextRequest, NextResponse } from "next/server";
import {
  fetchGateJson,
  isArrayPayload,
  mapWithConcurrency,
} from "../gate-route";

const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;
const MAX_BATCH_CONTRACTS = 50;
const UPSTREAM_CONCURRENCY = 8;

type BatchResult =
  | { contract: string; data: unknown[] }
  | { contract: string; error: { status: number; message: string; retryAfter?: string } };

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

  const uniqueContracts = Array.from(new Set(contracts as string[]));
  try {
    const results = await mapWithConcurrency(uniqueContracts, UPSTREAM_CONCURRENCY, async (contract): Promise<BatchResult> => {
      const result = await fetchGateJson<unknown[]>(request, {
        path: "/futures/usdt/funding_rate",
        query: { contract, limit: "1" },
        timeout: 5_000,
        validate: isArrayPayload,
        invalidMessage: "Invalid funding history payload",
      });

      if (result.ok) return { contract, data: result.data };
      return {
        contract,
        error: {
          status: result.status,
          message: result.message,
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
        },
      };
    });

    if (request.signal.aborted || results.some((result) => "error" in result && result.error.status === 499)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }

    // Failed items are explicit rather than being represented as empty market
    // data. Existing consumers can continue to use the data-bearing items.
    return NextResponse.json(results);
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch batch funding rates" }, { status: 502 });
  }
}
