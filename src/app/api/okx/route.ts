import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";

const OKX_API_BASE = "https://www.okx.com/api/v5";

function buildUrl(endpoint: string, params: URLSearchParams): string {
  const query = new URLSearchParams(params);
  query.delete("endpoint");
  return `${OKX_API_BASE}/${endpoint}${query.toString() ? `?${query.toString()}` : ""}`;
}

export async function GET(request: NextRequest) {
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint parameter is required" }, { status: 400 });
  }

  try {
    const url = buildUrl(endpoint, request.nextUrl.searchParams);

    const response = await proxyFetch(url, {
      timeout: 10_000,
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }

    const message = error instanceof Error ? error.message : "Failed to fetch OKX data";
    console.error("[OKX API] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}