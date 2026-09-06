import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();

mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: proxyFetchMock,
}));

const { GET } = await import("./route");

const request = () => new NextRequest("http://localhost/api/gate/futures/usdt/tickers");

describe("Gate futures ticker route", () => {
  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  test("fetches both resources through proxyFetch and merges contract metadata", async () => {
    proxyFetchMock.mockImplementation(async (url) => {
      if (url.toString().endsWith("/tickers")) {
        return Response.json([
          { contract: "BTC_USDT", last: "65000" },
          { contract: "XAUT_USDT", last: "2400" },
        ]);
      }

      return Response.json([
        { name: "BTC_USDT", funding_interval: 14_400 },
        { name: "XAUT_USDT", funding_interval: 28_800 },
      ]);
    });

    const response = await GET(request());

    expect(response.ok).toBe(true);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyFetchMock.mock.calls.map(([url]) => url.toString()).sort()).toEqual([
      "https://api.gateio.ws/api/v4/futures/usdt/contracts",
      "https://api.gateio.ws/api/v4/futures/usdt/tickers",
    ]);
    for (const [, init] of proxyFetchMock.mock.calls) {
      expect(init).toMatchObject({ method: "GET", cache: "no-store", timeout: 10_000 });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(await response.json()).toEqual([
      {
        contract: "BTC_USDT",
        last: "65000",
        funding_interval: 14_400,
        asset_category: "Crypto",
      },
      {
        contract: "XAUT_USDT",
        last: "2400",
        funding_interval: 28_800,
        asset_category: "商品",
      },
    ]);
  });

  test("returns a non-OK response when the ticker upstream fails", async () => {
    proxyFetchMock.mockImplementation(async (url) => (
      url.toString().endsWith("/tickers")
        ? Response.json({ error: "upstream details" }, { status: 503 })
        : Response.json([])
    ));

    const response = await GET(request());

    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Tickers API failed: 503" });
  });

  test("allows the impact-price contract filter and rejects duplicate or unknown queries", async () => {
    proxyFetchMock.mockImplementation(async (url) => (
      new URL(url.toString()).pathname.endsWith("/tickers")
        ? Response.json([{ contract: "BTC_USDT" }])
        : Response.json([])
    ));
    const compatible = await GET(requestWithUrl("http://localhost/api/gate/futures/usdt/tickers?contract=BTC_USDT"));
    expect(compatible.status).toBe(200);
    expect(new URL(proxyFetchMock.mock.calls[0][0].toString()).searchParams.get("contract")).toBe("BTC_USDT");

    proxyFetchMock.mockClear();
    const invalid = await GET(requestWithUrl("http://localhost/api/gate/futures/usdt/tickers?contract=BTC_USDT&contract=ETH_USDT"));
    expect(invalid.status).toBe(400);
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});

const requestWithUrl = (url: string) => new NextRequest(url);
