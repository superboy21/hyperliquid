import { describe, expect, test } from "bun:test";
import {
  fetchHyperliquidInfo,
  fetchL2Book,
  getCandleSnapshot,
  getAllFundingRates,
  getFundingHistory,
  getFundingHistoryRange,
  HYPERLIQUID_FUNDING_PAGE_MS,
  HYPERLIQUID_FUNDING_MAX_PAGES,
  getMeta,
} from "./hyperliquid";

const directUrl = "https://api.hyperliquid.xyz/info";
const proxyUrl = "/api/hyperliquid";
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Hyperliquid direct-first transport", () => {
  test("returns direct success without invoking the proxy", async () => {
    let proxyCalls = 0;
    const restore = mockFetch(async (url) => {
      if (url === proxyUrl) proxyCalls += 1;
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1)).resolves.toEqual({ ok: true });
      expect(proxyCalls).toBe(0);
    } finally {
      restore();
    }
  });

  test.each([
    ["network", new TypeError("Failed to fetch")],
    ["timeout", new DOMException("timed out", "TimeoutError")],
  ])("falls back exactly once for direct %s failure", async (_name, error) => {
    let proxyCalls = 0;
    const restore = mockFetch(async (url) => {
      if (url === directUrl) throw error;
      proxyCalls += 1;
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1)).resolves.toEqual({ ok: true });
      expect(proxyCalls).toBe(1);
    } finally {
      restore();
    }
  });

  test.each([403, 451, 500])("falls back exactly once for final direct %s", async (status) => {
    let proxyCalls = 0;
    const restore = mockFetch(async (url) => {
      if (url === directUrl) return new Response(null, { status });
      proxyCalls += 1;
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1)).resolves.toEqual({ ok: true });
      expect(proxyCalls).toBe(1);
    } finally {
      restore();
    }
  });

  test("does not proxy when a direct 429 is followed by a network failure", async () => {
    let directCalls = 0;
    let proxyCalls = 0;
    const restore = mockFetch(async (url) => {
      if (url === directUrl) {
        directCalls += 1;
        if (directCalls === 1) return new Response(null, { status: 429 });
        throw new TypeError("Failed to fetch");
      }
      proxyCalls += 1;
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 2)).resolves.toBeNull();
      expect(directCalls).toBe(2);
      expect(proxyCalls).toBe(0);
    } finally {
      restore();
    }
  });

  test("does not send forbidden Origin or Referer headers on direct POST", async () => {
    let directHeaders: Headers | undefined;
    const restore = mockFetch(async (_url, init) => {
      directHeaders = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1)).resolves.toEqual({ ok: true });
      expect(directHeaders?.get("Content-Type")).toBe("application/json");
      expect(directHeaders?.get("Origin")).toBeNull();
      expect(directHeaders?.get("Referer")).toBeNull();
    } finally {
      restore();
    }
  });

  test.each([400, 429])("does not proxy ordinary direct status %s", async (status) => {
    let proxyCalls = 0;
    const restore = mockFetch(async (url) => {
      if (url === proxyUrl) proxyCalls += 1;
      return new Response(null, { status });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1)).resolves.toBeNull();
      expect(proxyCalls).toBe(0);
    } finally {
      restore();
    }
  });

  test("preserves the caller abort and never invokes the proxy", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    let calls = 0;
    const restore = mockFetch(async () => {
      calls += 1;
      throw reason;
    });
    controller.abort(reason);

    try {
      await expect(fetchHyperliquidInfo({ type: "meta" }, 1, controller.signal)).resolves.toBeNull();
      expect(calls).toBe(0);
    } finally {
      restore();
    }
  });

  test("reuses the exact serialized body for direct and proxy legs", async () => {
    const bodies: string[] = [];
    const restore = mockFetch(async (url, init) => {
      bodies.push(String(init?.body));
      if (url === directUrl) return new Response(null, { status: 403 });
      return jsonResponse({ ok: true });
    });

    try {
      await expect(fetchHyperliquidInfo({ type: "metaAndAssetCtxs", dex: "xyz" }, 1)).resolves.toEqual({ ok: true });
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(bodies[1]);
    } finally {
      restore();
    }
  });

  test("routes every Hyperliquid info body type through the shared transport", async () => {
    const bodies: string[] = [];
    const restore = mockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { type: string };
      bodies.push(body.type);
      switch (body.type) {
        case "l2Book":
          return jsonResponse({ levels: [[{ px: "1", sz: "1", n: 1 }], [{ px: "2", sz: "1", n: 1 }]] });
        case "candleSnapshot":
          return jsonResponse([]);
        case "fundingHistory":
          return jsonResponse([]);
        case "meta":
          return jsonResponse({ universe: [] });
        default:
          return jsonResponse([{ universe: [] }, []]);
      }
    });

    try {
      await getFundingHistory("BTC", undefined);
      await getCandleSnapshot("BTC");
      await fetchL2Book("BTC");
      await getMeta();
      expect(bodies).toEqual(["fundingHistory", "candleSnapshot", "l2Book", "meta"]);
    } finally {
      restore();
    }
  });

  test("paginates a multi-page range with fixed inclusive millisecond windows", async () => {
    const hour = 60 * 60 * 1000;
    const start = 0;
    const end = 600 * hour;
    const requests: { startTime: number; endTime: number }[] = [];
    const restore = mockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { startTime: number; endTime: number };
      requests.push(body);
      const rows = [];
      for (let time = body.startTime; time <= body.endTime; time += hour) {
        rows.push({ time, coin: "BTC", fundingRate: "0.001" });
      }
      if (rows.length > 0) rows.push(rows[0]);
      return jsonResponse(rows);
    });

    try {
      const history = await getFundingHistoryRange("BTC", start, end);
      expect(requests).toHaveLength(2);
      expect(requests.every(({ startTime, endTime }) =>
        endTime >= startTime && endTime - startTime + 1 <= HYPERLIQUID_FUNDING_PAGE_MS,
      )).toBe(true);
      expect(requests[1].endTime).toBe(requests[0].startTime - 1);
      expect(history).toHaveLength(600);
      expect(history.map((item) => item.time)).toEqual(
        Array.from({ length: 600 }, (_, index) => index * hour),
      );
    } finally {
      restore();
    }
  });

  test("does not return partial history when the range exceeds the page budget", async () => {
    let calls = 0;
    const restore = mockFetch(async () => {
      calls += 1;
      return jsonResponse([]);
    });

    try {
      await expect(getFundingHistoryRange(
        "BTC",
        0,
        HYPERLIQUID_FUNDING_PAGE_MS * HYPERLIQUID_FUNDING_MAX_PAGES + 1,
      )).rejects.toThrow("page budget");
      expect(calls).toBe(0);
    } finally {
      restore();
    }
  });

  test("retains a valid zero live funding rate but drops missing funding", async () => {
    const restore = mockFetch(async () => jsonResponse([
      { universe: [{ name: "BTC" }, { name: "ETH" }] },
      [{ funding: "0" }, { funding: "" }],
    ]));

    try {
      await expect(getAllFundingRates()).resolves.toEqual([
        expect.objectContaining({ coin: "BTC", fundingRate: "0" }),
      ]);
    } finally {
      restore();
    }
  });
});
