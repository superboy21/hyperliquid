/**
 * Statuses for which a successful direct request should be retried through the
 * caller-provided proxy transport.
 */
export function isProxyEligibleStatus(status: number): boolean {
  return status === 403 || status === 451 || status >= 500;
}

export type ProxyEligibility = (status: number) => boolean;
export type DirectResponseObserver = (response: Response) => void;
export type ResponseOperation = (signal?: AbortSignal, onResponse?: DirectResponseObserver) => Promise<Response>;

export interface DirectFirstOptions {
  direct: ResponseOperation;
  proxy: ResponseOperation;
  signal?: AbortSignal;
  directTimeoutMs?: number;
  isProxyEligibleStatus?: ProxyEligibility;
  /** Called for every response received by the direct operation, including retries. */
  onDirectResponse?: DirectResponseObserver;
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
 * Any direct rejection is treated as a transport failure unless the operation
 * has already reported a non-proxy-eligible response; caller cancellation is
 * never sent to the proxy leg.
 */
export async function runDirectFirst({
  direct,
  proxy,
  signal,
  directTimeoutMs,
  isProxyEligibleStatus: isEligible = isProxyEligibleStatus,
  onDirectResponse,
}: DirectFirstOptions): Promise<Response> {
  throwIfCallerAborted(signal);

  const directController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let callerAbort: (() => void) | undefined;
  let rejectCallerAbort: ((reason: unknown) => void) | undefined;
  let rejectTimeout: ((reason: unknown) => void) | undefined;
  let lastNonProxyEligibleResponse: Response | undefined;
  let observed429 = false;
  const reportedResponses = new WeakSet<Response>();
  const reportDirectResponse: DirectResponseObserver = (response) => {
    if (reportedResponses.has(response)) return;
    reportedResponses.add(response);
    if (!isEligible(response.status) || response.status === 429) lastNonProxyEligibleResponse = response;
    if (response.status === 429) observed429 = true;
    onDirectResponse?.(response);
  };
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
    const directOperation = Promise.resolve().then(async () => {
      const response = await direct(directController.signal, reportDirectResponse);
      // Operations which retry internally report each response through
      // onDirectResponse. The returned response is reported here as well for
      // simple operations that do not do so themselves.
      reportDirectResponse(response);
      return response;
    });
    const race = timeoutEnabled
      ? Promise.race([directOperation, callerAbortPromise, timeoutPromise])
      : Promise.race([directOperation, callerAbortPromise]);
    const directResponse = await race;

    throwIfCallerAborted(signal);
    if (observed429) {
      return lastNonProxyEligibleResponse ?? directResponse;
    }
    if (!isEligible(directResponse.status)) {
      return directResponse;
    }

    throwIfCallerAborted(signal);
    return proxy();
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    if (lastNonProxyEligibleResponse) {
      return lastNonProxyEligibleResponse;
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
