import { beforeEach, describe, expect, test, mock, spyOn } from "bun:test";

mock.module("server-only", () => ({}));

const proxyCalls: Array<{ url: URL; init: RequestInit }> = [];
let proxyFailure: unknown;
let proxyWait: Promise<void> | undefined;
let proxyResponse = Response.json({ retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT" }] } });
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL, init: RequestInit = {}) => {
    if (proxyWait) await proxyWait;
    if (proxyFailure) throw proxyFailure;
    proxyCalls.push({ url, init });
    return proxyResponse.clone();
  },
}));

import { NextRequest } from "next/server";
const { bybitActionPath, GET, mappedBybitStatus, clearBybitCaches } = await import("./route");

const request = (query: string) => new NextRequest(`http://localhost/api/bybit?${query}`);

describe("Bybit proxy contract", () => {
  beforeEach(() => {
    clearBybitCaches();
    proxyWait = undefined;
  });

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

  test.each([
    ["abort", new DOMException("aborted", "AbortError"), 499, "Request cancelled"],
    ["timeout", new DOMException("timed out", "TimeoutError"), 504, "Upstream request timed out"],
    ["transport", new TypeError("network"), 502, "Failed to fetch upstream"],
  ])("classifies %s failures", async (_name, error, status, message) => {
    proxyFailure = error;
    const controller = new AbortController();
    if (status === 499) controller.abort();
    try {
      const response = await GET(new NextRequest("http://localhost/api/bybit?action=tickers", { signal: controller.signal }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      proxyFailure = undefined;
    }
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const previous = proxyResponse;
    proxyResponse = new Response("not json", { status: 200 });
    try {
      const response = await GET(request("action=tickers"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to fetch upstream" });
    } finally {
      proxyResponse = previous;
    }
  });

  test("coalesces identical instruments loads, then reuses and expires the five-minute TTL", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      proxyCalls.length = 0;
      const [first, second] = await Promise.all([
        GET(request("action=instruments")),
        GET(request("action=instruments&limit=1000")),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(proxyCalls).toHaveLength(1);
      expect(proxyCalls[0].init.signal).toBeUndefined();
      await GET(request("action=instruments"));
      expect(proxyCalls).toHaveLength(1);
      clock.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      await GET(request("action=instruments"));
      expect(proxyCalls).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });

  test("an aborted cache waiter gets 499 without cancelling the shared loader", async () => {
    proxyCalls.length = 0;
    let release!: () => void;
    proxyWait = new Promise<void>((resolve) => { release = resolve; });
    const first = GET(request("action=tickers"));
    await Promise.resolve();
    const controller = new AbortController();
    const second = GET(new NextRequest("http://localhost/api/bybit?action=tickers", { signal: controller.signal }));
    controller.abort();
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(499);
    expect(proxyCalls).toHaveLength(1);
    expect(proxyCalls[0].init.signal).toBeUndefined();
  });
});
