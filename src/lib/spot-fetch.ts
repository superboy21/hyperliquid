// ==================== Spot Direct-First Fetch ====================
// Browser-side spot market fetcher. Requests originate from the user's own
// network (bypassing server egress IP blocks such as Cloudflare Workers being
// rejected by Binance/OKX/Bitget), falling back to the Next.js API proxy only
// when the direct request fails (CORS/network) or the exchange rejects it.

import { buildSpotUpstreamRequest } from "./spot-upstream";
import type { SpotExchangeName } from "./spot-search";
import { runDirectFirst } from "./utils/direct-first";
import { sleep, throwIfAborted } from "./utils/abort";

const SLUGS: Record<SpotExchangeName, string> = {
  Hyperliquid: "hyperliquid", "Gate.io": "gateio", Binance: "binance",
  Lighter: "lighter", OKX: "okx", Bitget: "bitget", Bybit: "bybit",
};
export const SPOT_DIRECT_TIMEOUT_MS = 15_000;

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60_000, seconds * 1_000);
  }

  const date = Date.parse(value) - Date.now();
  return Number.isFinite(date) ? Math.max(0, Math.min(60_000, date)) : null;
}

/**
 * Fetch spot market data direct-first:
 * 1. Try the exchange's public API directly from the browser.
 * 2. If the direct request throws (CORS/network) or is rejected, fall back to
 *    the `/api/spot/[exchange]` server proxy.
 */
export async function spotFetch(
  exchange: SpotExchangeName,
  params: URLSearchParams,
  init?: RequestInit,
  directTimeoutMs = SPOT_DIRECT_TIMEOUT_MS,
): Promise<Response> {
  const signal = init?.signal ?? undefined;
  const proxyUrl = `/api/spot/${SLUGS[exchange]}?${params.toString()}`;
  const built = buildSpotUpstreamRequest(SLUGS[exchange], params);
  if (typeof built === "string") {
    throwIfAborted(signal);
    return fetch(proxyUrl, { ...init, cache: "no-store" });
  }

  // The upstream builder also serves server-side code and carries a legacy
  // timeout hint. Browser fetch does not define RequestInit.timeout; the
  // direct-first runner owns the actual client-leg deadline instead.
  const { timeout: _unusedTimeout, ...builtInit } = built.init;
  const directInit = { ...init, ...builtInit };
  return runDirectFirst({
    signal,
    directTimeoutMs,
    direct: async (directSignal) => {
      const attemptInit = { ...directInit, signal: directSignal };
      let response = await fetch(built.url, attemptInit);
      // A single bounded direct retry handles rate limiting without ever
      // routing a final 429 through the same upstream proxy.
      if (response.status === 429) {
        await sleep(retryAfterMs(response) ?? 1_000, directSignal);
        throwIfAborted(directSignal);
        response = await fetch(built.url, attemptInit);
      }
      return response;
    },
    proxy: () => fetch(proxyUrl, { ...init, cache: "no-store" }),
  });
}
