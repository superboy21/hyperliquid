import { describe, expect, spyOn, test } from "bun:test";
import {
  buildBybitProxyUrl,
  buildBybitUrl,
  computeBybitBboSpread,
  computeBybitImpactSpread,
  computeBybitImpactSpreadDetail,
  createBybitCandleCache,
  createBybitFundingHistoryCache,
  createBybitInstrumentCache,
  createBybitRequest,
  createBybitScheduler,
  fetchBybitCandles,
  fetchBybitCanonicalDetail,
  fetchBybitFundingHistory,
  fetchBybitImpactSpread,
  fetchBybitImpactSpreadDetail,
  fetchLatestBybitSettlement,
  filterBybitInstruments,
  hydrateBybitLatestSettlementRates,
  isBybitProxyEligibleFailure,
  latestBybitFundingPoint,
  normalizeBybitCandles,
  normalizeBybitFundingHistory,
  normalizeBybitFundingRows,
  normalizeBybitOrderBook,
  normalizeBybitRpiOrderBook,
  parseBybitFundingIntervalHours,
  parseBybitFundingIntervalSeconds,
  parseBybitList,
  resolveBybitFundingHistoryWindowMs,
  resolveBybitImpactDepth,
  selectBybitDetailCandles,
  type BybitRequest,
} from "./bybit";
import { computeOrderBookImpactDetail, computeOrderBookImpactSpread, resolvePerpImpactDepth } from "../order-book-impact";

