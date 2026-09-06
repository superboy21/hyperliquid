import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));
const { GET } = await import("./route");

describe("Gate premium index route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("accepts a supported interval and returns upstream data", async () => {
    proxyFetchMock.mockResolvedValue(Response.json([{ c: "1" }]));
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/premium_index?contract=ETH_USDT&interval=1h"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ c: "1" }]);
  });

  test("rejects an unsupported interval before upstream I/O", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/premium_index?contract=ETH_USDT&interval=2h"));
    expect(response.status).toBe(400);
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});
