import { afterEach, describe, expect, mock, test } from "bun:test";
import { binanceFetch, binanceKlinesFetch } from "./binance";

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