describe("Bybit successful-payload parsing and list normalization", () => {
  test("rejects envelopes and malformed successful payloads", () => {
    expect(() => parseBybitList({ retCode: 0, retMsg: "OK", result: { list: [] } })).toThrow();
    expect(() => parseBybitList({ nope: [] })).toThrow();
  });

  test("keeps exactly Trading LinearPerpetual USDT contracts", () => {
    const rows = filterBybitInstruments([
      { symbol: "BTCUSDT", baseCoin: "BTC", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT" },
      { symbol: "OFFUSDT", baseCoin: "OFF", contractType: "LinearPerpetual", status: "Closed", settleCoin: "USDT" },
      { symbol: "DELUSDT", baseCoin: "DEL", contractType: "Delivery", status: "Trading", settleCoin: "USDT" },
      { symbol: "OPUSDT", baseCoin: "OP", contractType: "Option", status: "Trading", settleCoin: "USDT" },
      { symbol: "BUSDUSDT", baseCoin: "BUSD", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDC" },
      { symbol: "NOCONTRACT", baseCoin: "NO", status: "Trading", settleCoin: "USDT" },
    ]);
    expect(rows.map((row) => row.symbol)).toEqual(["BTCUSDT"]);
  });

  test("maps ticker fields to canonical rows with the exact raw symbol and BBO", () => {
    const rows = normalizeBybitFundingRows(
      [{ symbol: "1000PEPEUSDT", baseCoin: "1000PEPE", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT", fundingInterval: "480" }],
      {
        list: [{
          symbol: "1000PEPEUSDT", lastPrice: "0.0102", indexPrice: "0.0101", markPrice: "0.01015",
          prevPrice24h: "0.01", price24hPcnt: "0.025", turnover24h: "123456", openInterest: "999999",
          openInterestValue: "10149", fundingRate: "0.0001", bid1Price: "0.0101", ask1Price: "0.0102",
        }],
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exchange: "bybit",
      transportMode: "native",
      symbol: "1000PEPE",
      rawSymbol: "1000PEPEUSDT",
      marketKey: "1000PEPEUSDT",
      fundingRate: 0.0001,
      markPrice: 0.01015,
      indexPrice: 0.0101,
      lastPrice: 0.0102,
      change24h: 2.5,
      quoteVolume: 123456,
      openInterest: 999999,
      notionalValue: 10149,
      fundingIntervalSeconds: 28800,
      assetCategory: "Crypto",
      bestBid: 0.0101,
      bestAsk: 0.0102,
    });
  });

  test("falls back to openInterestValue notional and prevPrice24h change", () => {
    const rows = normalizeBybitFundingRows(
      [{ symbol: "BTCUSDT", baseCoin: "BTC", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT" }],
      {
        list: [{
          symbol: "BTCUSDT", lastPrice: "110", prevPrice24h: "100", markPrice: "105",
          turnover24h: "1", openInterest: "2", fundingRate: "0",
        }],
      },
    );
    expect(rows[0].notionalValue).toBe(210);
    expect(rows[0].change24h).toBe(10);
  });
});

describe("Bybit funding interval normalization", () => {
  test("converts instrument minutes and ticker hours with validation", () => {
    expect(parseBybitFundingIntervalSeconds("60")).toBe(3600);
    expect(parseBybitFundingIntervalSeconds("240")).toBe(14400);
    expect(parseBybitFundingIntervalSeconds("480")).toBe(28800);
    expect(parseBybitFundingIntervalSeconds("30")).toBeNull();
    expect(parseBybitFundingIntervalSeconds("bad")).toBeNull();
    expect(parseBybitFundingIntervalHours("1")).toBe(3600);
    expect(parseBybitFundingIntervalHours("4")).toBe(14400);
    expect(parseBybitFundingIntervalHours("8")).toBe(28800);
    expect(parseBybitFundingIntervalHours("2")).toBeNull();
  });

  test("applies instrument minutes first, ticker hours as fallback, 8h default", () => {
    const instruments = [
      { symbol: "AUSDT", baseCoin: "A", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT", fundingInterval: "60" },
      { symbol: "BUSDT", baseCoin: "B", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT", fundingInterval: "480" },
      { symbol: "CUSDT", baseCoin: "C", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT", fundingInterval: "bad" },
      { symbol: "DUSDT", baseCoin: "D", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT" },
      { symbol: "EUSDT", baseCoin: "E", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT", fundingInterval: "30" },
    ];
    const tickers = {
      list: [
        { symbol: "AUSDT", markPrice: "10", fundingRate: "1" },
        { symbol: "BUSDT", markPrice: "10", fundingRate: "1", fundingIntervalHour: "1" },
        { symbol: "CUSDT", markPrice: "10", fundingRate: "1", fundingIntervalHour: "8" },
        { symbol: "DUSDT", markPrice: "10", fundingRate: "1", fundingIntervalHour: "bad" },
        { symbol: "EUSDT", markPrice: "10", fundingRate: "1", fundingIntervalHour: "1" },
      ],
    };
    const rows = normalizeBybitFundingRows(instruments, tickers);
    expect(rows.map((row) => row.fundingIntervalSeconds)).toEqual([3600, 28800, 28800, 28800, 3600]);
  });
});

describe("Bybit instrument metadata cache", () => {
  test("paginates with nextPageCursor, filters the universe, and honors the TTL", async () => {
    let clock = 0;
    const cache = createBybitInstrumentCache({ ttlMs: 3_600_000, now: () => clock });
    const calls: Array<Record<string, string>> = [];
    const request: BybitRequest = async (_action, params) => {
      calls.push(params);
      if (params.cursor === "page-2") {
        return {
          list: [{ symbol: "BTCUSDT", baseCoin: "BTC", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT" }],
          nextPageCursor: "",
        };
      }
      return {
        list: [
          ...Array.from({ length: 1000 }, (_, index) => ({
            symbol: `SYM${index}USDT`, baseCoin: `SYM${index}`,
            contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT",
          })),
          { symbol: "USDCUSDT", baseCoin: "USDC", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDC" },
        ],
        nextPageCursor: "page-2",
      };
    };

    const first = await cache.getInstruments(request);
    expect(first.size).toBe(1001);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ limit: "1000" });
    expect(calls[0].cursor).toBeUndefined();
    expect(calls[1]).toMatchObject({ limit: "1000", cursor: "page-2" });

    const second = await cache.getInstruments(request);
    expect(second).toBe(first);
    expect(calls).toHaveLength(2);

    clock += 3_600_000;
    const third = await cache.getInstruments(request);
    expect(third).not.toBe(first);
    expect(calls).toHaveLength(4);

    cache.clear();
    clock += 1;
    await cache.getInstruments(request);
    expect(calls).toHaveLength(6);
  });

  test("stops pagination when a page is not full", async () => {
    let calls = 0;
    const cache = createBybitInstrumentCache();
    const request: BybitRequest = async () => {
      calls += 1;
      return { list: [{ symbol: "BTCUSDT", contractType: "LinearPerpetual", status: "Trading", settleCoin: "USDT" }], nextPageCursor: "page-2" };
    };
    await cache.getInstruments(request);
    expect(calls).toBe(1);
  });

  test("reuses an in-flight load for concurrent callers", async () => {
    let calls = 0;
    let release!: () => void;
    const cache = createBybitInstrumentCache();
    const request: BybitRequest = async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return { list: [], nextPageCursor: "" };
    };
    const first = cache.getInstruments(request);
    const second = cache.getInstruments(request);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});

describe("Bybit funding history", () => {
  const hour = 3_600_000;
  const day = 86_400_000;

  test("walks 7-day windows backwards to a 30d cutoff, always pairing startTime/endTime", async () => {
    const endTime = Date.UTC(2026, 6, 15);
    const cutoffTime = endTime - 30 * day;
    const calls: Array<{ startTime: number; endTime: number; limit: string }> = [];
    const request: BybitRequest = async (_action, params) => {
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      expect(params.startTime).toBeDefined();
      expect(params.endTime).toBeDefined();
      expect(start).toBeLessThan(end);
      expect(end - start).toBe(7 * day);
      calls.push({ startTime: start, endTime: end, limit: params.limit });
      // 1h funding: 168 rows per 7-day window.
      return {
        list: Array.from({ length: 168 }, (_, index) => ({
          symbol: "BTCUSDT",
          fundingRateTimestamp: String(end - index * hour),
          fundingRate: String(index / 1000),
        })),
      };
    };

    const rows = await fetchBybitFundingHistory("BTCUSDT", { cutoffTime, endTime, request, cache: null });
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(calls[0]).toMatchObject({ limit: "200", endTime });
    expect(rows.every((row) => row.timestamp >= cutoffTime)).toBe(true);
    // 168 rows at 1h spacing cover 167h of a 7-day window; the next window
    // resumes at the oldest row minus one.
    for (let index = 1; index < calls.length; index += 1) {
      expect(calls[index].endTime).toBe(calls[index - 1].endTime - 167 * hour - 1);
    }
  });

  test("continues past short pages when a cutoff is set (8h funding)", async () => {
    const endTime = Date.UTC(2026, 6, 15);
    const cutoffTime = endTime - 20 * day;
    let calls = 0;
    const request: BybitRequest = async (_action, params) => {
      calls += 1;
      const start = Number(params.startTime);
      const end = Number(params.endTime);
      return {
        list: Array.from({ length: 21 }, (_, index) => ({
          symbol: "BTCUSDT",
          fundingRateTimestamp: String(end - index * 8 * hour),
          fundingRate: "0.0001",
        })),
      };
    };

    const rows = await fetchBybitFundingHistory("BTCUSDT", { cutoffTime, endTime, request, cache: null });
    expect(calls).toBe(3);
    expect(rows.length).toBe(62);
    expect(rows.every((row) => row.timestamp >= cutoffTime)).toBe(true);
  });

  test("stops after one window when no cutoff is requested", async () => {
    let calls = 0;
    const request: BybitRequest = async () => {
      calls += 1;
      return { list: [{ fundingRateTimestamp: "1000", fundingRate: "0.001" }] };
    };
    const rows = await fetchBybitFundingHistory("BTCUSDT", { request, cache: null });
    expect(calls).toBe(1);
    expect(rows).toEqual([{ timestamp: 1000, fundingRate: 0.001 }]);
  });

  test("dedupes the window seam and sorts ascending", async () => {
    let calls = 0;
    const request: BybitRequest = async () => {
      calls += 1;
      // Every window repeats the same two timestamps plus a new oldest one.
      return {
        list: [
          { fundingRateTimestamp: String(300 - calls), fundingRate: "0.3" },
          { fundingRateTimestamp: "200", fundingRate: "0.2" },
          { fundingRateTimestamp: "100", fundingRate: "0.1" },
        ],
      };
    };
    const rows = await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: 50, request, cache: null });
    expect(rows).toEqual([
      { timestamp: 100, fundingRate: 0.1 },
      { timestamp: 200, fundingRate: 0.2 },
      { timestamp: 298, fundingRate: 0.3 },
      { timestamp: 299, fundingRate: 0.3 },
    ]);
  });

  test("stops when a window makes no timestamp progress", async () => {
    let calls = 0;
    const request: BybitRequest = async () => {
      calls += 1;
      return { list: [{ fundingRateTimestamp: "100", fundingRate: "0.1" }] };
    };
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: 1, request, cache: null });
    expect(calls).toBe(2);
  });

  test("latest settlement helper issues exactly one limit=1 request", async () => {
    const calls: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BybitRequest = async (action, params) => {
      calls.push({ action, params });
      return { list: [{ fundingRateTimestamp: "1234", fundingRate: "0.001" }] };
    };
    await expect(fetchLatestBybitSettlement("BTCUSDT", { request, cache: null })).resolves.toEqual({ timestamp: 1234, fundingRate: 0.001 });
    expect(calls).toEqual([{
      action: "funding-history",
      params: { symbol: "BTCUSDT", startTime: expect.stringMatching(/^\d+$/), endTime: expect.stringMatching(/^\d+$/), limit: "1" },
    }]);
  });

  test("hydrates exact raw symbols with one limit=1 request each", async () => {
    const calls: string[] = [];
    const request: BybitRequest = async (_action, params) => {
      calls.push(params.symbol);
      return { list: [{ fundingRateTimestamp: "1234", fundingRate: "0.001" }] };
    };
    const result = await hydrateBybitLatestSettlementRates(["BTCUSDT", "ETHUSDT"], undefined, request, null);
    expect(Array.from(result.entries())).toEqual([["BTCUSDT", 0.001], ["ETHUSDT", 0.001]]);
    // Raw symbols pass through verbatim: never reconstructed as ${symbol}USDT.
    expect(calls).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(await hydrateBybitLatestSettlementRates([], undefined, request, null)).toEqual(new Map());
  });
});

describe("Bybit funding window sizing", () => {
  const day = 86_400_000;

  test("resolveBybitFundingHistoryWindowMs is the full-page span capped at 90 days", () => {
    expect(resolveBybitFundingHistoryWindowMs(8 * 3600)).toBe(5_760_000_000);
    expect(resolveBybitFundingHistoryWindowMs(4 * 3600)).toBe(2_880_000_000);
    expect(resolveBybitFundingHistoryWindowMs(3600)).toBe(720_000_000);
    // A full 200-row 1d-funding page spans 200 days; the 90-day cap keeps it
    // inside the proxy route's funding-history validation.
    expect(resolveBybitFundingHistoryWindowMs(24 * 3600)).toBe(90 * day);
    expect(resolveBybitFundingHistoryWindowMs(3600, 100)).toBe(360_000_000);
    expect(resolveBybitFundingHistoryWindowMs(3600, 0)).toBe(3_600_000);
    expect(resolveBybitFundingHistoryWindowMs(0)).toBe(60_000 * 200);
  });
});

describe("Bybit detail funding request counts", () => {
  const hour = 3_600_000;
  const day = 86_400_000;
  const now = Date.UTC(2026, 6, 15);

  async function detailCalls(fundingIntervalSeconds: number) {
    const calls: string[] = [];
    const request: BybitRequest = async (action, params) => {
      if (action === "funding-history") {
        const end = Number(params.endTime);
        calls.push("funding");
        return {
          list: Array.from({ length: 200 }, (_, index) => ({
            symbol: params.symbol,
            fundingRateTimestamp: String(end - index * fundingIntervalSeconds * 1000),
            fundingRate: "0.0001",
          })),
        };
      }
      const end = Number(params.end);
      const ms = params.interval === "240" ? 4 * hour : params.interval === "D" ? day : hour;
      calls.push("candles");
      return {
        list: Array.from({ length: Math.min(1000, Math.floor((end - Number(params.start)) / ms) + 1) }, (_, index) => [
          String(end - index * ms), "1", "1", "1", "1", "1",
        ]),
      };
    };
    const row = {
      symbol: "BTC",
      rawSymbol: "BTCUSDT",
      marketKey: "BTCUSDT",
      fundingIntervalSeconds,
      bestBid: 99,
      bestAsk: 101,
    };
    const detail = await fetchBybitCanonicalDetail(row, "4h", {
      now, request, fundingCache: null, candleCache: null,
    });
    return { detail, calls };
  }

  test("4h funding needs exactly one funding-history request for the 30-day window", async () => {
    const { calls, detail } = await detailCalls(4 * 3600);
    expect(calls).toEqual(["funding", "candles"]);
    expect(detail.fundingHistory.length).toBeGreaterThan(0);
  });

  test("8h funding needs exactly one funding-history request", async () => {
    const { calls } = await detailCalls(8 * 3600);
    expect(calls).toEqual(["funding", "candles"]);
  });

  test("1d funding needs exactly one funding-history request (90-day window cap)", async () => {
    const { calls } = await detailCalls(24 * 3600);
    expect(calls).toEqual(["funding", "candles"]);
  });

  test("1h funding needs four funding-history requests (8.3-day windows)", async () => {
    const { calls } = await detailCalls(3600);
    expect(calls.filter((call) => call === "funding")).toHaveLength(4);
    expect(calls.filter((call) => call === "candles")).toHaveLength(1);
  });
});

describe("Bybit funding-history cache", () => {
  const hour = 3_600_000;
  const day = 86_400_000;
  const endTime = Date.UTC(2026, 6, 15);

  function walkingRequest() {
    let calls = 0;
    const request: BybitRequest = async (_action, params) => {
      calls += 1;
      const end = Number(params.endTime);
      return {
        list: Array.from({ length: 168 }, (_, index) => ({
          symbol: params.symbol,
          fundingRateTimestamp: String(end - index * hour),
          fundingRate: "0.0001",
        })),
      };
    };
    return { request, calls: () => calls };
  }

  test("serves a repeated same-range request from cache without network I/O", async () => {
    const cache = createBybitFundingHistoryCache();
    const { request, calls } = walkingRequest();
    const options = { cutoffTime: endTime - 30 * day, endTime, request, cache };
    const first = await fetchBybitFundingHistory("BTCUSDT", options);
    expect(calls()).toBeGreaterThan(1); // walked multiple 7-day windows
    const before = calls();
    const second = await fetchBybitFundingHistory("BTCUSDT", options);
    expect(calls()).toBe(before);
    expect(second).toEqual(first);
  });

  test("refetches when the requested range extends before the cached coverage", async () => {
    const cache = createBybitFundingHistoryCache();
    const { request, calls } = walkingRequest();
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    const before = calls();
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 40 * day, endTime, request, cache });
    expect(calls()).toBe(before + 6); // six 7-day windows cover 40 days
  });

  test("expires entries after the TTL", async () => {
    let nowMs = 1_000_000;
    const cache = createBybitFundingHistoryCache({ now: () => nowMs, ttlMs: 300_000 });
    const { request, calls } = walkingRequest();
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    const before = calls();
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    expect(calls()).toBe(before); // fresh hit
    nowMs += 300_001;
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    expect(calls()).toBe(before + 5); // expired → full walk again (5 × 7d windows)
  });

  test("cache: null bypasses reads and writes", async () => {
    const cache = createBybitFundingHistoryCache();
    const { request, calls } = walkingRequest();
    const options = { cutoffTime: endTime - 30 * day, endTime, request, cache: null };
    await fetchBybitFundingHistory("BTCUSDT", options);
    const before = calls();
    await fetchBybitFundingHistory("BTCUSDT", options);
    expect(calls()).toBe(before + 5); // nothing was cached
    expect(cache.get("BTCUSDT", endTime - 30 * day, endTime)).toBeNull(); // and nothing was written
  });

  test("aborted fetches neither return nor poison the cache", async () => {
    const cache = createBybitFundingHistoryCache();
    const { request, calls } = walkingRequest();
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBybitFundingHistory("BTCUSDT", {
      cutoffTime: endTime - 30 * day, endTime, request, cache, signal: controller.signal,
    })).rejects.toThrow();
    expect(calls()).toBe(0);
    const before = calls();
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    expect(calls()).toBeGreaterThan(before); // the failed attempt left nothing cached
  });

  test("failed fetches never write to the cache", async () => {
    const cache = createBybitFundingHistoryCache();
    let fail = true;
    let calls = 0;
    const request: BybitRequest = async () => {
      calls += 1;
      if (fail) throw new Error("funding unavailable");
      return { list: [] };
    };
    await expect(fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache }))
      .rejects.toThrow("funding unavailable");
    expect(calls).toBe(1);
    fail = false;
    await fetchBybitFundingHistory("BTCUSDT", { cutoffTime: endTime - 30 * day, endTime, request, cache });
    expect(calls).toBe(2); // nothing cached from the failure → the retry hits the network
  });

  test("detail-first fills the shared cache so immediate repeats are request-free", async () => {
    const fundingCache = createBybitFundingHistoryCache();
    const candleCache = createBybitCandleCache();
    let calls = 0;
    const request: BybitRequest = async (action, params) => {
      calls += 1;
      if (action === "funding-history") {
        const end = Number(params.endTime);
        return {
          list: Array.from({ length: 200 }, (_, index) => ({
            fundingRateTimestamp: String(end - index * 8 * hour),
            fundingRate: "0.0001",
          })),
        };
      }
      const end = Number(params.end);
      return {
        list: Array.from({ length: Math.min(1000, Math.floor((end - Number(params.start)) / (4 * hour)) + 1) }, (_, index) => [
          String(end - index * 4 * hour), "1", "1", "1", "1", "1",
        ]),
      };
    };
    const row = {
      symbol: "BTC",
      rawSymbol: "BTCUSDT",
      marketKey: "BTCUSDT",
      fundingIntervalSeconds: 8 * 3600,
      bestBid: 99,
      bestAsk: 101,
    };
    const detail = await fetchBybitCanonicalDetail(row, "4h", { now: endTime, request, fundingCache, candleCache });
    expect(detail.fundingHistory.length).toBeGreaterThan(0);
    expect(calls).toBe(2); // one funding window + one candle page

    // A latest-settlement read at the same endTime is served from the cache.
    const latest = await fetchLatestBybitSettlement("BTCUSDT", { request, cache: fundingCache, endTime });
    expect(calls).toBe(2);
    expect(latest).toEqual({ timestamp: endTime, fundingRate: 0.0001 });

    // A repeated detail call is request-free while the caches are fresh.
    const again = await fetchBybitCanonicalDetail(row, "4h", { now: endTime, request, fundingCache, candleCache });
    expect(calls).toBe(2);
    expect(again.fundingHistory).toEqual(detail.fundingHistory);
    expect(again.candles).toEqual(detail.candles);

    // A hydration asking for a much later endTime refetches instead of serving
    // stale data: the cached coverage no longer reaches within one TTL.
    await hydrateBybitLatestSettlementRates(["BTCUSDT"], undefined, request, fundingCache);
    expect(calls).toBe(3);
  });
});

describe("Bybit candle cache", () => {
  const minute = 60_000;
  const hour = 3_600_000;
  const endTime = Math.floor(Date.UTC(2026, 6, 15) / minute) * minute;

  function capFillingRequest() {
    let calls = 0;
    const request: BybitRequest = async (_action, params) => {
      calls += 1;
      const end = Number(params.end);
      const ms = params.interval === "1" ? minute : params.interval === "240" ? 4 * hour : hour;
      return {
        list: Array.from({ length: 1000 }, (_, index) => [String(end - index * ms), "1", "1", "1", "1", "1"]),
      };
    };
    return { request, calls: () => calls };
  }

  test("keys by interval and raw symbol, so different keys never collide", async () => {
    const cache = createBybitCandleCache();
    const { request, calls } = capFillingRequest();
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(1); // second same-key call is served from cache
    await fetchBybitCandles("BTCUSDT", "1d", { endTime, request, cache });
    expect(calls()).toBe(2); // a different interval is its own entry
    await fetchBybitCandles("ETHUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(3); // a different symbol is its own entry
  });

  test("serves narrower range requests from a wider cached range", async () => {
    const cache = createBybitCandleCache();
    const { request, calls } = capFillingRequest();
    await fetchBybitCandles("BTCUSDT", "1m", { startTime: endTime - 90 * minute, endTime, request, cache });
    const before = calls();
    const rows = await fetchBybitCandles("BTCUSDT", "1m", { startTime: endTime - 60 * minute, endTime, request, cache });
    expect(calls()).toBe(before); // fully contained → cache hit
    expect(rows).toHaveLength(61);
    expect(rows[0].openTime).toBe(endTime - 60 * minute);
    expect(rows.at(-1)?.openTime).toBe(endTime);
  });

  test("refetches when the requested end moves beyond one interval of cached coverage", async () => {
    const cache = createBybitCandleCache();
    const { request, calls } = capFillingRequest();
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(1);
    // One minute later: within the one-interval tolerance → cache hit.
    await fetchBybitCandles("BTCUSDT", "1m", { endTime: endTime + minute, request, cache });
    expect(calls()).toBe(1);
    // Two minutes later: stale by more than one interval → refetch.
    await fetchBybitCandles("BTCUSDT", "1m", { endTime: endTime + 2 * minute, request, cache });
    expect(calls()).toBe(2);
  });

  test("expires candle entries after the TTL", async () => {
    let nowMs = 1_000_000;
    const cache = createBybitCandleCache({ now: () => nowMs, ttlMs: 60_000 });
    const { request, calls } = capFillingRequest();
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    const before = calls();
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(before); // fresh hit
    nowMs += 60_001;
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(before + 1); // expired → network again
  });

  test("aborted candle fetches leave no stale cache entry", async () => {
    const cache = createBybitCandleCache();
    const { request, calls } = capFillingRequest();
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache, signal: controller.signal })).rejects.toThrow();
    expect(calls()).toBe(0);
    await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache });
    expect(calls()).toBe(1);
  });
});

