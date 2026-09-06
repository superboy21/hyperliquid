import { describe, expect, mock, test } from "bun:test";

const calls: URL[] = [];
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL) => {
    calls.push(new URL(url));
    return Response.json({});
  },
}));

import { NextRequest } from "next/server";
import { buildLighterUrl, GET, lighterEndpointPath } from "./route";

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
});
