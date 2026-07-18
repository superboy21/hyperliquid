import { describe, expect, test } from "bun:test";
import {
  aggregateBitgetWeeklyCandles,
  computeBitgetBboSpread,
  computeBitgetImpactSpread,
  createBitgetScheduler,
  fetchBitgetCandles,
  fetchBitgetFundingHistory,
  fetchLatestBitgetSettlement,
  latestBitgetFundingPoint,
  normalizeBitgetCandles,
  normalizeBitgetFundingRows,
  normalizeBitgetOrderBook,
  parseBitgetList,
  selectBitgetDetailCandles,
  type BitgetRequest,
} from "./bitget";

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

  test("aggregates UTC Monday weeks and both volume units", () => {
    const monday = Date.UTC(2026, 6, 13);
    const weekly = aggregateBitgetWeeklyCandles([
      { openTime: monday + 86_400_000, closeTime: 0, open: "2", high: "5", low: "1", close: "4", volume: "3", quoteVolume: "12" },
      { openTime: monday, closeTime: 0, open: "1", high: "3", low: "0.5", close: "2", volume: "2", quoteVolume: "4" },
      { openTime: monday + 7 * 86_400_000, closeTime: 0, open: "4", high: "4", low: "4", close: "4", volume: "1", quoteVolume: "4" },
    ]);
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toMatchObject({ openTime: monday, open: "1", high: "5", low: "0.5", close: "4", volume: "5", quoteVolume: "16" });
  });

  test("keeps weekly official turnover missing unless every daily candle has a valid value", () => {
    const monday = Date.UTC(2026, 6, 13);
    const base = { closeTime: 0, open: "1", high: "2", low: "1", close: "2", volume: "3" };
    const weekly = aggregateBitgetWeeklyCandles([
      { ...base, openTime: monday, quoteVolume: "6" },
      { ...base, openTime: monday + 86_400_000 },
    ]);
    const invalid = aggregateBitgetWeeklyCandles([
      { ...base, openTime: monday, quoteVolume: "6" },
      { ...base, openTime: monday + 86_400_000, quoteVolume: "not-official" },
    ]);

    expect(weekly[0].volume).toBe("6");
    expect(weekly[0].quoteVolume).toBeUndefined();
    expect(invalid[0].quoteVolume).toBeUndefined();
  });

  test("enforces the 1m 1500-point/15-page cap and aligned 90-day windows", async () => {
    let calls = 0;
    const actions: string[] = [];
    const request: BitgetRequest = async (action, params) => {
      calls += 1;
      actions.push(action);
      expect(Number(params.endTime) % 60_000).toBe(0);
      expect(Number(params.endTime) - Number(params.startTime)).toBeLessThanOrEqual(90 * 86_400_000);
      const end = Number(params.endTime);
      return Array.from({ length: 100 }, (_, index) => [end - index * 60_000, "1", "1", "1", "1", "1", "1"]);
    };
    const rows = await fetchBitgetCandles("BTCUSDT", "1m", { endTime: 2_000_000_000_000, request });
    expect(calls).toBe(15);
    expect(rows).toHaveLength(1500);
    expect(actions).toEqual(["candles", ...Array.from({ length: 14 }, () => "history-candles")]);
  });

  test("continues after a complete 90-row 1d window and stops on a genuinely short page", async () => {
    const day = 86_400_000;
    const endTime = Date.UTC(2026, 6, 15);
    const actions: string[] = [];
    let historyCalls = 0;
    const request: BitgetRequest = async (action, params) => {
      actions.push(action);
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      const rows = Array.from({ length: Math.floor((end - start) / day) + 1 }, (_, index) => [end - index * day, "1", "1", "1", "1", "1"]);
      if (action !== "history-candles") return rows;
      historyCalls += 1;
      return historyCalls === 1 ? rows : rows.slice(0, 12);
    };

    const rows = await fetchBitgetCandles("BTCUSDT", "1d", { endTime, request });

    expect(actions).toEqual(["candles", "history-candles", "history-candles"]);
    expect(rows).toHaveLength(202);
    expect(rows.at(-1)?.openTime).toBe(endTime);
  });

  test("requests multiple daily history windows for 1w and aggregates beyond 27 weeks", async () => {
    const day = 86_400_000;
    const endTime = Date.UTC(2026, 6, 15);
    const startTime = endTime - 300 * day;
    const actions: string[] = [];
    const request: BitgetRequest = async (action, params) => {
      actions.push(action);
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      const rows = Array.from({ length: Math.floor((end - start) / day) + 1 }, (_, index) => [end - index * day, "1", "1", "1", "1", "1"]);
      return action === "candles" ? rows.slice(0, 100) : rows;
    };

    const rows = await fetchBitgetCandles("BTCUSDT", "1w", { startTime, endTime, request });

    expect(actions).toEqual(["candles", "history-candles", "history-candles", "history-candles"]);
    expect(rows.length).toBeGreaterThan(27);
    expect(rows.at(-1)?.openTime).toBe(Date.UTC(2026, 6, 13));
  });

  test("uses only the one recent request when it reaches the requested cutoff", async () => {
    const endTime = Math.floor(2_000_000_000_000 / 60_000) * 60_000;
    const startTime = endTime - 2 * 60_000;
    const calls: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BitgetRequest = async (action, params) => {
      calls.push({ action, params });
      return Array.from({ length: 3 }, (_, index) => [endTime - index * 60_000, "1", "1", "1", "1", "1", "1"]);
    };
    const rows = await fetchBitgetCandles("BTCUSDT", "1m", { startTime, endTime, request });
    expect(rows).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("candles");
    expect(Number(calls[0].params.startTime) % 60_000).toBe(0);
    expect(Number(calls[0].params.endTime) % 60_000).toBe(0);
  });

  test("dedupes the recent/history seam", async () => {
    const endTime = Math.floor(2_000_000_000_000 / 60_000) * 60_000;
    const request: BitgetRequest = async (action) => action === "candles"
      ? [[endTime, "2", "2", "2", "2", "2"], [endTime - 60_000, "1", "1", "1", "1", "1"]]
      : [[endTime - 60_000, "9", "9", "9", "9", "9"]];
    const rows = await fetchBitgetCandles("BTCUSDT", "1m", { endTime, request });
    expect(rows.map((row) => row.openTime)).toEqual([endTime - 60_000, endTime]);
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
});

describe("Bitget scheduler", () => {
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
        return Response.json([]);
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
        return Response.json([]);
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
        return calls === 1 ? new Response("{}", { status: 429, headers: { "Retry-After": "600" } }) : Response.json([]);
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
