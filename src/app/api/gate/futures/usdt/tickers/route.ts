import { NextRequest, NextResponse } from "next/server";
import { enrichGateTickers, hasCompleteGateTickerEnrichment } from "@/lib/gate-upstream";
import {
  fetchGateJson,
  gateFailureResponse,
  isArrayPayload,
  type GateRouteFailure,
} from "../gate-route";

const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;

function isTickerPayload(value: unknown): value is unknown[] {
  return isArrayPayload(value) && value.every((item) => (
    !!item && typeof item === "object" && !Array.isArray(item) &&
    typeof (item as { contract?: unknown }).contract === "string"
  ));
}

function enrichmentFailure(): NextResponse {
  const failure: GateRouteFailure = {
    ok: false,
    status: 502,
    kind: "malformed",
    message: "Contracts enrichment is unavailable",
  };
  return gateFailureResponse(failure);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const allowed = new Set(["contract"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = searchParams.get("contract");
  if (contract !== null && !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }

  const [tickersResult, contractsResult] = await Promise.all([
    fetchGateJson<unknown[]>(request, {
      path: "/futures/usdt/tickers",
      query: contract ? { contract } : undefined,
      timeout: 10_000,
      validate: isTickerPayload,
      invalidMessage: "Invalid ticker response format",
    }),
    fetchGateJson<unknown[]>(request, {
      path: "/futures/usdt/contracts",
      timeout: 10_000,
      validate: isArrayPayload,
      invalidMessage: "Invalid contracts response format",
    }),
  ]);
  if (!tickersResult.ok) return gateFailureResponse(tickersResult);
  if (tickersResult.data.length === 0) return NextResponse.json([]);

  // Contracts are required metadata for non-empty results, not an optional
  // fallback. In particular, do not turn a contracts outage into an
  // inaccurate 8-hour interval.
  if (!contractsResult.ok) return gateFailureResponse(contractsResult);
  if (!hasCompleteGateTickerEnrichment(tickersResult.data, contractsResult.data)) return enrichmentFailure();

  const mergedTickers = enrichGateTickers(tickersResult.data, contractsResult.data);
  return NextResponse.json(mergedTickers);
}
