import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const calls: URL[] = [];
let lastInit: RequestInit | undefined;
let failure: unknown;
let upstreamResponse = Response.json({ code: "0", data: [] });
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
const { buildOkxUrl, GET, okxEndpointPath } = await import("./route");

const request = (query: string) => new NextRequest(`http://localhost/api/okx?${query}`);

describe("OKX fixed endpoint proxy", () => {
  test("maps all allowed endpoints without accepting a URL", () => {
    const endpoints = [
      "public/funding-rate", "public/funding-rate-history", "public/instruments", "public/open-interest",
      "market/tickers", "market/index-tickers", "market/history-candles", "market/books",
      "market/books-full", "market/books-rpi",
    ];
    for (const endpoint of endpoints) expect(okxEndpointPath(endpoint)).toMatch(/^\//);
    expect(okxEndpointPath("https://evil.example/")).toBeNull();
    expect(buildOkxUrl("market/books", new URLSearchParams("instId=BTC-USDT-SWAP&sz=100"))?.toString())
      .toBe("https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=100");
  });

  test("requests every allowed endpoint", async () => {
    calls.length = 0;
    const queries = [
      "endpoint=public%2Ffunding-rate&instId=ANY",
      "endpoint=public%2Ffunding-rate-history&instId=BTC-USDT-SWAP&after=1000&limit=400",
      "endpoint=public%2Finstruments&instType=SWAP",
      "endpoint=public%2Fopen-interest&instType=SWAP",
      "endpoint=market%2Ftickers&instType=SWAP",
      "endpoint=market%2Findex-tickers&quoteCcy=USDT",
      "endpoint=market%2Fhistory-candles&instId=BTC-USDT-SWAP&bar=1Dutc&limit=300",
      "endpoint=market%2Fbooks&instId=BTC-USDT-SWAP&sz=100",
      "endpoint=market%2Fbooks-full&instId=BTC-USDT-SWAP&sz=5000",
      "endpoint=market%2Fbooks-rpi&instId=BTC-USDT-SWAP&sz=400",
    ];
    for (const query of queries) expect((await GET(request(query))).status).toBe(200);
    expect(calls).toHaveLength(queries.length);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/api/v5/public/funding-rate", "/api/v5/public/funding-rate-history", "/api/v5/public/instruments",
      "/api/v5/public/open-interest", "/api/v5/market/tickers", "/api/v5/market/index-tickers",
      "/api/v5/market/history-candles", "/api/v5/market/books", "/api/v5/market/books-full",
      "/api/v5/market/books-rpi",
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
      "endpoint=market%2Fbooks&instId=BTC-USDT-SWAP&foo=1",
      "endpoint=market%2Fbooks&instId=BTC-USDT-SWAP&sz=1&sz=2",
      "endpoint=market%2Fbooks&instId=BTC%2FUSDT-SWAP",
      "endpoint=market%2Fhistory-candles&instId=BTC-USDT-SWAP&bar=bad",
      "endpoint=market%2Fbooks&instId=BTC-USDT-SWAP&sz=0",
      "endpoint=public%2Fopen-interest&instType=BAD",
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
      const response = await GET(new NextRequest("http://localhost/api/okx?endpoint=public%2Ffunding-rate&instId=BTC-USDT-SWAP", { signal: controller.signal }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      failure = undefined;
    }
  });

  test("passes caller cancellation to a non-cacheable upstream request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const response = await GET(new NextRequest("http://localhost/api/okx?endpoint=public%2Ffunding-rate&instId=BTC-USDT-SWAP", {
      signal: controller.signal,
    }));
    expect(lastInit?.signal?.aborted).toBe(true);
    expect(response.status).toBe(499);
  });

  test("does not cache a business-error instruments response", async () => {
    const previous = upstreamResponse;
    const before = calls.length;
    const query = "endpoint=public%2Finstruments&instType=SWAP&instFamily=SOL-USD";
    try {
      upstreamResponse = Response.json({ code: "51000", msg: "temporarily unavailable", data: [] });
      await expect(GET(request(query))).resolves.toMatchObject({ status: 502 });
      upstreamResponse = Response.json({ code: "0", data: [] });
      await expect(GET(request(query))).resolves.toMatchObject({ status: 200 });
      expect(calls.length - before).toBe(2);
    } finally {
      upstreamResponse = previous;
    }
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const previous = upstreamResponse;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const response = await GET(request("endpoint=public%2Ffunding-rate&instId=BTC-USDT-SWAP"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to fetch upstream" });
    } finally {
      upstreamResponse = previous;
    }
  });

  test("does not cache malformed TTL responses", async () => {
    const previous = upstreamResponse;
    const before = calls.length;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const query = "endpoint=public%2Finstruments&instType=SWAP&instFamily=ETH-USD";
      await expect(GET(request(query))).resolves.toMatchObject({ status: 502 });
      await expect(GET(request(query))).resolves.toMatchObject({ status: 502 });
      expect(calls.length - before).toBe(2);
    } finally {
      upstreamResponse = previous;
    }
  });

  test("serves a fresh response from the instruments TTL cache", async () => {
    const query = "endpoint=public%2Finstruments&instType=SWAP&instFamily=BTC-USD";
    const before = calls.length;
    const first = await GET(request(query));
    const second = await GET(request(query));
    expect(first).not.toBe(second);
    expect(second.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.length - before).toBe(1);
  });

  test("coalesces bulk requests while aborting only one waiter", async () => {
    let resolvePending!: (response: Response) => void;
    pendingResponse = new Promise((resolve) => { resolvePending = resolve; });
    const cancelled = new AbortController();
    const query = "endpoint=market%2Ftickers&instType=FUTURES&uly=ETH-USD";
    const before = calls.filter((url) => url.pathname.endsWith("/market/tickers")).length;
    const first = GET(new NextRequest(`http://localhost/api/okx?${query}`, { signal: cancelled.signal }));
    const second = GET(request(query));
    await Promise.resolve();
    expect(calls.filter((url) => url.pathname.endsWith("/market/tickers")).length - before).toBe(1);
    cancelled.abort(new Error("caller cancelled"));
    await expect(first).resolves.toMatchObject({ status: 499 });
    resolvePending(Response.json({ code: "0", data: [{ instId: "ETH-USD-SWAP" }] }));
    await expect(second).resolves.toMatchObject({ status: 200 });
    pendingResponse = undefined;
  });

  test("does not cache single-instrument or candle requests", async () => {
    const before = calls.length;
    for (const query of [
      "endpoint=public%2Finstruments&instType=SWAP&instId=BTC-USDT-SWAP",
      "endpoint=public%2Fopen-interest&instType=SWAP&instId=BTC-USDT-SWAP",
      "endpoint=market%2Findex-tickers&instId=BTC-USDT",
      "endpoint=market%2Fhistory-candles&instId=BTC-USDT-SWAP&bar=1m",
    ]) {
      await GET(request(query));
      await GET(request(query));
    }
    expect(calls.length - before).toBe(8);
  });
});
