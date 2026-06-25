import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHTER_WS = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true";
const WS_TIMEOUT_MS = 5_000;
const WS_COLLECT_MS = 1_500;

interface LighterMarketStats {
  symbol?: string;
  index_price?: string;
  market_id?: number;
}

/**
 * Serverless-friendly WebSocket snapshot for Lighter index prices.
 * Uses Node.js native WebSocket (no external ws dependency).
 */
export async function GET() {
  try {
    const prices = await new Promise<Record<string, number>>((resolve) => {
      let settled = false;
      const ws = new globalThis.WebSocket(LIGHTER_WS);
      const result: Record<string, number> = {};
      let collectTimer: ReturnType<typeof setTimeout> | null = null;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (collectTimer) clearTimeout(collectTimer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(result);
      }, WS_TIMEOUT_MS);

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (collectTimer) clearTimeout(collectTimer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(result);
      }

      ws.addEventListener("open", () => {
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

    return NextResponse.json(prices);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Lighter Index Prices] Failed:", message);
    return NextResponse.json(
      { error: "Failed to fetch Lighter index prices", detail: message },
      { status: 500 },
    );
  }
}
