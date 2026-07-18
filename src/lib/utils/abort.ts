export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError") {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("aborterror") || message.includes("operation was aborted");
}

export function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function getAbortReason(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error || reason instanceof DOMException ? reason : createAbortError();
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(getAbortReason(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