describe("Bybit candles and books", () => {
  test("maps the V5 tuple with turnover and interval close time", () => {
    const rows = normalizeBybitCandles({
      list: [["1000000", "1", "3", "0.5", "2", "7", "14"]],
    }, "1h");
    expect(rows[0]).toMatchObject({ openTime: 1_000_000, closeTime: 4_599_999, volume: "7", quoteVolume: "14" });
    expect(rows[0].open).toBe("1");
  });

  test("paginates 1m windows backwards and honors an unaligned cutoff", async () => {
    const endTime = Math.floor(2_000_000_000_000 / 60_000) * 60_000;
    const cutoffTime = endTime - 40 * 3_600_000;
    const calls: Array<{ start: number; end: number }> = [];
    const request: BybitRequest = async (_action, params) => {
      const start = Number(params.start);
      const end = Number(params.end);
      expect(start).toBeLessThan(end);
      expect(start % 60_000).toBe(0);
      expect(end % 60_000).toBe(0);
      // Full windows span 999 rows; the final window is clamped by the cutoff.
      expect(end - start).toBeLessThanOrEqual(999 * 60_000);
      calls.push({ start, end });
      return {
        list: Array.from({ length: 1000 }, (_, index) => [String(end - index * 60_000), "1", "1", "1", "1", "1", "1"]),
      };
    };

    const rows = await fetchBybitCandles("BTCUSDT", "1m", { startTime: cutoffTime, endTime, request, cache: null });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < calls.length; index += 1) {
      expect(calls[index].end).toBe(calls[index - 1].start - 60_000);
    }
    expect(rows.every((row) => row.openTime >= cutoffTime)).toBe(true);
    expect(rows.every((row, index, all) => index === 0 || row.openTime > all[index - 1].openTime)).toBe(true);
  });

  test("1d detail range fits in a single request up to the cutoff", async () => {
    const day = 86_400_000;
    const endTime = Date.UTC(2026, 6, 15);
    const startTime = endTime - 30 * day;
    let calls = 0;
    const request: BybitRequest = async (_action, params) => {
      calls += 1;
      const start = Number(params.start);
      const end = Number(params.end);
      return {
        list: Array.from({ length: Math.floor((end - start) / day) + 1 }, (_, index) => [String(end - index * day), "1", "1", "1", "1", "1"]),
      };
    };

    const rows = await fetchBybitCandles("BTCUSDT", "1d", { startTime, endTime, request, cache: null });
    expect(calls).toBe(1);
    expect(rows).toHaveLength(31);
    expect(rows.at(-1)?.openTime).toBe(endTime);
    expect(rows.at(0)?.openTime).toBe(startTime);
  });

  test("dedupes the window seam", async () => {
    const endTime = Math.floor(2_000_000_000_000 / 60_000) * 60_000;
    const request: BybitRequest = async (_action, params) => {
      const end = Number(params.end);
      return { list: [[String(end), "2", "2", "2", "2", "2"], [String(end - 60_000), "1", "1", "1", "1", "1"]] };
    };
    const rows = await fetchBybitCandles("BTCUSDT", "1m", { endTime, request, cache: null });
    expect(rows.map((row) => row.openTime)).toEqual([endTime - 60_000, endTime]);
  });

  test("normalizes book quantities as base quantities without a multiplier", () => {
    expect(normalizeBybitOrderBook({ s: "BTCUSDT", b: [["100", "3"]], a: [["101", "2.5"]] })).toEqual({
      bids: [{ price: 100, baseQty: 3 }], asks: [{ price: 101, baseQty: 2.5 }],
    });
  });

  test("merges non-RPI and RPI quantities in the RPI order book", () => {
    expect(normalizeBybitRpiOrderBook({ s: "BTCUSDT", b: [["100", "3", "1"]], a: [["101", "2.5", "0.5"]] })).toEqual({
      bids: [{ price: 100, baseQty: 4 }], asks: [{ price: 101, baseQty: 3 }],
    });
    expect(normalizeBybitRpiOrderBook({ b: [], a: [] })).toEqual({ bids: [], asks: [] });
  });

  test("requests the RPI order book action and clamps depth to 50 levels", async () => {
    const seen: Array<{ action: string; params: Record<string, string> }> = [];
    const request: BybitRequest = async (action, params) => {
      seen.push({ action, params });
      return {
        s: "BTCUSDT",
        b: [["100", "3", "1"], ["99", "10", "0"], ["98", "10", "0"]],
        a: [["101", "2.5", "0.5"], ["102", "10", "0"], ["103", "10", "0"]],
      };
    };
    const detail = await fetchBybitImpactSpreadDetail("BTCUSDT", 1000, undefined, request, resolveBybitImpactDepth("max"), "rpi");
    expect(seen).toHaveLength(1);
    expect(seen[0].action).toBe("rpi-orderbook");
    expect(seen[0].params.limit).toBe("50"); // max 500 → RPI cap 50
    expect(detail !== null && typeof detail === "object").toBe(true);
    if (detail !== null && typeof detail === "object") {
      expect(detail.bidPrice).toBeLessThan(detail.askPrice);
      // 含 RPI 的 bid 一档为 4（3+1），若按普通盘口只算 3 则首档深度不足 1000 名义。
      expect(detail.spread).toBeGreaterThan(0);
    }
  });

  test("computes BBO and base-quantity impact spreads", () => {
    expect(computeBybitBboSpread(99, 101)).toBe(2);
    expect(computeBybitImpactSpread({ bids: [{ price: 99, baseQty: 20 }], asks: [{ price: 101, baseQty: 20 }] }, 1000)).toBeCloseTo(2, 10);
    expect(computeBybitImpactSpread({ bids: [{ price: 99, baseQty: 1 }], asks: [{ price: 101, baseQty: 20 }] }, 1000)).toBe("insufficient");
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
    expect(computeBybitImpactSpread(book, 1000)).toBe(computeOrderBookImpactSpread(sharedBook, 1000));
    expect(computeBybitImpactSpreadDetail(book, 1000)).toEqual(computeOrderBookImpactDetail(sharedBook, 1000));
  });

  test("uses the local Bybit perpetual impact depth by default and propagates overrides", async () => {
    const requestedLimits: string[] = [];
    const request: BybitRequest = async (_action, params) => {
      requestedLimits.push(params.limit);
      return { bids: [["99", "20"]], asks: [["101", "20"]] };
    };
    await fetchBybitImpactSpread("BTCUSDT", 1000, undefined, request);
    await fetchBybitImpactSpread("BTCUSDT", 1000, undefined, request, resolveBybitImpactDepth("max"));
    expect(requestedLimits).toEqual([String(resolveBybitImpactDepth()), String(resolveBybitImpactDepth("max"))]);
    expect(resolveBybitImpactDepth("max")).toBe(500);
    // The adapter resolves depths from the shared Bybit perpetual registry.
    expect(resolveBybitImpactDepth()).toBe(resolvePerpImpactDepth("Bybit"));
    expect(resolveBybitImpactDepth("max")).toBe(resolvePerpImpactDepth("Bybit", "max"));
  });

  test("detail fetch mirrors the spread fetch with the same request overloads", async () => {
    const requestedLimits: string[] = [];
    const request: BybitRequest = async (_action, params) => {
      requestedLimits.push(params.limit);
      return { bids: [["99", "20"]], asks: [["101", "20"]] };
    };
    const standard = await fetchBybitImpactSpreadDetail("BTCUSDT", 1000, undefined, request);
    const max = await fetchBybitImpactSpreadDetail("BTCUSDT", 1000, undefined, request, resolveBybitImpactDepth("max"));
    expect(requestedLimits).toEqual([String(resolveBybitImpactDepth()), String(resolveBybitImpactDepth("max"))]);
    expect(standard).not.toBeNull();
    expect(max).not.toBeNull();
  });
});

