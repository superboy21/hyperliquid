import { describe, expect, spyOn, test } from "bun:test";
import {
  buildBitgetUrl,
  computeBitgetBboSpread,
  computeBitgetImpactSpread,
  computeBitgetImpactSpreadDetail,
  createBitgetScheduler,
  fetchBitgetCandles,
  fetchBitgetCanonicalDetail,
  fetchBitgetFundingHistory,
  fetchBitgetImpactSpread,
  fetchBitgetImpactSpreadDetail,
  fetchLatestBitgetSettlement,
  latestBitgetFundingPoint,
  normalizeBitgetCandles,
  normalizeBitgetFundingRows,
  normalizeBitgetOrderBook,
  parseBitgetList,
  selectBitgetDetailCandles,
  type BitgetRequest,
} from "./bitget";
import { computeOrderBookImpactDetail, computeOrderBookImpactSpread, resolvePerpImpactDepth } from "../order-book-impact";

describe("Bitget successful-payload parsing and list normalization", () => {
  test("rejects envelopes and malformed successful payloads", () => {
    expect(() => parseBitgetList({ code: "00000", data: [] })).toThrow();
    expect(() => parseBitgetList({ nope: [] })).toThrow();
  });

  test("uses online perpetual instruments as the intersected universe", () => {
    const rows = normalizeBitgetFundingRows(
      [
        { symbol: "BTCUSDT", baseCoin: "BTC", type: "perpetual", status: "online", symbolType: "crypto", fundInterval: "4", quantityMultiplier: "999" },
        { symbol: "OFFUSDT", baseCoin: "OFF", type: "perpetual", status: "offline" },
        { symbol: "DELIVERY", baseCoin: "DEL", type: "delivery", status: "online" },
        { symbol: "NOFUND", baseCoin: "NO", type: "perpetual", status: "online" },
      ],
      [{ symbol: "BTCUSDT", lastPrice: "102", openPrice24h: "100", markPrice: "101", indexPrice: "100.5", price24hPcnt: "0.025", turnover24h: "12345", openInterest: "7", bid1Price: "100", ask1Price: "102" }, { symbol: "NOFUND" }],
      [{ symbol: "BTCUSDT", fundingRate: "0.0001", fundingRateInterval: "2" }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "BTC", rawSymbol: "BTCUSDT", marketKey: "BTCUSDT", fundingIntervalSeconds: 7200, change24h: 2.5, quoteVolume: 12345, openInterest: 7, notionalValue: 707, assetCategory: "Crypto", bestBid: 100, bestAsk: 102 });
  });

  test("applies interval precedence, fallback change, and category mapping", () => {
    const instruments = [
      { symbol: "A", baseCoin: "A", type: "perpetual", status: "online", fundInterval: "1", category: "stock" },
      { symbol: "B", baseCoin: "B", type: "perpetual", status: "online", fundInterval: "bad", category: "metal" },
      { symbol: "C", baseCoin: "C", type: "perpetual", status: "online", category: "mystery" },
    ];
    const tickers = instruments.map(({ symbol }) => ({ symbol, lastPr: "110", open24h: "100", markPrice: "10", turnover24h: "1", openInterest: "2" }));
    const funding = [{ symbol: "A", fundingRate: "1", fundingRateInterval: "bad" }, { symbol: "B", fundingRate: "1" }, { symbol: "C", fundingRate: "1" }];
    const rows = normalizeBitgetFundingRows(instruments, tickers, funding);
    expect(rows.map((row) => row.fundingIntervalSeconds)).toEqual([3600, 28800, 28800]);
    expect(rows.map((row) => row.assetCategory)).toEqual(["股票/指数", "商品", "其他"]);
    expect(rows[0].change24h).toBe(10);
  });
});

