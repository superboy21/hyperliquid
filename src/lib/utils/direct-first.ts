/**
 * Statuses for which a successful direct request should be retried through the
 * caller-provided proxy transport.
 */
export function isProxyEligibleStatus(status: number): boolean {
  return status === 403 || status === 451 || status >= 500;
}

export type ResponseOperation = (signal?: AbortSignal) => Promise<Response>;
export type ProxyEligibility = (status: number) => boolean;

export interface DirectFirstOptions {
  direct: ResponseOperation;
  proxy: ResponseOperation;
  signal?: AbortSignal;
  directTimeoutMs?: number;
  isProxyEligibleStatus?: ProxyEligibility;
}

function throwIfCallerAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    // AbortSignal.reason is intentionally thrown as-is. Callers may use a
    // domain-specific reason, and fallback must not replace it.
    throw signal.reason;
  }
}

/**
 * Run a raw REST request direct-first, falling back at most once.
 *
 * The operations are closures so this helper does not know about URLs,
 * request bodies, response envelopes, parsing, retries, schedulers, or cache.
 * Any direct rejection is treated as a transport failure; caller cancellation
 * is the one exception and is never sent to the proxy leg.
 */
export async function runDirectFirst({
  direct,
  proxy,
  signal,
  directTimeoutMs,
  isProxyEligibleStatus: isEligible = isProxyEligibleStatus,
}: DirectFirstOptions): Promise<Response> {
  throwIfCallerAborted(signal);

  const directController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let callerAbort: (() => void) | undefined;
  let rejectCallerAbort: ((reason: unknown) => void) | undefined;
  let rejectTimeout: ((reason: unknown) => void) | undefined;
  const callerAbortPromise = new Promise<never>((_, reject) => {
    rejectCallerAbort = reject;
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timeoutEnabled = directTimeoutMs !== undefined && Number.isFinite(directTimeoutMs) && directTimeoutMs >= 0;

  callerAbort = () => {
    const reason = signal?.reason;
    directController.abort(reason);
    rejectCallerAbort?.(reason);
  };
  signal?.addEventListener("abort", callerAbort, { once: true });
  if (timeoutEnabled) {
    timeoutId = setTimeout(() => {
      const reason = new DOMException("The operation timed out.", "TimeoutError");
      directController.abort(reason);
      rejectTimeout?.(reason);
    }, directTimeoutMs);
  }

  try {
    const directOperation = Promise.resolve().then(() => direct(directController.signal));
    const race = timeoutEnabled
      ? Promise.race([directOperation, callerAbortPromise, timeoutPromise])
      : Promise.race([directOperation, callerAbortPromise]);
    const directResponse = await race;

    throwIfCallerAborted(signal);
    if (!isEligible(directResponse.status)) {
      return directResponse;
    }

    throwIfCallerAborted(signal);
    return proxy();
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    // Check immediately before invoking the fallback as the direct operation
    // may have completed at the same time that cancellation was requested.
    throwIfCallerAborted(signal);
    return proxy();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (callerAbort) signal?.removeEventListener("abort", callerAbort);
  }
}
