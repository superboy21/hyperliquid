import { describe, expect, test } from "bun:test";
import { isProxyEligibleStatus, runDirectFirst } from "./direct-first";

describe("isProxyEligibleStatus", () => {
  test("allows only 403, 451, and 5xx statuses", () => {
    expect(isProxyEligibleStatus(200)).toBe(false);
    expect(isProxyEligibleStatus(400)).toBe(false);
    expect(isProxyEligibleStatus(429)).toBe(false);
    expect(isProxyEligibleStatus(499)).toBe(false);
    expect(isProxyEligibleStatus(403)).toBe(true);
    expect(isProxyEligibleStatus(451)).toBe(true);
    expect(isProxyEligibleStatus(500)).toBe(true);
    expect(isProxyEligibleStatus(599)).toBe(true);
  });
});

describe("runDirectFirst", () => {
  test("returns direct 2xx and ordinary 4xx/429 responses unchanged", async () => {
    for (const status of [204, 400, 404, 429]) {
      const directResponse = new Response(null, { status });
      let directCalls = 0;
      let proxyCalls = 0;

      const response = await runDirectFirst({
        direct: async () => {
          directCalls += 1;
          return directResponse;
        },
        proxy: async () => {
          proxyCalls += 1;
          return new Response(null, { status: 200 });
        },
      });

      expect(response).toBe(directResponse);
      expect(directCalls).toBe(1);
      expect(proxyCalls).toBe(0);
    }
  });

  test("falls back once for 403, 451, and 5xx responses", async () => {
    for (const status of [403, 451, 500, 503]) {
      const proxyResponse = new Response(null, { status: 200 });
      let directCalls = 0;
      let proxyCalls = 0;

      const response = await runDirectFirst({
        direct: async () => {
          directCalls += 1;
          return new Response(null, { status });
        },
        proxy: async () => {
          proxyCalls += 1;
          return proxyResponse;
        },
      });

      expect(response).toBe(proxyResponse);
      expect(directCalls).toBe(1);
      expect(proxyCalls).toBe(1);
    }
  });

  test("falls back once for a direct network/CORS-style failure", async () => {
    const proxyResponse = new Response(null, { status: 200 });
    let directCalls = 0;
    let proxyCalls = 0;

    const response = await runDirectFirst({
      direct: async () => {
        directCalls += 1;
        throw new TypeError("Failed to fetch");
      },
      proxy: async () => {
        proxyCalls += 1;
        return proxyResponse;
      },
    });

    expect(response).toBe(proxyResponse);
    expect(directCalls).toBe(1);
    expect(proxyCalls).toBe(1);
  });

  test("falls back once for a direct client-timeout failure", async () => {
    const proxyResponse = new Response(null, { status: 200 });
    let proxyCalls = 0;

    const response = await runDirectFirst({
      direct: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      proxy: async () => {
        proxyCalls += 1;
        return proxyResponse;
      },
    });

    expect(response).toBe(proxyResponse);
    expect(proxyCalls).toBe(1);
  });

  test.each(["network", "timeout"] as const)("does not proxy after a reported 429 followed by %s", async (kind) => {
    const rateLimited = new Response(null, { status: 429 });
    let proxyCalls = 0;

    await expect(runDirectFirst({
      direct: async (_signal, reportResponse) => {
        reportResponse?.(rateLimited);
        throw kind === "timeout"
          ? new DOMException("The operation timed out.", "TimeoutError")
          : new TypeError("Failed to fetch");
      },
      proxy: async () => {
        proxyCalls += 1;
        return new Response(null, { status: 200 });
      },
    })).resolves.toBe(rateLimited);
    expect(proxyCalls).toBe(0);
  });

  test("does not proxy when a reported 429 is followed by a direct 5xx", async () => {
    const rateLimited = new Response(null, { status: 429 });
    let proxyCalls = 0;

    await expect(runDirectFirst({
      direct: async (_signal, reportResponse) => {
        reportResponse?.(rateLimited);
        return new Response(null, { status: 503 });
      },
      proxy: async () => {
        proxyCalls += 1;
        return new Response(null, { status: 200 });
      },
    })).resolves.toBe(rateLimited);
    expect(proxyCalls).toBe(0);
  });

  test("returns a reported 429 when the direct deadline expires during retry backoff", async () => {
    const rateLimited = new Response(null, { status: 429 });
    let proxyCalls = 0;

    await expect(runDirectFirst({
      directTimeoutMs: 1,
      direct: async (_signal, reportResponse) => {
        reportResponse?.(rateLimited);
        return new Promise<Response>(() => undefined);
      },
      proxy: async () => {
        proxyCalls += 1;
        return new Response(null, { status: 200 });
      },
    })).resolves.toBe(rateLimited);
    expect(proxyCalls).toBe(0);
  });

  test("aborts a hung direct operation at its client deadline", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") handler();
      return 0;
    }) as typeof setTimeout;
    try {
      const proxyResponse = new Response(null, { status: 200 });
      let directSignal: AbortSignal | undefined;
      let proxyCalls = 0;

      const request = runDirectFirst({
        directTimeoutMs: 25,
        direct: (signal) => {
          directSignal = signal;
          return new Promise<Response>(() => undefined);
        },
        proxy: async () => {
          proxyCalls += 1;
          return proxyResponse;
        },
      });

      await expect(request).resolves.toBe(proxyResponse);
      expect(directSignal?.aborted).toBe(true);
      expect(directSignal?.reason).toMatchObject({ name: "TimeoutError" });
      expect(proxyCalls).toBe(1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("preserves the caller abort reason before direct starts", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    let directCalls = 0;
    let proxyCalls = 0;

    await expect(
      runDirectFirst({
        signal: controller.signal,
        direct: async () => {
          directCalls += 1;
          return new Response(null, { status: 200 });
        },
        proxy: async () => {
          proxyCalls += 1;
          return new Response(null, { status: 200 });
        },
      }),
    ).rejects.toBe(reason);

    expect(directCalls).toBe(0);
    expect(proxyCalls).toBe(0);
  });

  test("preserves the caller abort reason when abort happens during direct", async () => {
    const controller = new AbortController();
    const reason = new DOMException("user stopped", "AbortError");
    let proxyCalls = 0;

    await expect(
      runDirectFirst({
        signal: controller.signal,
        direct: async () => {
          controller.abort(reason);
          throw new TypeError("Failed to fetch");
        },
        proxy: async () => {
          proxyCalls += 1;
          return new Response(null, { status: 200 });
        },
      }),
    ).rejects.toBe(reason);

    expect(proxyCalls).toBe(0);
  });

  test("rethrows a proxy failure without retrying direct", async () => {
    const proxyError = new Error("proxy unavailable");
    let directCalls = 0;
    let proxyCalls = 0;

    await expect(
      runDirectFirst({
        direct: async () => {
          directCalls += 1;
          return new Response(null, { status: 503 });
        },
        proxy: async () => {
          proxyCalls += 1;
          throw proxyError;
        },
      }),
    ).rejects.toBe(proxyError);

    expect(directCalls).toBe(1);
    expect(proxyCalls).toBe(1);
  });

  test("supports a typed custom status eligibility predicate", async () => {
    const directResponse = new Response(null, { status: 400 });
    const proxyResponse = new Response(null, { status: 200 });
    let proxyCalls = 0;

    const response = await runDirectFirst({
      direct: async () => directResponse,
      proxy: async () => {
        proxyCalls += 1;
        return proxyResponse;
      },
      isProxyEligibleStatus: (status) => status === 400,
    });

    expect(response).toBe(proxyResponse);
    expect(proxyCalls).toBe(1);
  });
});
