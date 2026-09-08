import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  binanceFetch,
  binanceKlinesFetch,
  fetchBinanceCanonicalRates,
  fetchBinanceSearchRates,
  parseBinanceLiveFundingRate,
} from "./binance";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe.serial("Binance direct-first transport", () => {
  test.each([200, 400, 404])("does not proxy direct HTTP %i", async (status) => {
    const direct = new Response(null, { status });
    const fetchMock = mock().mockResolvedValueOnce(direct);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceFetch("premiumIndex", "")).resolves.toBe(direct);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([403, 451, 500, 503])("proxies direct HTTP %i once", async (status) => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceFetch("premiumIndex", "")).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each(["binanceFetch", "binanceKlinesFetch"] as const)("retries a 429 once and returns a final 429 without proxy (%s)", async (name) => {
    const final = new Response(null, { status: 429 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(final);
    globalThis.fetch = fetchMock as typeof fetch;

    const result = name === "binanceFetch"
      ? binanceFetch("premiumIndex", "")
      : binanceKlinesFetch("BTCUSDT", "1h", "30");
    await expect(result).resolves.toBe(final);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each(["binanceFetch", "binanceKlinesFetch"] as const)("does not proxy a 429 followed by a network failure (%s)", async (name) => {
    const first = new Response(null, { status: 429, headers: { "Retry-After": "0" } });
    const fetchMock = mock().mockResolvedValueOnce(first).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = name === "binanceFetch"
      ? binanceFetch("premiumIndex", "")
      : binanceKlinesFetch("BTCUSDT", "1h", "30");
    await expect(result).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not proxy a 429 whose Retry-After outlives the direct deadline", async () => {
    const first = new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    const fetchMock = mock().mockResolvedValueOnce(first);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceFetch("premiumIndex", "", undefined, 1)).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back once for a direct network failure", async () => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceKlinesFetch("BTCUSDT", "1h", "30")).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("falls back once when the direct client leg hangs past its deadline", async () => {
    const proxy = new Response(null, { status: 200 });
    let directSignal: AbortSignal | undefined;
    const fetchMock = mock().mockImplementationOnce((_url: string, init?: RequestInit) => {
      directSignal = init?.signal;
      return new Promise<Response>(() => undefined);
    }).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceFetch("premiumIndex", "", undefined, 1)).resolves.toBe(proxy);
    expect(directSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not proxy a cancelled kline request", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    const fetchMock = mock().mockImplementationOnce(async () => {
      controller.abort(reason);
      throw reason;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(binanceKlinesFetch("BTCUSDT", "1h", "30", { signal: controller.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Binance live funding normalization", () => {
  test("retains a numeric zero but drops a blank premium funding rate", async () => {
    expect(parseBinanceLiveFundingRate("0")).toBe(0);
    expect(parseBinanceLiveFundingRate(0)).toBe(0);
    expect(parseBinanceLiveFundingRate("")).toBeNull();
    expect(parseBinanceLiveFundingRate("NaN")).toBeNull();
    expect(parseBinanceLiveFundingRate("0.1garbage")).toBeNull();
  });

  test("maps PONS current funding as predicted funding and propagates it to Search", async () => {
    const now = Date.now();
    const premiums = [
      { symbol: "BTCUSDT", markPrice: "100", indexPrice: "100", fundingRate: "0.00040108", lastFundingRate: "0.0002", nextFundingTime: now + 8 * 60 * 60 * 1000, lastPrice: "100" },
      { symbol: "ZEROUSDT", markPrice: "100", indexPrice: "100", fundingRate: "0", nextFundingTime: now + 8 * 60 * 60 * 1000, lastPrice: "100" },
      { symbol: "LEGACYUSDT", markPrice: "100", indexPrice: "100", lastFundingRate: "-0.0002", nextFundingTime: now + 8 * 60 * 60 * 1000, lastPrice: "100" },
      { symbol: "BADUSDT", markPrice: "100", indexPrice: "100", fundingRate: "0.1garbage", lastFundingRate: "0.0003", nextFundingTime: now + 8 * 60 * 60 * 1000, lastPrice: "100" },
    ];
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("premiumIndex")) return Response.json(premiums);
      if (text.includes("ticker/24hr")) return Response.json(premiums.map((item) => ({ symbol: item.symbol, priceChangePercent: "0", quoteVolume: "1", lastPrice: "100" })));
      if (text.includes("fundingInfo")) return Response.json(premiums.map((item) => ({ symbol: item.symbol, fundingIntervalHours: 8 })));
      if (text.includes("bookTicker")) return Response.json(premiums.map((item) => ({ symbol: item.symbol, bidPrice: "99", askPrice: "101" })));
      if (text.includes("fundingRate")) return Response.json([]);
      throw new Error(`Unexpected Binance test URL: ${text}`);
    }) as typeof fetch;

    const canonical = await fetchBinanceCanonicalRates();
    expect(canonical.map((row) => [row.symbol, row.fundingRate, row.predictedFundingRate])).toEqual([
      ["BTCUSDT", 0.00040108, 0.00040108],
      ["ZEROUSDT", 0, 0],
      ["LEGACYUSDT", -0.0002, -0.0002],
    ]);

    const search = await fetchBinanceSearchRates();
    expect(search.find((row) => row.symbol === "BTCUSDT")?.predictedFundingRate).toBe(0.00040108);
    expect(search.find((row) => row.symbol === "ZEROUSDT")?.predictedFundingRate).toBe(0);
  });
});
