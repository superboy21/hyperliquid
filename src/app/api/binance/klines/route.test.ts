import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const calls: URL[] = [];
let failure: unknown;
let upstreamResponse = Response.json([]);
let pendingResponse: Promise<Response> | undefined;
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL) => {
    if (failure) throw failure;
    calls.push(new URL(url));
    if (pendingResponse) return (await pendingResponse).clone();
    return upstreamResponse.clone();
  },
}));

import { NextRequest } from "next/server";
const { buildBinanceKlinesUrl, GET } = await import("./route");

const request = (query: string) => new NextRequest(`http://localhost/api/binance/klines?${query}`);

function delayedBodyResponse(status: number, body: string) {
  let release!: () => void;
  let resolvePulled!: () => void;
  let pulled = false;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const bodyReadStarted = new Promise<void>((resolve) => { resolvePulled = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled) return;
      pulled = true;
      resolvePulled();
      return released.then(() => {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      });
    },
  });
  return {
    response: new Response(stream, { status }),
    bodyReadStarted,
    release,
  };
}

describe("Binance klines fixed proxy", () => {
  test("builds the fixed klines URL", () => {
    expect(buildBinanceKlinesUrl(new URLSearchParams("symbol=BTCUSDT&interval=4h&limit=30")).toString())
      .toBe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=30");
  });

  test("validates and requests klines", async () => {
    calls.length = 0;
    const response = await GET(request("symbol=BTCUSDT&interval=1d&limit=30&startTime=1000&endTime=2000"));
    expect(response.status).toBe(200);
    expect(calls[0].pathname).toBe("/fapi/v1/klines");
    expect(calls[0].searchParams.get("startTime")).toBe("1000");
  });

  test("rejects unknown, repeated, and invalid parameters before upstream I/O", async () => {
    calls.length = 0;
    for (const query of [
      "symbol=BTCUSDT&endpoint=klines",
      "symbol=BTCUSDT&symbol=ETHUSDT",
      "symbol=BTC-USDT",
      "symbol=BTCUSDT&interval=nope",
      "symbol=BTCUSDT&limit=0",
      "symbol=BTCUSDT&limit=1501",
      "symbol=BTCUSDT&startTime=200&endTime=100",
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
      const response = await GET(new NextRequest("http://localhost/api/binance/klines?symbol=BTCUSDT", { signal: controller.signal }));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    } finally {
      failure = undefined;
    }
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const previous = upstreamResponse;
    upstreamResponse = new Response("not json", { status: 200 });
    try {
      const response = await GET(request("symbol=BTCUSDT"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Failed to fetch upstream" });
    } finally {
      upstreamResponse = previous;
    }
  });

  test.each([
    ["successful", Response.json([])],
    ["non-OK", new Response("busy", { status: 503 })],
  ])("returns 499 when cancellation wins before the %s response resolves", async (_name, response) => {
    let resolvePending!: (value: Response) => void;
    pendingResponse = new Promise((resolve) => { resolvePending = resolve; });
    const controller = new AbortController();
    try {
      const result = GET(new NextRequest("http://localhost/api/binance/klines?symbol=BTCUSDT", {
        signal: controller.signal,
      }));
      await Promise.resolve();
      controller.abort(new Error("caller cancelled"));
      resolvePending(response);
      expect((await result).status).toBe(499);
    } finally {
      pendingResponse = undefined;
    }
  });

  test("returns 499 when cancellation wins during successful response body read", async () => {
    const delayed = delayedBodyResponse(200, "[]");
    pendingResponse = Promise.resolve(delayed.response);
    const controller = new AbortController();
    try {
      const result = GET(new NextRequest("http://localhost/api/binance/klines?symbol=BTCUSDT", {
        signal: controller.signal,
      }));
      await delayed.bodyReadStarted;
      controller.abort(new Error("caller cancelled"));
      delayed.release();
      expect((await result).status).toBe(499);
    } finally {
      pendingResponse = undefined;
    }
  });

  test("returns 499 when cancellation wins during non-OK response body read", async () => {
    const delayed = delayedBodyResponse(503, "busy");
    pendingResponse = Promise.resolve(delayed.response);
    const controller = new AbortController();
    try {
      const result = GET(new NextRequest("http://localhost/api/binance/klines?symbol=BTCUSDT", {
        signal: controller.signal,
      }));
      await delayed.bodyReadStarted;
      controller.abort(new Error("caller cancelled"));
      delayed.release();
      expect((await result).status).toBe(499);
    } finally {
      pendingResponse = undefined;
    }
  });
});
