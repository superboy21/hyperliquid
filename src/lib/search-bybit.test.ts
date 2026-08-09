import { describe, expect, test } from "bun:test";
import type { CanonicalFundingRateRow } from "./types";
import {
  batchFetchDetails,
  fetchDetailForSymbol,
  mapBybitSearchRate,
  partitionProgressiveDetailRates,
  requireBybitRawSymbol,
  type DetailResult,
  type SearchDetailDependencies,
  type SearchExchangeRate,
} from "./search";
import {
  fetchBybitSearchCandles,
  fetchBybitSearchChart,
  fetchBybitSearchFundingHistory,
  BYBIT_SEARCH_FUNDING_HORIZON_MS,
  type SearchCandlePoint,
} from "./search-candles";
import { fetchBybitCandles, resolveBybitFundingHistoryWindowMs, type BybitRequest } from "./adapters/bybit";

const RAW = "BTCUSDT";

function rate(overrides: Partial<SearchExchangeRate> = {}): SearchExchangeRate {
  return {
    exchange: "Bybit",
    exchangeColor: "orange",
    symbol: "BTC",
    rawSymbol: RAW,
    fundingRate: 0.0001,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 100,
    fundingInterval: 8 * 3600,
    assetCategory: "Crypto",
    ...overrides,
  };
}

const emptyDetail: DetailResult = {
  lastSettlementRate: null,
  avgFundingRate2d: null,
  historicalVolatility: null,
  bidAskSpread: null,
  avgFundingRate7d: null,
  avgFundingRate30d: null,
};

function canonicalRow(overrides: Partial<CanonicalFundingRateRow> = {}): CanonicalFundingRateRow {
  return {
    exchange: "bybit",
    transportMode: "native",
    symbol: "BTC",
    rawSymbol: RAW,
    marketKey: RAW,
    fundingRate: 0.0001,
    markPrice: 100,
    indexPrice: 99,
    lastPrice: 101,
    change24h: 1,
    quoteVolume: 2,
    openInterest: 3,
    notionalValue: 300,
    fundingIntervalSeconds: 4800,
    assetCategory: "Crypto",
    ...overrides,
  };
}

describe("Bybit list rates", () => {
  test("list mapping preserves the exact raw symbol, base-coin display, and BBO", () => {
    const mapped = mapBybitSearchRate(canonicalRow({ bestBid: 100, bestAsk: 102 }));
    expect(mapped.exchange).toBe("Bybit");
    expect(mapped.exchangeColor).toBe("orange");
    expect(mapped.symbol).toBe("BTC");
    expect(mapped.rawSymbol).toBe(RAW);
    expect(mapped.rawSymbol).not.toBe("BTCUSDTUSDT");
    expect(mapped.fundingInterval).toBe(4800);
    expect(mapped.markPrice).toBe(100);
    expect(mapped.indexPrice).toBe(99);
    expect(mapped.lastPrice).toBe(101);
    expect(mapped.change24h).toBe(1);
    expect(mapped.quoteVolume).toBe(2);
    expect(mapped.openInterest).toBe(3);
    expect(mapped.notionalValue).toBe(300);
    expect(mapped.bestBid).toBe(100);
    expect(mapped.bestAsk).toBe(102);
  });

  test("sparse canonical rows map with null/undefined defaults", () => {
    const mapped = mapBybitSearchRate(canonicalRow({ indexPrice: null, bestBid: undefined, bestAsk: null }));
    expect(mapped.indexPrice).toBeNull();
    expect(mapped.bestBid).toBeUndefined();
    expect(mapped.bestAsk).toBeUndefined();
  });
});

