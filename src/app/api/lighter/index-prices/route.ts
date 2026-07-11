import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHTER_WS = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true";
const WS_CONNECT_TIMEOUT_MS = 5_000;
const WS_HARD_TIMEOUT_MS = 6_000;
const WS_COLLECT_MS = 3_000;
const CACHE_TTL_MS = 15_000;
const MAX_REQUESTED_MARKETS = 100;

interface LighterMarketStats {
  symbol?: string;
  index_price?: string | number;
  market_id?: number | string;
}

interface IndexPrice {
  marketId: number | null;
  symbol: string | null;
  price: number;
}

interface IndexPriceSnapshot {
  prices: IndexPrice[];
  complete: boolean;
  received: number;
  expected: number | null;
  missingMarketIds: number[];
  fetchedAt: string;
  source: "websocket" | "cache";
  stale: boolean;
  reason?: "connect_timeout" | "collection_timeout" | "closed" | "error";
}

let lastCompleteSnapshot: IndexPriceSnapshot | null = null;
let cacheExpiresAt = 0;
const inFlight = new Map<string, Promise<IndexPriceSnapshot>>();

function satisfiesTargets(snapshot: IndexPriceSnapshot, requestedMarketIds: ReadonlySet<number>): boolean {
  if (requestedMarketIds.size === 0) return snapshot.complete;
  const available = new Set(snapshot.prices.flatMap((price) => price.marketId === null ? [] : [price.marketId]));
  return [...requestedMarketIds].every((marketId) => available.has(marketId));
}

