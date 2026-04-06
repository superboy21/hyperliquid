import { NextRequest, NextResponse } from "next/server";

const BINANCE_API_BASE = "https://fapi.binance.com";

/**
 * Binance API 代理
 * 解决 CORS 问题
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

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Binance API error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: "Failed to fetch data from Binance" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error proxying Binance request:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 }
    );
  }
}