describe("Bybit exact symbol detail dispatch", () => {
  test("detail dispatch passes the raw symbol verbatim and rejects a missing one before I/O", async () => {
    const seen: string[] = [];
    const fetchBybitCanonicalDetail: SearchDetailDependencies["fetchBybitCanonicalDetail"] = async (row) => {
      seen.push(row.rawSymbol);
      return {
        exchange: "bybit",
        transportMode: "native",
        symbol: row.symbol,
        rawSymbol: row.rawSymbol,
        marketKey: row.marketKey,
        fundingHistory: [],
        candles: [],
        lastSettlementRate: null,
        bidAskSpread: null,
      };
    };

    await fetchDetailForSymbol(rate(), undefined, { fetchBybitCanonicalDetail });
    expect(seen).toEqual([RAW]);

    await expect(fetchDetailForSymbol(rate({ rawSymbol: undefined }), undefined, { fetchBybitCanonicalDetail })).rejects.toThrow("rawSymbol");
    expect(seen).toEqual([RAW]);
    expect(() => requireBybitRawSymbol(rate({ rawSymbol: undefined }))).toThrow("rawSymbol");
  });

  test("maps funding-only canonical detail without losing settlement or BBO metrics", async () => {
    const now = Date.now();
    const result = await fetchDetailForSymbol(rate(), undefined, {
      fetchBybitCanonicalDetail: async (row) => ({
        exchange: "bybit",
        transportMode: "native",
        symbol: row.symbol,
        rawSymbol: row.rawSymbol,
        marketKey: row.marketKey,
        fundingHistory: [{ timestamp: now - 3_600_000, fundingRate: 0.001 }],
        candles: [],
        lastSettlementRate: 0.001,
        bidAskSpread: 2,
      }),
    });

    expect(result).toEqual({
      lastSettlementRate: 0.001,
      avgFundingRate2d: 0.001,
      historicalVolatility: null,
      bidAskSpread: 2,
      avgFundingRate7d: 0.001,
      avgFundingRate30d: 0.001,
    });
  });
});

describe("Bybit progressive detail lane", () => {
  test("partitions Bybit into its own lane alongside the existing ones", () => {
    const generic = rate({ exchange: "Binance", rawSymbol: "BTCUSDT" });
    const lighter = rate({ exchange: "Lighter", rawSymbol: "BTC", marketId: 1 });
    const bitget = rate({ exchange: "Bitget", rawSymbol: "XBTMYSTERY7" });
    const okx = rate({ exchange: "OKX", rawSymbol: "BTC-USDT-SWAP" });
    const bybit = rate();
    const lanes = partitionProgressiveDetailRates([generic, lighter, bitget, okx, bybit]);
    expect(lanes.generic).toEqual([generic]);
    expect(lanes.lighter).toEqual([lighter]);
    expect(lanes.bitget).toEqual([bitget]);
    expect(lanes.okx).toEqual([okx]);
    expect(lanes.bybit).toEqual([bybit]);
  });

  test("concurrency 1 never starts a queued Bybit detail after abort", async () => {
    const rows = [rate({ symbol: "A", rawSymbol: "BTCUSDT" }), rate({ symbol: "B", rawSymbol: "ETHUSDT" })];
    const controller = new AbortController();
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    let release!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { release = resolve; });
    const fetchDetail = async (item: SearchExchangeRate) => {
      started.push(item.rawSymbol!);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (started.length === 1) await firstBlocked;
      active -= 1;
      return emptyDetail;
    };

    const run = batchFetchDetails(rows, () => undefined, controller.signal, 1, 0, fetchDetail);
    while (started.length === 0) await Promise.resolve();
    controller.abort();
    release();
    await run;

    expect(maxActive).toBe(1);
    expect(started).toEqual([RAW]);
  });
});

describe("Bybit candle normalization", () => {
  test("normalizes reverse-chronological rows to ascending order and dedupes", async () => {
    const rows: SearchCandlePoint[] = [
      { openTime: 300, closeTime: 399, open: "3", high: "3", low: "3", close: "3", volume: "1" },
      { openTime: 100, closeTime: 199, open: "1", high: "1", low: "1", close: "1", volume: "1" },
      { openTime: 200, closeTime: 299, open: "2", high: "2", low: "2", close: "2", volume: "1" },
      { openTime: 100, closeTime: 199, open: "1", high: "1", low: "1", close: "1", volume: "1" },
    ];
    const candles = await fetchBybitSearchCandles(RAW, "1h", undefined, async () => rows);
    expect(candles.map((candle) => candle.openTime)).toEqual([100, 200, 300]);
  });

  test.each([
    ["1m", "1"],
    ["5m", "5"],
    ["1h", "60"],
    ["4h", "240"],
    ["1d", "D"],
    ["1w", "W"],
  ] as const)("relays app interval %s unchanged and maps it to V5 %s through the real adapter", async (appInterval, v5Interval) => {
    const captured: string[] = [];
    const request: BybitRequest = async (_action, params) => {
      captured.push(params.interval);
      const end = Number(params.end);
      return { list: [[String(end), "1", "1", "1", "1", "1"]] };
    };

    const candles = await fetchBybitSearchCandles(
      RAW,
      appInterval,
      undefined,
      (rawSymbol, interval, options) => fetchBybitCandles(rawSymbol, interval, { ...options, request }),
    );

    expect(captured).toEqual([v5Interval]);
    expect(candles).toHaveLength(1);
  });
});

