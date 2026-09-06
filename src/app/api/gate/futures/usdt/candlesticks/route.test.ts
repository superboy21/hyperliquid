import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));
const { GET } = await import("./route");

describe("Gate candlesticks route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("uses URLSearchParams for a valid candle request", async () => {
    proxyFetchMock.mockResolvedValue(Response.json([]));
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/candlesticks?contract=BTC_USDT&interval=1w&limit=2000"));
    expect(response.status).toBe(200);
    const url = new URL(proxyFetchMock.mock.calls[0][0].toString());
    expect(url.searchParams.get("contract")).toBe("BTC_USDT");
    expect(url.searchParams.get("interval")).toBe("1w");
    expect(url.searchParams.get("limit")).toBe("2000");
  });

  test("rejects an invalid interval before upstream I/O", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/candlesticks?contract=BTC_USDT&interval=2h"));
    expect(response.status).toBe(400);
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});
