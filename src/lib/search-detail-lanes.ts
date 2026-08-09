/**
 * Progressive detail-fetch lane profile shared by every consumer of
 * partitionProgressiveDetailRates (/search and /spot_perp_arbitrage). One
 * tested source of truth for how many independent detail rows may fetch in
 * parallel per exchange and how long each lane waits between rows.
 *
 * Bybit independent detail rows run at concurrency 2; a single symbol's
 * funding-history pagination stays sequential inside its own detail fetch.
 * Bitget, OKX, and Lighter keep their throttled lanes unchanged.
 */
export const DETAIL_LANE_PROFILE = {
  generic: { concurrency: 4, delayMs: 0 },
  lighter: { concurrency: 1, delayMs: 200 },
  bitget: { concurrency: 1, delayMs: 0 },
  bybit: { concurrency: 2, delayMs: 0 },
  okx: { concurrency: 1, delayMs: 200 },
} as const;

export type DetailLaneName = keyof typeof DETAIL_LANE_PROFILE;
