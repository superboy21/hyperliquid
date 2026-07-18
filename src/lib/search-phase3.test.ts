import { describe, expect, test } from "bun:test";
import type { CanonicalFundingRateRow } from "./types";
import {
  batchFetchDetails,
  fetchDetailForSymbol,
  mapBitgetSearchRate,
  partitionProgressiveDetailRates,
  requireBitgetRawSymbol,
  type DetailResult,
  type SearchDetailDependencies,
  type SearchExchangeRate,
} from "./search";
import {
  fetchBitgetSearchCandles,
  fetchBitgetSearchChart,
  fetchBitgetSearchFundingHistory,
  selectSearchChartRequest,
  toAnnualizedRate,
  type SearchCandlePoint,
} from "./search-candles";
import { fetchSearchImpactSpread } from "./impact-price";

const RAW = "XBTMYSTERY7";

function rate(overrides: Partial<SearchExchangeRate> = {}): SearchExchangeRate {
  return {
    exchange: "Bitget",
    exchangeColor: "teal",
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

describe("Phase 3 Bitget exact symbol dispatch", () => {
  test("thin list mapping preserves a deliberately non-derivable raw symbol", () => {
    const canonical: CanonicalFundingRateRow = {
      exchange: "bitget",
      transportMode: "native",
      symbol: "BTC",
      rawSymbol: RAW,
      marketKey: RAW,
      fundingRate: 0.0001,
      markPrice: 100,
      indexPrice: 99,
      lastPrice: 100,
      change24h: 1,
      quoteVolume: 2,
      openInterest: 3,
      notionalValue: 300,
      fundingIntervalSeconds: 7200,
      assetCategory: "Crypto",
    };
    expect(mapBitgetSearchRate(canonical).rawSymbol).toBe(RAW);
  });

  test("detail dispatch passes exact rawSymbol and rejects a missing one before I/O", async () => {
    const seen: string[] = [];
    const fetchBitgetCanonicalDetail = async (
      row: Parameters<SearchDetailDependencies["fetchBitgetCanonicalDetail"]>[0],
    ) => {
      seen.push(row.rawSymbol);
      return {
        exchange: "bitget" as const,
        transportMode: "native" as const,
        symbol: row.symbol,
        rawSymbol: row.rawSymbol,
        marketKey: row.marketKey,
        fundingHistory: [],
        candles: [],
        lastSettlementRate: null,
        bidAskSpread: null,
      };
    };

    await fetchDetailForSymbol(rate(), undefined, { fetchBitgetCanonicalDetail });
    expect(seen).toEqual([RAW]);

    await expect(fetchDetailForSymbol(rate({ rawSymbol: undefined }), undefined, { fetchBitgetCanonicalDetail })).rejects.toThrow("rawSymbol");
    expect(seen).toEqual([RAW]);
    expect(() => requireBitgetRawSymbol(rate({ rawSymbol: undefined }))).toThrow("rawSymbol");
  });

  test("maps funding-only canonical detail without losing settlement or BBO metrics", async () => {
    const now = Date.now();
    const result = await fetchDetailForSymbol(rate(), undefined, {
      fetchBitgetCanonicalDetail: async (row) => ({
        exchange: "bitget",
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

  test("impact dispatch uses exact rawSymbol and fails before its fetcher", async () => {
    const calls: string[] = [];
    const fetcher = async (_exchange: string, rawSymbol: string) => {
      calls.push(rawSymbol);
      return 1;
    };
    await expect(fetchSearchImpactSpread(rate(), undefined, 1000, fetcher)).resolves.toBe(1);
    await expect(fetchSearchImpactSpread(rate({ rawSymbol: undefined }), undefined, 1000, fetcher)).rejects.toThrow("rawSymbol");
    expect(calls).toEqual([RAW]);
  });
});

describe("Phase 3 progressive detail lanes", () => {
  test("partitions generic, Lighter, and Bitget independently", () => {
    const generic = rate({ exchange: "Binance", rawSymbol: "BTCUSDT" });
    const lighter = rate({ exchange: "Lighter", rawSymbol: "BTC", marketId: 1 });
    const bitget = rate();
    const lanes = partitionProgressiveDetailRates([generic, lighter, bitget]);
    expect(lanes.generic).toEqual([generic]);
    expect(lanes.lighter).toEqual([lighter]);
    expect(lanes.bitget).toEqual([bitget]);
  });

  test("concurrency 1 never starts a queued Bitget detail after abort", async () => {
    const rows = [rate({ symbol: "A", rawSymbol: "RAWA" }), rate({ symbol: "B", rawSymbol: "RAWB" })];
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
    expect(started).toEqual(["RAWA"]);
  });
});

describe("Phase 3 Bitget chart flow", () => {
  const candles: SearchCandlePoint[] = [
    { openTime: 300, closeTime: 399, open: "1", high: "1", low: "1", close: "1", volume: "2", quoteVolume: "17" },
    { openTime: 100, closeTime: 199, open: "1", high: "1", low: "1", close: "1", volume: "3" },
  ];

  test("requires rawSymbol before chart I/O", async () => {
    let calls = 0;
    await expect(fetchBitgetSearchChart(rate({ rawSymbol: undefined }), "1h", undefined, {
      fetchCandles: async () => { calls += 1; return []; },
      fetchFundingHistory: async () => { calls += 1; return []; },
    })).rejects.toThrow("rawSymbol");
    expect(calls).toBe(0);
  });

  test("fetches candles first, then exact-symbol funding at the earliest candle", async () => {
    const actions: string[] = [];
    const result = await fetchBitgetSearchChart(rate({ fundingInterval: 2 * 3600 }), "1h", undefined, {
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
    const result = await fetchBitgetSearchChart(rate(), "1d", undefined, {
      fetchCandles: async () => [],
      fetchFundingHistory: async () => { fundingCalls += 1; return []; },
    });
    expect(result).toEqual({ candles: [], fundingRates: [] });
    expect(fundingCalls).toBe(0);
  });

  test.each([1, 2, 4, 8])("annualizes a %sh settlement interval dynamically", (hours) => {
    expect(toAnnualizedRate(0.001, hours * 3600)).toBeCloseTo(0.001 * (24 / hours) * 365);
  });

  test("single request selector emits one combo generation and dispatches both exact rows", async () => {
    const first = rate();
    const second = rate({ symbol: "ETH", rawSymbol: "ETHODD42" });
    const request = selectSearchChartRequest(null, first, second, "spread");
    expect(request).toEqual({ kind: "combo", first, second, mode: "spread" });
    expect(selectSearchChartRequest(null, first, null, "spread")).toBeNull();
    if (!request || request.kind !== "combo") throw new Error("Expected combo request");

    const symbols: string[] = [];
    const dependencies = {
      fetchCandles: async (rawSymbol: string) => { symbols.push(rawSymbol); return []; },
      fetchFundingHistory: async () => [],
    };
    await Promise.all([
      fetchBitgetSearchChart(request.first, "1h", undefined, dependencies),
      fetchBitgetSearchChart(request.second, "1h", undefined, dependencies),
    ]);
    expect(symbols).toEqual([RAW, "ETHODD42"]);
  });

  test("candle and funding helpers rethrow abort and non-abort failures", async () => {
    const failure = new Error("candle failed");
    const abort = new DOMException("aborted", "AbortError");
    await expect(fetchBitgetSearchCandles(RAW, "1h", undefined, async () => { throw failure; })).rejects.toBe(failure);
    await expect(fetchBitgetSearchCandles(RAW, "1h", undefined, async () => { throw abort; })).rejects.toBe(abort);
    await expect(fetchBitgetSearchFundingHistory(RAW, 123, undefined, async () => { throw failure; })).rejects.toBe(failure);
    await expect(fetchBitgetSearchFundingHistory(RAW, 123, undefined, async () => { throw abort; })).rejects.toBe(abort);
  });

  test("chart dispatch propagates abort and non-abort errors", async () => {
    const failure = new Error("chart failed");
    const abort = new DOMException("aborted", "AbortError");
    const unusedFunding = async () => [];
    await expect(fetchBitgetSearchChart(rate(), "1h", undefined, {
      fetchCandles: async () => { throw failure; },
      fetchFundingHistory: unusedFunding,
    })).rejects.toBe(failure);
    await expect(fetchBitgetSearchChart(rate(), "1h", undefined, {
      fetchCandles: async () => { throw abort; },
      fetchFundingHistory: unusedFunding,
    })).rejects.toBe(abort);
  });
});
