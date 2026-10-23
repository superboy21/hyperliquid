import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useLiveOrderBook } from "../../hooks/use-live-order-book";
import { createBookSession, createBookSessionStore, createIdleBookState, type BookSessionDependencies } from "./session";
import { BookError } from "./types";
import type { BookFrame, BookSession, BookSessionOptions, BookTarget, BookWsOptions } from "./types";

const TARGET: BookTarget = { id: "spot:Gate.io:BTC_USDT", exchange: "Gate.io", kind: "spot", rawSymbol: "BTC_USDT", baseAsset: "BTC", quoteAsset: "USDT" };
const sessions: BookSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });

async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Clock {
  time = 0;
  sequence = 0;
  tasks = new Map<number, { due: number; callback: () => void }>();
  setTimeout: BookSessionDependencies["setTimeout"] = (callback, ms) => {
    const id = ++this.sequence;
    this.tasks.set(id, { due: this.time + ms, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout: BookSessionDependencies["clearTimeout"] = (timer) => { this.tasks.delete(timer as unknown as number); };
  async tick(ms: number) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      this.time = next[1].due;
      this.tasks.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.time = end;
    await flush();
  }
}

interface Open { options: BookWsOptions; closed: number }
function harness(config: {
  options?: Partial<BookSessionOptions>;
  target?: BookTarget;
  onOpen?: (open: Open, index: number) => void;
  dependencies?: Partial<BookSessionDependencies>;
} = {}) {
  const clock = new Clock();
  const target = config.target ?? TARGET;
  const requests: Array<ReturnType<typeof deferred<BookFrame>> & { bookMode: "normal" | "rpi"; signal?: AbortSignal }> = [];
  const opens: Open[] = [];
  const session = createBookSession(target, { bookMode: "normal", wsMode: false, ...config.options }, {
    now: () => clock.time, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    fetchRest: (_target, options) => { const d = deferred<BookFrame>(); requests.push({ ...d, ...options }); return d.promise; },
    openWs: (_target, options) => {
      const open = { options, closed: 0 };
      opens.push(open);
      config.onOpen?.(open, opens.length - 1);
      return () => { open.closed++; options.onError(new BookError("network", "Socket closed during cleanup")); };
    },
    ...config.dependencies,
  });
  sessions.push(session);
  function frame(transport: "rest" | "ws" = "rest", bookMode: "normal" | "rpi" = "normal", receivedAtMs = clock.time): BookFrame {
    return { targetId: target.id, baseAsset: target.baseAsset, quantityUnit: "base", book: {
      bids: [{ price: 100, quantity: 2 }], asks: [{ price: 101, quantity: 3 }],
    }, source: { transport, bookMode, route: `${bookMode}-${transport}` }, receivedAtMs, exchangeTimeMs: null, sequence: null };
  }
  return { session, requests, opens, clock, frame };
}

describe("REST book sessions", () => {
  test("fetches immediately, waits five seconds after completion, and never overlaps", async () => {
    const h = harness();
    expect(h.requests).toHaveLength(1);
    expect(h.session.getState().status).toBe("connecting");
    await h.clock.tick(8_000);
    expect(h.requests).toHaveLength(1);
    h.requests[0].resolve(h.frame()); await flush();
    expect(h.session.getState().status).toBe("live");
    await h.clock.tick(4_999); expect(h.requests).toHaveLength(1);
    await h.clock.tick(1); expect(h.requests).toHaveLength(2);
    await h.clock.tick(8_000); expect(h.requests).toHaveLength(2);
    h.requests[1].resolve(h.frame()); await flush();
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(3);
  });

  test("final REST failures keep polling and can recover", async () => {
    const h = harness();
    h.requests[0].reject(new BookError("network", "offline")); await flush();
    expect(h.session.getState()).toMatchObject({ status: "error", error: { code: "network" }, frame: null });
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(2);
    h.requests[1].reject(new BookError("timeout", "deadline")); await flush();
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(3);
    h.requests[2].resolve(h.frame()); await flush();
    expect(h.session.getState()).toMatchObject({ status: "live", error: null, updated: 10_000 });
  });

  test("RPI REST downgrades explicitly to normal REST, never a socket", async () => {
    const h = harness({ options: { bookMode: "rpi" } });
    expect(h.requests[0].bookMode).toBe("rpi");
    h.requests[0].reject(new BookError("unauthorized", "RPI not permitted")); await flush();
    expect(h.opens).toHaveLength(0);
    expect(h.requests.map((r) => r.bookMode)).toEqual(["rpi", "normal"]);
    expect(h.session.getState().notices[0]).toMatchObject({ reason: "unauthorized", from: { transport: "rest", bookMode: "rpi" }, to: { transport: "rest", bookMode: "normal" } });
    expect(h.session.getState().notices[0].message).toContain("RPI not permitted");
    h.requests[1].resolve(h.frame()); await flush();
    expect(h.session.getState().frame?.source.bookMode).toBe("normal");
  });

  test("rejects silently-normalized RPI source and retries it explicitly as normal", async () => {
    const h = harness({ options: { bookMode: "rpi" } });
    h.requests[0].resolve(h.frame()); await flush();
    expect(h.session.getState().frame).toBeNull();
    expect(h.requests[1].bookMode).toBe("normal");
    expect(h.session.getState().notices[0].reason).toBe("invalid-payload");
  });

  test("failed refresh preserves the old frame and source as stale", async () => {
    const h = harness(); h.requests[0].resolve(h.frame("rest", "normal", 17)); await flush();
    const old = h.session.getState().frame;
    await h.clock.tick(5_000);
    h.requests[1].reject(new BookError("network", "refresh failed")); await flush();
    expect(h.session.getState()).toMatchObject({ status: "stale", updated: 17 });
    expect(h.session.getState().frame).toBe(old);
    expect(h.session.getState().frame?.source.route).toBe("normal-rest");
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(3);
  });

  test("missing quantity metadata fails closed and keeps final REST retryable", async () => {
    const h = harness({ target: { ...TARGET, kind: "perp" } });
    h.requests[0].reject(new BookError("metadata-unavailable", "No contract multiplier")); await flush();
    expect(h.session.getState().frame).toBeNull();
    expect(h.session.getState().error?.code).toBe("metadata-unavailable");
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(2);
  });

  test("a hung refresh times out stale, retries after five seconds, and cannot overwrite recovery late", async () => {
    const h = harness();
    h.requests[0].resolve(h.frame("rest", "normal", 1)); await flush();
    const original = h.session.getState().frame;
    await h.clock.tick(5_000);
    const hung = h.requests[1];
    expect(hung.signal).not.toBe(h.requests[0].signal);
    await h.clock.tick(9_999);
    expect(h.session.getState().status).toBe("live");
    await h.clock.tick(1);
    expect(hung.signal?.aborted).toBe(true);
    expect(hung.signal?.reason).toBeInstanceOf(BookError);
    expect(h.session.getState()).toMatchObject({ status: "stale", error: { code: "timeout" }, updated: 1 });
    expect(h.session.getState().frame).toBe(original);
    expect(h.session.getState().frame?.source).toEqual(original?.source);
    expect(h.clock.tasks.size).toBe(1); // Only the next poll, not the expired deadline.
    await h.clock.tick(4_999); expect(h.requests).toHaveLength(2);
    await h.clock.tick(1); expect(h.requests).toHaveLength(3);
    expect(h.requests[2].signal?.aborted).toBe(false);
    h.requests[2].resolve(h.frame("rest", "normal", 20_000)); await flush();
    const recovered = h.session.getState();
    expect(recovered).toMatchObject({ status: "live", updated: 20_000, error: null });
    hung.resolve({ ...h.frame("rest", "normal", 99_999), source: { transport: "rest", bookMode: "normal", route: "late-hung-request" } });
    await flush();
    expect(h.session.getState()).toBe(recovered);
    expect(h.clock.tasks.size).toBe(1);
    expect(h.requests).toHaveLength(3);
  });

  test("a cooperative abort during an RPI deadline is timeout, not user cancellation", async () => {
    const h = harness({ options: { bookMode: "rpi" } });
    const first = h.requests[0];
    first.signal?.addEventListener("abort", () => first.reject(new DOMException("Fetch aborted", "AbortError")), { once: true });
    await h.clock.tick(10_000);
    expect(h.requests.map((request) => request.bookMode)).toEqual(["rpi", "normal"]);
    expect(first.signal?.aborted).toBe(true);
    expect(h.requests[1].signal?.aborted).toBe(false);
    expect(h.session.getState()).toMatchObject({ status: "connecting", error: { code: "timeout" } });
    expect(h.session.getState().notices).toHaveLength(1);
    expect(h.session.getState().notices[0].reason).toBe("timeout");
    h.requests[1].resolve(h.frame()); await flush();
    expect(h.session.getState()).toMatchObject({ status: "live", error: null });
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(3);
    expect(h.requests[2].bookMode).toBe("normal");
  });

  test("switching REST candidates aborts the old child and removes its earlier deadline", async () => {
    const h = harness({ options: { bookMode: "rpi" } });
    await h.clock.tick(8_000);
    h.requests[0].reject(new BookError("network", "RPI transport failed")); await flush();
    expect(h.requests).toHaveLength(2);
    expect(h.requests[0].signal?.aborted).toBe(true);
    expect(h.requests[1].signal?.aborted).toBe(false);
    expect(h.clock.tasks.size).toBe(1);
    await h.clock.tick(2_000); // The retired candidate's original deadline.
    expect(h.session.getState()).toMatchObject({ status: "connecting", error: { code: "network" } });
    expect(h.session.getState().notices).toHaveLength(1);
    expect(h.requests[1].signal?.aborted).toBe(false);
    h.requests[1].resolve(h.frame()); await flush();
    expect(h.session.getState()).toMatchObject({ status: "live", error: null });
  });

  test("the single-request timeout is injectable and also bounds an abort-ignoring first request", async () => {
    const h = harness({ dependencies: { restRequestTimeoutMs: 1_200 } });
    await h.clock.tick(1_199); expect(h.session.getState().status).toBe("connecting");
    await h.clock.tick(1);
    expect(h.session.getState()).toMatchObject({ status: "error", error: { code: "timeout" } });
    expect(h.requests[0].signal?.aborted).toBe(true);
    await h.clock.tick(5_000); expect(h.requests).toHaveLength(2);
  });

  test("dispose aborts the child request and synchronously removes its deadline", async () => {
    const h = harness();
    expect(h.clock.tasks.size).toBe(1);
    h.session.dispose();
    expect(h.requests[0].signal?.aborted).toBe(true);
    expect(h.clock.tasks.size).toBe(0);
    h.requests[0].reject(new Error("Late failure from ignored abort")); await flush();
    await h.clock.tick(20_000);
    expect(h.session.getState()).toMatchObject({ status: "closed", frame: null });
    expect(h.requests).toHaveLength(1);
    expect(h.clock.tasks.size).toBe(0);
  });

  test("a completed request clears its deadline before the next five-second poll", async () => {
    const h = harness();
    await h.clock.tick(9_999);
    h.requests[0].resolve(h.frame()); await flush();
    expect(h.clock.tasks.size).toBe(1);
    await h.clock.tick(1);
    expect(h.session.getState()).toMatchObject({ status: "live", error: null });
    expect(h.requests[0].signal?.aborted).toBe(false);
    h.session.dispose();
    // Parent cancellation no longer cascades to the completed request.
    expect(h.requests[0].signal?.aborted).toBe(false);
    expect(h.clock.tasks.size).toBe(0);
  });

  test("synchronous REST throws clean their deadline and cannot reject a detached race", async () => {
    const h = harness({ options: { bookMode: "rpi" }, dependencies: {
      fetchRest: () => { throw new BookError("network", "Synchronous transport failure"); },
    } });
    await flush();
    expect(h.session.getState().attempt).toEqual({ transport: "rest", bookMode: "normal" });
    expect(h.session.getState().status).toBe("error");
    expect(h.session.getState().notices).toHaveLength(1);
    expect(h.clock.tasks.size).toBe(1);
    h.session.dispose();
    expect(h.clock.tasks.size).toBe(0);
    await flush();
  });
});

describe("WS book sessions", () => {
  test("does not become live or fetch REST until a valid WS frame or failure", async () => {
    const h = harness({ options: { wsMode: true } });
    expect(h.opens).toHaveLength(1); expect(h.requests).toHaveLength(0);
    expect(h.session.getState().status).toBe("connecting");
    await h.clock.tick(9_999);
    expect(h.session.getState().frame).toBeNull();
    h.opens[0].options.onFrame(h.frame("ws"));
    expect(h.session.getState().status).toBe("live");
    await h.clock.tick(20_000);
    expect(h.requests).toHaveLength(0);
    expect(h.opens).toHaveLength(1);
  });

  test("first-frame deadlines downgrade both WS stages then try RPI REST before normal REST", async () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" } });
    await h.clock.tick(10_000);
    expect(h.opens.map((x) => x.options.bookMode)).toEqual(["rpi", "normal"]);
    expect(h.requests).toHaveLength(0);
    await h.clock.tick(10_000);
    expect(h.requests.map((x) => x.bookMode)).toEqual(["rpi"]);
    expect(h.opens.map((x) => x.closed)).toEqual([1, 1]);
    expect(h.session.getState().notices.map((x) => x.reason)).toEqual(["timeout", "timeout"]);
    h.requests[0].reject(new BookError("network", "RPI REST failed")); await flush();
    expect(h.requests.map((x) => x.bookMode)).toEqual(["rpi", "normal"]);
  });

  test("dynamic unsupported and socket close retain WS priority before RPI REST", async () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" } });
    h.opens[0].options.onError(new BookError("unsupported", "Unknown RPI channel"));
    expect(h.opens).toHaveLength(2); expect(h.requests).toHaveLength(0);
    h.opens[1].options.onError(new BookError("network", "Socket closed 1006"));
    expect(h.requests.map((x) => x.bookMode)).toEqual(["rpi"]);
    expect(h.session.getState().notices.map((x) => x.reason)).toEqual(["unsupported", "network"]);
    expect(h.session.getState().notices[1].message).toContain("1006");
    h.requests[0].reject(new BookError("network", "RPI REST failed")); await flush();
    expect(h.requests.map((x) => x.bookMode)).toEqual(["rpi", "normal"]);
  });

  test("both WS failures fall back to RPI REST, poll every five seconds, and ignore late WS frames", async () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" } });
    const lateRpiWs = h.opens[0].options;
    h.opens[0].options.onError(new BookError("network", "RPI WS failed"));
    const lateNormalWs = h.opens[1].options;
    h.opens[1].options.onError(new BookError("network", "normal WS failed"));
    expect(h.requests.map(request => request.bookMode)).toEqual(["rpi"]);
    h.requests[0].resolve(h.frame("rest", "rpi", 123)); await flush();
    const accepted = h.session.getState().frame;
    expect(accepted?.source).toEqual({ transport: "rest", bookMode: "rpi", route: "rpi-rest" });
    expect(h.session.getState().status).toBe("live");
    lateRpiWs.onFrame(h.frame("ws", "rpi", 999));
    lateNormalWs.onFrame(h.frame("ws", "normal", 1_000));
    expect(h.session.getState().frame).toBe(accepted);
    await h.clock.tick(4_999); expect(h.requests).toHaveLength(1);
    await h.clock.tick(1); expect(h.requests.map(request => request.bookMode)).toEqual(["rpi", "rpi"]);
  });

  test("sequence gaps mark the retained RPI frame stale without relabeling it", () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" } });
    h.opens[0].options.onFrame(h.frame("ws", "rpi", 42));
    const old = h.session.getState().frame;
    h.opens[0].options.onError(new BookError("sequence-gap", "Missing U/u"));
    expect(h.session.getState()).toMatchObject({ status: "stale", updated: 42, attempt: { transport: "ws", bookMode: "normal" } });
    expect(h.session.getState().frame).toBe(old);
    expect(h.session.getState().frame?.source).toEqual({ transport: "ws", bookMode: "rpi", route: "rpi-ws" });
    h.opens[0].options.onFrame(h.frame("ws", "rpi", 100));
    h.opens[0].options.onError(new BookError("network", "late close"));
    expect(h.session.getState().updated).toBe(42); expect(h.opens).toHaveLength(2);
    h.opens[1].options.onFrame(h.frame("ws", "normal", 101));
    expect(h.session.getState()).toMatchObject({ status: "live", error: null, updated: 101, frame: { source: { bookMode: "normal" } } });
  });

  test("authorization errors have an explicit notice and advance normally", () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" } });
    h.opens[0].options.onError(new BookError("unauthorized", "Channel requires authorization"));
    expect(h.session.getState().notices[0].reason).toBe("unauthorized");
    expect(h.opens[1].options.bookMode).toBe("normal");
  });

  test("UI emissions are throttled but the latest full adapter state wins", async () => {
    const h = harness({ options: { wsMode: true } });
    h.opens[0].options.onFrame(h.frame("ws", "normal", 1));
    h.opens[0].options.onFrame(h.frame("ws", "normal", 2));
    h.opens[0].options.onFrame(h.frame("ws", "normal", 3));
    expect(h.session.getState().updated).toBe(1);
    await h.clock.tick(149); expect(h.session.getState().updated).toBe(1);
    await h.clock.tick(1); expect(h.session.getState().updated).toBe(3);
    h.opens[0].options.onFrame(h.frame("ws", "normal", 4));
    h.opens[0].options.onError(new BookError("network", "connection lost"));
    await h.clock.tick(150);
    expect(h.session.getState().updated).toBe(3);
    expect(h.session.getState().status).toBe("stale");
  });

  test("synchronous mock error cleans its returned handle without overwriting the new generation", () => {
    const h = harness({ options: { wsMode: true, bookMode: "rpi" }, onOpen: (open, index) => {
      if (index === 0) open.options.onError(new BookError("network", "sync failure"));
    } });
    expect(h.opens).toHaveLength(2);
    expect(h.opens.map((x) => x.closed)).toEqual([1, 0]);
    h.session.dispose();
    expect(h.opens.map((x) => x.closed)).toEqual([1, 1]);
    expect(h.requests).toHaveLength(0);
    expect(h.clock.tasks.size).toBe(0);
  });

  test("synchronous valid frame cancels the first-frame timer", async () => {
    const h = harness({ options: { wsMode: true }, onOpen: (open) => open.options.onFrame({
      targetId: TARGET.id, baseAsset: "BTC", quantityUnit: "base", source: { transport: "ws", bookMode: "normal", route: "synchronous" },
      book: { bids: [], asks: [] }, receivedAtMs: 0, exchangeTimeMs: null, sequence: null,
    }) });
    expect(h.session.getState().status).toBe("live");
    await h.clock.tick(11_000); expect(h.requests).toHaveLength(0);
  });

  test("a synchronous throw from the opener triggers the same fallback policy", () => {
    const h = harness({ options: { wsMode: true }, onOpen: () => { throw new BookError("unsupported", "Browser WS unavailable"); } });
    expect(h.requests).toHaveLength(1);
    expect(h.session.getState().notices[0].reason).toBe("unsupported");
  });
});

