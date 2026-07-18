import { describe, expect, test } from "bun:test";
import { getAbortReason, isAbortLikeError, sleep, throwIfAborted } from "./abort";

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject");
}

describe("abort helpers", () => {
  test("preserves Error and DOMException signal reasons", async () => {
    const errorController = new AbortController();
    const errorReason = new Error("stopped");
    errorController.abort(errorReason);

    expect(getAbortReason(errorController.signal)).toBe(errorReason);
    expect(() => throwIfAborted(errorController.signal)).toThrow(errorReason);

    const timeoutController = new AbortController();
    const timeoutReason = new DOMException("timed out", "TimeoutError");
    const sleeping = sleep(60_000, timeoutController.signal);
    timeoutController.abort(timeoutReason);

    expect(await rejectionOf(sleeping)).toBe(timeoutReason);
  });

  test("falls back to AbortError for non-error reasons", () => {
    const controller = new AbortController();
    controller.abort("stopped");

    const reason = getAbortReason(controller.signal);
    expect(reason).toBeInstanceOf(DOMException);
    expect(reason.name).toBe("AbortError");
    expect(isAbortLikeError(reason)).toBe(true);
  });

  test("classifies caller abort separately from timeout", () => {
    expect(isAbortLikeError(new DOMException("canceled", "AbortError"))).toBe(true);
    expect(isAbortLikeError(new DOMException("timed out", "TimeoutError"))).toBe(false);
  });
});
