import { afterEach, describe, expect, mock, test } from "bun:test";
import { aggregateDailyCandlesToWeekly, aggregateFundingRatesToCandles, fetchGateCandles, fetchOkxCandles, fetchSearchCandles, normalizeLighterSearchFundingRow, normalizeOkxSearchCandle, parseSearchFundingRate, resolvePerpCandleSource, toOkxBar } from "./search-candles";
import { clearGateMultiplierCache } from "./gateio";
import { createCandleSourceProvenance } from "./candle-provenance";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  clearGateMultiplierCache();
});

test("Hyperliquid Search derives funding bounds from candles and deduplicates overlays", async () => {
  const now = 1_700_000_000_000;
  const hour = 60 * 60 * 1000;
  Date.now = () => now;
  const fundingBodies: Record<string, unknown>[] = [];
  globalThis.fetch = mock(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "candleSnapshot") {
      return Response.json([{
        t: now - 3 * hour,
        T: now - 2 * hour,
        s: "BTC",
        i: "1h",
        o: "100",
        h: "101",
        l: "99",
        c: "100",
        v: "1",
        n: 1,
      }, {
        t: now - 2 * hour,
        T: now - hour,
        s: "BTC",
        i: "1h",
        o: "100",
        h: "101",
        l: "99",
        c: "100",
        v: "1",
        n: 1,
      }]);
    }
    if (body.type === "fundingHistory") {
      fundingBodies.push(body);
      return Response.json([{
        time: now - 3 * hour,
        coin: "BTC",
        fundingRate: "0.001",
        markPrice: "99.5",
      }, {
        time: now - 3 * hour + 30 * 60 * 1000,
        coin: "BTC",
        fundingRate: "0.0005",
        // Upstream "0" placeholder is not a real settlement price.
        markPrice: "0",
      }, {
        time: now - 2 * hour,
        coin: "BTC",
        fundingRate: "0.002",
        markPrice: "100.5",
      }, {
        time: now - 2 * hour,
        coin: "BTC",
        fundingRate: "0.002",
        markPrice: "100.5",
      }, {
        time: now - hour,
        coin: "BTC",
        fundingRate: "0.004",
      }]);
    }
    return Response.json([]);
  }) as typeof fetch;

  const result = await fetchSearchCandles({
    exchange: "Hyperliquid",
    exchangeColor: "blue",
    symbol: "BTC",
    rawSymbol: "BTC",
    fundingRate: 0,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 100,
    fundingInterval: 3600,
    assetCategory: "Crypto",
  }, "1h");

  expect(fundingBodies).toEqual([expect.objectContaining({
    startTime: now - 3 * hour,
    endTime: now - hour - 1,
  })]);
  expect(result.fundingRates).toEqual([{
    time: now - 3 * hour,
    rate: 0.0015,
    annualizedRate: 0.0015 * 365 * 24,
    sampleCount: 2,
    // Two settlements in one bucket keep their own times; the 0 mark is absent.
    settlements: [
      { time: now - 3 * hour, rate: 0.001, markPrice: 99.5 },
      { time: now - 3 * hour + 30 * 60 * 1000, rate: 0.0005 },
    ],
  }, {
    time: now - 2 * hour,
    rate: 0.002,
    annualizedRate: 0.002 * 365 * 24,
    sampleCount: 1,
    // A legal upstream mark is preserved; the duplicate timestamp keeps one row.
    settlements: [{ time: now - 2 * hour, rate: 0.002, markPrice: 100.5 }],
  }]);
  // No synthetic 0 mark is ever produced from an upstream placeholder.
  expect(result.fundingRates.flatMap((point) => point.settlements ?? []))
    .not.toContainEqual(expect.objectContaining({ markPrice: 0 }));
});

test("Gate search candles prefer the direct URL before the proxy", async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (url) => {
    const text = String(url);
    urls.push(text);
    if (text.includes("candlesticks")) {
      return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10, sum: "15" }]);
    }
    if (text.includes("tickers")) return Response.json([{ contract: "BTC_USDT", quanto_multiplier: "0.01" }]);
    if (text.includes("contracts")) return Response.json([{ name: "BTC_USDT", funding_interval: 28_800 }]);
    return Response.json([]);
  }) as typeof fetch;

  await expect(fetchGateCandles("BTC", "1h")).resolves.toMatchObject([{ openTime: 1000, close: "1.5", volume: "0.1", quoteVolume: "15" }]);
  expect(urls).toContain("https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1h&limit=2000");
  expect(urls.some((url) => url.includes("/tickers") || url.includes("/contracts"))).toBe(true);
});

