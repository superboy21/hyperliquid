import "server-only";
import { NextResponse } from "next/server";

const MAX_RETRY_AFTER_SECONDS = 60;

/** TimeoutError is the reason created by proxyFetch's internal timeout signal. */
export function isProxyFetchTimeout(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "TimeoutError";
}

export function proxyFailureStatus(signal: AbortSignal | undefined, error?: unknown): 499 | 502 | 504 {
  if (signal?.aborted) return 499;
  if (error !== undefined && isProxyFetchTimeout(error)) return 504;
  return 502;
}

export function proxyFailureResponse(signal: AbortSignal | undefined, error?: unknown): NextResponse {
  const status = proxyFailureStatus(signal, error);
  const message = status === 499
    ? "Request cancelled"
    : status === 504
      ? "Upstream request timed out"
      : "Failed to fetch upstream";
  return NextResponse.json({ error: message }, { status });
}

/** Convert Retry-After seconds or an HTTP date to a safe, bounded delta. */
export function boundedRetryAfter(value: string | null, now = Date.now()): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    const timestamp = Date.parse(trimmed);
    if (!Number.isFinite(timestamp)) return null;
    seconds = Math.ceil((timestamp - now) / 1000);
  }
  if (!Number.isFinite(seconds)) return null;
  return String(Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, seconds)));
}

export function retryAfterHeaders(response: Response): Headers {
  const headers = new Headers();
  const retryAfter = boundedRetryAfter(response.headers.get("Retry-After"));
  if (retryAfter !== null) headers.set("Retry-After", retryAfter);
  return headers;
}
