import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  clearOkxFundingSnapshotCache,
  computeOkxRetryDelayMs,
  fetchNativeFundingSnapshot,
  okxFetch,
} from "./okx";

const originalFetch = globalThis.fetch;

function response(status: number, headers?: HeadersInit, body: unknown = { data: [] }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  clearOkxFundingSnapshotCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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
});