describe("Bybit canonical detail degradation", () => {
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
    const request: BybitRequest = async (action) => {
      if (action === "funding-history") {
        return { list: [{ fundingRateTimestamp: String(now - 1000), fundingRate: "0.001" }] };
      }
      throw candleFailure;
    };

    try {
      const detail = await fetchBybitCanonicalDetail(row, "1d", { now, request, fundingCache: null, candleCache: null });
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
    const request: BybitRequest = async (action) => {
      if (action === "funding-history") return { list: [] };
      throw abort;
    };

    await expect(fetchBybitCanonicalDetail(row, "1d", { now, request, fundingCache: null, candleCache: null })).rejects.toBe(abort);
  });

  test("still rejects required funding history failures", async () => {
    const fundingFailure = new Error("funding unavailable");
    const request: BybitRequest = async (action) => {
      if (action === "funding-history") throw fundingFailure;
      return { list: [] };
    };

    await expect(fetchBybitCanonicalDetail(row, "1d", { now, request, fundingCache: null, candleCache: null })).rejects.toBe(fundingFailure);
  });

  test("selects the 30-day candle budget per interval", () => {
    const candles = Array.from({ length: 800 }, (_, index) => ({
      openTime: index, closeTime: index, open: "1", high: "1", low: "1", close: "1", volume: "1",
    }));
    expect(selectBybitDetailCandles(candles, "1d")).toHaveLength(30);
    expect(selectBybitDetailCandles(candles, "4h")).toHaveLength(180);
    expect(selectBybitDetailCandles(candles, "1h")).toHaveLength(720);
  });
});

