import { describe, expect, mock, spyOn, test } from "bun:test";

mock.module("@/lib/utils/proxy", () => ({
  proxyFetch: (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const request = (body: string) => new NextRequest("http://localhost/api/hyperliquid", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

describe("Hyperliquid Perp proxy contract", () => {
  test("forwards each supported body and preserves bare upstream JSON", async () => {
    const upstream = [{ coin: "BTC", fundingRate: "0.001" }];
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(upstream));
    try {
      const bodies = [
        { type: "metaAndAssetCtxs" },
        { type: "metaAndAssetCtxs", dex: "xyz" },
        { type: "metaAndAssetCtxs", dex: "para" },
        { type: "metaAndAssetCtxs", dex: "hyna" },
        { type: "fundingHistory", coin: "BTC", startTime: 1000, endTime: 2000 },
        { type: "candleSnapshot", req: { coin: "BTC", interval: "1h", startTime: 1000, endTime: 2000 } },
        { type: "l2Book", coin: "BTC" },
        { type: "meta" },
      ];
      for (const body of bodies) {
        const response = await POST(request(JSON.stringify(body)));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(upstream);
        expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual(body);
      }
      expect(fetchMock).toHaveBeenCalledTimes(bodies.length);
      expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.hyperliquid.xyz/info");
      expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("rejects invalid requests before upstream I/O", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]));
    try {
      const bodies = [
        "not json",
        JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
        JSON.stringify({ type: "meta", extra: true }),
        JSON.stringify({ type: "l2Book", coin: "https://evil.example" }),
        JSON.stringify({ type: "metaAndAssetCtxs", dex: "bad/dex" }),
        JSON.stringify({ type: "metaAndAssetCtxs", dex: "valid-dex" }),
        JSON.stringify({ type: "fundingHistory", coin: "BTC", startTime: 20, endTime: 10 }),
        JSON.stringify({ type: "candleSnapshot", req: { coin: "BTC", interval: "1h", startTime: 1, endTime: 2 }, extra: true }),
        '{"type":"meta","type":"l2Book"}',
      ];
      for (const body of bodies) expect((await POST(request(body))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("passes upstream errors and Retry-After through", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "busy" }), {
      status: 429,
      headers: { "Retry-After": "3" },
    }));
    try {
      const response = await POST(request(JSON.stringify({ type: "meta" })));
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("3");
      expect(await response.json()).toEqual({ error: "busy" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("returns 499 when the request is aborted", async () => {
    const controller = new AbortController();
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return Response.json([]);
    });
    try {
      const nextRequest = new NextRequest("http://localhost/api/hyperliquid", {
        method: "POST",
        body: JSON.stringify({ type: "meta" }),
        signal: controller.signal,
      });
      expect((await POST(nextRequest)).status).toBe(499);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
