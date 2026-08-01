import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { buildSpotUpstreamRequest, handleSpotRequest } from "./route";

const params = (query: string) => new URLSearchParams(query);

describe("strict spot facade", () => {
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
});
