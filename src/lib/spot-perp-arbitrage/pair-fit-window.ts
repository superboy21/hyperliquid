import {
  normalizeAlignedPairCloses,
  type AlignedPairClose,
  type StatResult,
} from "./pair-statistics";

export type PairFitWindowMode = "all" | "7d" | "30d" | "90d" | "custom";

export interface PairFitWindowSpec {
  mode: PairFitWindowMode;
  startTime?: number | null;
  endTime?: number | null;
}

export interface PairFitWindowSelection {
  points: AlignedPairClose[];
  /** Requested nominal lower bound (for presets, this may precede available data). */
  startTime: number;
  /** Requested upper bound. */
  endTime: number;
  /** First actual sampled close included in the selection. */
  firstPointTime: number;
  /** Last actual sampled close included in the selection. */
  lastPointTime: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DAYS: Partial<Record<PairFitWindowMode, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function unavailable<T>(reason: string): StatResult<T> {
  return { available: false, value: null, reason };
}

function available<T>(value: T): StatResult<T> {
  return { available: true, value, reason: null };
}

/**
 * Selects an OLS beta-fitting window from the already-visible aligned closes.
 * The source timestamp is `closeTime` (the candle's K-bar open time). This is
 * intentionally separate from pair-trade PnL and does not impose OLS's minimum
 * point count; the fitting operation reports its own availability.
 */
export function selectPairFitWindow(
  aligned: readonly AlignedPairClose[],
  spec: PairFitWindowSpec,
): StatResult<PairFitWindowSelection> {
  const points = normalizeAlignedPairCloses(aligned);
  if (points.length === 0) return unavailable("insufficient-fit-points");

  const firstAvailableTime = points[0].closeTime;
  const lastAvailableTime = points[points.length - 1].closeTime;

  if (spec.mode === "all") {
    return available({
      points,
      startTime: firstAvailableTime,
      endTime: lastAvailableTime,
      firstPointTime: firstAvailableTime,
      lastPointTime: lastAvailableTime,
    });
  }

  if (spec.mode === "custom") {
    if (spec.startTime == null || !Number.isFinite(spec.startTime)
      || !points.some((point) => point.closeTime === spec.startTime)) {
      return unavailable("fit-start-unavailable");
    }
    const endTime = spec.endTime == null ? lastAvailableTime : spec.endTime;
    if (!Number.isFinite(endTime) || !points.some((point) => point.closeTime === endTime)) {
      return unavailable("fit-end-unavailable");
    }
    if (spec.startTime > endTime) return unavailable("invalid-fit-range");

    const selected = points.filter((point) => point.closeTime >= spec.startTime! && point.closeTime <= endTime);
    if (selected.length === 0) return unavailable("insufficient-fit-points");
    return available({
      points: selected,
      startTime: spec.startTime,
      endTime,
      firstPointTime: selected[0].closeTime,
      lastPointTime: selected[selected.length - 1].closeTime,
    });
  }

  const days = PRESET_DAYS[spec.mode];
  if (days === undefined) return unavailable("invalid-fit-range");
  const endTime = spec.endTime == null ? lastAvailableTime : spec.endTime;
  if (!Number.isFinite(endTime) || !points.some((point) => point.closeTime === endTime)) {
    return unavailable("fit-end-unavailable");
  }
  const startTime = endTime - days * DAY_MS;
  const selected = points.filter((point) => point.closeTime >= startTime && point.closeTime <= endTime);
  if (selected.length === 0) return unavailable("insufficient-fit-points");
  return available({
    points: selected,
    startTime,
    endTime,
    firstPointTime: selected[0].closeTime,
    lastPointTime: selected[selected.length - 1].closeTime,
  });
}
