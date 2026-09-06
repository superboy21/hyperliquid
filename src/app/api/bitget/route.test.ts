import { describe, expect, mock, spyOn, test } from "bun:test";

mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init),
}));

import { NextRequest } from "next/server";
import { bitgetActionPath, GET, mappedBitgetStatus } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/bitget?${query}`);

describe("Bitget proxy contract", () => {
  test("maps only the fixed Phase 1 actions", () => {
    expect([
      "instruments", "tickers", "current-fund-rate", "history-fund-rate", "candles", "history-candles", "orderbook", "rpi-orderbook",
    ].map((action) => [action, bitgetActionPath(action)])).toEqual([
      ["instruments", "/api/v3/market/instruments"],
      ["tickers", "/api/v3/market/tickers"],
      ["current-fund-rate", "/api/v3/market/current-fund-rate"],
      ["history-fund-rate", "/api/v3/market/history-fund-rate"],
      ["candles", "/api/v3/market/candles"],
      ["history-candles", "/api/v3/market/history-candles"],
      ["orderbook", "/api/v3/market/orderbook"],
      ["rpi-orderbook", "/api/v3/market/rpi-orderbook"],
    ]);
    expect(bitgetActionPath("https://evil.example/path")).toBeNull();
    expect(bitgetActionPath("constructor")).toBeNull();
    expect(bitgetActionPath("toString")).toBeNull();
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
      "action=constructor",
      "action=toString",
      "action=rpi-orderbook&symbol=BTCUSDT&limit=201",
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(400);
  });

  test("accepts rpi-orderbook limit 200 while keeping ordinary orderbook at 1000", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ code: "00000", msg: "success", data: [] }));
    try {
      expect((await GET(request("action=rpi-orderbook&symbol=BTCUSDT&limit=200"))).status).toBe(200);
      expect((await GET(request("action=orderbook&symbol=BTCUSDT&limit=1000"))).status).toBe(200);
      expect((await GET(request("action=rpi-orderbook&symbol=BTCUSDT&limit=201"))).status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("maps documented upstream statuses without exposing payloads", () => {
    expect(mappedBitgetStatus(429)).toBe(429);
    expect(mappedBitgetStatus(200, "25004")).toBe(429);
    expect(mappedBitgetStatus(200, "25100")).toBe(404);
    expect(mappedBitgetStatus(200, "25000")).toBe(503);
    expect(mappedBitgetStatus(200, "40017")).toBe(400);
    expect(mappedBitgetStatus(418, "unknown")).toBe(502);
  });

  test.each(["1Dutc", "1Wutc"])("allows official UTC candle interval %s", async (interval) => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "00000", msg: "success", data: [] }));
    try {
      const response = await GET(request(`action=candles&symbol=BTCUSDT&interval=${interval}`));
      expect(response.status).toBe(200);
      expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("interval")).toBe(interval);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("returns the complete Bitget envelope", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: "00000", msg: "success", data: [{ asks: [] }] }));
    try {
      const response = await GET(request("action=rpi-orderbook&symbol=BTCUSDT"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: "00000", msg: "success", data: [{ asks: [] }] });
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/v3/market/rpi-orderbook");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
