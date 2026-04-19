// ==================== Server-Side Fetch Helper ====================
// Wraps globalThis.fetch with timeout and header defaults for API routes.
// Works in both Node.js (dev) and Cloudflare Workers (production).
//
// HTTP CONNECT proxy support is available in Node.js development via
// the PROXY_* environment variables. On edge runtimes, direct fetch is used.

const PROXY_URL =
  process.env.PROXY_URL ||
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.https_proxy ||
  "";

/**
 * Server-side fetch with timeout and optional HTTP proxy support.
 * Falls back to direct globalThis.fetch if no proxy is configured,
 * or when running on edge runtimes where undici is unavailable.
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

  // No proxy configured — use direct fetch
  if (!PROXY_URL) {
    const { timeout: _, ...restInit } = init ?? {};
    return globalThis.fetch(url, {
      ...restInit,
      signal: init?.signal ?? AbortSignal.timeout(timeout),
    });
  }

  // Proxy configured — attempt undici (Node.js only, may fail on edge)
  try {
    // Dynamic import so bundlers can tree-shake the critical path.
    // undici is a devDependency — in production (edge runtime) this
    // import will fail and we gracefully fall back to direct fetch.
    const undici = await import("undici");
    const dispatcher = new undici.ProxyAgent({ uri: PROXY_URL });

    const {
      timeout: _,
      headers: initHeaders,
      signal: initSignal,
      method,
      body,
      ...restInit
    } = init ?? {};

    const headers: Record<string, string> = {};
    if (initHeaders) {
      const h = new Headers(initHeaders);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (!headers["Accept"]) headers["Accept"] = "application/json";

    const response = await undici.fetch(url.toString(), {
      method: method ?? "GET",
      headers,
      body: body as string | undefined,
      dispatcher,
      signal: initSignal ?? AbortSignal.timeout(timeout),
    });

    return response as unknown as Response;
  } catch {
    // undici unavailable (edge runtime / Cloudflare Workers) — direct fetch
    const { timeout: _, ...restInit } = init ?? {};
    return globalThis.fetch(url, {
      ...restInit,
      signal: init?.signal ?? AbortSignal.timeout(timeout),
    });
  }
}