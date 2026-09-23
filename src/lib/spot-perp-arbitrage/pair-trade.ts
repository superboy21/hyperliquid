import {
  normalizeAlignedPairCloses,
  type AlignedPairClose,
  type StatResult,
} from "./pair-statistics";

/** Default notional (USD) deployed on leg1; leg2 is sized at beta * this. */
export const DEFAULT_FIRST_NOTIONAL_USD = 10_000;

/** One mark-to-market observation of a fixed-quantity pair trade. */
export interface PairTradePoint {
  /** Entry-relative timestamp (the aligned closeTime, populated from openTime). */
  time: number;
  /** Null until the trade is opened at the selected entry candle. */
  pnlUsd: number | null;
  /** Null until the trade is opened at the selected entry candle. */
  returnPercent: number | null;
}

/** Hypothetical in-sample pair trade opened at a selected aligned close. */
export interface PairTradeSeries {
  /** Hedge ratio echoed from the caller; leg2 is short beta * leg1 notional. */
  beta: number;
  /** Long leg1 notional in USD (fixed for the whole trade). */
  firstNotionalUsd: number;
  /** Short leg2 notional in USD, i.e. beta * firstNotionalUsd. */
  secondNotionalUsd: number;
  /** Index of the selected entry bar in the normalized points array. */
  entryIndex: number;
  /** closeTime of the selected aligned close (the entry bar). */
  entryTime: number;
  entryFirstClose: number;
  entrySecondClose: number;
  /** One point per aligned close, in ascending time order; pre-entry values are null. */
  points: PairTradePoint[];
}

function unavailable<T>(reason: string): StatResult<T> {
  return { available: false, value: null, reason };
}

function available<T>(value: T): StatResult<T> {
  return { available: true, value, reason: null };
}

/**
 * Builds a bounded, fixed-quantity pair trade from aligned closes.
 *
 * The trade is long leg1 with `firstNotionalUsd` and short leg2 with
 * `firstNotionalUsd * beta`, entered at the first valid aligned close unless an
 * exact `entryTime` is supplied. There is
 * no rebalancing and no fees/funding; PnL is:
 *   PnL(t) = N1 * (P1t/P1entry - 1) - N1 * beta * (P2t/P2entry - 1)
 * `returnPercent` is PnL relative to the leg1 notional. Pre-entry points have
 * null values; the entry point is exactly zero. Fails closed on invalid input.
 */
export function calculatePairTradeSeries(
  aligned: readonly AlignedPairClose[],
  beta: number,
  firstNotionalUsd: number = DEFAULT_FIRST_NOTIONAL_USD,
  entryTime?: number,
): StatResult<PairTradeSeries> {
  const cleaned = normalizeAlignedPairCloses(aligned);
  let entryIndex: number;
  if (entryTime === undefined) {
    if (cleaned.length === 0) return unavailable("insufficient-points");
    entryIndex = 0;
  } else {
    entryIndex = Number.isFinite(entryTime) ? cleaned.findIndex((point) => point.closeTime === entryTime) : -1;
    if (entryIndex < 0) return unavailable("entry-not-found");
  }
  if (cleaned.length < 2) return unavailable("insufficient-points");
  if (!Number.isFinite(beta) || beta <= 0) return unavailable("invalid-beta");
  if (!Number.isFinite(firstNotionalUsd) || firstNotionalUsd <= 0) return unavailable("invalid-notional");
  const secondNotionalUsd = firstNotionalUsd * beta;
  if (!Number.isFinite(secondNotionalUsd) || secondNotionalUsd <= 0) return unavailable("invalid-notional");

  const entry = cleaned[entryIndex];
  const points: PairTradePoint[] = [];
  for (const [index, point] of cleaned.entries()) {
    if (index < entryIndex) {
      points.push({ time: point.closeTime, pnlUsd: null, returnPercent: null });
      continue;
    }
    const firstReturn = point.firstClose / entry.firstClose - 1;
    const secondReturn = point.secondClose / entry.secondClose - 1;
    const pnlUsd = firstNotionalUsd * firstReturn - secondNotionalUsd * secondReturn;
    const returnPercent = (pnlUsd / firstNotionalUsd) * 100;
    if (!Number.isFinite(pnlUsd) || !Number.isFinite(returnPercent)) return unavailable("non-finite-pnl");
    points.push({
      time: point.closeTime,
      pnlUsd,
      returnPercent,
    });
  }
  // The entry point is definitionally flat; pin it to exact zero so no
  // floating-point residual leaks into the baseline.
  points[entryIndex] = { time: entry.closeTime, pnlUsd: 0, returnPercent: 0 };

  return available({
    beta,
    firstNotionalUsd,
    secondNotionalUsd,
    entryIndex,
    entryTime: entry.closeTime,
    entryFirstClose: entry.firstClose,
    entrySecondClose: entry.secondClose,
    points,
  });
}
