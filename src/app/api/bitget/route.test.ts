import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { bitgetActionPath, GET, mappedBitgetStatus } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/bitget?${query}`);

describe("Bitget proxy contract", () => {
  test("maps only the fixed Phase 1 actions", () => {
    expect([
      "instruments", "tickers", "current-fund-rate", "history-fund-rate", "candles", "history-candles", "orderbook",
    ].map((action) => [action, bitgetActionPath(action)])).toEqual([
      ["instruments", "/api/v3/market/instruments"],
      ["tickers", "/api/v3/market/tickers"],
      ["current-fund-rate", "/api/v3/market/current-fund-rate"],
      ["history-fund-rate", "/api/v3/market/history-fund-rate"],
      ["candles", "/api/v3/market/candles"],
      ["history-candles", "/api/v3/market/history-candles"],
      ["orderbook", "/api/v3/market/orderbook"],
    ]);
    expect(bitgetActionPath("https://evil.example/path")).toBeNull();
  });

  test("rejects unknown, repeated, missing, and invalid parameters before upstream I/O", async () => {
    const queries = [
      "action=unknown",
      "action=tickers&category=COIN-FUTURES",
      "action=tickers&symbol=BTCUSDT&symbol=ETHUSDT",
      "action=history-fund-rate",
      "action=history-fund-rate&symbol=btc-usdt",
      "action=history-fund-rate&symbol=BTCUSDT&cursor=0",
      "action=candles&symbol=BTCUSDT&interval=1h",
      "action=history-candles&symbol=BTCUSDT&interval=1H&startTime=200&endTime=100",
      `action=history-candles&symbol=BTCUSDT&interval=1H&startTime=1&endTime=${90 * 86_400_000 + 2}`,
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(400);
  });

  test("maps documented upstream statuses without exposing payloads", () => {
    expect(mappedBitgetStatus(429)).toBe(429);
    expect(mappedBitgetStatus(200, "25004")).toBe(429);
    expect(mappedBitgetStatus(200, "25100")).toBe(404);
    expect(mappedBitgetStatus(200, "25000")).toBe(503);
    expect(mappedBitgetStatus(200, "40017")).toBe(400);
    expect(mappedBitgetStatus(418, "unknown")).toBe(502);
  });
});
