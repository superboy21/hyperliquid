import { afterEach, describe, expect, mock, test } from "bun:test";
import { spotFetch } from "./spot-fetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function params() {
  return new URLSearchParams({ action: "list" });
}

describe.serial("spotFetch direct-first transport", () => {
  test.each([200, 204, 400, 404])("returns direct HTTP %i without proxy", async (status) => {
    const direct = new Response(null, { status });
    const fetchMock = mock().mockResolvedValueOnce(direct);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params())).resolves.toBe(direct);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([403, 451, 500, 503])("uses the proxy once for direct HTTP %i", async (status) => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params())).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe("/api/spot/binance?action=list");
  });

  test("retries a direct 429 once, honors Retry-After, and never proxies a final 429", async () => {
    const final = new Response(null, { status: 429 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(final);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params())).resolves.toBe(final);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each(["network", "timeout"] as const)("falls back once for direct %s failure", async (kind) => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock().mockImplementationOnce(async () => {
      throw kind === "timeout"
        ? new DOMException("The operation timed out.", "TimeoutError")
        : new TypeError("Failed to fetch");
    }).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params())).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses the proxy once when the direct client leg hangs past its deadline", async () => {
    const proxy = new Response(null, { status: 200 });
    let directSignal: AbortSignal | undefined;
    const fetchMock = mock().mockImplementationOnce((_url: string, init?: RequestInit) => {
      directSignal = init?.signal;
      return new Promise<Response>(() => undefined);
    }).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params(), undefined, 1)).resolves.toBe(proxy);
    expect(directSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("never proxies a caller abort", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    const fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(spotFetch("Binance", params(), { signal: controller.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
