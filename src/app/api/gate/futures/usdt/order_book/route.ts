import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

const GATE_API_URLS = [
  "https://api.gateio.ws/api/v4",
  "https://api.gate.io/api/v4",
  "https://fx-api.gateio.ws/api/v4",
];
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

  let lastError: Error | null = null;

  for (const baseUrl of GATE_API_URLS) {
    try {
      if (request.signal.aborted) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      // rpi=1 时读取含 RPI 订单的盘口（/futures/usdt/rpi_order_book）；否则普通盘口。
      const bookPath = rpi ? "rpi_order_book" : "order_book";
      const url = new URL(`${baseUrl}/futures/usdt/${bookPath}`);
      url.searchParams.set("contract", contract);
      url.searchParams.set("limit", limit);
      if (withBookParam) url.searchParams.set("with_book", "true");

      const response = await proxyFetch(url, {
        timeout: 10_000,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (request.signal.aborted) {
        return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const message = lastError?.message || "Failed to fetch order book from all Gate.io endpoints";
  return NextResponse.json({ error: message }, { status: 500 });
}