test("Gate search candles fail closed without a valid multiplier", async () => {
  globalThis.fetch = mock(async (url) => {
    const text = String(url);
    if (text.includes("candlesticks")) return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10, sum: "15" }]);
    if (text.includes("tickers")) return Response.json([{ contract: "ETH_USDT", quanto_multiplier: "" }]);
    if (text.includes("contracts")) return Response.json([{ name: "ETH_USDT", funding_interval: 28_800 }]);
    return Response.json([]);
  }) as typeof fetch;

  await expect(fetchGateCandles("ETH", "1h")).resolves.toEqual([]);
});

test("OKX perpetual candle fields keep contract, base, and quote volume semantics", () => {
  expect(normalizeOkxSearchCandle([1_000, "1", "2", "0.5", "1.5", "10", "25", "37.5", "1"], 60_000))
    .toEqual({ openTime: 1_000, closeTime: 61_000, open: "1", high: "2", low: "0.5", close: "1.5", volume: "25", quoteVolume: "37.5" });
  expect(normalizeOkxSearchCandle([1_000, "1", "2", "0.5", "1.5", "10", "25"], 60_000).quoteVolume).toBeUndefined();
  expect(normalizeOkxSearchCandle([1_000, "1", "2", "0.5", "1.5", "10"], 60_000).volume).toBe("0");
});

test("OKX 1m pagination and other intervals use the same volume mapping", async () => {
  globalThis.fetch = mock(async () => Response.json({
    data: [[1_000, "1", "2", "0.5", "1.5", "10", "25", "37.5", "1"]],
  })) as typeof fetch;

  await expect(fetchOkxCandles("BTC-USDT-SWAP", "1m")).resolves.toMatchObject([{ volume: "25", quoteVolume: "37.5" }]);
  await expect(fetchOkxCandles("BTC-USDT-SWAP", "1h")).resolves.toMatchObject([{ volume: "25", quoteVolume: "37.5" }]);
});

test("Lighter search funding rejects missing/blank rates but retains zero", () => {
  const cutoff = 1_700_000_000_000 - 60 * 60 * 1000;
  expect(parseSearchFundingRate(undefined)).toBeNull();
  expect(parseSearchFundingRate("")).toBeNull();
  expect(parseSearchFundingRate("not-a-number")).toBeNull();
  expect(normalizeLighterSearchFundingRow({ timestamp: (cutoff + 1) / 1000, rate: "" }, cutoff)).toBeNull();
  expect(normalizeLighterSearchFundingRow({ timestamp: (cutoff + 2) / 1000 }, cutoff)).toBeNull();
  expect(normalizeLighterSearchFundingRow({ timestamp: (cutoff + 3) / 1000, rate: "0" }, cutoff)).toEqual({
    time: cutoff + 3,
    rate: 0,
  });
});

test("Binance search funding keeps real history marks and never fabricates a missing one", async () => {
  const HOUR = 60 * 60 * 1000;
  const now = 1_700_000_000_000;
  const bucket = now - 8 * HOUR;
  Date.now = () => now;

  globalThis.fetch = mock(async (url) => {
    const text = String(url);
    if (text.includes("/klines?")) {
      // Real Binance kline envelope: [openTime, o, h, l, c, v, closeTime, ...].
      return Response.json([[
        bucket, "35000.0", "35100.0", "34900.0", "35050.0", "12.5", bucket + HOUR - 1,
        "437999.0", 100, "6.0", "210000.0", "0",
      ]]);
    }
    if (text.includes("/fundingRate?")) {
      // Real Binance fundingRate rows, including a zero markPrice envelope and a
      // row without a mark price at all.
      return Response.json([
        { symbol: "BTCUSDT", fundingTime: bucket + 60_000, fundingRate: "0.00010000", markPrice: "35012.34567890" },
        { symbol: "BTCUSDT", fundingTime: bucket + 25 * 60_000, fundingRate: "-0.00020000", markPrice: "34980.5" },
        { symbol: "BTCUSDT", fundingTime: bucket + 40 * 60_000, fundingRate: "0.00000000", markPrice: "0.00000000" },
      ]);
    }
    throw new Error(`Unexpected Binance test URL: ${text}`);
  }) as typeof fetch;

  const result = await fetchSearchCandles({
    exchange: "Binance",
    exchangeColor: "yellow",
    symbol: "BTCUSDT",
    rawSymbol: "BTCUSDT",
    fundingRate: 0,
    markPrice: 35_000,
    indexPrice: 35_000,
    lastPrice: 35_000,
    change24h: 0,
    quoteVolume: 1,
    openInterest: 1,
    notionalValue: 35_000,
    fundingInterval: 8 * 3600,
    assetCategory: "Crypto",
  }, "1h");

  expect(result.fundingRates).toHaveLength(1);
  const point = result.fundingRates[0];
  // Bucket maths is unchanged: sum of the three settled rates over one hour.
  expect(point.time).toBe(bucket);
  expect(point.sampleCount).toBe(3);
  expect(point.rate).toBeCloseTo(-0.0001, 12);
  // Real marks survive verbatim; the zero markPrice is not published as 0.
  expect(point.settlements).toEqual([
    { time: bucket + 60_000, rate: 0.0001, markPrice: 35_012.3456789 },
    { time: bucket + 25 * 60_000, rate: -0.0002, markPrice: 34_980.5 },
    { time: bucket + 40 * 60_000, rate: 0 },
  ]);
});