describe("session identity, abort and observability", () => {
  test("unsupported products do not silently claim to be RPI", () => {
    const h = harness({ target: { ...TARGET, exchange: "Hyperliquid" }, options: { wsMode: true, bookMode: "rpi" } });
    expect(h.opens[0].options.bookMode).toBe("normal");
    expect(h.session.getState()).toMatchObject({ requested: { transport: "ws", bookMode: "rpi" }, attempt: { transport: "ws", bookMode: "normal" } });
    expect(h.session.getState().notices[0].code).toBe("unsupported");
    h.opens[0].options.onError(new BookError("network", "normal WS failed"));
    expect(h.requests.map(request => request.bookMode)).toEqual(["normal"]);
  });

  test("rToken bypasses both WS and RPI with a policy notice", () => {
    const h = harness({ target: { ...TARGET, exchange: "Bitget", isRealityToken: true }, options: { wsMode: true, bookMode: "rpi" } });
    expect(h.opens).toHaveLength(0); expect(h.requests[0].bookMode).toBe("normal");
    expect(h.session.getState().notices[0]).toMatchObject({ code: "policy", reason: "reality-token" });
  });

  test("dispose aborts pending REST, ignores late completion, and clears all timers", async () => {
    const h = harness(); h.session.dispose(); h.session.dispose();
    expect(h.requests[0].signal?.aborted).toBe(true);
    h.requests[0].resolve(h.frame()); await flush();
    await h.clock.tick(20_000);
    expect(h.session.getState()).toMatchObject({ status: "closed", frame: null, updated: null });
    expect(h.requests).toHaveLength(1); expect(h.clock.tasks.size).toBe(0);
  });

  test("external abort closes a socket once and prevents cleanup callbacks from downgrading", async () => {
    const controller = new AbortController();
    const h = harness({ options: { signal: controller.signal, wsMode: true, bookMode: "rpi" } });
    controller.abort(); await h.clock.tick(30_000);
    expect(h.opens).toHaveLength(1); expect(h.opens[0].closed).toBe(1);
    expect(h.opens[0].options.signal.aborted).toBe(true);
    expect(h.requests).toHaveLength(0); expect(h.session.getState().status).toBe("closed");
  });

  test("an already-aborted caller starts no work", () => {
    const controller = new AbortController(); controller.abort();
    const h = harness({ options: { signal: controller.signal, wsMode: true } });
    expect(h.opens).toHaveLength(0); expect(h.requests).toHaveLength(0);
    expect(h.session.getState().status).toBe("closed");
  });

  test("AbortError never becomes a normal-book fallback", async () => {
    const h = harness({ options: { bookMode: "rpi" } });
    h.requests[0].reject(new DOMException("Canceled", "AbortError")); await flush();
    expect(h.requests).toHaveLength(1); expect(h.session.getState().notices).toHaveLength(0);
    expect(h.session.getState().status).toBe("closed");
  });

  test("wrong market/base units and malformed frames never enter the public state", async () => {
    const h = harness({ options: { wsMode: true } });
    h.opens[0].options.onFrame({ ...h.frame("ws"), targetId: "other-market" });
    expect(h.session.getState().frame).toBeNull();
    expect(h.session.getState().notices[0].reason).toBe("invalid-payload");
    h.requests[0].resolve({ ...h.frame(), baseAsset: "CONTRACTS" }); await flush();
    expect(h.session.getState().frame).toBeNull();
    expect(h.session.getState().error?.code).toBe("invalid-payload");
    await h.clock.tick(5_000);
    h.requests[1].resolve(null as unknown as BookFrame); await flush();
    expect(h.session.getState().frame).toBeNull();
  });

  test("snapshots are cached and adapter-owned arrays cannot mutate accepted data", () => {
    const h = harness({ options: { wsMode: true } });
    let calls = 0; const off = h.session.subscribe(() => calls++);
    const frame = h.frame("ws"); h.opens[0].options.onFrame(frame);
    const state = h.session.getState(); expect(h.session.getState()).toBe(state);
    frame.book.bids[0].quantity = 100; frame.source.route = "mutated";
    expect(state.frame?.book.bids[0].quantity).toBe(2);
    expect(state.frame?.source.route).toBe("normal-ws");
    expect(calls).toBe(1); off(); h.session.dispose(); expect(calls).toBe(1);
  });

  test("idle state exposes the entire stable hook contract", () => {
    expect(createIdleBookState({ wsMode: false, bookMode: "normal" })).toEqual({
      requested: { transport: "rest", bookMode: "normal" }, attempt: null, frame: null,
      status: "idle", notices: [], error: null, updated: null,
    });
  });
});

