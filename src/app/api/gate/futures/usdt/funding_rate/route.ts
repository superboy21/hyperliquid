import { NextRequest, NextResponse } from "next/server";
import { fetchGateJson, gateFailureResponse, isArrayPayload } from "../gate-route";

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

  const result = await fetchGateJson<unknown[]>(request, {
    path: "/futures/usdt/funding_rate",
    query: parsed,
    timeout: 5_000,
    validate: isArrayPayload,
    invalidMessage: "Invalid funding history payload",
  });

  return result.ok ? NextResponse.json(result.data) : gateFailureResponse(result);
}