describe("Bitget funding history", () => {
  test("accepts the official resultList/fundingRateTimestamp shape and counts resultList for pagination", async () => {
    const calls: number[] = [];
    const request: BitgetRequest = async (_action, params) => {
      const page = Number(params.cursor);
      calls.push(page);
      if (page === 1) return { resultList: Array.from({ length: 100 }, (_, index) => ({ symbol: "BTCUSDT", fundingRateTimestamp: String(200 - index), fundingRate: String(index / 1000) })) };
      return { resultList: [{ symbol: "BTCUSDT", fundingRateTimestamp: "101", fundingRate: "9" }, { symbol: "BTCUSDT", fundingRateTimestamp: "100", fundingRate: "0.5" }, { symbol: "BTCUSDT", fundingRateTimestamp: "99", fundingRate: "0.6" }] };
    };
    const rows = await fetchBitgetFundingHistory("BTCUSDT", { cutoffTime: 100, request });
    expect(calls).toEqual([1, 2]);
    expect(rows[0].timestamp).toBe(100);
    expect(rows.filter((row) => row.timestamp === 101)).toHaveLength(1);
    expect(latestBitgetFundingPoint(rows)?.timestamp).toBe(200);
  });

  test("stops when a full page makes no timestamp progress", async () => {
    let calls = 0;
    const request: BitgetRequest = async () => {
      calls += 1;
      return Array.from({ length: 100 }, () => ({ fundingTime: 100, fundingRate: "0.1" }));
    };
    await fetchBitgetFundingHistory("BTCUSDT", { request });
    expect(calls).toBe(2);
  });

  test("latest settlement helper issues exactly cursor=1/limit=1 once", async () => {
    const calls: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BitgetRequest = async (action, params) => {
      calls.push({ action, params });
      return { resultList: [{ fundingRateTimestamp: "1234", fundingRate: "0.001" }] };
    };
    await expect(fetchLatestBitgetSettlement("BTCUSDT", { request })).resolves.toEqual({ timestamp: 1234, fundingRate: 0.001 });
    expect(calls).toEqual([{ action: "history-fund-rate", params: { symbol: "BTCUSDT", cursor: "1", limit: "1" } }]);
  });
});

