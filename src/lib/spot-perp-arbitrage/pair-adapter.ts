import type { ComboCandleResult } from "../combo";
import type { AlignedPairClose, TimedClose } from "./pair-statistics";
import type { SpotContainingCombinationResult } from "./combine";
import type { LoadedLeg } from "./load";

/** Extracts only raw exact-aligned leg closes. Composite spread/ratio prices are never inverted. */
export function alignedPairCloses(result: ComboCandleResult | SpotContainingCombinationResult): AlignedPairClose[] {
  if ("candles" in result) {
    if (!result.leg1Points || !result.leg2Points) return [];
    const second = new Map(result.leg2Points.map((point) => [point.openTime, point]));
    return result.leg1Points.flatMap((first) => {
      const other = second.get(first.openTime);
      const firstClose = Number(first.close); const secondClose = Number(other?.close);
      return other && Number.isFinite(firstClose) && Number.isFinite(secondClose)
        ? [{ closeTime: first.openTime, firstClose, secondClose }]
        : [];
    });
  }
  return result.points.flatMap((point) => {
    const firstClose = point.leg1Point?.close; const secondClose = point.leg2Point?.close;
    return typeof firstClose === "number" && typeof secondClose === "number"
      ? [{ closeTime: point.openTime, firstClose, secondClose }]
      : [];
  });
}

/**
 * Returns the later raw-leg close time for an exact aligned candle open. The
 * result is suitable as a post-entry funding boundary only when both legs
 * have valid close times strictly after that candle's open.
 */
export function pairEntryFundingCloseTime(
  result: ComboCandleResult | SpotContainingCombinationResult,
  entryOpenTime: number | null,
): number | null {
  if (entryOpenTime === null || !Number.isFinite(entryOpenTime)) return null;

  let firstCloseTime: number | undefined;
  let secondCloseTime: number | undefined;
  if ("candles" in result) {
    const first = result.leg1Points?.find((point) => point.openTime === entryOpenTime);
    const second = result.leg2Points?.find((point) => point.openTime === entryOpenTime);
    if (!first || !second || first.openTime !== entryOpenTime || second.openTime !== entryOpenTime) return null;
    firstCloseTime = first.closeTime;
    secondCloseTime = second.closeTime;
  } else {
    const aligned = result.points.find((point) => point.openTime === entryOpenTime);
    const first = aligned?.leg1Point;
    const second = aligned?.leg2Point;
    if (
      !first || !second
      || first.openTime !== entryOpenTime
      || second.openTime !== entryOpenTime
    ) return null;
    firstCloseTime = first.closeTime;
    secondCloseTime = second.closeTime;
  }

  if (
    firstCloseTime === undefined || secondCloseTime === undefined
    || !Number.isFinite(firstCloseTime) || !Number.isFinite(secondCloseTime)
    || firstCloseTime <= entryOpenTime || secondCloseTime <= entryOpenTime
  ) return null;
  return Math.max(firstCloseTime, secondCloseTime);
}

export function timedClosesFromLoadedLeg(leg: LoadedLeg, source: string): TimedClose[] {
  return leg.series.points.map((point) => ({ closeTime: point.openTime, close: point.close, source }));
}

/** Reuses a selected raw leg as the BTC benchmark without refetching it. */
export function timedClosesFromPairLeg(
  result: ComboCandleResult | SpotContainingCombinationResult,
  leg: 1 | 2,
  source: string,
): TimedClose[] {
  if ("candles" in result) {
    const points = leg === 1 ? result.leg1Points : result.leg2Points;
    return (points ?? []).map((point) => ({ closeTime: point.openTime, close: Number(point.close), source }));
  }
  return result.points.flatMap((point) => {
    const close = (leg === 1 ? point.leg1Point : point.leg2Point)?.close;
    return typeof close === "number" ? [{ closeTime: point.openTime, close, source }] : [];
  });
}
