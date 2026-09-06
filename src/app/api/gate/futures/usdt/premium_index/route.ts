import { NextRequest, NextResponse } from "next/server";
import { fetchGateJson, gateFailureResponse, isArrayPayload } from "../gate-route";

const MAX_LIMIT = 1_000;
const INTERVALS = new Set(["10s", "1m", "5m", "10m", "15m", "30m", "1h", "4h", "8h", "1d", "7d", "30d", "1w"]);
const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const allowed = new Set(["contract", "limit", "from", "to", "interval"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = params.get("contract");
  const limit = params.get("limit") ?? "100";
  const from = params.get("from");
  const to = params.get("to");
  const interval = params.get("interval");
  if (!contract || !CONTRACT_RE.test(contract)) return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  if (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  for (const value of [from, to]) {
    if (value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)) return NextResponse.json({ error: "from and to must be positive integers" }, { status: 400 });
  }
  if (from && to && Number(from) > Number(to)) return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  if (interval !== null && !INTERVALS.has(interval)) return NextResponse.json({ error: "invalid interval" }, { status: 400 });

  const result = await fetchGateJson<unknown[]>(request, {
    path: "/futures/usdt/premium_index",
    query: { contract, limit, from: from ?? undefined, to: to ?? undefined, interval: interval ?? undefined },
    timeout: 5_000,
    validate: isArrayPayload,
    invalidMessage: "Invalid premium index response format",
  });

  return result.ok ? NextResponse.json(result.data) : gateFailureResponse(result);
}
