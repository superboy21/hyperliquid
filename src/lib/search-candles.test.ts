import { afterEach, describe, expect, mock, test } from "bun:test";
import { aggregateDailyCandlesToWeekly, aggregateFundingRatesToCandles, fetchGateCandles, fetchSearchCandles, normalizeLighterSearchFundingRow, parseSearchFundingRate, resolvePerpCandleSource, toOkxBar } from "./search-candles";
import { createCandleSourceProvenance } from "./candle-provenance";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
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
      }, {
        time: now - 2 * hour,
        coin: "BTC",
        fundingRate: "0.002",
      }, {
        time: now - 2 * hour,
        coin: "BTC",
        fundingRate: "0.002",
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
    rate: 0.001,
    annualizedRate: 0.001 * 365 * 24,
    sampleCount: 1,
  }, {
    time: now - 2 * hour,
    rate: 0.002,
    annualizedRate: 0.002 * 365 * 24,
    sampleCount: 1,
  }]);
});

test("Gate search candles prefer the direct URL before the proxy", async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (url) => {
    urls.push(String(url));
    return Response.json([{ t: 1, o: "1", h: "2", l: "0.5", c: "1.5", v: 10, sum: "15" }]);
  }) as typeof fetch;

  await expect(fetchGateCandles("BTC", "1h")).resolves.toMatchObject([{ openTime: 1000, close: "1.5" }]);
  expect(urls).toEqual(["https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=1h&limit=2000"]);
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

    expect(funding[0]).toEqual({ time: 0, rate: 0.01, annualizedRate: 0.01 * 365 * 24, sampleCount: 1 });
    expect(funding[1]).toEqual({ time: hour, rate: 0.05, annualizedRate: 0.05 * 365 * 24 / 4, sampleCount: 2 });
    expect(funding[2]).toEqual({ time: 5 * hour, rate: 0, annualizedRate: 0, sampleCount: 1 });
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
    expect(funding).toEqual([{ time: 0, rate: 0, annualizedRate: 0, sampleCount: 0 }]);
  });
});
