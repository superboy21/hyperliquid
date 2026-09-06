import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));
const { GET } = await import("./route");

describe("Gate funding rate route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("validates and encodes the actual query parameters", async () => {
    proxyFetchMock.mockResolvedValue(Response.json([{ r: "0.01" }]));
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/funding_rate?contract=BTC_USDT&limit=10&from=100&to=200"));
    expect(response.status).toBe(200);
    const url = new URL(proxyFetchMock.mock.calls[0][0].toString());
    expect(Object.fromEntries(url.searchParams)).toEqual({ contract: "BTC_USDT", limit: "10", from: "100", to: "200" });
  });

  test("allows a live paginator to start at from=0", async () => {
    proxyFetchMock.mockResolvedValue(Response.json([{ r: "0.01" }]));
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/funding_rate?contract=BTC_USDT&from=0&to=1"));
    expect(response.status).toBe(200);
    const url = new URL(proxyFetchMock.mock.calls[0][0].toString());
    expect(url.searchParams.get("from")).toBe("0");
  });

  test("rejects invalid, duplicate, and unknown parameters before I/O", async () => {
    for (const query of [
      "contract=BTC-USDT",
      "contract=BTC_USDT&limit=0",
      "contract=BTC_USDT&from=2&to=1",
      "contract=BTC_USDT&from=-1&to=1",
      "contract=BTC_USDT&from=1.5&to=2",
      "contract=BTC_USDT&from=1&to=0",
      "contract=BTC_USDT&from=1&to=-1",
      "contract=BTC_USDT&from=1&to=2.5",
      "contract=BTC_USDT&foo=1",
      "contract=BTC_USDT&limit=1&limit=2",
    ]) {
      proxyFetchMock.mockClear();
      const response = await GET(new NextRequest(`http://localhost/api/gate/futures/usdt/funding_rate?${query}`));
      expect(response.status).toBe(400);
      expect(proxyFetchMock).not.toHaveBeenCalled();
    }
  });
});
