import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fetchGateBatchFundingHistory, getGateTickers } from "../gateio";
import {
  buildGateUrl,
  buildGateRequest,
  createGateRequest,
  enrichGateTickers,
  hasCompleteGateTickerEnrichment,
} from "../gate-upstream";
import { fetchGateCanonicalDetail } from "./gate";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
}

describe("Gate detail cancellation and timeout", () => {
  test("proxies a direct timeout instead of treating it as caller cancellation", async () => {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      urls.push(text);
      if (text.startsWith("https://")) {
        throw new DOMException("direct timed out", "TimeoutError");
      }
      if (text.includes("candlesticks")) {
        return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10 }]);
      }
      return Response.json([{ t: 1, r: "0.001" }]);
    }) as typeof fetch;

    await expect(fetchGateCanonicalDetail("BTC", "1d", 28_800)).resolves.toMatchObject({
      symbol: "BTC",
      candles: [{ open: "1" }],
      fundingHistory: [{ fundingRate: 0.001 }],
    });
    expect(urls.some((url) => url.startsWith("/api/gate/"))).toBe(true);
  });

  test("does not proxy when the caller aborts", async () => {
    const caller = new AbortController();
    const reason = new DOMException("caller canceled", "AbortError");
    caller.abort(reason);
    const fetchMock = mock() as typeof fetch;
    globalThis.fetch = fetchMock;

    expect(await rejectionOf(fetchGateCanonicalDetail("BTC", "1d", 28_800, undefined, undefined, caller.signal))).toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Gate direct-first transport", () => {
  test("returns a successful direct response without touching the proxy", async () => {
    const urls: string[] = [];
    const request = createGateRequest({
      fetch: (async (url) => {
        urls.push(String(url));
        return Response.json([{ contract: "BTC_USDT" }]);
      }) as typeof fetch,
    });

    await expect(request("tickers")).resolves.toBeInstanceOf(Response);
    expect(urls).toEqual(["https://api.gateio.ws/api/v4/futures/usdt/tickers"]);
  });

  test("falls back once for a network failure but not for 400, 429, or abort", async () => {
    const networkUrls: string[] = [];
    const networkRequest = createGateRequest({
      fetch: (async (url) => {
        networkUrls.push(String(url));
        if (String(url).startsWith("https://")) throw new TypeError("Failed to fetch");
        return Response.json([{ contract: "BTC_USDT" }]);
      }) as typeof fetch,
    });
    await expect(networkRequest("tickers")).resolves.toBeInstanceOf(Response);
    expect(networkUrls).toEqual(["https://api.gateio.ws/api/v4/futures/usdt/tickers", "/api/gate/futures/usdt/tickers"]);

    for (const status of [400, 429]) {
      let calls = 0;
      const request = createGateRequest({
        sleep: async () => undefined,
        fetch: (async () => { calls += 1; return new Response(null, { status }); }) as typeof fetch,
      });
      await expect(request("tickers")).resolves.toMatchObject({ status });
      expect(calls).toBe(status === 429 ? 2 : 1);
    }

    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    let abortCalls = 0;
    const abortedRequest = createGateRequest({ fetch: (async () => { abortCalls += 1; return Response.json([]); }) as typeof fetch });
    await expect(abortedRequest("tickers", {}, controller.signal)).rejects.toBe(reason);
    expect(abortCalls).toBe(0);
  });

  test("falls back after a client timeout", async () => {
    const urls: string[] = [];
    const request = createGateRequest({
      requestTimeoutMs: 1,
      fetch: ((url, init) => {
        urls.push(String(url));
        if (String(url).startsWith("https://")) {
          return new Promise((_resolve, reject) => init?.signal?.addEventListener(
            "abort", () => reject(new DOMException("aborted", "AbortError")), { once: true },
          ));
        }
        return Promise.resolve(Response.json([]));
      }) as typeof fetch,
    });

    await expect(request("contracts")).resolves.toBeInstanceOf(Response);
    expect(urls).toEqual(["https://api.gateio.ws/api/v4/futures/usdt/contracts", "/api/gate/futures/usdt/contracts"]);
  });

  test("does not proxy a 429 followed by a direct network failure", async () => {
    const urls: string[] = [];
    const first = new Response(null, { status: 429, headers: { "Retry-After": "0" } });
    const request = createGateRequest({
      sleep: async () => undefined,
      fetch: (async (url) => {
        urls.push(String(url));
        if (urls.length === 1) return first;
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });

    await expect(request("tickers")).resolves.toBe(first);
    expect(urls).toHaveLength(2);
  });

  test("does not proxy a 429 when its Retry-After exceeds the direct deadline", async () => {
    const first = new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    const fetchMock = mock().mockResolvedValueOnce(first);

    const request = createGateRequest({ fetch: fetchMock as typeof fetch, requestTimeoutMs: 1 });
    await expect(request("tickers")).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("only includes Content-Type for Gate POST requests", () => {
    expect(new Headers(buildGateRequest("tickers").init.headers).get("Content-Type")).toBeNull();
    expect(new Headers(buildGateRequest("funding-rates").init.headers).get("Content-Type")).toBe("application/json");
  });

  test("keeps direct and proxy enrichment semantics aligned", () => {
    const tickers = [{ contract: "BTC_USDT", last: "1" }, { contract: "XAUT_USDT", last: "2" }];
    const contracts = [{ name: "BTC_USDT", funding_interval: 14_400 }, { name: "XAUT_USDT", funding_interval: 28_800 }];
    expect(enrichGateTickers(tickers, contracts)).toEqual([
      { contract: "BTC_USDT", last: "1", funding_interval: 14_400, asset_category: "Crypto" },
      { contract: "XAUT_USDT", last: "2", funding_interval: 28_800, asset_category: "商品" },
    ]);
    expect(new URL(buildGateUrl("order-book", { contract: "BTC_USDT", limit: "20", rpi: "1" })).pathname)
      .toBe("/api/v4/futures/usdt/rpi_order_book");
  });

  test("requires contracts metadata for non-empty tickers but preserves empty results", () => {
    expect(hasCompleteGateTickerEnrichment([], undefined)).toBe(true);
    expect(hasCompleteGateTickerEnrichment([{ contract: "BTC_USDT" }], [])).toBe(false);
    expect(hasCompleteGateTickerEnrichment(
      [{ contract: "BTC_USDT" }],
      [{ name: "BTC_USDT", funding_interval: 28_800 }],
    )).toBe(true);
  });

  test("does not fabricate an 8-hour interval when the direct contracts leg is unavailable", async () => {
    const urls: string[] = [];
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      urls.push(text);
      if (text.includes("/tickers")) return Response.json([{ contract: "BTC_USDT", last: "1" }]);
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;

    try {
      await expect(getGateTickers()).resolves.toEqual([]);
      expect(urls.some((url) => url.includes("/contracts"))).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  test("keeps an authentically empty direct ticker response empty without enrichment metadata", async () => {
    globalThis.fetch = mock(async (url) => {
      if (String(url).includes("/tickers")) return Response.json([]);
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;

    await expect(getGateTickers()).resolves.toEqual([]);
  });
});

describe("Gate batch latest settlements", () => {
  test.each(["not json", JSON.stringify({ invalid: true }), JSON.stringify([{}])])("does not proxy malformed direct 200 response (%s)", async (body) => {
    let proxyCalls = 0;
    const result = await fetchGateBatchFundingHistory(["BTC_USDT"], undefined, {
      fetch: (async (url) => {
        if (String(url).startsWith("https://")) return new Response(body, { status: 200 });
        proxyCalls += 1;
        return Response.json([]);
      }) as typeof fetch,
    });

    expect(result).toEqual(new Map());
    expect(proxyCalls).toBe(0);
  });

  test("retains direct successes and chunks only eligible failures into batches of 50", async () => {
    const urls: string[] = [];
    const proxyBodies: string[][] = [];
    const contracts = Array.from({ length: 101 }, (_, index) => `C${index}_USDT`);
    const result = await fetchGateBatchFundingHistory(contracts, undefined, {
      fetch: (async (url, init) => {
        const text = String(url);
        urls.push(text);
        if (text.startsWith("https://")) {
          const contract = new URL(text).searchParams.get("contract")!;
          return contract === "C0_USDT"
            ? Response.json([{ t: 1, r: "0.1" }])
            : new Response(null, { status: 503 });
        }
        const body = JSON.parse(String(init?.body)) as { contracts: string[] };
        proxyBodies.push(body.contracts);
        return Response.json(body.contracts.map((contract) => ({ contract, data: [{ t: 2, r: "0.2" }] })));
      }) as typeof fetch,
      sleep: async () => undefined,
    });

    expect(result.get("C0_USDT")).toEqual([{ time: 1000, fundingRate: "0.1" }]);
    expect(result.get("C100_USDT")).toEqual([{ time: 2000, fundingRate: "0.2" }]);
    expect(proxyBodies).toHaveLength(2);
    expect(proxyBodies.map((body) => body.length)).toEqual([50, 50]);
    expect(urls.filter((url) => url.startsWith("https://"))).toHaveLength(101);
  });

  test.each(["retry returns 5xx", "retry throws transport failure"])("never proxies a contract after a direct 429 when %s", async (mode) => {
    const urls: string[] = [];
    const result = await fetchGateBatchFundingHistory(["BTC_USDT"], undefined, {
      fetch: (async (url) => {
        const text = String(url);
        urls.push(text);
        if (urls.length === 1) return new Response("rate limited", { status: 429 });
        if (mode === "retry returns 5xx") return new Response("upstream", { status: 503 });
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
      sleep: async () => undefined,
    });

    expect(result).toEqual(new Map());
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.startsWith("https://api.gateio.ws/"))).toBe(true);
  });

  test("retains a successful direct retry after an initial 429 without proxying", async () => {
    const urls: string[] = [];
    const result = await fetchGateBatchFundingHistory(["BTC_USDT"], undefined, {
      fetch: (async (url) => {
        const text = String(url);
        urls.push(text);
        return urls.length === 1
          ? new Response("rate limited", { status: 429 })
          : Response.json([{ t: 3, r: "0.3" }]);
      }) as typeof fetch,
      sleep: async () => undefined,
    });

    expect(result.get("BTC_USDT")).toEqual([{ time: 3000, fundingRate: "0.3" }]);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.startsWith("https://api.gateio.ws/"))).toBe(true);
  });
});
