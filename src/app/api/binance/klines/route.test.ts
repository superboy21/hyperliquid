import { describe, expect, mock, test } from "bun:test";

const calls: URL[] = [];
mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: async (url: URL) => {
    calls.push(new URL(url));
    return Response.json([]);
  },
}));

import { NextRequest } from "next/server";
import { buildBinanceKlinesUrl, GET } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/binance/klines?${query}`);

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
});
