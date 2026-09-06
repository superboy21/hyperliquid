import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const calls: URL[] = [];
let lastInit: RequestInit | undefined;
let failure: unknown;
let upstreamResponse = Response.json([]);
let pendingResponse: Promise<Response> | undefined;
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL, init?: RequestInit) => {
    lastInit = init;
    if (failure) throw failure;
    calls.push(new URL(url));
    if (pendingResponse) return (await pendingResponse).clone();
    return upstreamResponse.clone();
  },
}));

import { NextRequest } from "next/server";
const { binanceEndpointPath, buildBinanceUrl, GET } = await import("./route");

const request = (query: string) => new NextRequest(`http://localhost/api/binance?${query}`);

describe("Binance fixed endpoint proxy", () => {
  test("has a path builder for every allowed endpoint", () => {
    const endpoints = [
      "premiumIndex", "ticker/24hr", "fundingInfo", "ticker/bookTicker", "fundingRate",
      "openInterest", "depth", "rpiDepth", "premiumIndexKlines",
    ];
    for (const endpoint of endpoints) expect(binanceEndpointPath(endpoint)).toMatch(/^\/fapi\/v1\//);
    expect(binanceEndpointPath("https://evil.example/anything")).toBeNull();
    expect(buildBinanceUrl("ticker/24hr", new URLSearchParams("symbol=BTCUSDT"))?.toString())
      .toBe("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT");
  });

  test("requests every allowed endpoint and only forwards its parameters", async () => {
    calls.length = 0;
    const queries = [
      "endpoint=premiumIndex",
      "endpoint=ticker%2F24hr&symbol=BTCUSDT",
      "endpoint=fundingInfo&symbol=BTCUSDT",
      "endpoint=ticker%2FbookTicker&symbol=BTCUSDT",
      "endpoint=fundingRate&symbol=BTCUSDT&startTime=1000&endTime=2000&limit=1000",
      "endpoint=openInterest&symbol=BTCUSDT",
      "endpoint=depth&symbol=BTCUSDT&limit=100",
      "endpoint=rpiDepth&symbol=BTCUSDT&limit=1000",
      "endpoint=premiumIndexKlines&symbol=BTCUSDT&interval=1m&startTime=1000&endTime=2000&limit=1",
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(200);
    expect(calls).toHaveLength(queries.length);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/fapi/v1/premiumIndex", "/fapi/v1/ticker/24hr", "/fapi/v1/fundingInfo",
      "/fapi/v1/ticker/bookTicker", "/fapi/v1/fundingRate", "/fapi/v1/openInterest",
      "/fapi/v1/depth", "/fapi/v1/rpiDepth", "/fapi/v1/premiumIndexKlines",
    ]);
  });

  test("rejects unknown, repeated, and injected endpoints before upstream I/O", async () => {
    calls.length = 0;
    for (const query of [
      "endpoint=unknown",
      "endpoint=constructor",
      "endpoint=toString",
      "endpoint=__proto__",
      "endpoint=https%3A%2F%2Fevil.example%2F",
      "endpoint=..%2Fsecret",
      "endpoint=depth&symbol=BTCUSDT&foo=1",
      "endpoint=depth&symbol=BTCUSDT&symbol=ETHUSDT",
      "endpoint=depth&symbol=BTC-USDT",
      "endpoint=depth&symbol=BTCUSDT&limit=0",
      "endpoint=premiumIndexKlines&symbol=BTCUSDT&interval=bad",
      "endpoint=fundingRate&startTime=bad",
    ]) expect((await GET(request(query))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test.each([
    ["abort", new DOMException("aborted", "AbortError"), 499, "Request cancelled"],
    ["timeout", new DOMException("timed out", "TimeoutError"), 504, "Upstream request timed out"],
    ["transport", new TypeError("network"), 502, "Failed to fetch upstream"],
  ])("classifies %s failures", async (_name, error, status, message) => {
    failure = error;
    const controller = new AbortController();
    if (status === 499) controller.abort();
    try {
      const response = await GET(new NextRequest("http://localhost/api/binance?endpoint=depth&symbol=BTCUSDT", { signal: controller.signal }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      failure = undefined;
    }
  });

  test("passes caller cancellation to a non-cacheable upstream request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const response = await GET(new NextRequest("http://localhost/api/binance?endpoint=depth&symbol=BTCUSDT", {
      signal: controller.signal,
    }));
    expect(lastInit?.signal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const previous = upstreamResponse;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const response = await GET(request("endpoint=depth&symbol=BTCUSDT"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to fetch upstream" });
    } finally {
      upstreamResponse = previous;
    }
  });

  test("does not cache malformed bulk JSON", async () => {
    const previous = upstreamResponse;
    const before = calls.length;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      await expect(GET(request("endpoint=fundingInfo"))).resolves.toMatchObject({ status: 502 });
      await expect(GET(request("endpoint=fundingInfo"))).resolves.toMatchObject({ status: 502 });
      expect(calls.length - before).toBe(2);
    } finally {
      upstreamResponse = previous;
    }
  });

  test("coalesces concurrent bulk requests and isolates an aborted waiter", async () => {
    let resolvePending!: (response: Response) => void;
    pendingResponse = new Promise((resolve) => { resolvePending = resolve; });
    const cancelled = new AbortController();
    const before = calls.filter((url) => url.pathname.endsWith("/ticker/bookTicker")).length;
    const first = GET(new NextRequest("http://localhost/api/binance?endpoint=ticker%2FbookTicker", {
      signal: cancelled.signal,
    }));
    const second = GET(request("endpoint=ticker%2FbookTicker"));
    await Promise.resolve();
    expect(calls.filter((url) => url.pathname.endsWith("/ticker/bookTicker")).length - before).toBe(1);

    cancelled.abort(new Error("caller cancelled"));
    await expect(first).resolves.toMatchObject({ status: 499 });
    resolvePending(Response.json([{ symbol: "BTCUSDT" }]));
    const response = await second;
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    pendingResponse = undefined;
  });

  test("does not coalesce parameterized or kline requests", async () => {
    const before = calls.length;
    await GET(request("endpoint=premiumIndex&symbol=BTCUSDT"));
    await GET(request("endpoint=premiumIndex&symbol=BTCUSDT"));
    await GET(request("endpoint=premiumIndexKlines&symbol=BTCUSDT&interval=1m"));
    await GET(request("endpoint=premiumIndexKlines&symbol=BTCUSDT&interval=1m"));
    expect(calls.length - before).toBe(4);
  });
});
