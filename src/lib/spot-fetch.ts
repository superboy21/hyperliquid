// ==================== Spot Direct-First Fetch ====================
// Browser-side spot market fetcher. Requests originate from the user's own
// network (bypassing server egress IP blocks such as Cloudflare Workers being
// rejected by Binance/OKX/Bitget), falling back to the Next.js API proxy only
// when the direct request fails (CORS/network) or the exchange rejects it.

import { buildSpotUpstreamRequest } from "./spot-upstream";
import type { SpotExchangeName } from "./spot-search";

const SLUGS: Record<SpotExchangeName, string> = {
  Hyperliquid: "hyperliquid", "Gate.io": "gateio", Binance: "binance",
  Lighter: "lighter", OKX: "okx", Bitget: "bitget",
};

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
): Promise<Response> {
  const proxyUrl = `/api/spot/${SLUGS[exchange]}?${params.toString()}`;
  const built = buildSpotUpstreamRequest(SLUGS[exchange], params);
  if (typeof built === "string") {
    return fetch(proxyUrl, { ...init, cache: "no-store" });
  }
  try {
    const response = await fetch(built.url, { ...init, ...built.init });
    if (response.ok) return response;
  } catch {
    // CORS or network failure — fall through to the proxy.
  }
  return fetch(proxyUrl, { ...init, cache: "no-store" });
}