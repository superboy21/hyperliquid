import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("server-only", () => ({}));

const { buildSpotUpstreamRequest, handleSpotRequest, clearSpotCaches } = await import("./route");

const params = (query: string) => new URLSearchParams(query);

describe("strict spot facade", () => {
  beforeEach(() => clearSpotCaches());

  test("uses fixed hosts and clamps depth to exchange limits", () => {
    const request = buildSpotUpstreamRequest("binance", params("action=book&symbol=BTCUSDT&limit=999999"));
    expect(typeof request).not.toBe("string");
    if (typeof request !== "string") expect(request.url).toBe("https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=5000");
    const hyperliquid = buildSpotUpstreamRequest("hyperliquid", params("action=list"));
    if (typeof hyperliquid !== "string") expect(hyperliquid.init.body).toBe(JSON.stringify({ type: "spotMetaAndAssetCtxs" }));
  });

  test("rejects unknown exchanges, actions, parameters and repetitions before fetch", async () => {
    expect(buildSpotUpstreamRequest("evil", params("action=list"))).toBe("Unknown exchange");
    expect(buildSpotUpstreamRequest("binance", params("action=nope"))).toBe("Unknown or missing action");
    expect(buildSpotUpstreamRequest("binance", params("action=list&endpoint=https://evil.test"))).toBe("Unknown or repeated parameter");
    let calls = 0;
    const request = new NextRequest("http://localhost/api/spot/binance?action=book&symbol=BTCUSDT&symbol=ETHUSDT");
    const response = await handleSpotRequest(request, "binance", async () => { calls += 1; return Response.json({}); });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  test("strictly limits the instrument action to Bitget Spot", () => {
    const bitget = buildSpotUpstreamRequest("bitget", params("action=instrument&symbol=BTCUSDT"));
    expect(typeof bitget).not.toBe("string");
    if (typeof bitget !== "string") expect(bitget.url).toBe("https://api.bitget.com/api/v3/market/instruments?category=SPOT&symbol=BTCUSDT");
    expect(buildSpotUpstreamRequest("okx", params("action=instrument&symbol=BTC-USDT"))).toBe("Unknown or missing action");
    expect(buildSpotUpstreamRequest("bitget", params("action=instrument&symbol=BTCUSDT&marketId=1"))).toBe("Unknown or repeated parameter");
  });

  test("passes through successful JSON but does not expose upstream error payloads", async () => {
    const request = new NextRequest("http://localhost/api/spot/gateio?action=list");
    const success = await handleSpotRequest(request, "gateio", async () => Response.json([{ currency_pair: "BTC_USDT" }]));
    expect(await success.json()).toEqual([{ currency_pair: "BTC_USDT" }]);
    const failed = await handleSpotRequest(request, "gateio", async () => Response.json({ secret: "do not leak" }, { status: 429 }));
    expect(failed.status).toBe(429);
    expect(await failed.json()).toEqual({ error: "Upstream request failed", status: 429 });
  });

  test("maps a non-JSON upstream error before parsing while rejecting non-JSON success", async () => {
    const request = new NextRequest("http://localhost/api/spot/hyperliquid?action=list");
    const unsupported = await handleSpotRequest(request, "hyperliquid", async () => new Response(
      "Expected request with Content-Type application/json",
      { status: 415, headers: { "Content-Type": "text/plain" } },
    ));
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({ error: "Upstream request failed", status: 415 });

    const invalidSuccess = await handleSpotRequest(request, "hyperliquid", async () => new Response(
      "not json",
      { status: 200, headers: { "Content-Type": "text/plain" } },
    ));
    expect(invalidSuccess.status).toBe(502);
    expect(await invalidSuccess.json()).toEqual({ error: "Invalid upstream response" });
  });

  test.each([
    ["abort", new DOMException("aborted", "AbortError"), 499, "Request cancelled"],
    ["timeout", new DOMException("timed out", "TimeoutError"), 504, "Upstream request timed out"],
    ["transport", new TypeError("network"), 502, "Failed to fetch upstream"],
  ])("classifies %s failures", async (_name, error, status, message) => {
    const controller = new AbortController();
    if (status === 499) controller.abort();
    const request = new NextRequest("http://localhost/api/spot/binance?action=list", { signal: controller.signal });
    const response = await handleSpotRequest(request, "binance", async () => { throw error; });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  test("classifies malformed successful JSON as upstream failure", async () => {
    const request = new NextRequest("http://localhost/api/spot/binance?action=list");
    const response = await handleSpotRequest(request, "binance", async () => new Response("not json", { status: 200 }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid upstream response" });
  });

  test("coalesces non-Gate list requests without passing a caller signal", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      expect(init?.signal).toBeUndefined();
      await gate;
      return Response.json([{ symbol: "BTCUSDT" }]);
    };
    const first = handleSpotRequest(new NextRequest("http://localhost/api/spot/binance?action=list"), "binance", fetcher);
    await Promise.resolve();
    const controller = new AbortController();
    const second = handleSpotRequest(new NextRequest("http://localhost/api/spot/binance?action=list", { signal: controller.signal }), "binance", fetcher);
    controller.abort();
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(499);
    expect(calls).toBe(1);
  });

  test("caches Bitget Spot bulk instruments for five minutes but not malformed JSON", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(4_000_000);
    let calls = 0;
    let malformed = true;
    const fetcher = async () => {
      calls += 1;
      return malformed ? new Response("not json", { status: 200 }) : Response.json({ code: "00000", msg: "success", data: [] });
    };
    try {
      expect((await handleSpotRequest(new NextRequest("http://localhost/api/spot/bitget?action=instruments"), "bitget", fetcher)).status).toBe(502);
      malformed = false;
      expect((await handleSpotRequest(new NextRequest("http://localhost/api/spot/bitget?action=instruments"), "bitget", fetcher)).status).toBe(200);
      expect((await handleSpotRequest(new NextRequest("http://localhost/api/spot/bitget?action=instruments"), "bitget", fetcher)).status).toBe(200);
      expect(calls).toBe(2);
      clock.mockReturnValue(4_000_000 + 5 * 60 * 1000);
      await handleSpotRequest(new NextRequest("http://localhost/api/spot/bitget?action=instruments"), "bitget", fetcher);
      expect(calls).toBe(3);
    } finally {
      clock.mockRestore();
    }
  });

  test("returns 499 when cancellation wins before a coalesced success resolves", async () => {
    let resolvePending!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolvePending = resolve; });
    const controller = new AbortController();
    const request = new NextRequest("http://localhost/api/spot/binance?action=list", { signal: controller.signal });
    const result = handleSpotRequest(request, "binance", async () => pending);
    await Promise.resolve();
    controller.abort(new Error("caller cancelled"));
    resolvePending(Response.json([]));
    expect((await result).status).toBe(499);
  });

  test("returns 499 when cancellation wins before a coalesced non-OK response resolves", async () => {
    let resolvePending!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolvePending = resolve; });
    const controller = new AbortController();
    const request = new NextRequest("http://localhost/api/spot/binance?action=list", { signal: controller.signal });
    const result = handleSpotRequest(request, "binance", async () => pending);
    await Promise.resolve();
    controller.abort(new Error("caller cancelled"));
    resolvePending(new Response("busy", { status: 503 }));
    expect((await result).status).toBe(499);
  });

  test("returns 499 when cancellation wins before a coalesced business-error response resolves", async () => {
    let resolvePending!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolvePending = resolve; });
    const controller = new AbortController();
    const request = new NextRequest("http://localhost/api/spot/binance?action=list", { signal: controller.signal });
    const result = handleSpotRequest(request, "binance", async () => pending);
    await Promise.resolve();
    controller.abort(new Error("caller cancelled"));
    resolvePending(Response.json({ code: "1", msg: "business failure", data: null }));
    expect((await result).status).toBe(499);
  });
});
