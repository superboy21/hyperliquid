import { describe, expect, mock, test } from "bun:test";

const calls: URL[] = [];
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL) => {
    calls.push(new URL(url));
    return Response.json({ code: "0", data: [] });
  },
}));

import { NextRequest } from "next/server";
import { buildOkxUrl, GET, okxEndpointPath } from "./route";

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
});
