// ==================== Server-Side Fetch Helper ====================
// Wraps globalThis.fetch with timeout and header defaults for API routes.
// Works in both Node.js (dev) and Cloudflare Workers (production).
//
// HTTP CONNECT proxy support is available in Node.js via the PROXY_* environment
// variables. The environment is read per request so callers can configure it
// before invoking this helper (and so tests do not depend on module load order).

type ProxyAgent = import("undici").ProxyAgent;

const proxyAgentCache = new Map<string, ProxyAgent>();

function getProxyUrl(): string {
  if (typeof process === "undefined") return "";

  return (
    process.env.PROXY_URL ||
    process.env.HTTP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.https_proxy ||
    ""
  );
}

function requestSignal(
  callerSignal: AbortSignal | null | undefined,
  timeout: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    timeout,
  );
  const onCallerAbort = () => controller.abort(callerSignal?.reason);

  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

function withoutTimeout(init?: RequestInit & { timeout?: number }): RequestInit {
  const { timeout: _, ...requestInit } = init ?? {};
  return requestInit;
}

/**
 * Canonicalize request header names for Undici and add JSON defaults without
 * creating differently-cased duplicates. Caller-provided values win.
 */
export function normalizeProxyHeaders(initHeaders?: HeadersInit): Record<string, string> {
  const normalized = new Headers(initHeaders);
  if (!normalized.has("content-type")) normalized.set("content-type", "application/json");
  if (!normalized.has("accept")) normalized.set("accept", "application/json");

  const headers: Record<string, string> = {};
  normalized.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

/**
 * Server-side fetch with timeout and optional HTTP proxy support.
 * Uses direct globalThis.fetch only when no proxy is configured. If a proxy is
 * configured, loading undici or making the proxied request is allowed to fail
 * and that failure is propagated to the caller.
 *
 * Usage in API routes:
 *   import { proxyFetch } from "@/lib/utils/proxy";
 *   const response = await proxyFetch("https://fapi.binance.com/...");
 */
export async function proxyFetch(
  url: string | URL,
  init?: RequestInit & { timeout?: number },
): Promise<Response> {
  const timeout = init?.timeout ?? 10_000;
  const proxyUrl = getProxyUrl();
  const requestInit = withoutTimeout(init);
  const cancellation = requestSignal(init?.signal, timeout);

  // No proxy configured — use direct fetch
  if (!proxyUrl) {
    try {
      return await globalThis.fetch(url, {
        ...requestInit,
        signal: cancellation.signal,
      });
    } finally {
      cancellation.cleanup();
    }
  }

  // Proxy configured — a missing undici runtime is an explicit failure, not a
  // reason to bypass the configured proxy.
  try {
    const undici = await import("undici");
    let dispatcher = proxyAgentCache.get(proxyUrl);
    if (!dispatcher) {
      dispatcher = new undici.ProxyAgent({ uri: proxyUrl });
      proxyAgentCache.set(proxyUrl, dispatcher);
    }

    const response = await undici.fetch(url.toString(), {
      ...requestInit,
      headers: normalizeProxyHeaders(init?.headers),
      dispatcher,
      signal: cancellation.signal,
    } as Parameters<typeof undici.fetch>[1]);

    return response as unknown as Response;
  } finally {
    cancellation.cleanup();
  }
}
