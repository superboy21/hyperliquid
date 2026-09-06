import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];

const MAX_LIMIT = 1_000;
const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;

function parseQuery(request: NextRequest): { contract: string; limit: string; from?: string; to?: string } | NextResponse {
  const params = request.nextUrl.searchParams;
  const allowed = new Set(["contract", "limit", "from", "to"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = params.get("contract");
  const limit = params.get("limit") ?? "100";
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  if (!contract || !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }
  if (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }
  if (from !== undefined && (!/^\d+$/.test(from) || !Number.isSafeInteger(Number(from)))) {
    return NextResponse.json({ error: "from must be a non-negative integer" }, { status: 400 });
  }
  if (to !== undefined && (!/^\d+$/.test(to) || !Number.isSafeInteger(Number(to)) || Number(to) < 1)) {
    return NextResponse.json({ error: "to must be a positive integer" }, { status: 400 });
  }
  if (from && to && Number(from) > Number(to)) {
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  }
  return { contract, limit, from, to };
}

export async function GET(request: NextRequest) {
  const parsed = parseQuery(request);
  if (parsed instanceof NextResponse) return parsed;
  const { contract, limit, from, to } = parsed;

  try {
    let lastError: Error | null = null;
    for (const baseUrl of GATE_API_URLS) {
      if (request.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      try {
        const url = new URL(`${baseUrl}/futures/usdt/funding_rate`);
        url.searchParams.set("contract", contract);
        url.searchParams.set("limit", limit);
        if (from) url.searchParams.set("from", from);
        if (to) url.searchParams.set("to", to);
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

        return NextResponse.json(await response.json());
      } catch (error) {
        if (request.signal.aborted) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    return NextResponse.json({ error: lastError?.message || "Failed to fetch funding rate history" }, { status: 500 });
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
