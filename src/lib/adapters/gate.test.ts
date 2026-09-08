import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { clearGateMultiplierCache, fetchGateBatchFundingHistory, getAllFundingRates, getCandleSnapshot, getFundingHistoryForDays, getGateTickers } from "../gateio";
import {
  buildGateUrl,
  buildGateRequest,
  createGateRequest,
  enrichGateTickers,
  hasCompleteGateTickerEnrichment,
} from "../gate-upstream";
import { fetchGateCanonicalDetail } from "./gate";
import { computeAvgFundingRates } from "../search";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  clearGateMultiplierCache();
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
  test("normalizes contract volume with the official quanto multiplier", async () => {
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("candlesticks")) {
        return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10, sum: "15" }]);
      }
      if (text.includes("tickers")) return Response.json([{ contract: "BTC_USDT", quanto_multiplier: "0.01" }]);
      if (text.includes("contracts")) return Response.json([{ name: "BTC_USDT", funding_interval: 28_800 }]);
      return Response.json([]);
    }) as typeof fetch;

    await expect(getCandleSnapshot("BTC", "1d", 1)).resolves.toEqual([expect.objectContaining({
      volume: "0.1",
      quoteVolume: "15",
    })]);
  });

  test("does not estimate Gate quote volume when sum is absent", async () => {
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("candlesticks")) {
        return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10 }]);
      }
      if (text.includes("tickers")) return Response.json([{ contract: "BTC_USDT", quanto_multiplier: "0.01" }]);
      if (text.includes("contracts")) return Response.json([{ name: "BTC_USDT", funding_interval: 28_800 }]);
      return Response.json([]);
    }) as typeof fetch;

    const candles = await getCandleSnapshot("BTC", "1d", 1);
    expect(candles[0].quoteVolume).toBeUndefined();
    expect(candles[0].volume).toBe("0.1");
  });

  test("canonical detail preserves a partial three-day history and latest settlement", async () => {
    const nowMs = Date.UTC(2026, 6, 15);
    const nowSeconds = Math.floor(nowMs / 1000);
    const boundarySeconds = nowSeconds - 30 * 24 * 60 * 60 - 8 * 60 * 60;
    const urls: string[] = [];
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      urls.push(text);
      if (text.includes("candlesticks")) return Response.json([]);
      return Response.json([
        { t: nowSeconds - 3 * 24 * 60 * 60, r: "0.1" },
        { t: boundarySeconds, r: "0.2" },
      ]);
    }) as typeof fetch;

    const detail = await fetchGateCanonicalDetail("BTC", "1d", 3600, undefined, undefined, undefined, { asOf: nowMs });
    expect(new URL(urls.find((url) => url.includes("funding_rate"))!).searchParams.get("to")).toBe(String(nowSeconds));
    expect(detail.fundingHistory).toEqual([
      { timestamp: boundarySeconds * 1000, fundingRate: 0.2 },
      { timestamp: (nowSeconds - 3 * 24 * 60 * 60) * 1000, fundingRate: 0.1 },
    ]);
    expect(detail.lastSettlementRate).toBe(0.1);
  });

  test("canonical detail rejects a Gate 5xx history response", async () => {
    globalThis.fetch = mock(async () => new Response("upstream failure", { status: 503 })) as typeof fetch;
    await expect(fetchGateCanonicalDetail("BTC", "1d", 8 * 60 * 60, undefined, undefined, undefined, { now: Date.now() }))
      .rejects.toThrow("Failed to fetch funding history");
  });

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
      if (text.includes("tickers")) return Response.json([{ contract: "BTC_USDT", quanto_multiplier: "0.01" }]);
      if (text.includes("contracts")) return Response.json([{ name: "BTC_USDT", funding_interval: 28_800 }]);
      return Response.json(Array.from({ length: 1000 }, (_, index) => ({
        t: Math.floor(Date.now() / 1000) - index * 3_600,
        r: "0.001",
      })));
    }) as typeof fetch;

    const detail = await fetchGateCanonicalDetail("BTC", "1d", 28_800);
    expect(detail).toMatchObject({
      symbol: "BTC",
      candles: [{ open: "1" }],
    });
    expect(detail.fundingHistory.length).toBeGreaterThan(0);
    expect(detail.fundingHistory.every((item) => item.fundingRate === 0.001)).toBe(true);
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

  test("retains a valid zero live funding rate but drops a blank rate", async () => {
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("/tickers")) {
        return Response.json([
          { contract: "BTC_USDT", funding_rate: "0", funding_rate_indicative: "", mark_price: "100", index_price: "100", total_size: "1", volume_24h_settle: "1", last: "100" },
          { contract: "ETH_USDT", funding_rate: "", funding_rate_indicative: "0.1", mark_price: "100", index_price: "100", total_size: "1", volume_24h_settle: "1", last: "100" },
        ]);
      }
      if (text.includes("/contracts")) {
        return Response.json([
          { name: "BTC_USDT", funding_interval: 28_800, type: "Futures", in_delisting: false },
          { name: "ETH_USDT", funding_interval: 28_800, type: "Futures", in_delisting: false },
        ]);
      }
      return new Response("unavailable", { status: 503 });
    }) as typeof fetch;

    const rates = await getAllFundingRates();
    expect(rates.map((rate) => [rate.coin, rate.fundingRate])).toEqual([["BTC", "0"]]);
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

