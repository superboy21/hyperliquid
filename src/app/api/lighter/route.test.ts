import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const calls: URL[] = [];
let lastInit: RequestInit | undefined;
let failure: unknown;
let upstreamResponse = Response.json({});
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
const { buildLighterUrl, clearLighterCaches, GET, lighterEndpointPath } = await import("./route");

const request = (query: string) => new NextRequest(`http://localhost/api/lighter?${query}`);

describe("Lighter fixed endpoint proxy", () => {
  test("maps every allowed endpoint without accepting a URL", () => {
    const endpoints = ["orderBooks", "funding-rates", "fundings", "candles", "orderBookDetails", "exchangeStats", "orderBookOrders"];
    for (const endpoint of endpoints) expect(lighterEndpointPath(endpoint)).toMatch(/^\/api\/v1\//);
    expect(lighterEndpointPath("https://evil.example/")).toBeNull();
    expect(buildLighterUrl("orderBookOrders", new URLSearchParams("market_id=1&limit=100"))?.toString())
      .toBe("https://mainnet.zklighter.elliot.ai/api/v1/orderBookOrders?market_id=1&limit=100");
  });

  test("requests every allowed endpoint", async () => {
    calls.length = 0;
    const queries = [
      "endpoint=orderBooks",
      "endpoint=funding-rates",
      "endpoint=fundings&market_id=1&resolution=1h&start_timestamp=1000&end_timestamp=2000&count_back=720",
      "endpoint=candles&market_id=1&resolution=1d&start_timestamp=1000&end_timestamp=2000&count_back=500",
      "endpoint=orderBookDetails&filter=perp",
      "endpoint=exchangeStats",
      "endpoint=orderBookOrders&market_id=1&limit=250",
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(200);
    expect(calls).toHaveLength(queries.length);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v1/orderBooks", "/api/v1/funding-rates", "/api/v1/fundings", "/api/v1/candles",
      "/api/v1/orderBookDetails", "/api/v1/exchangeStats", "/api/v1/orderBookOrders",
    ]);
  });

  test("rejects unknown, repeated, and invalid parameters before upstream I/O", async () => {
    calls.length = 0;
    for (const query of [
      "endpoint=unknown",
      "endpoint=constructor",
      "endpoint=toString",
      "endpoint=__proto__",
      "endpoint=https%3A%2F%2Fevil.example%2F",
      "endpoint=..%2Fsecret",
      "endpoint=orderBooks&market_id=1",
      "endpoint=orderBookOrders&market_id=1&market_id=2",
      "endpoint=orderBookOrders&market_id=0",
      "endpoint=candles&market_id=1&resolution=bad",
      "endpoint=candles&market_id=1&resolution=1h&start_timestamp=bad",
      "endpoint=candles&market_id=1&resolution=1h&start_timestamp=200&end_timestamp=100",
      "endpoint=candles&market_id=1&resolution=1h&count_back=1001",
      "endpoint=orderBookOrders&market_id=1&limit=251",
      "endpoint=orderBookDetails&filter=bad",
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
      const response = await GET(new NextRequest("http://localhost/api/lighter?endpoint=orderBookOrders&market_id=1", { signal: controller.signal }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      failure = undefined;
    }
  });

  test("passes caller cancellation to a non-cacheable upstream request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const response = await GET(new NextRequest("http://localhost/api/lighter?endpoint=orderBookOrders&market_id=1", {
      signal: controller.signal,
    }));
    expect(lastInit?.signal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  test("does not cache a business-error orderBooks response", async () => {
    clearLighterCaches();
    const previous = upstreamResponse;
    const before = calls.length;
    try {
      upstreamResponse = Response.json({ error: "temporarily unavailable" });
      await expect(GET(request("endpoint=orderBooks"))).resolves.toMatchObject({ status: 502 });
      upstreamResponse = Response.json({});
      await expect(GET(request("endpoint=orderBooks"))).resolves.toMatchObject({ status: 200 });
      expect(calls.length - before).toBe(2);
    } finally {
      upstreamResponse = previous;
      clearLighterCaches();
    }
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const previous = upstreamResponse;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const response = await GET(request("endpoint=orderBookOrders&market_id=1"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to fetch upstream" });
    } finally {
      upstreamResponse = previous;
    }
  });

  test("does not cache malformed coalesced responses", async () => {
    const previous = upstreamResponse;
    const before = calls.length;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const query = "endpoint=orderBookDetails&filter=spot";
      await expect(GET(request(query))).resolves.toMatchObject({ status: 502 });
      await expect(GET(request(query))).resolves.toMatchObject({ status: 502 });
      expect(calls.length - before).toBe(2);
    } finally {
      upstreamResponse = previous;
    }
  });

  test("reuses the orderBooks TTL cache and returns fresh responses", async () => {
    clearLighterCaches();
    const before = calls.length;
    const first = await GET(request("endpoint=orderBooks"));
    const second = await GET(request("endpoint=orderBooks"));
    expect(first).not.toBe(second);
    expect(second.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.length - before).toBe(1);
  });

  test("coalesces orderBookDetails without coalescing history and candle requests", async () => {
    let resolvePending!: (response: Response) => void;
    pendingResponse = new Promise((resolve) => { resolvePending = resolve; });
    const query = "endpoint=orderBookDetails&filter=spot";
    const beforeDetails = calls.filter((url) => url.pathname.endsWith("/orderBookDetails")).length;
    const first = GET(request(query));
    const second = GET(request(query));
    await Promise.resolve();
    expect(calls.filter((url) => url.pathname.endsWith("/orderBookDetails")).length - beforeDetails).toBe(1);
    resolvePending(Response.json({ order_book_id: 2 }));
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });
    pendingResponse = undefined;

    const before = calls.length;
    for (const query of [
      "endpoint=orderBookOrders&market_id=2",
      "endpoint=fundings&market_id=2&resolution=1h",
      "endpoint=candles&market_id=2&resolution=1h",
    ]) {
      await GET(request(query));
      await GET(request(query));
    }
    expect(calls.length - before).toBe(6);
  });
});
