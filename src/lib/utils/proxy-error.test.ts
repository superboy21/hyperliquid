import { describe, expect, mock, test } from "bun:test";

// Bun evaluates tests outside Next's server-component context.
mock.module("server-only", () => ({}));
import { boundedRetryAfter, isProxyFetchTimeout, proxyFailureResponse, proxyFailureStatus } from "./proxy-error";

describe("proxy error classification", () => {
  test("distinguishes caller cancellation, proxy timeout, and transport failure", async () => {
    const caller = new AbortController();
    caller.abort();
    expect(proxyFailureStatus(caller.signal, new Error("AbortError"))).toBe(499);
    expect(proxyFailureStatus(new AbortController().signal, new DOMException("timed out", "TimeoutError"))).toBe(504);
    expect(proxyFailureStatus(new AbortController().signal, new DOMException("aborted", "AbortError"))).toBe(502);
    expect(await proxyFailureResponse(new AbortController().signal, new Error("network")).json()).toEqual({ error: "Failed to fetch upstream" });
  });

  test("only recognizes TimeoutError as the proxy timeout", () => {
    expect(isProxyFetchTimeout(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isProxyFetchTimeout(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isProxyFetchTimeout(new Error("request aborted"))).toBe(false);
  });

  test("bounds Retry-After seconds and dates", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(boundedRetryAfter("3", now)).toBe("3");
    expect(boundedRetryAfter("9999", now)).toBe("60");
    expect(boundedRetryAfter("2030-01-01T00:00:04Z", now)).toBe("4");
    expect(boundedRetryAfter("2030-01-01T00:05:00Z", now)).toBe("60");
    expect(boundedRetryAfter("not-a-date", now)).toBeNull();
  });
});
