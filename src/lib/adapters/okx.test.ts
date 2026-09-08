import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  clearOkxFundingSnapshotCache,
  computeOkxRetryDelayMs,
  fetchOkxCanonicalDetail,
  fetchOkxCanonicalRates,
  fetchOkxFundingHistory,
  fetchNativeFundingSnapshot,
  okxFetch,
} from "./okx";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

function response(status: number, headers?: HeadersInit, body: unknown = { data: [] }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  clearOkxFundingSnapshotCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  clearOkxFundingSnapshotCache();
});

describe.serial("okxFetch retries", () => {
  test.each([403, 451])("uses the proxy once for direct HTTP %i", async (status) => {
    const proxy = response(200);
    const fetchMock = mock()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [1, 1])).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses the proxy once after the final direct 5xx", async () => {
    const proxy = response(200);
    const fetchMock = mock()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [1, 1])).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("uses the proxy once for a direct network failure", async () => {
    const proxy = response(200);
    const fetchMock = mock().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [1, 1])).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses the proxy once when the direct client leg hangs past its deadline", async () => {
    const proxy = response(200);
    let directSignal: AbortSignal | undefined;
    const fetchMock = mock().mockImplementationOnce((_url: string, init?: RequestInit) => {
      directSignal = init?.signal;
      return new Promise<Response>(() => undefined);
    }).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [1, 1], 500)).resolves.toBe(proxy);
    expect(directSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries a 429 with injected delays and returns the eventual success", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await okxFetch("/api/okx", {}, [1, 1]);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("returns the third 429 instead of retrying forever", async () => {
    const fetchMock = mock(() => Promise.resolve(response(429)));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await okxFetch("/api/okx", {}, [1, 1]);

    expect(result.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("does not proxy when a direct 429 is followed by a network failure", async () => {
    const first = response(429, { "Retry-After": "0" });
    const fetchMock = mock().mockResolvedValueOnce(first).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [0, 0])).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not proxy when a direct 429 backoff exceeds the direct deadline", async () => {
    const first = response(429, { "Retry-After": "60" });
    const fetchMock = mock().mockResolvedValueOnce(first);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", {}, [60_000, 60_000], 1)).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([400, 404])("does not retry HTTP %s", async (status) => {
    const fetchMock = mock(() => Promise.resolve(response(status)));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await okxFetch("/api/okx", {}, [1, 1]);

    expect(result.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("prefers Retry-After over an injected fallback delay", async () => {
    const fetchMock = mock()
      .mockResolvedValueOnce(response(429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response(200));
    globalThis.fetch = fetchMock as typeof fetch;

    const completed = okxFetch("/api/okx", {}, [60_000, 60_000]);
    const result = await Promise.race([
      completed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("used fallback delay")), 1_000)),
    ]);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects with AbortError and does not retry after abort", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const fetchMock = mock(() => {
      controller.abort(reason);
      return Promise.resolve(response(429));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(okxFetch("/api/okx", { signal: controller.signal }, [1, 1])).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe.serial("computeOkxRetryDelayMs", () => {
  test("uses exponential defaults when the header is absent or invalid", () => {
    expect(computeOkxRetryDelayMs(null, 0)).toBe(1_000);
    expect(computeOkxRetryDelayMs(null, 1)).toBe(2_000);
    expect(computeOkxRetryDelayMs("not-a-number", 0)).toBe(1_000);
    expect(computeOkxRetryDelayMs("-1", 1)).toBe(2_000);
  });

  test("parses seconds and caps Retry-After at 60 seconds", () => {
    expect(computeOkxRetryDelayMs("1.5", 0)).toBe(1_500);
    expect(computeOkxRetryDelayMs("60", 0)).toBe(60_000);
    expect(computeOkxRetryDelayMs("120", 0)).toBe(60_000);
  });
});

describe.serial("OKX funding snapshot cache", () => {
  test("single-flights concurrent calls, reuses the TTL, and refreshes after expiry", async () => {
    const fetchMock = mock(() => Promise.resolve(response(200, undefined, {
      data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.001" }],
    })));
    globalThis.fetch = fetchMock as typeof fetch;

    const [first, concurrent] = await Promise.all([
      fetchNativeFundingSnapshot(undefined, 20),
      fetchNativeFundingSnapshot(undefined, 20),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.get("BTC-USDT-SWAP")?.fundingRate).toBe("0.001");
    expect(concurrent).toBe(first);

    const cached = await fetchNativeFundingSnapshot(undefined, 20);
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const refreshed = await fetchNativeFundingSnapshot(undefined, 20);
    expect(refreshed.get("BTC-USDT-SWAP")?.fundingRate).toBe("0.001");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("maps the PONS upcoming fundingRate instead of next or settled funding", async () => {
    const now = originalDateNow();
    const entries = [
      {
        instId: "BTC-USDT-SWAP", instType: "SWAP", fundingTime: String(now),
        fundingRate: "0.0003286308411615", nextFundingRate: "", settState: "settled", settFundingRate: "0.0099",
        markPx: "100", indexPx: "100",
      },
      {
        instId: "ZERO-USDT-SWAP", instType: "SWAP", fundingTime: String(now),
        fundingRate: "0", nextFundingRate: "0.7", settState: "settled", settFundingRate: "-0.2",
        markPx: "100", indexPx: "100",
      },
      {
        instId: "BAD-USDT-SWAP", instType: "SWAP", fundingTime: String(now),
        fundingRate: "0.1garbage", nextFundingRate: "0.8", markPx: "100", indexPx: "100",
      },
      {
        instId: "NAN-USDT-SWAP", instType: "SWAP", fundingTime: String(now),
        fundingRate: "NaN", nextFundingRate: "0.9", markPx: "100", indexPx: "100",
      },
    ];
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("/public/funding-rate") && text.includes("instId=ANY")) return response(200, undefined, { data: entries });
      if (text.includes("/public/instruments")) return response(200, undefined, {
        data: entries.map((entry) => ({ instId: entry.instId, instType: "SWAP", state: "live", instCategory: "1" })),
      });
      if (text.includes("/market/tickers")) return response(200, undefined, {
        data: entries.map((entry) => ({ instId: entry.instId, last: "100", open24h: "100", bidPx: "99", askPx: "101" })),
      });
      if (text.includes("/public/open-interest")) return response(200, undefined, {
        data: entries.map((entry) => ({ instId: entry.instId, oi: "1", oiUsd: "100" })),
      });
      if (text.includes("/market/index-tickers")) return response(200, undefined, {
        data: entries.map((entry) => ({ instId: entry.instId.replace("-SWAP", ""), idxPx: "100" })),
      });
      throw new Error(`Unexpected OKX test URL: ${text}`);
    }) as typeof fetch;

    const rows = await fetchOkxCanonicalRates();
    expect(rows.map((row) => [row.symbol, row.fundingRate, row.predictedFundingRate])).toEqual([
      ["BTC", 0.0003286308411615, 0.0003286308411615],
      ["ZERO", 0, 0],
    ]);
    expect(rows[0].lastSettlementRate).toBe(0.0099);
  });
});

describe.serial("OKX funding history pagination", () => {
  test("covers an hourly window even when the current interval is 8h", async () => {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const cutoff = now - 400 * hour;
    const pages = [
      Array.from({ length: 400 }, (_, index) => ({
        fundingTime: String(now - index * hour),
        realizedRate: String(index),
      })),
      [{ fundingTime: String(cutoff), realizedRate: "400" }],
    ];
    const urls: string[] = [];
    let calls = 0;
    globalThis.fetch = mock(async (url) => {
      urls.push(String(url));
      return response(200, undefined, { data: pages[calls++] });
    }) as typeof fetch;

    const history = await fetchOkxFundingHistory("BTC-USDT-SWAP", 8 * 60 * 60, undefined, 30, cutoff, true);

    expect(history).toHaveLength(401);
    expect(history[0].timestamp).toBe(cutoff);
    expect(history.at(-1)?.timestamp).toBe(now);
    expect(calls).toBe(2);
    expect(new URL(urls[1]).searchParams.get("after")).toBe(String(now - 399 * hour));
  });

  test("filters records older than the cutoff and stops at that boundary", async () => {
    const now = Date.now();
    const cutoff = now - 10 * 60 * 60 * 1000;
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return response(200, undefined, {
        data: Array.from({ length: 400 }, (_, index) => ({
          fundingTime: String(now - index * 60 * 60 * 1000),
          fundingRate: "0.1",
        })),
      });
    }) as typeof fetch;

    const history = await fetchOkxFundingHistory("BTC-USDT-SWAP", undefined, undefined, 30, cutoff);

    expect(history).toHaveLength(11);
    expect(history.every((item) => item.timestamp >= cutoff)).toBe(true);
    expect(calls).toBe(1);
  });

  test("rejects missing and blank rates but retains an observed zero", async () => {
    const now = Date.now();
    globalThis.fetch = mock(async () => response(200, undefined, {
      data: [
        { fundingTime: String(now), fundingRate: "" },
        { fundingTime: String(now - 60 * 60 * 1000) },
        { fundingTime: String(now - 2 * 60 * 60 * 1000), fundingRate: "0" },
      ],
    })) as typeof fetch;

    await expect(fetchOkxFundingHistory(
      "BTC-USDT-SWAP",
      undefined,
      undefined,
      1,
      now - 3 * 60 * 60 * 1000,
    )).resolves.toEqual([
      { timestamp: now - 2 * 60 * 60 * 1000, fundingRate: 0 },
    ]);
  });

  test("deduplicates a repeated cursor boundary and honors abort", async () => {
    const now = Date.now();
    const page = Array.from({ length: 400 }, (_, index) => ({
      fundingTime: String(now - index * 60 * 60 * 1000),
      fundingRate: "0.1",
    }));
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      return response(200, undefined, { data: page });
    }) as typeof fetch;

    const history = await fetchOkxFundingHistory("BTC-USDT-SWAP", undefined, undefined, 30, now - 1_000 * 60 * 60 * 1000);
    expect(history).toHaveLength(400);
    expect(calls).toBe(2);

    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    await expect(fetchOkxFundingHistory("BTC-USDT-SWAP", undefined, controller.signal, 30, undefined, true)).rejects.toBe(reason);
  });

  test("fails closed on uncovered short pages but preserves partial non-strict history", async () => {
    const now = Date.now();
    globalThis.fetch = mock(async () => response(200, undefined, {
      data: [{ fundingTime: String(now), fundingRate: "0.1" }],
    })) as typeof fetch;

    await expect(fetchOkxFundingHistory("BTC-USDT-SWAP", undefined, undefined, 30, now - 30 * 24 * 60 * 60 * 1000, true))
      .resolves.toEqual([]);
    await expect(fetchOkxFundingHistory("BTC-USDT-SWAP", undefined, undefined, 30, now - 30 * 24 * 60 * 60 * 1000))
      .resolves.toEqual([{ timestamp: now, fundingRate: 0.1 }]);
  });

  test("canonical detail preserves a partial three-day history and latest settlement", async () => {
    const now = originalDateNow();
    Date.now = () => now;
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("history-candles")) return response(200, undefined, { data: [] });
      if (text.includes("funding-rate-history")) {
        return response(200, undefined, {
          data: [
            { fundingTime: String(now + 1_000), fundingRate: "0.2" },
            { fundingTime: String(now - 3 * 24 * 60 * 60 * 1000), fundingRate: "0.1" },
          ],
        });
      }
      return response(200, undefined, { data: [] });
    }) as typeof fetch;

    const detail = await fetchOkxCanonicalDetail("BTC-USDT-SWAP", "1d", 8 * 60 * 60, undefined, { asOf: now });
    expect(detail.fundingHistory).toEqual([{ timestamp: now - 3 * 24 * 60 * 60 * 1000, fundingRate: 0.1 }]);
    expect(detail.lastSettlementRate).toBe(0.1);
  });

  test("canonical detail uses OKX base and official quote candle volumes", async () => {
    const now = originalDateNow();
    Date.now = () => now;
    globalThis.fetch = mock(async (url) => {
      const text = String(url);
      if (text.includes("history-candles")) return response(200, undefined, {
        data: [
          [String(now - 60_000), "1", "2", "0.5", "1.5", "10", "25", "37.5", "1"],
          [String(now), "1", "2", "0.5", "1.5", "10", "25"],
        ],
      });
      if (text.includes("funding-rate-history")) return response(200, undefined, { data: [] });
      if (text.includes("public/funding-rate")) return response(200, undefined, { data: [] });
      return response(200, undefined, { data: [] });
    }) as typeof fetch;

    const detail = await fetchOkxCanonicalDetail("BTC-USDT-SWAP", "1d", undefined, undefined, { asOf: now });
    expect(detail.candles).toEqual([
      expect.objectContaining({ volume: "25", quoteVolume: "37.5" }),
      expect.objectContaining({ volume: "25" }),
    ]);
    expect(detail.candles[1].quoteVolume).toBeUndefined();
  });
});
