import { describe, expect, mock, test } from "bun:test";

// Bun evaluates tests outside Next's server-component context.
mock.module("server-only", () => ({}));
const { createInflightJsonCache } = await import("./inflight-json-cache");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function rejectionOf<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected promise to reject");
    },
    (error: unknown) => error,
  );
}

describe("InflightJsonCache", () => {
  test("runs one loader for concurrent callers of the same key", async () => {
    const cache = createInflightJsonCache();
    const pending = deferred<{ value: number }>();
    let calls = 0;

    const load = () => {
      calls += 1;
      return pending.promise;
    };

    const first = cache.getOrLoad("same", 1_000, load);
    const second = cache.getOrLoad("same", 1_000, load);
    await Promise.resolve();
    expect(calls).toBe(1);

    pending.resolve({ value: 42 });
    await expect(first).resolves.toEqual({ value: 42 });
    await expect(second).resolves.toEqual({ value: 42 });
  });

  test("isolates waiter cancellation and preserves its exact reason", async () => {
    const cache = createInflightJsonCache();
    const pending = deferred<string>();
    const cancelled = new AbortController();
    const reason = { kind: "caller cancellation" };

    const first = cache.getOrLoad("shared", 1_000, () => pending.promise, cancelled.signal);
    const second = cache.getOrLoad("shared", 1_000, () => pending.promise);
    cancelled.abort(reason);

    expect(await rejectionOf(first)).toBe(reason);
    pending.resolve("loaded");
    await expect(second).resolves.toBe("loaded");
  });

  test("keeps loading after every waiter aborts and caches the success", async () => {
    const cache = createInflightJsonCache();
    const pending = deferred<{ ok: true }>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    let calls = 0;
    const load = () => {
      calls += 1;
      return pending.promise;
    };

    const first = cache.getOrLoad("all-cancelled", 1_000, load, firstController.signal);
    const second = cache.getOrLoad("all-cancelled", 1_000, load, secondController.signal);
    await Promise.resolve();
    firstController.abort(new Error("first cancelled"));
    secondController.abort(new Error("second cancelled"));
    await rejectionOf(first);
    await rejectionOf(second);

    pending.resolve({ ok: true });
    await Promise.resolve();
    await expect(cache.getOrLoad("all-cancelled", 1_000, load)).resolves.toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test("does not cache loader failures", async () => {
    const cache = createInflightJsonCache();
    const failure = new Error("upstream failed");
    let calls = 0;

    const first = cache.getOrLoad("failure", 1_000, async () => {
      calls += 1;
      throw failure;
    });
    expect(await rejectionOf(first)).toBe(failure);

    await expect(cache.getOrLoad("failure", 1_000, async () => {
      calls += 1;
      return "recovered";
    })).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });

  test("starts TTL after loader success", async () => {
    let now = 0;
    const cache = createInflightJsonCache({ now: () => now });
    let calls = 0;

    const load = async () => {
      calls += 1;
      now = 100;
      return calls;
    };

    await expect(cache.getOrLoad("ttl", 50, load)).resolves.toBe(1);
    now = 149;
    await expect(cache.getOrLoad("ttl", 50, load)).resolves.toBe(1);
    now = 150;
    await expect(cache.getOrLoad("ttl", 50, load)).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  test("zero-TTL loads do not evict a live positive-TTL entry", async () => {
    const cache = createInflightJsonCache({ maxEntries: 1, now: () => 0 });
    let positiveCalls = 0;
    let zeroCalls = 0;

    await expect(cache.getOrLoad("positive", 1_000, async () => {
      positiveCalls += 1;
      return "kept";
    })).resolves.toBe("kept");

    await expect(cache.getOrLoad("zero", 0, async () => {
      zeroCalls += 1;
      return "coalesced-only";
    })).resolves.toBe("coalesced-only");
    await expect(cache.getOrLoad("positive", 1_000, async () => {
      positiveCalls += 1;
      return "reloaded";
    })).resolves.toBe("kept");
    await expect(cache.getOrLoad("zero", 0, async () => {
      zeroCalls += 1;
      return "coalesced-only-again";
    })).resolves.toBe("coalesced-only-again");

    expect(positiveCalls).toBe(1);
    expect(zeroCalls).toBe(2);
  });

  test("same-key zero-TTL loads refetch without replacing the positive-TTL value", async () => {
    const cache = createInflightJsonCache({ now: () => 0 });
    let positiveCalls = 0;
    let zeroCalls = 0;

    await expect(cache.getOrLoad("same", 1_000, async () => {
      positiveCalls += 1;
      return "positive";
    })).resolves.toBe("positive");
    await expect(cache.getOrLoad("same", 0, async () => {
      zeroCalls += 1;
      return "zero";
    })).resolves.toBe("zero");
    await expect(cache.getOrLoad("same", 1_000, async () => {
      positiveCalls += 1;
      return "reloaded";
    })).resolves.toBe("positive");

    expect(positiveCalls).toBe(1);
    expect(zeroCalls).toBe(1);
  });

  test("same-key zero-TTL loads do not touch positive-entry LRU order", async () => {
    const cache = createInflightJsonCache({ maxEntries: 2, now: () => 0 });
    let aCalls = 0;
    let bCalls = 0;

    await cache.getOrLoad("a", 1_000, async () => { aCalls += 1; return "a"; });
    await cache.getOrLoad("b", 1_000, async () => { bCalls += 1; return "b"; });
    await expect(cache.getOrLoad("a", 0, async () => "zero")).resolves.toBe("zero");
    await cache.getOrLoad("c", 1_000, async () => "c");

    await expect(cache.getOrLoad("b", 1_000, async () => { bCalls += 1; return "reloaded-b"; })).resolves.toBe("b");
    await expect(cache.getOrLoad("a", 1_000, async () => { aCalls += 1; return "reloaded-a"; })).resolves.toBe("reloaded-a");
    expect(aCalls).toBe(2);
    expect(bCalls).toBe(1);
  });

  test("evicts the least recently used value after 128 entries", async () => {
    const cache = createInflightJsonCache();
    const calls = new Map<string, number>();
    const load = async (key: string) => {
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return key;
    };

    for (let index = 0; index < 128; index += 1) {
      const key = `key-${index}`;
      await cache.getOrLoad(key, 1_000, () => load(key));
    }
    await cache.getOrLoad("key-0", 1_000, () => load("key-0"));
    await cache.getOrLoad("key-128", 1_000, () => load("key-128"));

    await cache.getOrLoad("key-0", 1_000, () => load("key-0"));
    await cache.getOrLoad("key-1", 1_000, () => load("key-1"));
    expect(calls.get("key-0")).toBe(1);
    expect(calls.get("key-1")).toBe(2);
  });

  test("keeps different keys independent", async () => {
    const cache = createInflightJsonCache();
    const firstPending = deferred<string>();
    const secondPending = deferred<string>();
    let firstCalls = 0;
    let secondCalls = 0;

    const first = cache.getOrLoad("first", 1_000, () => {
      firstCalls += 1;
      return firstPending.promise;
    });
    const second = cache.getOrLoad("second", 1_000, () => {
      secondCalls += 1;
      return secondPending.promise;
    });
    await Promise.resolve();

    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
    firstPending.resolve("one");
    secondPending.resolve("two");
    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
  });
});
