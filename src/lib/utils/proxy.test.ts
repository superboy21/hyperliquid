import { describe, expect, test } from "bun:test";
import { normalizeProxyHeaders, proxyFetch } from "./proxy";

const proxyEnvironmentKeys = [
  "PROXY_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
] as const;

async function withProxyEnvironment<T>(proxyUrl: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of proxyEnvironmentKeys) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  if (proxyUrl !== undefined) process.env.PROXY_URL = proxyUrl;

  try {
    return await callback();
  } finally {
    for (const key of proxyEnvironmentKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withFetch(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  callback: () => Promise<void>,
): Promise<void> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetcher as typeof globalThis.fetch;
  try {
    await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

describe("proxy header normalization", () => {
  test("adds exactly one lowercase Content-Type and Accept default", () => {
    const headers = normalizeProxyHeaders({ "X-Test": "value" });
    expect(headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "x-test": "value",
    });
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "content-type")).toHaveLength(1);
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "accept")).toHaveLength(1);
  });

  test("preserves caller values regardless of input header casing", () => {
    const headers = normalizeProxyHeaders({
      "Content-Type": "application/problem+json",
      ACCEPT: "application/vnd.test+json",
    });
    expect(headers["content-type"]).toBe("application/problem+json");
    expect(headers.accept).toBe("application/vnd.test+json");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Accept).toBeUndefined();
  });

  test("collapses differently-cased duplicates into one serialized header name", () => {
    const headers = normalizeProxyHeaders([
      ["content-type", "application/json"],
      ["Content-Type", "application/json"],
      ["accept", "application/json"],
      ["Accept", "application/json"],
    ]);
    expect(Object.keys(headers)).toEqual(["accept", "content-type"]);
  });
});

describe("proxyFetch routing and cancellation", () => {
  test("routes direct and proxied requests and combines caller and timeout signals", async () => {
    const directCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

    await withProxyEnvironment(undefined, () => withFetch(async (input, init) => {
      directCalls.push({ input, init });
      return Response.json({ ok: true });
    }, async () => {
      const response = await proxyFetch("https://example.test/direct", { timeout: 100 });
      expect(response.status).toBe(200);
    }));

    expect(directCalls).toHaveLength(1);
    expect(directCalls[0].input).toBe("https://example.test/direct");
    expect(directCalls[0].init?.signal).toBeInstanceOf(AbortSignal);

    const caller = new AbortController();
    const callerReason = new Error("caller cancelled");
    let callerSignal: AbortSignal | undefined;
    await withProxyEnvironment(undefined, () => withFetch((_input, init) => {
      const signal = init?.signal;
      callerSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return reject(new Error("missing signal"));
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }, async () => {
      const request = proxyFetch("https://example.test/abort", {
        signal: caller.signal,
        timeout: 1_000,
      });
      caller.abort(callerReason);
      await expect(request).rejects.toBe(callerReason);
    }));
    expect(callerSignal).not.toBe(caller.signal);

    let timeoutSignal: AbortSignal | undefined;
    await withProxyEnvironment(undefined, () => withFetch((_input, init) => {
      const signal = init?.signal;
      timeoutSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return reject(new Error("missing signal"));
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }, async () => {
      const error = await proxyFetch("https://example.test/timeout", { timeout: 1 }).catch((reason) => reason);
      expect(error).toMatchObject({ name: "TimeoutError" });
    }));
    expect(timeoutSignal?.aborted).toBe(true);

    let proxiedDirectCalls = 0;
    await withProxyEnvironment("not-a-valid-proxy-url", () => withFetch(async () => {
      proxiedDirectCalls += 1;
      return Response.json({ unexpected: true });
    }, async () => {
      await expect(proxyFetch("https://example.test/proxied", { timeout: 100 })).rejects.toThrow();
    }));
    expect(proxiedDirectCalls).toBe(0);
  });
});
