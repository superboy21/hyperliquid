import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHTER_WS = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true";
// Connection budget: if WS doesn't open within this, give up.
const WS_CONNECT_TIMEOUT_MS = 5_000;
// Collection budget: hard timeout after WS opens. Starts on "open", so cold
// start / TLS overhead no longer eats into the collection window.
const WS_HARD_TIMEOUT_MS = 6_000;
// Quiet period: resolve this long after the last useful message.
const WS_COLLECT_MS = 3_000;

interface LighterMarketStats {
  symbol?: string;
  index_price?: string;
  market_id?: number;
}

/**
 * Serverless-friendly WebSocket snapshot for Lighter index prices.
 * Uses Node.js native WebSocket (no external ws dependency).
 *
 * Timeout design (fixes "sometimes empty" on cold serverless):
 *   t=0            route starts → connect countdown begins
 *   t=open         WS connected → connect countdown cleared, hard countdown begins
 *   t=first msg    collection window begins (reset on every useful message)
 *   t=first+3s  or  t=open+6s  or  t=5s (no open)   → resolve with whatever collected
 */
export async function GET() {
  const startedAt = Date.now();
  if (typeof globalThis.WebSocket !== "function") {
    return NextResponse.json(
      { error: "WebSocket not available in this runtime" },
      { status: 500 },
    );
  }
  try {
    const prices = await new Promise<Record<string, number>>((resolve) => {
      let settled = false;
      const ws = new globalThis.WebSocket(LIGHTER_WS);
      const result: Record<string, number> = {};
      let collectTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;

      // Connection timeout: if WS doesn't open in time, give up with whatever we have.
      const connectTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (collectTimer) clearTimeout(collectTimer);
        if (hardTimer) clearTimeout(hardTimer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(result);
      }, WS_CONNECT_TIMEOUT_MS);

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        if (hardTimer) clearTimeout(hardTimer);
        if (collectTimer) clearTimeout(collectTimer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(result);
      }

      ws.addEventListener("open", () => {
        // Connection established — switch from connect budget to collection budget.
        clearTimeout(connectTimeout);
        hardTimer = setTimeout(finish, WS_HARD_TIMEOUT_MS);
        ws.send(
          JSON.stringify({
            type: "subscribe",
            channel: "market_stats/all",
          }),
        );
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "update/market_stats" && msg.market_stats) {
            const stats = Array.isArray(msg.market_stats)
              ? msg.market_stats
              : Object.values(msg.market_stats);
            for (const s of stats) {
              const stat = s as LighterMarketStats;
              if (stat.symbol && stat.index_price) {
                const price = Number.parseFloat(stat.index_price);
                if (Number.isFinite(price) && price > 0) {
                  result[stat.symbol] = price;
                }
              }
            }

            // Start/reset collection window after first useful message.
            if (collectTimer) clearTimeout(collectTimer);
            collectTimer = setTimeout(finish, WS_COLLECT_MS);
          }
        } catch {
          // ignore parse errors, keep waiting
        }
      });

      ws.addEventListener("error", (err) => {
        console.error("[Lighter Index Prices] WS error:", err.type);
        finish();
      });
      ws.addEventListener("close", () => finish());
    });

    const elapsed = Date.now() - startedAt;
    return NextResponse.json(prices, {
      headers: {
        "X-Lighter-Count": String(Object.keys(prices).length),
        "X-Lighter-Elapsed": String(elapsed),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Lighter Index Prices] Failed:", message);
    return NextResponse.json(
      { error: "Failed to fetch Lighter index prices", detail: message },
      { status: 500 },
    );
  }
}