import { NextRequest, NextResponse } from "next/server";

const LIGHTER_API_BASE = "https://mainnet.zklighter.elliot.ai";

/**
 * Lighter.xyz API 代理
 * 解决 CORS 问题
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint") || "funding-rates";

  try {
    let url = `${LIGHTER_API_BASE}/api/v1/${endpoint}`;
    const params = new URLSearchParams();

    // 传递所有查询参数（排除 endpoint）
    for (const [key, value] of searchParams.entries()) {
      if (key !== "endpoint") {
        params.append(key, value);
      }
    }

    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    console.log(`[Lighter API] Fetching: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Lighter API] Error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { error: `Failed to fetch data from Lighter: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log(`[Lighter API] Success: ${endpoint}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Lighter API] Error proxying request:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 }
    );
  }
}
