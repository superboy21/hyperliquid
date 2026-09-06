import { NextRequest, NextResponse } from "next/server";
import { fetchGateJson, gateFailureResponse, isArrayPayload } from "../gate-route";

const INTERVALS = new Set(["1m", "5m", "1h", "4h", "1d", "1w"]);
const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;
const MAX_LIMIT = 2_000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const allowed = new Set(["contract", "interval", "limit"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = searchParams.get("contract");
  const interval = searchParams.get("interval") || "1d";
  const limit = searchParams.get("limit") || "30";

  if (!contract || !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }
  if (!INTERVALS.has(interval)) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }
  if (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  const result = await fetchGateJson<unknown[]>(request, {
    path: "/futures/usdt/candlesticks",
    query: { contract, interval, limit },
    timeout: 10_000,
    validate: isArrayPayload,
    invalidMessage: "Invalid candlesticks response format",
  });

  return result.ok ? NextResponse.json(result.data) : gateFailureResponse(result);
}
