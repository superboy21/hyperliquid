import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

const BINANCE_API_BASE = "https://fapi.binance.com";

/**
 * Binance K 线数据代理
 * 解决 CORS 问题，支持 HTTP 代理
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval") || "1d";
  const limit = searchParams.get("limit") || "30";

  if (!symbol) {
    return NextResponse.json(
      { error: "Symbol is required" },
      { status: 400 },
    );
  }

  try {
    const url = `${BINANCE_API_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const response = await proxyFetch(url, {
      timeout: 15_000,
      signal: request.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: "Failed to fetch data from Binance" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    if (request.signal?.aborted) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }

    console.error("Error proxying Binance klines request:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 },
    );
  }
}