import { NextRequest, NextResponse } from "next/server";
import { isAbortLikeError } from "@/lib/utils/abort";
import { proxyFetch } from "@/lib/utils/proxy";
import { enrichGateTickers } from "@/lib/gate-upstream";

const CONTRACT_RE = /^[A-Z0-9]+_USDT$/;

export async function GET(request: NextRequest) {
  const baseUrl = "https://api.gateio.ws/api/v4";
  const searchParams = request.nextUrl.searchParams;
  const allowed = new Set(["contract"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      return NextResponse.json({ error: "Invalid, duplicate, or unknown query parameter" }, { status: 400 });
    }
  }
  const contract = searchParams.get("contract");
  if (contract !== null && !CONTRACT_RE.test(contract)) {
    return NextResponse.json({ error: "contract must be a Gate USDT contract" }, { status: 400 });
  }

  try {
    console.log(`[Gate API] Fetching from: ${baseUrl}`);

    // 并行拉取 tickers 和 contracts，缩短首屏等待时间
    const requestInit: RequestInit & { timeout: number } = {
      method: "GET",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 10_000,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    };

    const tickersUrl = new URL(`${baseUrl}/futures/usdt/tickers`);
    if (contract) tickersUrl.searchParams.set("contract", contract);
    const contractsUrl = new URL(`${baseUrl}/futures/usdt/contracts`);
    const [tickersRes, contractsRes] = await Promise.allSettled([
      proxyFetch(tickersUrl, requestInit),
      proxyFetch(contractsUrl, requestInit),
    ]);

    if (tickersRes.status !== "fulfilled" || !tickersRes.value.ok) {
      const status = tickersRes.status === "fulfilled" ? tickersRes.value.status : "rejected";
      throw new Error(`Tickers API failed: ${status}`);
    }

    const tickers = await tickersRes.value.json();

    let contracts: any[] = [];
    if (contractsRes.status === "fulfilled" && contractsRes.value.ok) {
      try {
        contracts = await contractsRes.value.json();
      } catch {
        contracts = [];
      }
    } else {
      console.log("[Gate API] Contracts fetch failed, using default funding interval");
    }

    if (!Array.isArray(tickers)) {
      throw new Error("Invalid ticker response format");
    }

    const mergedTickers = enrichGateTickers(tickers, contracts);

    console.log(`[Gate API] Success, got ${mergedTickers.length} tickers`);
    return NextResponse.json(mergedTickers);
  } catch (error) {
    console.error("[Gate API] Error:", error);
    if (request.signal.aborted || isAbortLikeError(error)) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch tickers" },
      { status: 500 }
    );
  }
}
