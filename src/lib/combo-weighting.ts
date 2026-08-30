import {
  annualizedVolatilityForVisibleRange,
  type AnnualizedVolatilityMetric,
  type VolatilityCandleLike,
} from "./spot-perp-arbitrage/single-market-analytics";

export type CombinationWeightMode = "none" | "parity" | "custom";

export interface CombinationWeights {
  first: number;
  second: number;
}

/**
 * The applied (not merely edited) weighting state owned by a combination
 * chart.  The key makes the child-to-controller hand-off reject a callback
 * from a chart that has already been replaced.
 */
export interface AppliedCombinationWeightSnapshot {
  key: string;
  mode: CombinationWeightMode;
  weights: CombinationWeights;
}

export function isCurrentCombinationWeightSnapshot(
  snapshot: AppliedCombinationWeightSnapshot,
  currentKey: string | null,
): boolean {
  return currentKey !== null && snapshot.key === currentKey;
}

export interface WeightedOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceCandleLike {
  open: unknown;
  close: unknown;
}

export interface VolatilityParityResult {
  ok: boolean;
  first: AnnualizedVolatilityMetric;
  second: AnnualizedVolatilityMetric;
  weights?: CombinationWeights;
  error?: string;
}

function finite(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/** The exact price formula shared by spread and ratio combinations. */
export function combineWeightedPrice(
  first: number,
  second: number,
  mode: "spread" | "ratio",
  weights: CombinationWeights,
): number | null {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  if (mode === "spread") return weights.first * first - weights.second * second;
  const denominator = weights.second * second;
  return denominator > 0 ? (weights.first * first) / denominator : null;
}

/**
 * Keeps combination candles endpoint-only. Leg highs/lows may occur at
 * different moments, so combining them would create a theoretical wick rather
 * than an observed synchronized high/low.
 */
export function combineWeightedOhlc(
  first: PriceCandleLike,
  second: PriceCandleLike,
  mode: "spread" | "ratio",
  weights: CombinationWeights,
): WeightedOhlc | null {
  const firstOpen = finite(first.open);
  const firstClose = finite(first.close);
  const secondOpen = finite(second.open);
  const secondClose = finite(second.close);
  if (firstOpen === null || firstClose === null || secondOpen === null || secondClose === null) return null;
  const open = combineWeightedPrice(firstOpen, secondOpen, mode, weights);
  const close = combineWeightedPrice(firstClose, secondClose, mode, weights);
  if (open === null || close === null) return null;

  return {
    open,
    close,
    high: Math.max(open, close),
    low: Math.min(open, close),
  };
}

export function calculateVolatilityParity(
  first: readonly VolatilityCandleLike[],
  second: readonly VolatilityCandleLike[],
  startTime?: number,
  endTime?: number,
): VolatilityParityResult {
  const firstVol = annualizedVolatilityForVisibleRange(first, startTime, endTime);
  const secondVol = annualizedVolatilityForVisibleRange(second, startTime, endTime);
  if (firstVol.percent === null || secondVol.percent === null || firstVol.percent <= 0 || secondVol.percent <= 0) {
    return {
      ok: false,
      first: firstVol,
      second: secondVol,
      error: "当前可见区间的数据不足，或一条腿的年化波动率为 0，无法计算波动率平价。",
    };
  }
  const inverseFirst = 1 / firstVol.percent;
  const inverseSecond = 1 / secondVol.percent;
  const smallest = Math.min(inverseFirst, inverseSecond);
  return {
    ok: true,
    first: firstVol,
    second: secondVol,
    weights: { first: inverseFirst / smallest, second: inverseSecond / smallest },
  };
}

export function validCombinationWeights(first: unknown, second: unknown): CombinationWeights | null {
  const firstNumber = positive(first);
  const secondNumber = positive(second);
  return firstNumber !== null && secondNumber !== null
    ? { first: firstNumber, second: secondNumber }
    : null;
}