describe("Bitget candles and books", () => {
  test.each([
    ["1d", 30],
    ["4h", 180],
    ["1h", 720],
  ] as const)("retains the full 30-day %s candle budget", (interval, expected) => {
    const candles = Array.from({ length: 800 }, (_, index) => ({
      openTime: index,
      closeTime: index,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "1",
    }));

    const selected = selectBitgetDetailCandles(candles, interval);
    expect(selected).toHaveLength(expected);
    expect(selected[0].openTime).toBe(800 - expected);
    expect(selectBitgetDetailCandles(candles.slice(0, expected - 1), interval)).toHaveLength(expected - 1);
  });

  test("maps base volume and official quote turnover with interval close time", () => {
    const rows = normalizeBitgetCandles([[1_000_000, "1", "3", "0.5", "2", "7", "14"]], "1h");
    expect(rows[0]).toMatchObject({ openTime: 1_000_000, closeTime: 4_599_999, volume: "7", quoteVolume: "14" });
  });

  test("routes daily and weekly candles to official UTC intervals without 4H transport", async () => {
    const monday = Date.UTC(2026, 6, 13);
    const calls: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BitgetRequest = async (action, params) => {
      calls.push({ action, params });
      return [[monday, "1", "3", "0.5", "2", "7", "14"]];
    };
    await fetchBitgetCandles("BTCUSDT", "1d", { startTime: monday, endTime: monday + 86_400_000, request });
    const weekly = await fetchBitgetCandles("BTCUSDT", "1w", {
      startTime: monday,
      endTime: monday + 2 * 86_400_000,
      request,
    });
    expect(calls.map(({ params }) => params.interval)).toEqual(["1Dutc", "1Wutc"]);
    expect(calls.every(({ params }) => params.interval !== "4H")).toBe(true);
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({ openTime: monday, closeTime: monday + 7 * 86_400_000 - 1, volume: "7", quoteVolume: "14" });
  });

  test("uses endpoint-specific bounds without missing a seam candle", async () => {
    const minute = 60_000;
    const endTime = Math.floor(2_000_000_000_000 / minute) * minute;
    const startTime = endTime - 250 * minute;
    const calls: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BitgetRequest = async (action, params) => {
      calls.push({ action, params });
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      const first = action === "candles" ? end : end - minute;
      const last = action === "candles" ? start + minute : start;
      return Array.from({ length: Math.floor((first - last) / minute) + 1 }, (_, index) => [first - index * minute, "1", "1", "1", "1", "1"]);
    };
    const rows = await fetchBitgetCandles("BTCUSDT", "1m", { startTime, endTime, request });
    expect(rows.map((row) => row.openTime)).toEqual(Array.from({ length: 251 }, (_, index) => startTime + index * minute));
    expect(calls[1]).toMatchObject({ action: "history-candles", params: { endTime: String(endTime - 99 * minute) } });
  });

  test.each([
    ["1d", 86_400_000, "1Dutc", 250],
    ["1w", 7 * 86_400_000, "1Wutc", 200],
  ] as const)("reaches the requested %s UTC cutoff with realistic recent/history windows", async (interval, ms, api, count) => {
    const endTime = interval === "1w" ? Date.UTC(2026, 6, 13) : Date.UTC(2026, 6, 15);
    const startTime = endTime - (count - 1) * ms;
    const request: BitgetRequest = async (action, params) => {
      expect(params.interval).toBe(api);
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      const first = action === "candles" ? end : end - ms;
      const last = action === "candles" ? start + ms : start;
      return Array.from({ length: Math.floor((first - last) / ms) + 1 }, (_, index) => [first - index * ms, "1", "1", "1", "1", "1"]);
    };
    const rows = await fetchBitgetCandles("BTCUSDT", interval, { startTime, endTime, request });
    expect(rows).toHaveLength(count);
    expect(rows[0].openTime).toBe(startTime);
    expect(rows.at(-1)?.openTime).toBe(endTime);
  });

  test.each([
    ["1d", "1Dutc", 3_000],
    ["1w", "1Wutc", 430],
  ] as const)("reaches the configured %s history cap without a seam short-page", async (interval, api, cap) => {
    const ms = interval === "1d" ? 86_400_000 : 7 * 86_400_000;
    const endTime = interval === "1d" ? Date.UTC(2026, 6, 15) : Date.UTC(2026, 6, 13);
    const request: BitgetRequest = async (action, params) => {
      expect(params.interval).toBe(api);
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      const first = action === "candles" ? end : end - ms;
      const last = action === "candles" ? start + ms : start;
      return Array.from({ length: Math.floor((first - last) / ms) + 1 }, (_, index) => [first - index * ms, "1", "1", "1", "1", "1"]);
    };
    const rows = await fetchBitgetCandles("BTCUSDT", interval, { endTime, request });
    expect(rows).toHaveLength(cap);
    expect(rows.every((row, index) => index === 0 || row.openTime - rows[index - 1].openTime === ms)).toBe(true);
    expect(rows.at(-1)?.openTime).toBe(endTime);
  });

  test("normalizes book quantities as base quantities without a multiplier", () => {
    expect(normalizeBitgetOrderBook({ a: [["101", "2.5"]], b: [["100", "3"]] })).toEqual({
      asks: [{ price: 101, baseQty: 2.5 }], bids: [{ price: 100, baseQty: 3 }],
    });
  });

  test("computes BBO and base-quantity impact spreads", () => {
    expect(computeBitgetBboSpread(99, 101)).toBe(2);
    expect(computeBitgetImpactSpread({
      bids: [{ price: 99, baseQty: 20 }],
      asks: [{ price: 101, baseQty: 20 }],
    }, 1000)).toBeCloseTo(2, 10);
    expect(computeBitgetImpactSpread({
      bids: [{ price: 99, baseQty: 1 }],
      asks: [{ price: 101, baseQty: 20 }],
    }, 1000)).toBe("insufficient");
  });

  test("delegates impact math to the shared unsorted-book calculation", () => {
    const book = {
      bids: [{ price: 99, baseQty: 20 }, { price: 100, baseQty: 1 }],
      asks: [{ price: 102, baseQty: 20 }, { price: 101, baseQty: 1 }],
    };
    const sharedBook = {
      bids: book.bids.map((level) => ({ price: level.price, quantity: level.baseQty })),
      asks: book.asks.map((level) => ({ price: level.price, quantity: level.baseQty })),
    };
    expect(computeBitgetImpactSpread(book, 1000)).toBe(computeOrderBookImpactSpread(sharedBook, 1000));
    expect(computeBitgetImpactSpreadDetail(book, 1000)).toEqual(computeOrderBookImpactDetail(sharedBook, 1000));
  });

  test("uses the centralized Bitget perpetual impact depth", async () => {
    let requestedLimit: string | undefined;
    const request: BitgetRequest = async (action, params) => {
      expect(action).toBe("orderbook");
      requestedLimit = params.limit;
      return { bids: [["99", "20"]], asks: [["101", "20"]] };
    };
    await fetchBitgetImpactSpread("BTCUSDT", 1000, undefined, request);
    expect(requestedLimit).toBe(String(resolvePerpImpactDepth("Bitget")));
  });

  test("propagates an explicitly requested maximum Bitget depth", async () => {
    let requestedLimit: string | undefined;
    const request: BitgetRequest = async (_action, params) => {
      requestedLimit = params.limit;
      return { bids: [["99", "20"]], asks: [["101", "20"]] };
    };
    await fetchBitgetImpactSpread("BTCUSDT", 1000, undefined, request, resolvePerpImpactDepth("Bitget", "max"));
    expect(requestedLimit).toBe("1000");
  });

  test("detail fetch mirrors the spread fetch with the same request overloads", async () => {
    const requestedLimits: string[] = [];
    const request: BitgetRequest = async (_action, params) => {
      expect(_action).toBe("orderbook");
      requestedLimits.push(params.limit);
      return { bids: [["99", "20"]], asks: [["101", "20"]] };
    };
    const standard = await fetchBitgetImpactSpreadDetail("BTCUSDT", 1000, undefined, request);
    const max = await fetchBitgetImpactSpreadDetail("BTCUSDT", 1000, undefined, request, resolvePerpImpactDepth("Bitget", "max"));
    expect(requestedLimits).toEqual([String(resolvePerpImpactDepth("Bitget")), "1000"]);
    expect(standard).not.toBeNull();
    expect(max).not.toBeNull();
  });
});