function collectIndexPrices(requestedMarketIds: ReadonlySet<number>): Promise<IndexPriceSnapshot> {
  return new Promise((resolve) => {
    let settled = false;
    let expectedMarketIds: Set<number> | null = null;
    let reason: IndexPriceSnapshot["reason"] = "collection_timeout";
    const byMarketId = new Map<number, IndexPrice>();
    const bySymbol = new Map<string, IndexPrice>();
    const ws = new globalThis.WebSocket(LIGHTER_WS);
    let collectTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;

    const requestedMissing = () => [...requestedMarketIds].filter((marketId) => !byMarketId.has(marketId));
    const fullMissing = () => expectedMarketIds === null
      ? []
      : [...expectedMarketIds].filter((marketId) => !byMarketId.has(marketId));
    const isComplete = () => requestedMarketIds.size > 0
      ? requestedMissing().length === 0
      : expectedMarketIds !== null && fullMissing().length === 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (collectTimer) clearTimeout(collectTimer);
      try { ws.close(); } catch { /* ignore */ }

      const prices = [...byMarketId.values()];
      for (const [symbol, item] of bySymbol) {
        if (!prices.some((price) => price.symbol === symbol)) prices.push(item);
      }
      const complete = isComplete();
      resolve({
        prices,
        complete,
        received: prices.length,
        expected: requestedMarketIds.size > 0 ? requestedMarketIds.size : expectedMarketIds?.size ?? null,
        missingMarketIds: requestedMarketIds.size > 0 ? requestedMissing() : fullMissing(),
        fetchedAt: new Date().toISOString(),
        source: "websocket",
        stale: false,
        ...(complete ? {} : { reason }),
      });
    };

    const connectTimer = setTimeout(() => {
      reason = "connect_timeout";
      finish();
    }, WS_CONNECT_TIMEOUT_MS);

    const ingest = (marketStats: unknown, fullSnapshot: boolean) => {
      const statsObject = (marketStats ?? {}) as Record<string, unknown>;
      const entries = Array.isArray(marketStats)
        ? marketStats.map((stat) => [null, stat] as const)
        : "index_price" in statsObject
          ? [[null, marketStats] as const]
          : Object.entries(statsObject);
      const snapshotMarketIds = new Set<number>();
      const changedMarketIds = new Set<number>();
      let symbolOnlyChanged = false;

      for (const [fallbackId, value] of entries) {
        const stat = value as LighterMarketStats;
        const idCandidate = stat.market_id ?? fallbackId;
        const hasIdCandidate = idCandidate !== null && idCandidate !== undefined &&
          (typeof idCandidate !== "string" || idCandidate.trim() !== "");
        const parsedId = hasIdCandidate ? Number(idCandidate) : Number.NaN;
        const marketId = Number.isInteger(parsedId) && parsedId >= 0 ? parsedId : null;
        if (marketId !== null) snapshotMarketIds.add(marketId);

        const price = Number(stat.index_price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const symbol = typeof stat.symbol === "string" && stat.symbol ? stat.symbol : null;
        const item = { marketId, symbol, price };
        if (marketId !== null) {
          const previous = byMarketId.get(marketId);
          if (!previous || previous.price !== price || previous.symbol !== symbol) {
            byMarketId.set(marketId, item);
            changedMarketIds.add(marketId);
          }
        } else if (symbol) {
          const previous = bySymbol.get(symbol);
          if (!previous || previous.price !== price) {
            bySymbol.set(symbol, item);
            symbolOnlyChanged = true;
          }
        }
      }

      if (fullSnapshot) expectedMarketIds = snapshotMarketIds;
      return { changedMarketIds, symbolOnlyChanged };
    };

    const scheduleCollectionTimeout = () => {
      if (collectTimer) clearTimeout(collectTimer);
      collectTimer = setTimeout(finish, WS_COLLECT_MS);
    };

    ws.addEventListener("open", () => {
      clearTimeout(connectTimer);
      hardTimer = setTimeout(finish, WS_HARD_TIMEOUT_MS);
      ws.send(JSON.stringify({ type: "subscribe", channel: "market_stats/all" }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        const isSubscribedSnapshot = msg.type === "subscribed/market_stats" ||
          (msg.type === "subscribed" && String(msg.channel ?? "").startsWith("market_stats"));
        if ((isSubscribedSnapshot || msg.type === "update/market_stats") && msg.market_stats) {
          const { changedMarketIds, symbolOnlyChanged } = ingest(msg.market_stats, isSubscribedSnapshot);
          if (isComplete()) {
            finish();
            return;
          }
          const expectedIds = expectedMarketIds;
          const relevantChange = requestedMarketIds.size > 0
            ? [...changedMarketIds].some((marketId) => requestedMarketIds.has(marketId))
            : symbolOnlyChanged || (expectedIds !== null &&
              [...changedMarketIds].some((marketId) => expectedIds.has(marketId)));
          if (isSubscribedSnapshot || relevantChange) scheduleCollectionTimeout();
        }
      } catch {
        // Ignore malformed messages and continue collecting.
      }
    });
    ws.addEventListener("error", () => {
      reason = "error";
      finish();
    });
    ws.addEventListener("close", () => {
      reason = "closed";
      finish();
    });
  });
}

function parseRequestedMarketIds(request: NextRequest): Set<number> | NextResponse {
  const rawValues = request.nextUrl.searchParams.getAll("marketIds");
  if (rawValues.length === 0 || rawValues.every((value) => value.trim() === "")) return new Set();

  const tokens = rawValues.flatMap((value) => value.split(","));
  if (tokens.some((token) => !/^\d+$/.test(token.trim()))) {
    return NextResponse.json({ error: "marketIds must contain only non-negative integers" }, { status: 400 });
  }
  const marketIds = new Set(tokens.map((token) => Number(token.trim())));
  if ([...marketIds].some((marketId) => !Number.isSafeInteger(marketId))) {
    return NextResponse.json({ error: "marketIds must contain only safe integers" }, { status: 400 });
  }
  if (marketIds.size > MAX_REQUESTED_MARKETS) {
    return NextResponse.json({ error: `marketIds is limited to ${MAX_REQUESTED_MARKETS} unique values` }, { status: 400 });
  }
  return marketIds;
}

export async function GET(request: NextRequest) {
  const parsed = parseRequestedMarketIds(request);
  if (parsed instanceof NextResponse) return parsed;
  const requestedMarketIds = parsed;
  const now = Date.now();
  if (lastCompleteSnapshot && now < cacheExpiresAt && satisfiesTargets(lastCompleteSnapshot, requestedMarketIds)) {
    return NextResponse.json({ ...lastCompleteSnapshot, source: "cache", stale: false });
  }

  if (typeof globalThis.WebSocket !== "function") {
    if (lastCompleteSnapshot && satisfiesTargets(lastCompleteSnapshot, requestedMarketIds)) {
      return NextResponse.json({ ...lastCompleteSnapshot, source: "cache", stale: true });
    }
    return NextResponse.json({
      error: "WebSocket not available in this runtime",
      complete: false,
      missingMarketIds: [...requestedMarketIds],
    }, { status: 500 });
  }

  try {
    const key = [...requestedMarketIds].sort((a, b) => a - b).join(",");
    let pending = inFlight.get(key);
    if (!pending) {
      pending = collectIndexPrices(requestedMarketIds).finally(() => { inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    const snapshot = await pending;
    if (snapshot.received === 0) {
      if (lastCompleteSnapshot && satisfiesTargets(lastCompleteSnapshot, requestedMarketIds)) {
        return NextResponse.json({ ...lastCompleteSnapshot, source: "cache", stale: true });
      }
      const status = snapshot.reason === "connect_timeout" || snapshot.reason === "collection_timeout" ? 504 : 503;
      return NextResponse.json({ ...snapshot, error: "No Lighter index prices received" }, { status });
    }
    if (requestedMarketIds.size === 0 && snapshot.complete) {
      lastCompleteSnapshot = snapshot;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    }
    return NextResponse.json(snapshot);
  } catch (error) {
    if (lastCompleteSnapshot && satisfiesTargets(lastCompleteSnapshot, requestedMarketIds)) {
      return NextResponse.json({ ...lastCompleteSnapshot, source: "cache", stale: true });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      error: "Failed to fetch Lighter index prices",
      detail,
      complete: false,
      missingMarketIds: [...requestedMarketIds],
    }, { status: 503 });
  }
}
