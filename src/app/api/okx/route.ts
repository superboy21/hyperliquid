import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";

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
    const response = await fetch(buildUrl(endpoint, request.nextUrl.searchParams), {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }

    const message = error instanceof Error ? error.message : "Failed to fetch OKX data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
