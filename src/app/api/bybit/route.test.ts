import { describe, expect, test, mock } from "bun:test";

const proxyCalls: Array<{ url: URL; init: RequestInit }> = [];
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL, init: RequestInit = {}) => {
    proxyCalls.push({ url, init });
    return Response.json({ retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT" }] } });
  },
}));

import { NextRequest } from "next/server";
import { bybitActionPath, GET, mappedBybitStatus } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/bybit?${query}`);

describe("Bybit proxy contract", () => {
  test("maps only the fixed Phase 1 actions", () => {
    expect([
      "instruments", "tickers", "funding-history", "kline", "orderbook",
    ].map((action) => [action, bybitActionPath(action)])).toEqual([
      ["instruments", "/v5/market/instruments-info"],
      ["tickers", "/v5/market/tickers"],
      ["funding-history", "/v5/market/funding/history"],
      ["kline", "/v5/market/kline"],
      ["orderbook", "/v5/market/orderbook"],
    ]);
    expect(bybitActionPath("https://evil.example/path")).toBeNull();
  });

  test("rejects unknown, repeated, missing, and invalid parameters before upstream I/O", async () => {
    const queries = [
      "action=unknown",
      "action=tickers&category=spot",
      "action=tickers&symbol=BTCUSDT&symbol=ETHUSDT",
      "action=funding-history",
      "action=funding-history&symbol=btc-usdt",
      "action=funding-history&symbol=BTCUSDT&startTime=1000",
      "action=funding-history&symbol=BTCUSDT&endTime=1000",
      "action=funding-history&symbol=BTCUSDT&startTime=200&endTime=100",
      `action=funding-history&symbol=BTCUSDT&startTime=1&endTime=${90 * 86_400_000 + 2}`,
      "action=funding-history&symbol=BTCUSDT&startTime=1000&endTime=2000&limit=201",
      "action=funding-history&symbol=BTCUSDT&startTime=1000&endTime=2000&limit=0",
      "action=funding-history&symbol=BTCUSDT&startTime=not-a-number&endTime=2000",
      "action=kline&symbol=BTCUSDT&interval=1h",
      "action=kline&symbol=BTCUSDT&interval=99&start=100&end=200",
      "action=kline&symbol=BTCUSDT&interval=60&start=200&end=100",
      `action=kline&symbol=BTCUSDT&interval=60&start=1&end=${90 * 86_400_000 + 2}`,
      `action=kline&symbol=BTCUSDT&interval=240&start=1&end=${200 * 86_400_000}`,
      "action=kline&symbol=BTCUSDT&interval=60&start=100&end=200&limit=1001",
      "action=orderbook&symbol=BTCUSDT&limit=0",
      "action=orderbook&symbol=BTCUSDT&limit=1001",
      "action=instruments&cursor=bad cursor!",
      "action=instruments&limit=1001",
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(400);
  });

  test("maps documented upstream statuses without exposing payloads", () => {
    expect(mappedBybitStatus(429)).toBe(429);
    expect(mappedBybitStatus(200, 10004)).toBe(429);
    expect(mappedBybitStatus(200, "10005")).toBe(429);
    expect(mappedBybitStatus(200, 10001)).toBe(400);
    expect(mappedBybitStatus(200, 10002)).toBe(401);
    expect(mappedBybitStatus(200, 10003)).toBe(403);
    expect(mappedBybitStatus(200, 10009)).toBe(404);
    expect(mappedBybitStatus(418, "unknown")).toBe(502);
  });

  test("accepts every kline window the adapter emits and bounds it by the V5 limit", async () => {
    proxyCalls.length = 0;
    // Adapter windows span 999 rows: 1m ~16.7h, 5m ~3.5d, 1h ~41.6d,
    // 4h ~166.5d, 1d ~999d, 1w ~19.2y.
    const accepted = [
      ["1", 12 * 3_600_000],
      ["5", 3 * 86_400_000],
      ["60", 40 * 86_400_000],
      ["240", 150 * 86_400_000],
      ["D", 600 * 86_400_000],
      ["W", 900 * 7 * 86_400_000],
    ] as const;
    for (const [interval, end] of accepted) {
      const response = await GET(request(`action=kline&symbol=BTCUSDT&interval=${interval}&start=1&end=${end}`));
      expect(response.status).toBe(200);
    }
    expect(proxyCalls).toHaveLength(accepted.length);

    const rejected = [
      ["1", 20 * 3_600_000],
      ["240", 167 * 86_400_000],
      ["D", 1000 * 86_400_000],
      ["W", 1000 * 7 * 86_400_000],
    ] as const;
    for (const [interval, end] of rejected) {
      const response = await GET(request(`action=kline&symbol=BTCUSDT&interval=${interval}&start=1&end=${end}`));
      expect(response.status).toBe(400);
    }
  });

  test("accepts funding-history windows up to 90 days and rejects anything wider", async () => {
    proxyCalls.length = 0;
    // The adapter derives interval-aware windows from resolveBybitFundingHistoryWindowMs
    // (4h = 33.3d, 8h = 66.7d, 1d = 90d), so the route must accept those.
    const accepted = [7 * 86_400_000, 33 * 86_400_000, 66 * 86_400_000, 90 * 86_400_000] as const;
    for (const span of accepted) {
      const response = await GET(request(`action=funding-history&symbol=BTCUSDT&startTime=1&endTime=${span}`));
      expect(response.status).toBe(200);
    }
    expect(proxyCalls).toHaveLength(accepted.length);
    expect((await GET(request(`action=funding-history&symbol=BTCUSDT&startTime=1&endTime=${90 * 86_400_000 + 2}`))).status).toBe(400);
  });

  test("passes the full V5 envelope through for the adapter parser and builds the upstream URL", async () => {
    proxyCalls.length = 0;
    const end = 500 * 86_400_000;
    const response = await GET(request(`action=kline&symbol=BTCUSDT&interval=D&start=1&end=${end}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ retCode: 0, retMsg: "OK" });
    expect(body.result).toEqual({ list: [{ symbol: "BTCUSDT" }] });

    expect(proxyCalls).toHaveLength(1);
    const upstream = proxyCalls[0].url;
    expect(upstream.origin).toBe("https://api.bybit.com");
    expect(upstream.pathname).toBe("/v5/market/kline");
    expect(Object.fromEntries(upstream.searchParams)).toMatchObject({
      category: "linear",
      interval: "D",
      symbol: "BTCUSDT",
      start: "1",
      end: String(end),
      limit: "1000",
    });
  });
});