describe("Bybit direct-to-proxy transport fallback", () => {
  function failureFromFetch(fetchImpl: typeof fetch, requestTimeoutMs = 15_000): Promise<unknown> {
    const scheduler = createBybitScheduler({
      requestTimeoutMs,
      random: () => 0,
      sleep: async () => undefined,
      fetch: fetchImpl,
    });
    return scheduler.fetchJson("https://api.bybit.com/test");
  }

  test("builds same-origin proxy URLs with exactly the allowlisted params", () => {
    const url = buildBybitProxyUrl("kline", {
      symbol: "BTCUSDT", interval: "60", start: "1", end: "2", limit: "1000", category: "linear",
    });
    expect(url).toBe("/api/bybit?action=kline&symbol=BTCUSDT&interval=60&start=1&end=2&limit=1000");
    expect(buildBybitProxyUrl("tickers")).toBe("/api/bybit?action=tickers");
  });

  test("classifies transport failures as proxy-eligible", async () => {
    const network = await failureFromFetch((async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)
      .catch((error) => error);
    expect(isBybitProxyEligibleFailure(network)).toBe(true);

    const timeout = await failureFromFetch((( _url, init) => new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }),
    )) as typeof fetch, 1).catch((error) => error);
    expect(isBybitProxyEligibleFailure(timeout)).toBe(true);

    const geo403 = await failureFromFetch((async () => Response.json(
      { retCode: "10003", retMsg: "blocked", result: null },
      { status: 403 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(geo403)).toBe(true);

    const geo451 = await failureFromFetch((async () => Response.json(
      { retCode: "10003", retMsg: "blocked", result: null },
      { status: 451 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(geo451)).toBe(true);

    const transient503 = await failureFromFetch((async () => Response.json(
      { retCode: "10006", retMsg: "busy", result: null },
      { status: 503 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(transient503)).toBe(true);
  });

  test("never classifies validation, business, or abort failures as proxy-eligible", async () => {
    const invalid400 = await failureFromFetch((async () => Response.json(
      { retCode: "10001", retMsg: "invalid param", result: null },
      { status: 400 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(invalid400)).toBe(false);

    const notFound404 = await failureFromFetch((async () => Response.json(
      { retCode: "10009", retMsg: "not found", result: null },
      { status: 404 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(notFound404)).toBe(false);

    const rateLimited429 = await failureFromFetch((async () => Response.json(
      { retCode: "10004", retMsg: "rate limited", result: null },
      { status: 429 },
    )) as typeof fetch).catch((error) => error);
    expect(isBybitProxyEligibleFailure(rateLimited429)).toBe(false);

    const malformed = await failureFromFetch((async () => Response.json({ nope: true })) as typeof fetch)
      .catch((error) => error);
    expect(isBybitProxyEligibleFailure(malformed)).toBe(false);

    const controller = new AbortController();
    controller.abort();
    expect(isBybitProxyEligibleFailure(controller.signal.reason)).toBe(false);
  });

  test("falls back to the proxy only after a direct transport failure", async () => {
    const urls: string[] = [];
    const fakeScheduler = {
      fetchJson: async (url: string) => {
        urls.push(url);
        if (urls.length === 1) throw new TypeError("Failed to fetch");
        return { list: [{ symbol: "BTCUSDT" }] };
      },
    };
    const request = createBybitRequest(fakeScheduler);
    const result = await request("kline", { symbol: "BTCUSDT", interval: "60", start: "1", end: "2" }, undefined);

    expect(result).toEqual({ list: [{ symbol: "BTCUSDT" }] });
    expect(urls).toHaveLength(2);
    const direct = new URL(urls[0]);
    expect(direct.origin).toBe("https://api.bybit.com");
    expect(direct.pathname).toBe("/v5/market/kline");
    expect(Object.fromEntries(direct.searchParams)).toMatchObject({
      category: "linear", interval: "60", symbol: "BTCUSDT", start: "1", end: "2", limit: "1000",
    });
    expect(urls[1]).toBe("/api/bybit?action=kline&symbol=BTCUSDT&interval=60&start=1&end=2");
  });

  test("never routes a business failure through the proxy", async () => {
    let calls = 0;
    const business = await failureFromFetch((async () => Response.json(
      { retCode: "10001", retMsg: "invalid param", result: null },
      { status: 400 },
    )) as typeof fetch).catch((error) => error);
    const fakeScheduler = {
      fetchJson: async () => { calls += 1; throw business; },
    };
    const request = createBybitRequest(fakeScheduler);
    await expect(request("tickers", {}, undefined)).rejects.toBe(business);
    expect(calls).toBe(1);
  });

  test("does not fall back after a caller abort", async () => {
    let calls = 0;
    const fakeScheduler = {
      fetchJson: async () => { calls += 1; throw new DOMException("aborted", "AbortError"); },
    };
    const request = createBybitRequest(fakeScheduler);
    await expect(request("tickers", {}, undefined)).rejects.toHaveProperty("name", "AbortError");
    expect(calls).toBe(1);
  });
});

describe("Bybit scheduler", () => {
  test("unwraps successful direct API envelopes", async () => {
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json({ retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT" }] } })) as typeof fetch,
    });
    await expect(scheduler.fetchJson("https://api.bybit.com/test")).resolves.toEqual({ list: [{ symbol: "BTCUSDT" }] });
  });

  test.each([
    ["10004", 429],
    ["10001", 400],
    ["10002", 401],
    ["10003", 403],
    ["10009", 404],
    ["unknown", 502],
  ])("maps failed business envelope %s to status %i", async (code, status) => {
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json({ retCode: code, retMsg: "diagnostic message", result: null })) as typeof fetch,
    });
    const failure = scheduler.fetchJson("https://api.bybit.com/test");
    await expect(failure).rejects.toMatchObject({ status, apiCode: code, apiMessage: "diagnostic message" });
    await expect(failure).rejects.toThrow(`API code ${code}: diagnostic message`);
  });

  test("keeps HTTP 429 precedence for unfamiliar business codes and retries with Retry-After", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const scheduler = createBybitScheduler({
      now: () => 0,
      random: () => 0,
      sleep: async (ms) => { sleeps.push(ms); },
      fetch: (async () => {
        calls += 1;
        if (calls === 1) {
          return Response.json(
            { retCode: "unfamiliar", retMsg: "rate limited", result: null },
            { status: 429, headers: { "Retry-After": "2" } },
          );
        }
        return Response.json({ retCode: 0, retMsg: "OK", result: ["recovered"] });
      }) as typeof fetch,
    });

    await expect(scheduler.fetchJson("/limited-envelope")).resolves.toEqual(["recovered"]);
    expect(calls).toBe(2);
    expect(sleeps[0]).toBe(2000);
  });

  test("rejects an HTTP error even when its Bybit envelope has success retCode 0", async () => {
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => Response.json(
        { retCode: 0, retMsg: "upstream failure", result: ["must not unwrap"] },
        { status: 400 },
      )) as typeof fetch,
    });

    const failure = scheduler.fetchJson("/http-error-success-code");
    await expect(failure).rejects.toMatchObject({ status: 400, apiCode: "0", apiMessage: "upstream failure" });
    await expect(failure).rejects.toThrow("Bybit request failed (400; API code 0: upstream failure)");
  });

  test("rejects malformed envelopes without retrying", async () => {
    let calls = 0;
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => {
        calls += 1;
        return Response.json({ nope: true });
      }) as typeof fetch,
    });
    await expect(scheduler.fetchJson("/malformed")).rejects.toThrow("Malformed Bybit response envelope");
    expect(calls).toBe(1);
  });

  test("runs up to 2 requests concurrently, spaces starts by 100ms, and retries transient failures", async () => {
    let clock = 0;
    const starts: number[] = [];
    const sleeps: number[] = [];
    let attempts = 0;
    const scheduler = createBybitScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      fetch: (async () => {
        starts.push(clock);
        attempts += 1;
        if (attempts === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
        return Response.json({ retCode: 0, retMsg: "OK", result: [] });
      }) as typeof fetch,
    });
    const first = scheduler.fetchJson("/first");
    const second = scheduler.fetchJson("/second");
    await Promise.all([first, second]);
    expect(starts).toEqual([0, 100, 2100]);
    expect(sleeps).toContain(100);
    expect(sleeps).toContain(2000);
  });

  test("never exceeds two concurrent in-flight requests", async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return Response.json({ retCode: 0, retMsg: "OK", result: [] });
      }) as typeof fetch,
    });
    const pending = Array.from({ length: 6 }, (_, i) => scheduler.fetchJson(`/req-${i}`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);
    release();
    await Promise.all(pending);
    expect(calls).toBe(6);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  test("spaces request starts at least 100ms apart with two concurrent slots", async () => {
    let clock = 0;
    const starts: number[] = [];
    const scheduler = createBybitScheduler({
      now: () => clock,
      random: () => 0,
      sleep: async (ms) => { clock += ms; },
      fetch: (async () => {
        starts.push(clock);
        return Response.json({ retCode: 0, retMsg: "OK", result: [] });
      }) as typeof fetch,
    });
    await Promise.all([
      scheduler.fetchJson("/a"),
      scheduler.fetchJson("/b"),
      scheduler.fetchJson("/c"),
      scheduler.fetchJson("/d"),
    ]);
    expect(starts).toEqual([0, 100, 200, 300]);
  });

  test("removes an aborted queued request without disturbing the rest of the queue", async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const controller = new AbortController();
    const scheduler = createBybitScheduler({
      random: () => 0,
      sleep: async () => undefined,
      fetch: (async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return Response.json({ retCode: 0, retMsg: "OK", result: [] });
      }) as typeof fetch,
    });
    const first = scheduler.fetchJson("/first");
    const second = scheduler.fetchJson("/second");
    const queued = scheduler.fetchJson("/queued", { signal: controller.signal });
    const fourth = scheduler.fetchJson("/fourth");
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(queued).rejects.toHaveProperty("name", "AbortError");
    release();
    await Promise.all([first, second, fourth]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  test("does not retry caller aborts", async () => {
    let calls = 0;
    const controller = new AbortController();
    const scheduler = createBybitScheduler({
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

  test("retries a client timeout at most three total attempts", async () => {
    let calls = 0;
    const scheduler = createBybitScheduler({
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

describe("Bybit direct API URLs", () => {
  test.each([
    ["instruments", "/v5/market/instruments-info"],
    ["tickers", "/v5/market/tickers"],
    ["funding-history", "/v5/market/funding/history"],
    ["kline", "/v5/market/kline"],
    ["orderbook", "/v5/market/orderbook"],
  ] as const)("maps %s to the direct V5 path", (action, path) => {
    const url = new URL(buildBybitUrl(action));
    expect(url.origin).toBe("https://api.bybit.com");
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get("category")).toBe("linear");
  });

  test("applies proxy defaults and lets caller params override them", () => {
    const instruments = new URL(buildBybitUrl("instruments"));
    expect(Object.fromEntries(instruments.searchParams)).toMatchObject({ category: "linear", status: "Trading", limit: "1000" });

    const history = new URL(buildBybitUrl("funding-history"));
    expect(Object.fromEntries(history.searchParams)).toMatchObject({ category: "linear", limit: "200" });

    const kline = new URL(buildBybitUrl("kline", { interval: "60", limit: "25" }));
    expect(Object.fromEntries(kline.searchParams)).toMatchObject({ category: "linear", interval: "60", limit: "25" });

    expect(new URL(buildBybitUrl("orderbook")).searchParams.get("limit")).toBe("100");
  });

  test("encodes caller parameters and always fixes the linear category", () => {
    const url = new URL(buildBybitUrl("tickers", { category: "spot" }));
    expect(url.searchParams.get("category")).toBe("linear");

    const kline = new URL(buildBybitUrl("kline", { symbol: "BTC/USDT + test" }));
    expect(kline.searchParams.get("symbol")).toBe("BTC/USDT + test");
    expect(kline.toString()).toContain("symbol=BTC%2FUSDT+%2B+test");
  });
});

describe("Bybit funding history fixtures", () => {
  test("normalizes history entries with dedupe and ascending order", () => {
    const rows = normalizeBybitFundingHistory({
      list: [
        { symbol: "BTCUSDT", fundingRateTimestamp: "200", fundingRate: "0.002" },
        { symbol: "BTCUSDT", fundingRateTimestamp: "100", fundingRate: "0.001" },
        { symbol: "BTCUSDT", fundingRateTimestamp: "200", fundingRate: "0.009" },
        { symbol: "BTCUSDT", fundingRateTimestamp: "0", fundingRate: "0.5" },
        { symbol: "BTCUSDT", fundingRateTimestamp: "300", fundingRate: "bad" },
      ],
    });
    expect(rows).toEqual([
      { timestamp: 100, fundingRate: 0.001 },
      { timestamp: 200, fundingRate: 0.002 },
    ]);
    expect(latestBybitFundingPoint(rows)?.timestamp).toBe(200);
  });
});
