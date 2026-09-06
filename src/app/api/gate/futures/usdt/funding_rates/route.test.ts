import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));
const { POST } = await import("./route");

const request = (body: unknown, query = "") => new NextRequest(`http://localhost/api/gate/futures/usdt/funding_rates${query}`, {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

describe("Gate batch funding rates route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("deduplicates valid contracts and limits upstream fan-out", async () => {
    proxyFetchMock.mockImplementation(async () => Response.json([{ r: "0.01" }]));
    const response = await POST(request({ contracts: ["BTC_USDT", "BTC_USDT", "ETH_USDT"] }));
    expect(response.status).toBe(200);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects an oversized or malformed batch before upstream I/O", async () => {
    for (const body of [
      { contracts: Array.from({ length: 51 }, (_, index) => `C${index}_USDT`) },
      { contracts: ["BTC-USDT"] },
      { contracts: ["BTC_USDT"], extra: true },
    ]) {
      proxyFetchMock.mockClear();
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(proxyFetchMock).not.toHaveBeenCalled();
    }
  });

  test("rejects unknown query parameters before reading upstream", async () => {
    const response = await POST(request({ contracts: ["BTC_USDT"] }, "?limit=1"));
    expect(response.status).toBe(400);
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });
});
