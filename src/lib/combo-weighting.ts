export type CombinationViewMode = "plain" | "ols" | "pair-trade";

/** Y-axis unit for the pair-trade PnL line: entry-relative percent or USD. */
export type CombinationValueUnit = "percent" | "usd";

export interface CombinationWeights {
  first: number;
  second: number;
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

export function validCombinationWeights(first: unknown, second: unknown): CombinationWeights | null {
  const firstNumber = positive(first);
  const secondNumber = positive(second);
  return firstNumber !== null && secondNumber !== null
    ? { first: firstNumber, second: secondNumber }
    : null;
}