describe("the hook's lazy external store", () => {
  test("the actual hook renders a deterministic idle server snapshot", () => {
    function Probe() {
      const state = useLiveOrderBook(TARGET, { enabled: true, bookMode: "rpi", wsMode: true });
      return `${state.status}:${state.requested.transport}:${state.requested.bookMode}:${String(state.frame)}`;
    }
    expect(renderToString(createElement(Probe))).toBe("idle:ws:rpi:null");
  });
  test("construction/SSR never opens a connection, and disabled or null targets never start I/O", () => {
    let calls = 0;
    const dependencies: Partial<BookSessionDependencies> = { fetchRest: async () => { calls++; throw new Error("not called"); } };
    for (const [target, enabled] of [[TARGET, false], [null, true], [TARGET, true]] as const) {
      const store = createBookSessionStore(target, { enabled, bookMode: "normal", wsMode: false }, dependencies);
      expect(store.getSnapshot()).toBe(store.getServerSnapshot());
      expect(store.getServerSnapshot().status).toBe("idle");
      if (!enabled || target === null) {
        const off = store.subscribe(() => {}); off();
        expect(store.getSnapshot().status).toBe("idle");
      }
    }
    expect(calls).toBe(0);
  });

  test("subscribers share one session; final cleanup aborts it; StrictMode resubscribe creates a fresh generation", async () => {
    const clock = new Clock();
    const pending: Array<ReturnType<typeof deferred<BookFrame>> & { signal?: AbortSignal }> = [];
    const store = createBookSessionStore(TARGET, { enabled: true, wsMode: false, bookMode: "normal" }, {
      now: () => clock.time, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      fetchRest: (_target, options) => { const d = deferred<BookFrame>(); pending.push({ ...d, signal: options.signal }); return d.promise; },
    });
    const first = store.subscribe(() => {}), second = store.subscribe(() => {});
    expect(pending).toHaveLength(1);
    first(); expect(pending[0].signal?.aborted).toBe(false);
    second(); expect(pending[0].signal?.aborted).toBe(true);
    expect(store.getSnapshot().status).toBe("idle");
    const third = store.subscribe(() => {});
    expect(pending).toHaveLength(2);
    second(); // An old duplicate cleanup must not dispose the new subscription.
    expect(pending[1].signal?.aborted).toBe(false);
    pending[0].resolve({ targetId: TARGET.id, baseAsset: "BTC", quantityUnit: "base", book: { bids: [], asks: [] },
      source: { transport: "rest", bookMode: "normal", route: "old-generation" }, receivedAtMs: 7, exchangeTimeMs: null, sequence: null });
    await flush();
    expect(store.getSnapshot().frame).toBeNull();
    third(); expect(pending[1].signal?.aborted).toBe(true);
    expect(clock.tasks.size).toBe(0);
  });

  test("a changed selected target gets a different idle store without showing the previous book", async () => {
    const h = harness(); h.requests[0].resolve(h.frame()); await flush();
    expect(h.session.getState().status).toBe("live");
    const next = createBookSessionStore({ ...TARGET, id: "spot:ETH", rawSymbol: "ETH_USDT", baseAsset: "ETH" },
      { enabled: true, bookMode: "normal", wsMode: false });
    expect(next.getSnapshot()).toMatchObject({ status: "idle", frame: null, updated: null });
    h.session.dispose();
  });

  test("duplicate listener identities still have independent unsubscribe lifetimes", () => {
    const clock = new Clock();
    let signal: AbortSignal | undefined;
    const store = createBookSessionStore(TARGET, { enabled: true, wsMode: true, bookMode: "normal" }, {
      now: () => clock.time, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      openWs: (_target, options) => { signal = options.signal; return () => {}; },
    });
    const listener = () => {};
    const off1 = store.subscribe(listener), off2 = store.subscribe(listener);
    off1(); expect(signal?.aborted).toBe(false);
    off2(); expect(signal?.aborted).toBe(true);
    expect(clock.tasks.size).toBe(0);
  });
});