describe("perp weekly candle source policy", () => {
  test("maps OKX weekly candles to its official UTC week", () => {
    expect(toOkxBar("1d")).toBe("1Dutc");
    expect(toOkxBar("1w")).toBe("1Wutc");
  });

  test("uses Hyperliquid native weeks for singles and UTC daily aggregation for combos", () => {
    expect(resolvePerpCandleSource("Hyperliquid", "1w")).toEqual({ sourceInterval: "1w", aggregateWeekly: false });
    expect(resolvePerpCandleSource("Hyperliquid", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
  });

  test("aggregates Lighter single and combo weeks from official UTC days", () => {
    expect(resolvePerpCandleSource("Lighter", "1w")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
    expect(resolvePerpCandleSource("Lighter", "1w", "combo")).toEqual({ sourceInterval: "1d", aggregateWeekly: true });
  });

  test("describes UTC, native, and locally aggregated source provenance", () => {
    expect(createCandleSourceProvenance("OKX", "1d", "1d", false)).toMatchObject({ sourceKind: "official 1Dutc", quoteTurnover: "official" });
    expect(createCandleSourceProvenance("Hyperliquid", "1w", "1w", false)).toMatchObject({ sourceKind: "official native interval", quoteTurnover: "derived" });
    expect(createCandleSourceProvenance("Lighter", "1w", "1d", true)).toMatchObject({ sourceKind: "official daily aggregation to UTC Monday", quoteTurnover: "derived" });
  });

  test("aggregates daily candles into Monday UTC buckets", () => {
    const monday = Date.UTC(2026, 6, 13);
    const weekly = aggregateDailyCandlesToWeekly([
      { openTime: monday, closeTime: monday + 86_400_000, open: "1", high: "3", low: "1", close: "2", volume: "2" },
      { openTime: monday + 86_400_000, closeTime: monday + 2 * 86_400_000, open: "2", high: "4", low: "0.5", close: "3", volume: "5" },
    ]);
    expect(weekly[0]).toMatchObject({ openTime: monday, closeTime: monday + 7 * 86_400_000, open: "1", high: "4", low: "0.5", close: "3", volume: "7" });
  });

  test("groups funding against the final Monday weekly candle bucket", () => {
    const monday = Date.UTC(2026, 6, 13);
    const weekly = aggregateDailyCandlesToWeekly([
      { openTime: monday, closeTime: monday + 86_400_000, open: "1", high: "2", low: "1", close: "2", volume: "3" },
      { openTime: monday + 6 * 86_400_000, closeTime: monday + 7 * 86_400_000, open: "2", high: "4", low: "1.5", close: "3", volume: "5" },
    ]);
    const funding = aggregateFundingRatesToCandles([
      { time: monday + 60 * 60_000, rate: 0.01 },
      { time: monday + 3 * 86_400_000, rate: 0.03 },
      { time: monday + 7 * 86_400_000, rate: 0.05 }, // next weekly bucket, excluded
    ], weekly, 3600);

    expect(funding).toEqual([{
      time: monday,
      rate: 0.04,
      annualizedRate: 0.04 * 365 / 7,
      sampleCount: 2,
      settlements: [
        { time: monday + 60 * 60_000, rate: 0.01 },
        { time: monday + 3 * 86_400_000, rate: 0.03 },
      ],
    }]);
  });

  test("sums settlements and annualizes each candle by its own duration", () => {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    const candles = [
      { openTime: 0, closeTime: hour, open: "1", high: "1", low: "1", close: "1", volume: "0" },
      { openTime: hour, closeTime: hour + 4 * hour, open: "1", high: "1", low: "1", close: "1", volume: "0" },
      { openTime: 5 * hour, closeTime: 5 * hour + day, open: "1", high: "1", low: "1", close: "1", volume: "0" },
    ];
    const funding = aggregateFundingRatesToCandles([
      { time: 10 * 60 * 1000, rate: 0.01 },
      { time: hour + 10 * 60 * 1000, rate: 0.02 },
      { time: hour + 20 * 60 * 1000, rate: 0.03 },
      { time: 5 * hour + 10 * 60 * 1000, rate: 0 },
    ], candles, 8 * 3600);

    expect(funding[0]).toEqual({
      time: 0,
      rate: 0.01,
      annualizedRate: 0.01 * 365 * 24,
      sampleCount: 1,
      settlements: [{ time: 10 * 60 * 1000, rate: 0.01 }],
    });
    expect(funding[1]).toEqual({
      time: hour,
      rate: 0.05,
      annualizedRate: 0.05 * 365 * 24 / 4,
      sampleCount: 2,
      settlements: [
        { time: hour + 10 * 60 * 1000, rate: 0.02 },
        { time: hour + 20 * 60 * 1000, rate: 0.03 },
      ],
    });
    // A real zero settlement is retained (not a gap, not dropped).
    expect(funding[2]).toEqual({
      time: 5 * hour,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 1,
      settlements: [{ time: 5 * hour + 10 * 60 * 1000, rate: 0 }],
    });
  });

  test("keeps empty candle buckets as explicit gaps", () => {
    const funding = aggregateFundingRatesToCandles([], [{
      openTime: 0,
      closeTime: 60 * 60 * 1000,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "0",
    }], 3600);
    // No real sample: no settlements array, so nothing can be mistaken for one.
    expect(funding).toEqual([{ time: 0, rate: 0, annualizedRate: 0, sampleCount: 0 }]);
    expect(funding[0].settlements).toBeUndefined();
  });

  describe("settlement pass-through", () => {
    const HOUR = 60 * 60 * 1000;
    const bucket = { openTime: 0, closeTime: HOUR, open: "1", high: "1", low: "1", close: "1", volume: "0" };

    test("keeps two real settlements in one bucket with their own times and marks", () => {
      const funding = aggregateFundingRatesToCandles([
        { time: 10 * 60 * 1000, rate: 0.0001, markPrice: 101 },
        { time: 50 * 60 * 1000, rate: 0.0002, markPrice: 103 },
      ], [bucket], 8 * 3600);

      expect(funding[0].sampleCount).toBe(2);
      expect(funding[0].rate).toBeCloseTo(0.0003, 12);
      // Per-settlement times and prices survive; the bucket time is not stamped
      // onto them and no bucket-close price replaces the real marks.
      expect(funding[0].settlements).toEqual([
        { time: 10 * 60 * 1000, rate: 0.0001, markPrice: 101 },
        { time: 50 * 60 * 1000, rate: 0.0002, markPrice: 103 },
      ]);
    });

    test("keeps a negative settlement rate verbatim (venue convention preserved)", () => {
      const funding = aggregateFundingRatesToCandles(
        [{ time: 30 * 60 * 1000, rate: -0.0004, markPrice: 99.5 }],
        [bucket],
        8 * 3600,
      );
      expect(funding[0].settlements).toEqual([{ time: 30 * 60 * 1000, rate: -0.0004, markPrice: 99.5 }]);
      expect(funding[0].rate).toBeCloseTo(-0.0004, 12);
    });

    test("zero, negative, non-finite, or missing mark prices are never fabricated", () => {
      const funding = aggregateFundingRatesToCandles([
        { time: 1 * 60 * 1000, rate: 0.0001, markPrice: 0 },
        { time: 2 * 60 * 1000, rate: 0.0001, markPrice: Number.POSITIVE_INFINITY },
        { time: 3 * 60 * 1000, rate: 0.0001 },
        { time: 4 * 60 * 1000, rate: 0.0001, markPrice: -5 },
      ], [bucket], 8 * 3600);

      expect(funding[0].sampleCount).toBe(4);
      const settlements = funding[0].settlements ?? [];
      expect(settlements).toHaveLength(4);
      expect(settlements.every((settlement) => !("markPrice" in settlement))).toBe(true);
    });

    test("treats a bucket boundary as half-open [openTime, closeTime)", () => {
      const funding = aggregateFundingRatesToCandles([
        { time: 0, rate: 0.0001, markPrice: 100 },        // included (open edge)
        { time: HOUR - 1, rate: 0.0002, markPrice: 101 }, // included (just before close)
        { time: HOUR, rate: 0.0004, markPrice: 102 },     // next bucket
      ], [bucket], 8 * 3600);

      expect(funding[0].sampleCount).toBe(2);
      expect(funding[0].settlements?.map((settlement) => settlement.time)).toEqual([0, HOUR - 1]);
    });
  });
});