describe("Bybit chart flow", () => {
  const candles: SearchCandlePoint[] = [
    { openTime: 300, closeTime: 399, open: "1", high: "1", low: "1", close: "1", volume: "2", quoteVolume: "17" },
    { openTime: 100, closeTime: 199, open: "1", high: "1", low: "1", close: "1", volume: "3" },
  ];

  test("requires rawSymbol before chart I/O", async () => {
    let calls = 0;
    await expect(fetchBybitSearchChart(rate({ rawSymbol: undefined }), "1h", undefined, {
      fetchCandles: async () => { calls += 1; return []; },
      fetchFundingHistory: async () => { calls += 1; return []; },
    })).rejects.toThrow("rawSymbol");
    expect(calls).toBe(0);
  });

  test("fetches candles first, then exact-symbol funding at the earliest candle", async () => {
    const actions: string[] = [];
    const result = await fetchBybitSearchChart(rate({ fundingInterval: 2 * 3600 }), "1h", undefined, {
      fetchCandles: async (rawSymbol) => {
        actions.push(`candles:${rawSymbol}`);
        return candles;
      },
      fetchFundingHistory: async (rawSymbol, cutoff) => {
        actions.push(`funding:${rawSymbol}:${cutoff}`);
        return [{ time: 100, rate: 0.001 }];
      },
    });
    expect(actions).toEqual([`candles:${RAW}`, `funding:${RAW}:100`]);
    expect(result.candles[0].quoteVolume).toBe("17");
    expect(result.candles[1].quoteVolume).toBeUndefined();
    expect(result.fundingRates.find((point) => point.time === 100)?.annualizedRate).toBeCloseTo(0.001 * 12 * 365);
  });

  test("skips funding entirely for a legitimate empty candle response", async () => {
    let fundingCalls = 0;
    const result = await fetchBybitSearchChart(rate(), "1d", undefined, {
      fetchCandles: async () => [],
      fetchFundingHistory: async () => { fundingCalls += 1; return []; },
    });
    expect(result).toEqual({ candles: [], fundingRates: [] });
    expect(fundingCalls).toBe(0);
  });

  test("aggregation distinguishes an observed zero funding from a missing bucket", async () => {
    const hour = 3_600_000;
    const result = await fetchBybitSearchChart(rate({ fundingInterval: 3600 }), "1h", undefined, {
      fetchCandles: async () => [
        { openTime: 100, closeTime: 100 + hour - 1, open: "1", high: "1", low: "1", close: "1", volume: "1" },
        { openTime: 100 + hour, closeTime: 100 + 2 * hour - 1, open: "1", high: "1", low: "1", close: "1", volume: "1" },
      ],
      fetchFundingHistory: async () => [{ time: 100, rate: 0 }],
    });
    expect(result.fundingRates[0]).toEqual({ time: 100, rate: 0, annualizedRate: 0, sampleCount: 1 });
    expect(result.fundingRates[1]).toEqual({ time: 100 + hour, rate: 0, annualizedRate: 0, sampleCount: 0 });
  });

  test("funding history wrapper maps timestamps and relays the exact cutoff", async () => {
    const cutoffs: number[] = [];
    const history = await fetchBybitSearchFundingHistory(RAW, 1234, undefined, async (rawSymbol, options) => {
      cutoffs.push(options.cutoffTime!);
      expect(rawSymbol).toBe(RAW);
      return [{ timestamp: 100, fundingRate: 0.002 }];
    });
    expect(cutoffs).toEqual([1234]);
    expect(history).toEqual([{ time: 100, rate: 0.002 }]);
  });

  test("candle and funding helpers rethrow abort and non-abort failures", async () => {
    const failure = new Error("candle failed");
    const abort = new DOMException("aborted", "AbortError");
    await expect(fetchBybitSearchCandles(RAW, "1h", undefined, async () => { throw failure; })).rejects.toBe(failure);
    await expect(fetchBybitSearchCandles(RAW, "1h", undefined, async () => { throw abort; })).rejects.toBe(abort);
    await expect(fetchBybitSearchFundingHistory(RAW, 123, undefined, async () => { throw failure; })).rejects.toBe(failure);
    await expect(fetchBybitSearchFundingHistory(RAW, 123, undefined, async () => { throw abort; })).rejects.toBe(abort);
  });

  test("chart dispatch propagates abort and non-abort errors", async () => {
    const failure = new Error("chart failed");
    const abort = new DOMException("aborted", "AbortError");
    const unusedFunding = async () => [];
    await expect(fetchBybitSearchChart(rate(), "1h", undefined, {
      fetchCandles: async () => { throw failure; },
      fetchFundingHistory: unusedFunding,
    })).rejects.toBe(failure);
    await expect(fetchBybitSearchChart(rate(), "1h", undefined, {
      fetchCandles: async () => { throw abort; },
      fetchFundingHistory: unusedFunding,
    })).rejects.toBe(abort);
  });
});

