// ==================== Server-Side Proxy Helper ====================
// Creates an undici ProxyAgent dispatcher for HTTP CONNECT proxy support.
// Configure via PROXY_URL or HTTP_PROXY environment variables.
// Example: PROXY_URL=http://127.0.0.1:10808
//
// This module is only intended for use in Next.js API route handlers
// (server-side Node.js runtime). Do NOT import in client components.

import { ProxyAgent } from "undici";

const PROXY_URL =
  process.env.PROXY_URL ||
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  process.env.http_proxy ||
  process.env.https_proxy ||
  "";

let _dispatcher: ProxyAgent | undefined;

/**
 * Returns an undici ProxyAgent dispatcher for use with undici fetch.
 * If no proxy is configured, returns undefined (direct connection).
 *
 * Usage in API routes:
 *   import { getProxyDispatcher, proxyFetch } from "@/lib/utils/proxy";
 *   const response = await proxyFetch("https://www.okx.com/api/v5/...");
 */
export function getProxyDispatcher(): ProxyAgent | undefined {
  if (!PROXY_URL) return undefined;

  // Cache the dispatcher instance
  if (!_dispatcher) {
    _dispatcher = new ProxyAgent({
      uri: PROXY_URL,
    });
  }
  return _dispatcher;
}

/**
 * Proxied version of fetch that uses the configured HTTP proxy.
 * Falls back to regular globalThis.fetch if no proxy is configured.
 */
export async function proxyFetch(
  url: string | URL,
  init?: RequestInit & { timeout?: number },
): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  const timeout = init?.timeout ?? 10_000;

  // If no proxy configured, use regular globalThis fetch with timeout
  if (!dispatcher) {
    const { timeout: _, ...restInit } = init ?? {};
    return globalThis.fetch(url, {
      ...restInit,
      signal: init?.signal ?? AbortSignal.timeout(timeout),
    });
  }

  // Use undici fetch with proxy dispatcher
  const { fetch: undiciFetch } = await import("undici");
  const { timeout: _, headers: initHeaders, signal: initSignal, method, body, ...restInit } = init ?? {};

  // Merge headers
  const headers: Record<string, string> = {};
  if (initHeaders) {
    const h = new Headers(initHeaders);
    h.forEach((v, k) => { headers[k] = v; });
  }
  if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (!headers["Accept"]) headers["Accept"] = "application/json";

  const response = await undiciFetch(url, {
    method: method ?? "GET",
    headers,
    body: body as string | undefined,
    dispatcher,
    signal: initSignal ?? AbortSignal.timeout(timeout),
  });

  // Convert undici Response to web Response
  return response as unknown as Response;
}