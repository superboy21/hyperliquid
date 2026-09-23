import type { ComboCandleResult, ComboLegPricePoint } from "../combo";
import type { SpotContainingCombinationResult } from "./combine";
import type { LegCandlePoint } from "./series";

export interface PairChartSample {
  time: number;
  ratio: number | null;
  firstOhlc: [number, number, number, number] | null;
  secondOhlc: [number, number, number, number] | null;
}

type RawLegPoint = Pick<ComboLegPricePoint | LegCandlePoint, "openTime" | "open" | "high" | "low" | "close">;

function validClose(close: number): boolean {
  return Number.isFinite(close) && close > 0;
}

function toOhlc(point: RawLegPoint | undefined): [number, number, number, number] | null {
  if (!point) return null;
  const { open, close, low, high } = point;
  if (![open, close, low, high].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (high < low || open < low || open > high || close < low || close > high) return null;
  return [open, close, low, high];
}

/**
 * Builds raw per-leg chart samples keyed by exact candle open time. Ratio is
 * always the raw first close divided by the raw second close, not the queried
 * spread/ratio composite. Missing and invalid values remain null; no synthetic
 * OHLC is inferred from a combined candle.
 */
export function alignedPairChartSamples(
  result: ComboCandleResult | SpotContainingCombinationResult,
  alignedTimes: readonly number[],
): PairChartSample[] {
  let firstByTime: Map<number, RawLegPoint>;
  let secondByTime: Map<number, RawLegPoint>;

  if ("candles" in result) {
    firstByTime = new Map((result.leg1Points ?? []).map((point) => [point.openTime, point]));
    secondByTime = new Map((result.leg2Points ?? []).map((point) => [point.openTime, point]));
  } else {
    firstByTime = new Map(result.points.flatMap((point) => point.leg1Point ? [[point.openTime, point.leg1Point] as const] : []));
    secondByTime = new Map(result.points.flatMap((point) => point.leg2Point ? [[point.openTime, point.leg2Point] as const] : []));
  }

  return alignedTimes.map((time) => {
    const first = firstByTime.get(time);
    const second = secondByTime.get(time);
    const firstClose = first?.close;
    const secondClose = second?.close;
    let ratio: number | null = null;
    if (firstClose !== undefined && secondClose !== undefined && validClose(firstClose) && validClose(secondClose)) {
      const candidate = firstClose / secondClose;
      if (Number.isFinite(candidate) && candidate > 0) ratio = candidate;
    }
    return {
      time,
      ratio,
      firstOhlc: toOhlc(first),
      secondOhlc: toOhlc(second),
    };
  });
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/**
 * Derives one composite candle endpoint pair from the raw leg open/close at an
 * exact open time. Only raw open and close are consulted; raw highs and lows are
 * deliberately ignored so a missing/invalid wick never invalidates an otherwise
 * valid derived candle. Ratio requires a strictly positive finite denominator
 * (and positive finite numerator); spread allows any finite derived value,
 * including zero and negative. Non-finite results collapse to a null gap.
 */
function deriveEndpoints(
  first: RawLegPoint | undefined,
  second: RawLegPoint | undefined,
  mode: "ratio" | "spread",
): [open: number, close: number] | null {
  if (!first || !second) return null;
  const { open: firstOpen, close: firstClose } = first;
  const { open: secondOpen, close: secondClose } = second;
  if (!finitePositive(firstOpen) || !finitePositive(firstClose)) return null;
  if (!finitePositive(secondOpen) || !finitePositive(secondClose)) return null;

  const open = mode === "ratio" ? firstOpen / secondOpen : firstOpen - secondOpen;
  const close = mode === "ratio" ? firstClose / secondClose : firstClose - secondClose;
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  return [open, close];
}

/**
 * Builds ECharts-order derived candles ([open, close, low, high]) for the
 * requested open times. Each entry is computed from the raw leg open/close via
 * the given ratio or spread mode, with the body itself acting as the wick:
 * low is min(open, close) and high is max(open, close), so no individual leg
 * high/low ever leaks into the composite. Missing, invalid, or non-finite
 * endpoints become null gaps. Inputs are never mutated.
 */
export function alignedPairDerivedCandles(
  result: ComboCandleResult | SpotContainingCombinationResult,
  alignedTimes: readonly number[],
  mode: "ratio" | "spread",
): ([number, number, number, number] | null)[] {
  let firstByTime: Map<number, RawLegPoint>;
  let secondByTime: Map<number, RawLegPoint>;

  if ("candles" in result) {
    firstByTime = new Map((result.leg1Points ?? []).map((point) => [point.openTime, point]));
    secondByTime = new Map((result.leg2Points ?? []).map((point) => [point.openTime, point]));
  } else {
    firstByTime = new Map(result.points.flatMap((point) => point.leg1Point ? [[point.openTime, point.leg1Point] as const] : []));
    secondByTime = new Map(result.points.flatMap((point) => point.leg2Point ? [[point.openTime, point.leg2Point] as const] : []));
  }

  return alignedTimes.map((time) => {
    const endpoints = deriveEndpoints(firstByTime.get(time), secondByTime.get(time), mode);
    if (!endpoints) return null;
    const [open, close] = endpoints;
    return [open, close, Math.min(open, close), Math.max(open, close)];
  });
}
