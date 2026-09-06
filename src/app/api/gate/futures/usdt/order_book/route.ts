import { NextRequest, NextResponse } from "next/server";
import { fetchGateJson, gateFailureResponse, isRecord } from "../gate-route";

const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;
const MAX_LIMIT = 1_000;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const allowed = new Set(["contract", "interval", "limit", "book", "rpi"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = searchParams.get("contract");
  const interval = searchParams.get("interval");
  const limit = searchParams.get("limit") || "20";
  const book = searchParams.get("book");
  const rpiParam = searchParams.get("rpi");

  if (!contract || !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }
  if (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }
  if (interval !== null && interval !== "book") {
    return NextResponse.json({ error: "interval must be book when supplied" }, { status: 400 });
  }
  if (book !== null && book !== "0" && book !== "1") {
    return NextResponse.json({ error: "book must be 0 or 1" }, { status: 400 });
  }
  if (rpiParam !== null && rpiParam !== "0" && rpiParam !== "1") {
    return NextResponse.json({ error: "rpi must be 0 or 1" }, { status: 400 });
  }
  if (interval === "book" && book === "0") {
    return NextResponse.json({ error: "book conflicts with interval=book" }, { status: 400 });
  }

  const withBookParam = interval === "book" || book === "1";
  const rpi = rpiParam === "1";
  const result = await fetchGateJson<Record<string, unknown>>(request, {
    path: `/futures/usdt/${rpi ? "rpi_order_book" : "order_book"}`,
    query: {
      contract,
      limit,
      ...(withBookParam ? { with_book: "true" } : {}),
    },
    timeout: 10_000,
    validate: isRecord,
    invalidMessage: "Invalid order book response format",
  });

  return result.ok ? NextResponse.json(result.data) : gateFailureResponse(result);
}
