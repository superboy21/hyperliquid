import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/utils/proxy";

const BINANCE_API_BASE = "https://fapi.binance.com";

/**
 * Binance API 代理
 * 解决 CORS 问题，支持 HTTP 代理
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint") || "premiumIndex";

  try {
    let url = `${BINANCE_API_BASE}/fapi/v1/${endpoint}`;
    const params = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      if (key !== "endpoint") {
        params.append(key, value);
      }
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await proxyFetch(url, {
      timeout: 10_000,
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

    console.error("Error proxying Binance request:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 },
    );
  }
}