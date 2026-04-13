import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "OKX CCXT route has been retired. Use native OKX routes instead." },
    { status: 410 },
  );
}
