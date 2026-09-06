import "server-only";

export interface InflightJsonCacheOptions {
  /** Maximum number of successfully cached values. Set to zero to disable storage. */
  maxEntries?: number;
  /** Injectable clock, primarily for deterministic tests. */
  now?: () => number;
  /** Alias for `now`, useful when passing a clock implementation directly. */
  clock?: () => number;
}

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type Loader<T> = () => T | PromiseLike<T>;

const DEFAULT_MAX_ENTRIES = 128;

/**
 * A server-side cache for already parsed values which also coalesces loads.
 *
 * The loader is deliberately not given an AbortSignal. A caller's signal only
 * controls that caller's wait, so one cancelled request cannot cancel a load
 * that other callers may be waiting for.
 */
export class InflightJsonCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InflightJsonCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError("maxEntries must be a non-negative integer");
    }

    this.maxEntries = maxEntries;
    this.now = options.now ?? options.clock ?? Date.now;
  }

  /**
   * Return a cached value, join an existing load, or start a new load.
   *
   * `loader` must return the parsed JSON value to cache; Response objects are
   * intentionally not part of this API. TTL begins when the loader succeeds.
   */
  getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: Loader<T>,
    callerSignal?: AbortSignal,
  ): Promise<T> {
    if (callerSignal?.aborted) {
      return Promise.reject(callerSignal.reason);
    }

    if (ttlMs !== 0) {
      const cached = this.entries.get(key);
      if (cached !== undefined) {
        if (this.now() < cached.expiresAt) {
          // Map insertion order is the LRU order.
          this.entries.delete(key);
          this.entries.set(key, cached);
          return this.waitForCaller(Promise.resolve(cached.value as T), callerSignal);
        }
        this.entries.delete(key);
      }
    }

    let shared = this.inFlight.get(key) as Promise<T> | undefined;
    if (shared === undefined) {
      shared = Promise.resolve().then(loader) as Promise<T>;
      this.inFlight.set(key, shared);

      // Attach both outcomes immediately. In particular, an aborted final
      // waiter must not turn a later loader rejection into an unhandled one.
      void shared.then(
        (value) => {
          if (this.inFlight.get(key) === shared) {
            this.inFlight.delete(key);
            this.store(key, value, ttlMs);
          }
        },
        () => {
          if (this.inFlight.get(key) === shared) {
            this.inFlight.delete(key);
          }
        },
      );
    }

    return this.waitForCaller(shared, callerSignal);
  }

  /** Remove cached values. Active loads remain shared and are never aborted. */
  clear(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(key);
    }
  }

  private store(key: string, value: unknown, ttlMs: number): void {
    // A zero TTL is an in-flight coalescing request, not a completed-value
    // cache entry. In particular, it must not evict an unrelated live entry.
    if (ttlMs === 0 || this.maxEntries === 0) return;

    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttlMs,
    });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  private waitForCaller<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined) return shared;

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal.reason);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      shared.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );

      if (signal.aborted) onAbort();
    });
  }
}

export function createInflightJsonCache(options?: InflightJsonCacheOptions): InflightJsonCache {
  return new InflightJsonCache(options);
}
