import { describe, expect, mock, test } from "bun:test";

const calls: URL[] = [];
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL) => {
    calls.push(new URL(url));
    return Response.json([]);
  },
}));

import { NextRequest } from "next/server";
import { binanceEndpointPath, buildBinanceUrl, GET } from "./route";

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
});