describe("Bitget canonical detail degradation", () => {
  const now = Date.UTC(2026, 6, 15);
  const row = {
    symbol: "BTC",
    rawSymbol: "BTCUSDT",
    marketKey: "BTCUSDT",
    fundingIntervalSeconds: 8 * 3600,
    bestBid: 99,
    bestAsk: 101,
  };

  test("preserves funding, settlement, and BBO when candles fail ordinarily", async () => {
    const candleFailure = new Error("candles unavailable");
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    const request: BitgetRequest = async (action) => {
      if (action === "history-fund-rate") {
        return { resultList: [{ fundingRateTimestamp: String(now - 1000), fundingRate: "0.001" }] };
      }
      throw candleFailure;
    };

    try {
      const detail = await fetchBitgetCanonicalDetail(row, "1d", { now, request });
      expect(detail.candles).toEqual([]);
      expect(detail.fundingHistory).toEqual([{ timestamp: now - 1000, fundingRate: 0.001 }]);
      expect(detail.lastSettlementRate).toBe(0.001);
      expect(detail.bidAskSpread).toBe(2);
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  test("still rejects candle aborts", async () => {
    const abort = new DOMException("caller canceled", "AbortError");
    const request: BitgetRequest = async (action) => {
      if (action === "history-fund-rate") return { resultList: [] };
      throw abort;
    };

    await expect(fetchBitgetCanonicalDetail(row, "1d", { now, request })).rejects.toBe(abort);
  });

  test("still rejects required funding history failures", async () => {
    const fundingFailure = new Error("funding unavailable");
    const request: BitgetRequest = async (action) => {
      if (action === "history-fund-rate") throw fundingFailure;
      return [];
    };

    await expect(fetchBitgetCanonicalDetail(row, "1d", { now, request })).rejects.toBe(fundingFailure);
  });
});

describe("Bitget scheduler", () => {
  test("unwraps successful direct API envelopes", async () => {
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json({ code: "00000", data: [{ symbol: "BTCUSDT" }] })) as typeof fetch,
    });
    await expect(scheduler.fetchJson("https://api.bitget.com/test")).resolves.toEqual([{ symbol: "BTCUSDT" }]);
  });

  test.each([
    ["25004", 429],
    ["25100", 404],
    ["25000", 503],
    ["25200", 400],
    ["unknown", 502],
  ])("maps failed business envelope %s to status %i", async (code, status) => {
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json({ code, msg: "diagnostic message", data: null })) as typeof fetch,
    });
    const failure = scheduler.fetchJson("https://api.bitget.com/test");
    await expect(failure).rejects.toMatchObject({ status, apiCode: code, apiMessage: "diagnostic message" });
    await expect(failure).rejects.toThrow(`API code ${code}: diagnostic message`);
  });

  test("keeps HTTP 429 precedence for unfamiliar business codes and retries with Retry-After", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const scheduler = createBitgetScheduler({
      now: () => 0,
      random: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json(
            { code: "unfamiliar", msg: "rate limited", data: null },
            { status: 429, headers: { "Retry-After": "2" } },
          );
        }
        return Response.json({ code: "00000", data: ["recovered"] });
      }) as typeof fetch,
    });

    await expect(scheduler.fetchJson("/limited-envelope")).resolves.toEqual(["recovered"]);
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });

  test("reports HTTP status 429 instead of mapping an unfamiliar business code", async () => {
    let calls = 0;
    const scheduler = createBitgetScheduler({
      now: () => 0,
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => {
        calls += 1;
        return Response.json(
          { code: "unfamiliar", msg: "rate limited", data: null },
          { status: 429, headers: { "Retry-After": "2" } },
        );
      }) as typeof fetch,
    });

    await expect(scheduler.fetchJson("/limited-envelope")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 2000,
      apiCode: "unfamiliar",
      apiMessage: "rate limited",
    });
    expect(calls).toBe(3);
  });

  test("rejects an HTTP error even when its Bitget envelope has success code 00000", async () => {
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json(
        { code: "00000", msg: "upstream failure", data: ["must not unwrap"] },
        { status: 400 },
      )) as typeof fetch,
    });

    const failure = scheduler.fetchJson("/http-error-success-code");
    await expect(failure).rejects.toMatchObject({ status: 400, apiCode: "00000", apiMessage: "upstream failure" });
    await expect(failure).rejects.toThrow("Bitget request failed (400; API code 00000: upstream failure)");
  });

  test("serializes requests, spaces starts by 250ms, and retries transient failures", async () => {
    let clock = 0;
    const starts: number[] = [];
    const sleeps: number[] = [];
    let attempts = 0;
    const scheduler = createBitgetScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      fetch: (async () => {
        starts.push(clock);
        attempts += 1;
        if (attempts === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
        return Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    const first = scheduler.fetchJson("/first");
    const second = scheduler.fetchJson("/second");
    await Promise.all([first, second]);
    expect(starts).toEqual([0, 2000, 2250]);
    expect(sleeps).toContain(2000);
  });

  test("does not retry caller aborts", async () => {
    let calls = 0;
    const controller = new AbortController();
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async (_url, init) => {
        calls += 1;
        controller.abort();
        throw init?.signal?.reason ?? new DOMException("aborted", "AbortError");
      }) as typeof fetch,
    });
    await expect(scheduler.fetchJson("/abort", { signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(calls).toBe(1);
  });

  test("removes an aborted request while it is queued", async () => {
    let releaseFirst!: () => void;
    let calls = 0;
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => {
        calls += 1;
        if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    const first = scheduler.fetchJson("/first");
    await Promise.resolve();
    const controller = new AbortController();
    const queued = scheduler.fetchJson("/queued", { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toHaveProperty("name", "AbortError");
    releaseFirst();
    await first;
    expect(calls).toBe(1);
  });

  test("runs queued interactive work before background work without preempting the in-flight request", async () => {
    let releaseFirst!: () => void;
    const started: string[] = [];
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async (url) => {
        started.push(String(url));
        if (url === "/current") await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    const current = scheduler.fetchJson("/current", {}, "background");
    await Promise.resolve();
    const background = scheduler.fetchJson("/background", {}, "background");
    const interactive = scheduler.fetchJson("/interactive", {}, "interactive");
    releaseFirst();
    await Promise.all([current, background, interactive]);
    expect(started).toEqual(["/current", "/interactive", "/background"]);
  });

  test("keeps FIFO order inside each priority", async () => {
    const started: string[] = [];
    const scheduler = createBitgetScheduler({ random: () => 0, sleep: async () => undefined, fetch: (async (url) => {
      started.push(String(url));
      return Response.json({ code: "00000", data: [] });
    }) as typeof fetch });
    await Promise.all([
      scheduler.fetchJson("/one", {}, "interactive"),
      scheduler.fetchJson("/two", {}, "interactive"),
      scheduler.fetchJson("/three", {}, "interactive"),
    ]);
    expect(started).toEqual(["/one", "/two", "/three"]);
  });

  test("lets interactive work overtake a background retry backoff", async () => {
    let clock = 0;
    let calls = 0;
    const starts: string[] = [];
    const scheduler = createBitgetScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { clock += ms; },
      fetch: (async (url) => {
        starts.push(String(url));
        calls += 1;
        return calls === 1
          ? new Response("{}", { status: 500 })
          : Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    const background = scheduler.fetchJson("/background", {}, "background");
    await Promise.resolve();
    const interactive = scheduler.fetchJson("/interactive", {}, "interactive");
    await Promise.all([background, interactive]);
    expect(starts).toEqual(["/background", "/interactive", "/background"]);
  });

  test("applies a 429 retry cooldown to queued interactive work", async () => {
    let clock = 0;
    let calls = 0;
    const starts: Array<[string, number]> = [];
    const scheduler = createBitgetScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { clock += ms; },
      fetch: (async (url) => {
        starts.push([String(url), clock]);
        calls += 1;
        return calls === 1
          ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } })
          : Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    const background = scheduler.fetchJson("/background", {}, "background");
    await Promise.resolve();
    const interactive = scheduler.fetchJson("/interactive", {}, "interactive");
    await Promise.all([background, interactive]);
    expect(starts[1]).toEqual(["/interactive", 2000]);
  });

  test("terminal 429 still cools down a later interactive request", async () => {
    let clock = 0;
    let backgroundAttempts = 0;
    const starts: Array<[string, number]> = [];
    const scheduler = createBitgetScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { clock += ms; },
      fetch: (async (url) => {
        starts.push([String(url), clock]);
        if (url === "/background") {
          backgroundAttempts += 1;
          return backgroundAttempts === 3
            ? new Response("{}", { status: 429, headers: { "Retry-After": "2" } })
            : new Response("{}", { status: 500 });
        }
        return Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    await expect(scheduler.fetchJson("/background", {}, "background")).rejects.toMatchObject({ status: 429 });
    await scheduler.fetchJson("/interactive", {}, "interactive");
    expect(starts.at(-1)).toEqual(["/interactive", 7000]);
  });



  test("aborts during retry backoff without another attempt", async () => {
    const controller = new AbortController();
    let calls = 0;
    const scheduler = createBitgetScheduler({
      random: () => 0,
      fetch: (async () => { calls += 1; return new Response("{}", { status: 429 }); }) as typeof fetch,
      sleep: async (_ms, signal) => {
        controller.abort();
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(scheduler.fetchJson("/retry", { signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(calls).toBe(1);
  });

  test("does not retry non-transient responses", async () => {
    let calls = 0;
    const scheduler = createBitgetScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => { calls += 1; return new Response("{}", { status: 400 }); }) as typeof fetch,
    });
    await expect(scheduler.fetchJson("/bad-request")).rejects.toHaveProperty("status", 400);
    expect(calls).toBe(1);
  });

  test("caps an oversized Retry-After at 60 seconds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const scheduler = createBitgetScheduler({
      now: () => 0,
      random: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
      fetch: (async () => {
        calls += 1;
        return calls === 1 ? new Response("{}", { status: 429, headers: { "Retry-After": "600" } }) : Response.json({ code: "00000", data: [] });
      }) as typeof fetch,
    });
    await scheduler.fetchJson("/limited");
    expect(sleeps[0]).toBe(60_000);
  });

  test("retries a client timeout at most three total attempts", async () => {
    let calls = 0;
    const scheduler = createBitgetScheduler({
      requestTimeoutMs: 1,
      random: () => 0,
      sleep: async () => undefined,
      fetch: ((_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      }) as typeof fetch,
    });
    await expect(scheduler.fetchJson("/timeout")).rejects.toHaveProperty("name", "TimeoutError");
    expect(calls).toBe(3);
  });
});

describe("Bitget direct API URLs", () => {
  test.each([
    ["instruments", "/api/v3/market/instruments"],
    ["tickers", "/api/v3/market/tickers"],
    ["current-fund-rate", "/api/v3/market/current-fund-rate"],
    ["history-fund-rate", "/api/v3/market/history-fund-rate"],
    ["candles", "/api/v3/market/candles"],
    ["history-candles", "/api/v3/market/history-candles"],
    ["orderbook", "/api/v3/market/orderbook"],
  ] as const)("maps %s to the direct V3 path", (action, path) => {
    const url = new URL(buildBitgetUrl(action));
    expect(url.origin).toBe("https://api.bitget.com");
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get("category")).toBe("USDT-FUTURES");
  });

  test("applies proxy defaults and lets caller params override them", () => {
    const history = new URL(buildBitgetUrl("history-fund-rate"));
    expect(Object.fromEntries(history.searchParams)).toMatchObject({ category: "USDT-FUTURES", cursor: "1", limit: "100" });

    const candles = new URL(buildBitgetUrl("candles", { type: "index", limit: "25" }));
    expect(Object.fromEntries(candles.searchParams)).toMatchObject({ category: "USDT-FUTURES", type: "index", limit: "25" });

    const historyCandles = new URL(buildBitgetUrl("history-candles"));
    expect(Object.fromEntries(historyCandles.searchParams)).toMatchObject({ category: "USDT-FUTURES", type: "market", limit: "100" });
    expect(new URL(buildBitgetUrl("orderbook")).searchParams.get("limit")).toBe("100");
  });

  test("encodes caller parameters and always fixes the futures category", () => {
    const url = new URL(buildBitgetUrl("tickers", { symbol: "BTC/USDT + test", category: "wrong" }));
    expect(url.searchParams.get("symbol")).toBe("BTC/USDT + test");
    expect(url.searchParams.get("category")).toBe("USDT-FUTURES");
    expect(url.toString()).toContain("symbol=BTC%2FUSDT+%2B+test");
  });
});