describe("Bybit search chart funding overlay horizon", () => {
  const DAY_MS = 86_400_000;
  // Fixed epochs keep the cutoff math deterministic (no Date.now dependency).
  const NEWEST_OPEN = 5_000_000_000_000;

  function dailyCandles(count: number): SearchCandlePoint[] {
    return Array.from({ length: count }, (_, index) => {
      const openTime = NEWEST_OPEN - (count - 1 - index) * DAY_MS;
      return { openTime, closeTime: openTime + DAY_MS - 1, open: "1", high: "1", low: "1", close: "1", volume: "1" };
    });
  }

  test("caps the funding cutoff at the newest candle minus 90 days, not the oldest candle", async () => {
    const candles = dailyCandles(120); // oldest candle is 119 days back
    const captured: Array<{ cutoff: number; windowMs?: number; maxPages?: number }> = [];
    await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1d", undefined, {
      fetchCandles: async () => candles,
      fetchFundingHistory: async (rawSymbol, cutoff, options) => {
        expect(rawSymbol).toBe(RAW);
        captured.push({ cutoff, windowMs: options.windowMs, maxPages: options.maxPages });
        return [];
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].cutoff).toBe(NEWEST_OPEN - 90 * DAY_MS);
    expect(captured[0].cutoff).not.toBe(NEWEST_OPEN - 119 * DAY_MS);
  });

  test("derives interval-aware windowMs and bounded maxPages for the 90-day overlay", async () => {
    const candles = dailyCandles(5);
    const captured: Array<{ windowMs?: number; maxPages?: number }> = [];
    const fetchFundingHistory = async (_rawSymbol: string, _cutoff: number, options: { windowMs?: number; maxPages?: number }) => {
      captured.push({ windowMs: options.windowMs, maxPages: options.maxPages });
      return [];
    };

    await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1d", undefined, { fetchCandles: async () => candles, fetchFundingHistory });
    await fetchBybitSearchChart(rate({ fundingInterval: 4 * 3600 }), "1d", undefined, { fetchCandles: async () => candles, fetchFundingHistory });
    await fetchBybitSearchChart(rate({ fundingInterval: 3600 }), "1d", undefined, { fetchCandles: async () => candles, fetchFundingHistory });

    expect(captured).toEqual([
      { windowMs: 5_760_000_000, maxPages: 2 }, // 8h × 200 rows = 66.7 days → ceil(90 / 66.7) = 2
      { windowMs: 2_880_000_000, maxPages: 3 }, // 4h × 200 rows = 33.3 days → ceil(90 / 33.3) = 3
      { windowMs: 720_000_000, maxPages: 11 },  // 1h × 200 rows = 8.3 days → ceil(90 / 8.3) = 11
    ]);
  });

  test("resolveBybitFundingHistoryWindowMs is the full-page settlement span at the given interval", () => {
    expect(resolveBybitFundingHistoryWindowMs(8 * 3600)).toBe(5_760_000_000);
    expect(resolveBybitFundingHistoryWindowMs(4 * 3600)).toBe(2_880_000_000);
    expect(resolveBybitFundingHistoryWindowMs(3600)).toBe(720_000_000);
    expect(resolveBybitFundingHistoryWindowMs(3600, 100)).toBe(360_000_000);
    expect(resolveBybitFundingHistoryWindowMs(3600, 0)).toBe(3_600_000); // pageSize clamps to >= 1
    expect(resolveBybitFundingHistoryWindowMs(0)).toBe(60_000 * 200); // interval clamps to >= 1 minute
  });

  test("preserves the full 1000-candle range while the funding overlay stays capped at 90 days", async () => {
    const candles = dailyCandles(1000); // oldest candle is 999 days back
    let fundingCutoff: number | null = null;
    const result = await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1d", undefined, {
      fetchCandles: async () => candles,
      fetchFundingHistory: async (_rawSymbol, cutoff) => {
        fundingCutoff = cutoff;
        return [{ time: NEWEST_OPEN - 89 * DAY_MS, rate: 0.0001 }];
      },
    });
    expect(result.candles).toHaveLength(1000);
    expect(result.candles[0].openTime).toBe(NEWEST_OPEN - 999 * DAY_MS);
    expect(fundingCutoff).toBe(NEWEST_OPEN - 90 * DAY_MS);
    expect(result.fundingRates).toHaveLength(1000);
  });

  test("funding older than the 90-day horizon is unavailable, never fabricated", async () => {
    const candles = dailyCandles(120);
    const horizonStart = NEWEST_OPEN - 90 * DAY_MS;
    const result = await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1d", undefined, {
      fetchCandles: async () => candles,
      // Only one observed settlement inside the horizon; nothing older is returned.
      fetchFundingHistory: async () => [{ time: horizonStart + 60_000, rate: 0.0001 }],
    });

    expect(result.fundingRates).toHaveLength(120);
    const sampled = result.fundingRates.filter((point) => point.sampleCount === 1);
    const unavailable = result.fundingRates.filter((point) => point.sampleCount === 0);
    expect(sampled).toEqual([{ time: horizonStart, rate: 0.0001, annualizedRate: 0.0001 * 3 * 365, sampleCount: 1 }]);
    expect(unavailable).toHaveLength(119);
    // The oldest bucket is a numeric-zero gap, not a fabricated rate.
    expect(unavailable[0]).toEqual({ time: NEWEST_OPEN - 119 * DAY_MS, rate: 0, annualizedRate: 0, sampleCount: 0 });
  });

  test("funding within the horizon still reaches buckets when candles predate the 90-day overlay", async () => {
    const candles = dailyCandles(120);
    const horizonStart = NEWEST_OPEN - 90 * DAY_MS;
    const result = await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1d", undefined, {
      fetchCandles: async () => candles,
      fetchFundingHistory: async () => [
        { time: horizonStart + 60_000, rate: 0 },
        { time: NEWEST_OPEN - 89 * DAY_MS + 60_000, rate: 0.001 },
      ],
    });
    // Observed zero (sampleCount 1) stays distinct from unavailable (sampleCount 0).
    expect(result.fundingRates.find((point) => point.time === horizonStart)).toEqual({
      time: horizonStart,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 1,
    });
    expect(result.fundingRates.find((point) => point.time === NEWEST_OPEN - 89 * DAY_MS)?.sampleCount).toBe(1);
    expect(result.fundingRates.filter((point) => point.sampleCount === 0)).toHaveLength(118);
  });

  test("window propagation is capped by the 90-day horizon for 1w and 1d intervals", async () => {
    const candles = dailyCandles(120);
    const captured: Array<{ cutoff: number; maxPages?: number }> = [];
    const fetchFundingHistory = async (_rawSymbol: string, cutoff: number, options: { maxPages?: number }) => {
      captured.push({ cutoff, maxPages: options.maxPages });
      return [];
    };
    await fetchBybitSearchChart(rate({ fundingInterval: 8 * 3600 }), "1w", undefined, { fetchCandles: async () => candles, fetchFundingHistory });
    expect(captured[0]).toEqual({ cutoff: NEWEST_OPEN - 90 * DAY_MS, maxPages: 2 });
    expect(BYBIT_SEARCH_FUNDING_HORIZON_MS).toBe(90 * DAY_MS);
  });
});
