import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));
const { GET } = await import("./route");

describe("Gate order book route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("preserves book and rpi behavior with validated values", async () => {
    proxyFetchMock.mockResolvedValue(Response.json({ bids: [], asks: [] }));
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/order_book?contract=BTC_USDT&limit=50&book=1&rpi=1"));
    expect(response.status).toBe(200);
    const url = new URL(proxyFetchMock.mock.calls[0][0].toString());
    expect(url.pathname).toEndWith("/futures/usdt/rpi_order_book");
    expect(url.searchParams.get("with_book")).toBe("true");
  });

  test("rejects invalid book flags before upstream I/O", async () => {
    for (const query of ["contract=BTC_USDT&book=true", "contract=BTC_USDT&rpi=2", "contract=BTC_USDT&interval=1m"]) {
      proxyFetchMock.mockClear();
      const response = await GET(new NextRequest(`http://localhost/api/gate/futures/usdt/order_book?${query}`));
      expect(response.status).toBe(400);
      expect(proxyFetchMock).not.toHaveBeenCalled();
    }
  });
});
