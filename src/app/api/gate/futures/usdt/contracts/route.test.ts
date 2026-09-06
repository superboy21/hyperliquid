import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const proxyFetchMock = mock<(url: string | URL, init?: RequestInit & { timeout?: number }) => Promise<Response>>();
mock.module("@/lib/utils/proxy", () => ({ proxyFetch: proxyFetchMock }));

const { GET } = await import("./route");

describe("Gate contracts route", () => {
  beforeEach(() => proxyFetchMock.mockReset());

  test("uses proxyFetch and falls back to the next Gate host", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json([{ name: "BTC_USDT" }]));

    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts"));

    expect(response.status).toBe(200);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
    expect(proxyFetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "https://api.gateio.ws/api/v4/futures/usdt/contracts",
      "https://api.gate.io/api/v4/futures/usdt/contracts",
    ]);
  });

  test("rejects query parameters before upstream I/O", async () => {
    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts?foo=1&foo=2"));
    expect(response.status).toBe(400);
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  test("stops host fallback when the caller aborts", async () => {
    const controller = new AbortController();
    proxyFetchMock.mockImplementation(async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return Response.json([]);
    });

    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts", { signal: controller.signal }));
    expect(response.status).toBe(499);
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not retry rate limits or ordinary client errors", async () => {
    for (const status of [429, 404]) {
      proxyFetchMock.mockReset();
      proxyFetchMock.mockResolvedValue(Response.json({ error: "no" }, {
        status,
        headers: { "Retry-After": "9999" },
      }));

      const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts"));

      expect(response.status).toBe(status);
      expect(proxyFetchMock).toHaveBeenCalledTimes(1);
      expect(response.headers.get("Retry-After")).toBe(status === 429 ? "60" : "60");
    }
  });

  test("fails over malformed successful responses", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(Response.json({ contracts: "not-an-array" }))
      .mockResolvedValueOnce(Response.json([{ name: "BTC_USDT" }]));

    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts"));

    expect(response.status).toBe(200);
    expect(proxyFetchMock).toHaveBeenCalledTimes(2);
  });

  test("classifies an exhausted own timeout as 504", async () => {
    proxyFetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

    const response = await GET(new NextRequest("http://localhost/api/gate/futures/usdt/contracts"));

    expect(response.status).toBe(504);
    expect(proxyFetchMock).toHaveBeenCalledTimes(3);
  });
});
