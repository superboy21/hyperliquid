import { createBookAttemptPlan } from "./capabilities";
import { BookError } from "./types";
import type {
  BookAttempt, BookFrame, BookRestFetcher, BookSession, BookSessionOptions,
  BookSessionState, BookTarget, BookWsOpener,
} from "./types";

type Timer = ReturnType<typeof setTimeout>;

export interface BookSessionDependencies {
  fetchRest: BookRestFetcher;
  openWs: BookWsOpener;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  pollIntervalMs: number;
  restRequestTimeoutMs: number;
  firstFrameTimeoutMs: number;
  wsEmitIntervalMs: number;
}

function bookError(error: unknown): BookError {
  return error instanceof BookError ? error : new BookError("network", error instanceof Error ? error.message : "盘口请求失败");
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Lazy imports keep the engine testable without loading a browser socket or
// exchange transport. They also avoid doing work for disabled/unmounted hooks.
const defaultFetchRest: BookRestFetcher = async (target, options) => {
  const { fetchOrderBookRest } = await import("./rest");
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  return fetchOrderBookRest(target, options);
};

const defaultOpenWs: BookWsOpener = (target, options) => {
  let closed = false;
  let cleanup: (() => void) | undefined;
  void import("./ws").then(({ openBookWs }) => {
    if (closed || options.signal.aborted) return;
    const close = openBookWs(target, options);
    if (closed || options.signal.aborted) close();
    else cleanup = close;
  }).catch((error: unknown) => {
    if (!closed && !options.signal.aborted) options.onError(bookError(error));
  });
  return () => { closed = true; cleanup?.(); cleanup = undefined; };
};

export function createIdleBookState(options: Pick<BookSessionOptions, "bookMode" | "wsMode">): BookSessionState {
  return {
    requested: { transport: options.wsMode ? "ws" : "rest", bookMode: options.bookMode },
    attempt: null, frame: null, status: "idle", notices: [], error: null, updated: null,
  };
}

interface Run {
  generation: number;
  controller: AbortController;
  attempt: BookAttempt;
  ended: boolean;
  cleanup?: () => void;
  firstTimer?: Timer;
  pollTimer?: Timer;
  emitTimer?: Timer;
  restRequest?: object;
  firstFrame: boolean;
  pending?: BookFrame;
  emittedAt: number;
}

function label(attempt: BookAttempt): string {
  return `${attempt.bookMode === "rpi" ? "RPI" : "普通"} ${attempt.transport.toUpperCase()}`;
}

function validFrame(frame: BookFrame, target: BookTarget, attempt: BookAttempt): boolean {
  return !!frame && frame.targetId === target.id && frame.baseAsset === target.baseAsset && frame.quantityUnit === "base"
    && frame.source?.transport === attempt.transport && frame.source.bookMode === attempt.bookMode
    && typeof frame.source.route === "string" && frame.source.route.length > 0
    && Number.isFinite(frame.receivedAtMs)
    && (frame.exchangeTimeMs === null || Number.isFinite(frame.exchangeTimeMs))
    && (frame.sequence === null || typeof frame.sequence === "string")
    && [frame.book?.bids, frame.book?.asks].every((levels) => Array.isArray(levels)
      && levels.every((level) => !!level && Number.isFinite(level.price) && level.price > 0
        && Number.isFinite(level.quantity) && level.quantity > 0));
}

function copyFrame(frame: BookFrame): BookFrame {
  return { ...frame, source: { ...frame.source }, book: {
    bids: frame.book.bids.map((level) => ({ ...level })),
    asks: frame.book.asks.map((level) => ({ ...level })),
  } };
}

export function createBookSession(
  target: BookTarget,
  options: BookSessionOptions,
  overrides: Partial<BookSessionDependencies> = {},
): BookSession {
  const deps: BookSessionDependencies = {
    fetchRest: defaultFetchRest, openWs: defaultOpenWs, now: Date.now,
    setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (timer) => clearTimeout(timer),
    pollIntervalMs: 5_000, restRequestTimeoutMs: 10_000, firstFrameTimeoutMs: 10_000, wsEmitIntervalMs: 150,
    ...overrides,
  };
  const plan = createBookAttemptPlan(target, options);
  let state: BookSessionState = { ...createIdleBookState(options),
    notices: plan.notices.map((notice, index) => ({ ...notice, id: index + 1 })) };
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let active: Run | undefined;

  function update(patch: Partial<BookSessionState>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }
  function current(run: Run): boolean {
    return !disposed && active === run && run.generation === generation && !run.ended && !run.controller.signal.aborted;
  }
  function end(run: Run) {
    run.ended = true;
    if (active === run) active = undefined;
    run.restRequest = undefined;
    for (const timer of [run.firstTimer, run.pollTimer, run.emitTimer]) if (timer !== undefined) deps.clearTimeout(timer);
    run.pending = undefined;
    // Invalidate before abort/close: mocks and real adapters can report close synchronously.
    run.controller.abort();
    const close = run.cleanup;
    run.cleanup = undefined;
    try { close?.(); } catch { /* Cleanup must not resurrect a disposed session. */ }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    options.signal?.removeEventListener("abort", dispose);
    if (active) end(active);
    update({ status: "closed", attempt: null });
    listeners.clear();
  }
  function emit(run: Run, frame: BookFrame) {
    if (!current(run)) return;
    run.emittedAt = deps.now();
    update({ frame, status: "live", error: null, updated: frame.receivedAtMs });
  }
  function accept(run: Run, incoming: BookFrame, index: number) {
    if (!current(run)) return;
    if (!validFrame(incoming, target, run.attempt)) {
      fail(run, new BookError("invalid-payload", "盘口的市场、数量单位或实际来源与当前请求不一致"), index);
      return;
    }
    const frame = copyFrame(incoming);
    const first = !run.firstFrame;
    run.firstFrame = true;
    if (run.firstTimer !== undefined) deps.clearTimeout(run.firstTimer);
    run.firstTimer = undefined;
    if (run.attempt.transport === "rest" || first || deps.now() - run.emittedAt >= deps.wsEmitIntervalMs) {
      if (run.emitTimer !== undefined) deps.clearTimeout(run.emitTimer);
      run.emitTimer = undefined;
      run.pending = undefined;
      emit(run, frame);
    } else {
      run.pending = frame;
      if (run.emitTimer === undefined) run.emitTimer = deps.setTimeout(() => {
        run.emitTimer = undefined;
        const pending = run.pending;
        run.pending = undefined;
        if (pending) emit(run, pending);
      }, Math.max(0, deps.wsEmitIntervalMs - (deps.now() - run.emittedAt)));
    }
  }
  function fail(run: Run, error: unknown, index: number) {
    if (!current(run)) return;
    if (isAbort(error)) { dispose(); return; }
    const failure = bookError(error);
    update({ status: state.frame ? "stale" : "error", error: failure });
    if (!current(run)) return;
    const next = plan.attempts[index + 1];
    if (next) {
      update({ notices: [...state.notices, {
        id: state.notices.length + 1, code: failure.code === "unsupported" ? "unsupported" : "fallback",
        reason: failure.code, from: run.attempt, to: next,
        message: `${label(run.attempt)} 不可用：${failure.message}；改用 ${label(next)}。`,
      }] });
      if (current(run)) start(index + 1);
    }
  }
  async function poll(run: Run, index: number) {
    if (!current(run) || run.restRequest !== undefined) return;
    // Each poll owns its own signal and identity. A timed-out fetch may ignore
    // abort and finish during a later poll, but cannot publish into that poll.
    const request = {};
    run.restRequest = request;
    const controller = new AbortController();
    let timer: Timer | undefined;
    let interrupted = false;
    let rejectInterruption!: (reason: unknown) => void;
    const interruption = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
    function cleanupRequest() {
      if (timer !== undefined) deps.clearTimeout(timer);
      timer = undefined;
      run.controller.signal.removeEventListener("abort", parentAborted);
    }
    function interrupt(reason: unknown) {
      if (interrupted) return;
      interrupted = true;
      // Win the race before abort listeners can reject fetch with AbortError:
      // an internal deadline is a timeout, never caller cancellation.
      rejectInterruption(reason);
      cleanupRequest();
      controller.abort(reason);
    }
    function parentAborted() {
      interrupt(run.controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
    }
    run.controller.signal.addEventListener("abort", parentAborted, { once: true });
    timer = deps.setTimeout(() => interrupt(new BookError("timeout", `${label(run.attempt)} 单轮请求超时`)), deps.restRequestTimeoutMs);
    try {
      if (run.controller.signal.aborted) parentAborted();
      let pending: Promise<BookFrame>;
      try {
        pending = controller.signal.aborted ? interruption
          : deps.fetchRest(target, { bookMode: run.attempt.bookMode, signal: controller.signal });
      } catch (error) {
        pending = Promise.reject(error);
      }
      const frame = await Promise.race([pending, interruption]);
      if (run.restRequest === request) accept(run, frame, index);
    } catch (error) {
      if (run.restRequest === request) fail(run, error, index);
    } finally {
      cleanupRequest();
      if (run.restRequest === request) run.restRequest = undefined;
      // Schedule after settlement: neither slow requests nor repeated failures overlap.
      if (current(run)) run.pollTimer = deps.setTimeout(() => { run.pollTimer = undefined; void poll(run, index); }, deps.pollIntervalMs);
    }
  }
  function start(index: number) {
    if (disposed) return;
    if (active) end(active);
    const run: Run = { generation: ++generation, controller: new AbortController(), attempt: plan.attempts[index],
      ended: false, firstFrame: false, emittedAt: Number.NEGATIVE_INFINITY };
    active = run;
    update({ attempt: run.attempt, status: state.frame ? "stale" : "connecting" });
    if (!current(run)) return;
    if (run.attempt.transport === "rest") { void poll(run, index); return; }
    run.firstTimer = deps.setTimeout(() => fail(run, new BookError("timeout", `${label(run.attempt)} 在首帧期限内未收到有效盘口`), index), deps.firstFrameTimeoutMs);
    try {
      const close = deps.openWs(target, { bookMode: run.attempt.bookMode, signal: run.controller.signal,
        onFrame: (frame) => accept(run, frame, index), onError: (error) => fail(run, error, index) });
      // openWs can invoke callbacks before returning its cleanup function.
      if (current(run)) run.cleanup = close;
      else { try { close(); } catch { /* The already-ended generation owns this cleanup. */ } }
    } catch (error) { fail(run, error, index); }
  }

  const session: BookSession = {
    getState: () => state,
    subscribe: (listener) => {
      const notify = () => listener();
      if (!disposed) listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    dispose,
  };
  if (options.signal?.aborted) dispose();
  else { options.signal?.addEventListener("abort", dispose, { once: true }); start(0); }
  return session;
}

export interface BookSessionStore {
  getSnapshot(): BookSessionState;
  getServerSnapshot(): BookSessionState;
  subscribe(listener: () => void): () => void;
}

/** Pure construction; the first React subscriber starts I/O, the last one closes it. */
export function createBookSessionStore(
  target: BookTarget | null,
  options: BookSessionOptions & { enabled: boolean },
  dependencies: Partial<BookSessionDependencies> = {},
): BookSessionStore {
  const idle = createIdleBookState(options);
  let session: BookSession | undefined;
  let unsubscribeSession: (() => void) | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => session?.getState() ?? idle,
    getServerSnapshot: () => idle,
    subscribe(listener) {
      if (!options.enabled || target === null) return () => {};
      const notify = () => listener();
      listeners.add(notify);
      if (!session) {
        session = createBookSession(target, options, dependencies);
        unsubscribeSession = session.subscribe(() => { for (const notify of [...listeners]) notify(); });
      }
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners.delete(notify);
        if (listeners.size === 0) {
          unsubscribeSession?.();
          unsubscribeSession = undefined;
          session?.dispose();
          session = undefined;
        }
      };
    },
  };
}
