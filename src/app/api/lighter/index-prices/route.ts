import { NextResponse } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHTER_WS = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true";
const WS_TIMEOUT_MS = 8_000;
const WS_COLLECT_MS = 2_500;

interface LighterMarketStats {
  symbol?: string;
  index_price?: string;
  market_id?: number;
}

/**
 * Serverless-friendly WebSocket snapshot for Lighter index prices.
 * Opens a short-lived WS connection, subscribes to all market stats,
 * collects pushes for a short window, extracts index prices, then closes.
 */
export async function GET() {
  const prices = await new Promise<Record<string, number>>((resolve) => {
    let settled = false;
    const ws = new WebSocket(LIGHTER_WS);
    const result: Record<string, number> = {};
    let collectTimer: NodeJS.Timeout | null = null;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (collectTimer) clearTimeout(collectTimer);
      try {
        ws.terminate();
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

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: "market_stats/all",
        }),
      );
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
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

    ws.on("error", () => finish());
    ws.on("close", () => finish());
  });

  return NextResponse.json(prices);
}
