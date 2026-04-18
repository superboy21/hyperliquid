import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const LIGHTER_API_BASE = "https://mainnet.zklighter.elliot.ai";

/**
 * Lighter.xyz API 代理
 * 解决 CORS 问题，支持 HTTP 代理
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

    const response = await proxyFetch(url, {
      timeout: 15_000,
      signal: request.signal,
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
    return NextResponse.json(data);
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json(
        { error: "Request cancelled" },
        { status: 499 }
      );
    }

    console.error("[Lighter API] Error proxying request:", error);
    return NextResponse.json(
      { error: "Failed to proxy request" },
      { status: 500 }
    );
  }
}