describe("Gate funding history pagination", () => {
  const nowMs = 1_700_000_000_000;
  const nowSeconds = Math.floor(nowMs / 1000);

  test("uses the time window rather than the current interval for 8h and 1h schedules", async () => {
    Date.now = () => nowMs;
    const requests: URL[] = [];
    const rows = Array.from({ length: 721 }, (_, index) => ({
      t: nowSeconds - index * 3_600,
      r: String(index),
    }));
    globalThis.fetch = mock(async (url) => {
      requests.push(new URL(String(url)));
      return Response.json(rows);
    }) as typeof fetch;

    const current = await getFundingHistoryForDays("BTC", 30, 28_800, undefined, true);
    const historical = await getFundingHistoryForDays("BTC", 30, 3_600);

    expect(current).toHaveLength(721);
    expect(historical).toHaveLength(721);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.searchParams.get("limit")).toBe("1000");
      expect(request.searchParams.get("from")).toBe(String(nowSeconds - 90 * 24 * 60 * 60));
      expect(request.searchParams.get("to")).toBe(String(nowSeconds));
    }
    expect(current[0].time).toBe(historical[0].time);
    expect(current[0].time).toBe((nowSeconds - 720 * 3_600) * 1000);
  });

  test("paginates full pages, removes repeated boundaries, and sorts without zero fill", async () => {
    Date.now = () => nowMs;
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json(Array.from({ length: 1000 }, (_, index) => ({
          t: nowSeconds - index * 3_600,
          r: String(index + 1),
        })));
      }
      return Response.json([
        { t: nowSeconds - 999 * 3_600, r: "duplicate" },
        ...Array.from({ length: 500 }, (_, index) => ({
          t: nowSeconds - (1000 + index) * 3_600,
          r: String(index + 1001),
        })),
      ]);
    }) as typeof fetch;

    const history = await getFundingHistoryForDays("BTC", 100, 28_800);

    expect(calls).toBe(2);
    expect(history).toHaveLength(1500);
    expect(history[0].time).toBe((nowSeconds - 1499 * 3_600) * 1000);
    expect(history.at(-1)?.time).toBe(nowMs);
    expect(history.some((item) => item.fundingRate === "0")).toBe(false);
  });

  test("stops at the cutoff and honors abort", async () => {
    Date.now = () => nowMs;
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return Response.json(Array.from({ length: 1000 }, (_, index) => ({
        t: nowSeconds - index * 3_600,
        r: "0.1",
      })));
    }) as typeof fetch;

    const history = await getFundingHistoryForDays("BTC", 1, 3_600);
    expect(history).toHaveLength(25);
    expect(calls).toBe(1);

    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    await expect(getFundingHistoryForDays("BTC", 30, 3_600, controller.signal)).rejects.toBe(reason);
    expect(calls).toBe(1);
  });

  test("fails closed on uncovered short pages but preserves partial non-strict history", async () => {
    Date.now = () => nowMs;
    globalThis.fetch = mock(async () => Response.json([{ t: nowSeconds, r: "0.1" }])) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 30, 3_600, undefined, true)).resolves.toEqual([]);
    await expect(getFundingHistoryForDays("BTC", 30, 3_600)).resolves.toEqual([
      { time: nowMs, fundingRate: "0.1" },
    ]);
  });

  test("enforces the maximum request budget", async () => {
    Date.now = () => nowMs;
    let calls = 0;
    globalThis.fetch = mock(async () => {
      const pageStart = nowSeconds - (calls + 1) * 1_000;
      calls += 1;
      return Response.json(Array.from({ length: 1000 }, (_, index) => ({
        t: pageStart - index,
        r: "0.1",
      })));
    }) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 100_000, 3_600, undefined, true)).resolves.toEqual([]);
    expect(calls).toBe(30);
  });

  test("fails closed when the oldest retained row is two days after the cutoff", async () => {
    Date.now = () => nowMs;
    const gridSeconds = 8 * 3_600;
    const rows = Array.from({ length: 84 }, (_, index) => ({
      t: nowSeconds - index * gridSeconds,
      r: "0.0001",
    }));
    globalThis.fetch = mock(async () => Response.json(rows)) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 30, 28_800, undefined, true)).resolves.toEqual([]);
  });

  test("retains a settlement at the exact cutoff for shared half-open statistics", async () => {
    Date.now = () => nowMs;
    const cutoff = nowSeconds - 30 * 24 * 60 * 60;
    globalThis.fetch = mock(async () => Response.json([
      { t: cutoff + 3_600, r: "0.1" },
      { t: cutoff, r: "0.2" },
    ])) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 30, 28_800, undefined, true)).resolves.toEqual([
      { time: cutoff * 1000, fundingRate: "0.2" },
      { time: (cutoff + 3_600) * 1000, fundingRate: "0.1" },
    ]);
  });

  test("retains an unaligned cutoff proof settlement for Search coverage", async () => {
    Date.now = () => nowMs;
    const cutoff = nowSeconds - 30 * 24 * 60 * 60;
    globalThis.fetch = mock(async () => Response.json([
      { t: nowSeconds - 3_600, r: "0.3" },
      { t: cutoff + 3_600, r: "0.1" },
      { t: cutoff - 1, r: "0.2" },
    ])) as typeof fetch;

    const history = await getFundingHistoryForDays("BTC", 30, 28_800, undefined, true);
    expect(history).toEqual([
      { time: (cutoff - 1) * 1000, fundingRate: "0.2" },
      { time: (cutoff + 3_600) * 1000, fundingRate: "0.1" },
      { time: (nowSeconds - 3_600) * 1000, fundingRate: "0.3" },
    ]);
    expect(computeAvgFundingRates(history, 28_800, nowMs, { requireWindowCoverage: true }).avg30d)
      .toBeCloseTo(0.4 * (8 * 3_600_000) / (30 * 24 * 3_600_000), 12);
  });

  test("strict coverage ignores invalid proof rows but retains a valid zero boundary", async () => {
    Date.now = () => nowMs;
    const cutoff = nowSeconds - 30 * 24 * 60 * 60;
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return Response.json(calls === 1
        ? [{ t: cutoff + 3_600, r: "0.1" }, { t: cutoff, r: "" }, { t: cutoff - 1 }]
        : [{ t: cutoff + 3_600, r: "0.1" }, { t: cutoff, r: 0 }]);
    }) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 30, 28_800, undefined, true)).resolves.toEqual([]);
    await expect(getFundingHistoryForDays("BTC", 30, 28_800, undefined, true)).resolves.toEqual([
      { time: cutoff * 1000, fundingRate: "0" },
      { time: (cutoff + 3_600) * 1000, fundingRate: "0.1" },
    ]);
  });

  test("strictly fails when retained funding is far shorter than the requested window", async () => {
    // A brand-new venue market keeps only a few days of funding; a 30-day
    // detail window must not present a five-day average as a thirty-day one.
    Date.now = () => nowMs;
    const rows = Array.from({ length: 15 }, (_, index) => ({
      t: nowSeconds - index * 8 * 3_600,
      r: "0.0001",
    }));
    globalThis.fetch = mock(async () => Response.json(rows)) as typeof fetch;

    await expect(getFundingHistoryForDays("BTC", 30, 28_800, undefined, true)).resolves.toEqual([]);
  });
});
