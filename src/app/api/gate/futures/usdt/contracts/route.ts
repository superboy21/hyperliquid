import { NextRequest, NextResponse } from "next/server";
import { fetchGateJson, gateFailureResponse, isArrayPayload } from "../gate-route";

export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
    return NextResponse.json({ error: "Unknown query parameter" }, { status: 400 });
  }

  const result = await fetchGateJson<unknown[]>(request, {
    path: "/futures/usdt/contracts",
    timeout: 10_000,
    validate: isArrayPayload,
    invalidMessage: "Invalid contracts response format",
  });

  return result.ok ? NextResponse.json(result.data) : gateFailureResponse(result);
}
