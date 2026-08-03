import { NextRequest, NextResponse } from "next/server";
import { buildSpotUpstreamRequest } from "@/lib/spot-upstream";
import { proxyFetch } from "@/lib/utils/proxy";

export { buildSpotUpstreamRequest } from "@/lib/spot-upstream";

type Fetcher = (url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>;

function bad(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }

export async function handleSpotRequest(request: NextRequest, exchange: string, fetcher: Fetcher = proxyFetch): Promise<NextResponse> {
  const built = buildSpotUpstreamRequest(exchange, request.nextUrl.searchParams);
  if (typeof built === "string") return bad(built);
  try {
    const response = await fetcher(built.url, { ...built.init, signal: request.signal });
    if (!response.ok) {
      const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
      return NextResponse.json({ error: "Upstream request failed", status: response.status }, { status });
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { return NextResponse.json({ error: "Invalid upstream response" }, { status: 502 }); }
    return NextResponse.json(payload);
  } catch (error) {
    if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    return NextResponse.json({ error: "Failed to fetch upstream" }, { status: 502 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ exchange: string }> }) {
  const { exchange } = await context.params;
  return handleSpotRequest(request, exchange);
}
