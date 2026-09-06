import { afterEach, describe, expect, mock, test } from "bun:test";
import { lighterFetch } from "./lighter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe.serial("Lighter direct-first transport", () => {
  test.each([200, 400, 404])("returns direct HTTP %i without proxy", async (status) => {
    const direct = new Response(null, { status });
    const fetchMock = mock().mockResolvedValueOnce(direct);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lighterFetch("funding-rates")).resolves.toBe(direct);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([403, 451, 500, 503])("proxies direct HTTP %i once", async (status) => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lighterFetch("funding-rates")).resolves.toBe(proxy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries a 429 once and returns a final 429 without proxy", async () => {
    const final = new Response(null, { status: 429 });
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(final);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lighterFetch("funding-rates")).resolves.toBe(final);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each(["network", "timeout"] as const)("proxies once for a direct %s failure", async (kind) => {
    const proxy = new Response(null, { status: 200 });
    const fetchMock = mock().mockImplementationOnce(async () => {
      throw kind === "timeout" ? new DOMException("timed out", "TimeoutError") : new TypeError("Failed to fetch");
    }).mockResolvedValueOnce(proxy);
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lighterFetch("funding-rates")).resolves.toBe(proxy);
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

    await expect(lighterFetch("funding-rates", "", undefined, 700)).resolves.toBe(proxy);
    expect(directSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not proxy a caller abort", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    const fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(lighterFetch("funding-rates", "", { signal: controller.signal })).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
