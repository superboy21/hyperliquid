import { describe, expect, test } from "bun:test";
import { getCandleSnapshot, getFundingHistory } from "../gateio";
import { isAbortLikeError, throwIfAborted } from "../utils/abort";
import { combineGateDetailSignals } from "./gate";

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
}

describe("Gate detail cancellation", () => {
  test("preserves caller cancellation while a timeout signal is active", () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const signal = combineGateDetailSignals(caller.signal, timeout.signal);
    const reason = new DOMException("caller canceled", "AbortError");

    caller.abort(reason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    expect(() => throwIfAborted(signal)).toThrow(reason);
    expect(isAbortLikeError(reason)).toBe(true);
  });

  test("preserves timeout cancellation while a caller signal is active", async () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const signal = combineGateDetailSignals(caller.signal, timeout.signal);
    const reason = new DOMException("detail timed out", "TimeoutError");

    timeout.abort(reason);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    expect(caller.signal.aborted).toBe(false);
    expect(await rejectionOf(getCandleSnapshot("BTC", "1d", 30, signal))).toBe(reason);
    expect(isAbortLikeError(reason)).toBe(false);
  });

  test("Gate catch paths preserve caller abort reasons", async () => {
    const caller = new AbortController();
    const reason = new DOMException("caller canceled", "AbortError");
    caller.abort(reason);

    expect(await rejectionOf(getFundingHistory("BTC_USDT", 30, caller.signal))).toBe(reason);
  });
});
