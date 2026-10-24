"use client";

import { useSyncExternalStore } from "react";

/** One-second clock so age/staleness advances even while no frame arrives. */
const CLOCK_INTERVAL_MS = 1_000;

/**
 * One shared wall clock. The snapshot is cached so `getSnapshot` stays
 * referentially stable between refreshes, and both the interval and the
 * wake-up listeners are torn down with the last subscriber so an unmounted
 * panel leaves nothing behind.
 *
 * A background tab may throttle `setInterval` to about once a minute, so the
 * clock is also refreshed on `visibilitychange`, `focus` and `pageshow`. Without
 * that, a tab returning to the foreground would render ages (and a `nowMs`)
 * that are minutes behind reality for one paint.
 */
let clockValue: number | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function publishClock(): void {
  const next = Date.now();
  if (clockValue === next) return;
  clockValue = next;
  for (const notify of [...clockListeners]) notify();
}

function clockSubscribe(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === undefined) {
    clockValue = Date.now();
    clockTimer = setInterval(publishClock, CLOCK_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", publishClock);
      window.addEventListener("focus", publishClock);
      window.addEventListener("pageshow", publishClock);
    }
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size > 0 || clockTimer === undefined) return;
    clearInterval(clockTimer);
    clockTimer = undefined;
    clockValue = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", publishClock);
      window.removeEventListener("focus", publishClock);
      window.removeEventListener("pageshow", publishClock);
    }
  };
}

const clockSnapshot = () => clockValue;
/** Null during SSR and hydration; the panel then measures from the newest frame. */
const clockServerSnapshot = () => null;
const noClockSubscribe = () => () => {};

/**
 * The clock the derivation actually uses.
 *
 * The one-second tick can legitimately be older than a frame, because a frame
 * can arrive in the middle of the current second (and a background tab may have
 * had its timers throttled). Reporting the bare tick would therefore call a
 * just-arrived frame "received in the future" and blank the book. The live clock
 * never runs behind a frame it can see, so the newest receipt time is a floor;
 * the tick drives staleness while nothing arrives.
 *
 * Frames are stamped by this same page, so the floor cannot invent a value that
 * the core would otherwise reject as untrustworthy. An explicit `nowMs` (tests,
 * stories) bypasses the floor entirely, which keeps future-frame rejection
 * testable and lets a test pin an exact instant.
 */
export function resolveLiveClock(input: {
  nowMs?: number;
  ticking: number | null;
  frameReference: number;
}): number {
  if (input.nowMs !== undefined) return input.nowMs;
  return Math.max(input.ticking ?? 0, input.frameReference);
}

/**
 * Live clock for one panel. An explicit `nowMs` wins and never starts a timer,
 * so SSR and tests stay deterministic; otherwise the shared ticking clock is
 * used with the newest frame receipt as a floor.
 */
export function useOrderBookClock(nowMs: number | undefined, frameReference: number): number {
  // An explicit clock (tests, stories) wins and never starts a timer.
  const ticking = useSyncExternalStore(
    nowMs === undefined ? clockSubscribe : noClockSubscribe,
    clockSnapshot,
    clockServerSnapshot,
  );
  return resolveLiveClock({ nowMs, ticking, frameReference });
}
