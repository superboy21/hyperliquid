import type { ComboFundingLegObservation, ComboFundingRatePoint, ComboCandleResult } from "../combo";
import type { MixedCombinationResult, SpotContainingCombinationResult, SpotSpotCombinationResult } from "./combine";
import { combineWeightedPrice, type CombinationWeights } from "../combo-weighting";

export type ArbitrageChartRange = "all" | "3y" | "1y" | "6m" | "1m" | "1d" | "4h";
export type TailTrimPercent = 0 | 1 | 2.5 | 5 | 10;

const RANGE_MS: Record<ArbitrageChartRange, number | null> = {
  all: null,
  "3y": 3 * 365 * 86_400_000,
  "1y": 365 * 86_400_000,
  "6m": 183 * 86_400_000,
  "1m": 30 * 86_400_000,
  "1d": 86_400_000,
  "4h": 14_400_000,
};

export interface ValueWithRelativeGap {
  value: number | null;
  gapPercent: number | null;
}

export interface DistributionBands {
  minus2Sigma: ValueWithRelativeGap;
  minus1Sigma: ValueWithRelativeGap;
  plus1Sigma: ValueWithRelativeGap;
  plus2Sigma: ValueWithRelativeGap;
}

export interface DistributionAnalytics {
  mean: number | null;
  populationSigma: number | null;
  minus2Sigma: number | null;
  minus1Sigma: number | null;
  plus1Sigma: number | null;
  plus2Sigma: number | null;
  bands: DistributionBands;
  retainedCount: number;
  removedCount: number;
}

export interface AverageAnalytics {
  mean: number | null;
  count: number;
}

export interface MixedDashboardAnalytics {
  derivedClose: DistributionAnalytics;
  currentDerivedClose: ValueWithRelativeGap;
  fundingAnnualized: AverageAnalytics;
  spotTurnover: AverageAnalytics;
  perpTurnover: AverageAnalytics;
}

export interface PairDashboardAnalytics {
  derivedClose: DistributionAnalytics;
  currentDerivedClose: ValueWithRelativeGap;
  fundingAnnualized: AverageAnalytics | null;
  fundingLeg1: AverageAnalytics | null;
  fundingLeg2: AverageAnalytics | null;
  fundingAlignedCount: number | null;
  leg1Turnover: AverageAnalytics;
  leg2Turnover: AverageAnalytics;
}

const INTRADAY_PERP_PAIR_INTERVALS = new Set(["4h", "1h", "5m"]);

export type PairDashboardResult = ComboCandleResult | SpotSpotCombinationResult;

export function relativeGapPercent(
  value: number | null | undefined,
  mean: number | null | undefined,
): number | null {
  if (
    value === null || value === undefined || mean === null || mean === undefined
    || !Number.isFinite(value) || !Number.isFinite(mean) || mean === 0
  ) return null;
  return (value - mean) / Math.abs(mean) * 100;
}

export function valueWithRelativeGap(
  value: number | null | undefined,
  mean: number | null | undefined,
): ValueWithRelativeGap {
  const finiteValue = value !== null && value !== undefined && Number.isFinite(value) ? value : null;
  return { value: finiteValue, gapPercent: relativeGapPercent(finiteValue, mean) };
}

function distributionBands(
  mean: number | null,
  values: Pick<DistributionAnalytics, "minus2Sigma" | "minus1Sigma" | "plus1Sigma" | "plus2Sigma">,
): DistributionBands {
  return {
    minus2Sigma: valueWithRelativeGap(values.minus2Sigma, mean),
    minus1Sigma: valueWithRelativeGap(values.minus1Sigma, mean),
    plus1Sigma: valueWithRelativeGap(values.plus1Sigma, mean),
    plus2Sigma: valueWithRelativeGap(values.plus2Sigma, mean),
  };
}

function average(values: readonly number[]): AverageAnalytics {
  const finite = values.filter(Number.isFinite);
  return {
    mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
    count: finite.length,
  };
}

const ONE_TO_ONE: CombinationWeights = { first: 1, second: 1 };

function isOneToOne(weights: CombinationWeights): boolean {
  return weights.first === 1 && weights.second === 1;
}

interface DerivedCloseRows {
  values: number[];
  latest: number | null;
}

/**
 * Rebuilds dashboard prices from the retained raw legs.  In particular, a
 * weighted dashboard never reverse-engineers a weight from an already
 * combined spread/ratio. Missing raw legs therefore fail closed for a
 * non-1:1 request instead of producing plausible but incorrect statistics.
 */
function derivedCloseRows(
  visible: MixedCombinationResult | SpotSpotCombinationResult | ComboCandleResult,
  weights: CombinationWeights,
): DerivedCloseRows | null {
  if (isOneToOne(weights)) {
    const rows = "candles" in visible
      ? visible.candles.map((point) => ({ closeTime: point.closeTime, value: Number(point.close) }))
      : visible.points.map((point) => ({ closeTime: point.closeTime, value: point.close }));
    let latestTime = Number.NEGATIVE_INFINITY;
    let latest: number | null = null;
    for (const row of rows) {
      if (!Number.isFinite(row.closeTime) || row.closeTime <= latestTime) continue;
      latestTime = row.closeTime;
      latest = Number.isFinite(row.value) ? row.value : null;
    }
    return { values: rows.map((row) => row.value), latest };
  }

  if (!Number.isFinite(weights.first) || !Number.isFinite(weights.second) || weights.first <= 0 || weights.second <= 0) {
    return null;
  }

  if ("candles" in visible) {
    if (!visible.leg1Points || !visible.leg2Points) return null;
    const firstByTime = new Map(visible.leg1Points.map((point) => [point.openTime, point]));
    const secondByTime = new Map(visible.leg2Points.map((point) => [point.openTime, point]));
    const rows: Array<{ closeTime: number; value: number }> = [];
    for (const candle of visible.candles) {
      const first = firstByTime.get(candle.openTime);
      const second = secondByTime.get(candle.openTime);
      if (!first || !second) return null;
      const value = combineWeightedPrice(first.close, second.close, visible.mode === "ratio" ? "ratio" : "spread", weights);
      if (value === null) return null;
      rows.push({ closeTime: candle.closeTime, value });
    }
    let latestTime = Number.NEGATIVE_INFINITY;
    let latest: number | null = null;
    for (const row of rows) {
      if (Number.isFinite(row.closeTime) && row.closeTime > latestTime) {
        latestTime = row.closeTime;
        latest = row.value;
      }
    }
    return { values: rows.map((row) => row.value), latest };
  }

  const rows: Array<{ closeTime: number; value: number }> = [];
  for (const point of visible.points) {
    if (!point.leg1Point || !point.leg2Point) return null;
    const value = combineWeightedPrice(point.leg1Point.close, point.leg2Point.close, visible.mode, weights);
    if (value === null) return null;
    rows.push({ closeTime: point.closeTime, value });
  }
  let latestTime = Number.NEGATIVE_INFINITY;
  let latest: number | null = null;
  for (const row of rows) {
    if (Number.isFinite(row.closeTime) && row.closeTime > latestTime) {
      latestTime = row.closeTime;
      latest = row.value;
    }
  }
  return { values: rows.map((row) => row.value), latest };
}

function actualLegFunding(
  point: ComboFundingRatePoint,
  observation: ComboFundingLegObservation | null | undefined,
): ComboFundingLegObservation | null {
  if (
    point.sampleCount !== undefined
    && (!Number.isFinite(point.sampleCount) || point.sampleCount <= 0)
  ) return null;
  if (
    observation == null
    || !Number.isFinite(observation.rate)
    || !Number.isFinite(observation.annualizedRate)
  ) return null;
  return observation;
}

function perpPairFundingAnalytics(visible: ComboCandleResult, weights: CombinationWeights): Pick<
  PairDashboardAnalytics,
  "fundingAnnualized" | "fundingLeg1" | "fundingLeg2" | "fundingAlignedCount"
> {
  const points = [...visible.fundingRates].sort((a, b) => a.time - b.time);
  // Legacy hand-built results may not carry per-leg metadata. Preserve their
  // established aligned dashboard metric; production combo results always do.
  if (points.length === 0 || points.every((point) => point.firstFunding === undefined && point.secondFunding === undefined)) {
    if (!isOneToOne(weights)) {
      return {
        fundingAnnualized: { mean: null, count: 0 },
        fundingLeg1: null,
        fundingLeg2: null,
        fundingAlignedCount: 0,
      };
    }
    const funding = average((visible.dashboardFundingRates ?? []).map((point) => point.annualizedRate));
    return { fundingAnnualized: funding, fundingLeg1: null, fundingLeg2: null, fundingAlignedCount: funding.count };
  }

  if (!INTRADAY_PERP_PAIR_INTERVALS.has(visible.interval)) {
    const alignedPoints = points.filter((point) => (
      actualLegFunding(point, point.firstFunding)
      && actualLegFunding(point, point.secondFunding)
    ));
    const fundingLeg1 = average(alignedPoints.map((point) => weights.first * point.firstFunding!.annualizedRate));
    const fundingLeg2 = average(alignedPoints.map((point) => weights.second * point.secondFunding!.annualizedRate));
    return {
      fundingAnnualized: {
        mean: average(alignedPoints.map((point) => weights.first * point.firstFunding!.annualizedRate - weights.second * point.secondFunding!.annualizedRate)).mean,
        count: alignedPoints.length,
      },
      fundingLeg1,
      fundingLeg2,
      fundingAlignedCount: alignedPoints.length,
    };
  }

  const startIndex = points.findIndex((point) => (
    actualLegFunding(point, point.firstFunding)
    && actualLegFunding(point, point.secondFunding)
  ));
  if (startIndex === -1) {
    return {
      fundingAnnualized: { mean: null, count: 0 },
      fundingLeg1: { mean: null, count: 0 },
      fundingLeg2: { mean: null, count: 0 },
      fundingAlignedCount: 0,
    };
  }

  const leg1Values: number[] = [];
  const leg2Values: number[] = [];
  let alignedCount = 0;
  for (const point of points.slice(startIndex)) {
    const leg1 = actualLegFunding(point, point.firstFunding);
    const leg2 = actualLegFunding(point, point.secondFunding);
    if (leg1) leg1Values.push(weights.first * leg1.annualizedRate);
    if (leg2) leg2Values.push(weights.second * leg2.annualizedRate);
    if (leg1 && leg2) alignedCount += 1;
  }
  const fundingLeg1 = average(leg1Values);
  const fundingLeg2 = average(leg2Values);
  return {
    fundingAnnualized: {
      mean: fundingLeg1.mean === null || fundingLeg2.mean === null ? null : fundingLeg1.mean - fundingLeg2.mean,
      count: alignedCount,
    },
    fundingLeg1,
    fundingLeg2,
    fundingAlignedCount: alignedCount,
  };
}

export function filterLegacyComboRange(
  result: ComboCandleResult,
  range: ArbitrageChartRange,
): ComboCandleResult {
  const cloneAlignedLegPoints = (candles: typeof result.candles) => {
    const candleTimes = new Set(candles.map((point) => point.openTime));
    const first = result.leg1Points?.filter((point) => candleTimes.has(point.openTime));
    const second = result.leg2Points?.filter((point) => candleTimes.has(point.openTime));
    // Aligned results normally contain both arrays. If a hand-built legacy
    // result has only one, preserve that optional field without inventing the
    // other leg. When both exist, use their intersection to keep parity's
    // visible point set exactly aligned with the displayed candles.
    if (first && second) {
      const secondTimes = new Set(second.map((point) => point.openTime));
      const exactTimes = new Set(first.flatMap((point) => secondTimes.has(point.openTime) ? [point.openTime] : []));
      return {
        candles: candles.filter((point) => exactTimes.has(point.openTime)),
        leg1Points: first.filter((point) => exactTimes.has(point.openTime)),
        leg2Points: second.filter((point) => exactTimes.has(point.openTime)),
      };
    }
    return {
      candles,
      ...(first ? { leg1Points: first } : {}),
      ...(second ? { leg2Points: second } : {}),
    };
  };

  if (range === "all" || result.candles.length === 0) {
    const aligned = cloneAlignedLegPoints([...result.candles]);
    return {
      ...result,
      candles: aligned.candles,
      fundingRates: [...result.fundingRates],
      ...(result.firstQuoteTurnover ? { firstQuoteTurnover: [...result.firstQuoteTurnover] } : {}),
      ...(result.secondQuoteTurnover ? { secondQuoteTurnover: [...result.secondQuoteTurnover] } : {}),
      ...(result.dashboardFundingRates ? { dashboardFundingRates: [...result.dashboardFundingRates] } : {}),
      ...(aligned.leg1Points ? { leg1Points: aligned.leg1Points } : result.leg1Points ? { leg1Points: [] } : {}),
      ...(aligned.leg2Points ? { leg2Points: aligned.leg2Points } : result.leg2Points ? { leg2Points: [] } : {}),
    };
  }
  const duration = RANGE_MS[range];
  if (duration === null) return filterLegacyComboRange(result, "all");
  const dataEnd = Math.max(...result.candles.map((point) => point.closeTime).filter(Number.isFinite));
  if (!Number.isFinite(dataEnd)) {
    return {
      ...result,
      candles: [],
      fundingRates: [],
      ...(result.leg1Points ? { leg1Points: [] } : {}),
      ...(result.leg2Points ? { leg2Points: [] } : {}),
    };
  }
  const cutoff = dataEnd - duration;
  const rangedCandles = result.candles.filter((point) => point.openTime >= cutoff && point.openTime <= dataEnd);
  const aligned = cloneAlignedLegPoints(rangedCandles);
  return {
    ...result,
    candles: aligned.candles,
    fundingRates: result.fundingRates.filter((point) => point.time >= cutoff && point.time <= dataEnd),
    ...(result.firstQuoteTurnover
      ? { firstQuoteTurnover: result.firstQuoteTurnover.filter((point) => point.time >= cutoff && point.time <= dataEnd) }
      : {}),
    ...(result.secondQuoteTurnover
      ? { secondQuoteTurnover: result.secondQuoteTurnover.filter((point) => point.time >= cutoff && point.time <= dataEnd) }
      : {}),
    ...(result.dashboardFundingRates
      ? { dashboardFundingRates: result.dashboardFundingRates.filter((point) => point.time >= cutoff && point.time <= dataEnd) }
      : {}),
    ...(aligned.leg1Points ? { leg1Points: aligned.leg1Points } : result.leg1Points ? { leg1Points: [] } : {}),
    ...(aligned.leg2Points ? { leg2Points: aligned.leg2Points } : result.leg2Points ? { leg2Points: [] } : {}),
  };
}

export function filterAlignedRange<T extends SpotContainingCombinationResult>(
  result: T,
  range: ArbitrageChartRange,
): T;
export function filterAlignedRange(
  result: ComboCandleResult,
  range: ArbitrageChartRange,
): ComboCandleResult;
export function filterAlignedRange(
  result: SpotContainingCombinationResult | ComboCandleResult,
  range: ArbitrageChartRange,
): SpotContainingCombinationResult | ComboCandleResult {
  if (!("kind" in result)) return filterLegacyComboRange(result, range);
  if (range === "all" || result.points.length === 0) {
    return { ...result, points: [...result.points], funding: [...result.funding] };
  }
  const duration = RANGE_MS[range];
  if (duration === null) return result;
  const dataEnd = Math.max(...result.points.map((point) => point.closeTime).filter(Number.isFinite));
  if (!Number.isFinite(dataEnd)) return { ...result, points: [], funding: [] };
  const cutoff = dataEnd - duration;
  return {
    ...result,
    points: result.points.filter((point) => point.openTime >= cutoff && point.openTime <= dataEnd),
    funding: result.funding.filter((point) => point.time >= cutoff && point.time <= dataEnd),
  };
}

export function distributionAnalytics(
  values: readonly number[],
  trimPercent: TailTrimPercent,
): DistributionAnalytics {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const tailSize = Math.floor(sorted.length * trimPercent / 100);
  const retained = sorted.slice(tailSize, sorted.length - tailSize);
  if (retained.length === 0) {
    const emptyBands = distributionBands(null, {
      minus2Sigma: null,
      minus1Sigma: null,
      plus1Sigma: null,
      plus2Sigma: null,
    });
    return {
      mean: null,
      populationSigma: null,
      minus2Sigma: null,
      minus1Sigma: null,
      plus1Sigma: null,
      plus2Sigma: null,
      bands: emptyBands,
      retainedCount: 0,
      removedCount: sorted.length,
    };
  }
  const mean = retained.reduce((sum, value) => sum + value, 0) / retained.length;
  const populationSigma = Math.sqrt(
    retained.reduce((sum, value) => sum + (value - mean) ** 2, 0) / retained.length,
  );
  const minus2Sigma = mean - 2 * populationSigma;
  const minus1Sigma = mean - populationSigma;
  const plus1Sigma = mean + populationSigma;
  const plus2Sigma = mean + 2 * populationSigma;
  return {
    mean,
    populationSigma,
    minus2Sigma,
    minus1Sigma,
    plus1Sigma,
    plus2Sigma,
    bands: distributionBands(mean, { minus2Sigma, minus1Sigma, plus1Sigma, plus2Sigma }),
    retainedCount: retained.length,
    removedCount: sorted.length - retained.length,
  };
}

export function dashboardAnalytics(
  visible: MixedCombinationResult,
  trimPercent: TailTrimPercent,
  weights: CombinationWeights = ONE_TO_ONE,
): MixedDashboardAnalytics {
  const derived = derivedCloseRows(visible, weights);
  const derivedClose = distributionAnalytics(derived?.values ?? [], trimPercent);
  const spotTurnovers: number[] = [];
  const perpTurnovers: number[] = [];
  for (const point of visible.points) {
    const legs = [
      { market: visible.leg1, turnover: point.leg1Turnover },
      { market: visible.leg2, turnover: point.leg2Turnover },
    ] as const;
    for (const leg of legs) {
      if (!leg.turnover) continue;
      (leg.market.kind === "spot" ? spotTurnovers : perpTurnovers).push(leg.turnover.value);
    }
  }
  return {
    derivedClose,
    currentDerivedClose: valueWithRelativeGap(derived?.latest ?? null, derivedClose.mean),
    fundingAnnualized: average(visible.funding
      .filter((point) => point.sampleCount === null || point.sampleCount === undefined || point.sampleCount > 0)
      // combineSpotContaining stores leg-2 observations with the already
      // applied negative combination sign. Scale that signed observation once;
      // do not negate it a second time here.
      .map((point) => (point.perpLeg === 1 ? weights.first : weights.second) * point.annualizedRate)),
    spotTurnover: average(spotTurnovers),
    perpTurnover: average(perpTurnovers),
  };
}

export function pairDashboardAnalytics(
  visible: PairDashboardResult,
  trimPercent: TailTrimPercent,
  weights: CombinationWeights = ONE_TO_ONE,
): PairDashboardAnalytics {
  if ("candles" in visible) {
    const derived = derivedCloseRows(visible, weights);
    const derivedClose = distributionAnalytics(derived?.values ?? [], trimPercent);
    return {
      derivedClose,
      currentDerivedClose: valueWithRelativeGap(derived?.latest ?? null, derivedClose.mean),
      ...perpPairFundingAnalytics(visible, weights),
      leg1Turnover: average((visible.firstQuoteTurnover ?? []).map((point) => point.value)),
      leg2Turnover: average((visible.secondQuoteTurnover ?? []).map((point) => point.value)),
    };
  }

  const derived = derivedCloseRows(visible, weights);
  const derivedClose = distributionAnalytics(derived?.values ?? [], trimPercent);
  return {
    derivedClose,
    currentDerivedClose: valueWithRelativeGap(derived?.latest ?? null, derivedClose.mean),
    fundingAnnualized: null,
    fundingLeg1: null,
    fundingLeg2: null,
    fundingAlignedCount: null,
    leg1Turnover: average(visible.points.flatMap((point) => point.leg1Turnover ? [point.leg1Turnover.value] : [])),
    leg2Turnover: average(visible.points.flatMap((point) => point.leg2Turnover ? [point.leg2Turnover.value] : [])),
  };
}

export function visiblePairDashboardAnalytics(
  result: PairDashboardResult,
  range: ArbitrageChartRange,
  trimPercent: TailTrimPercent,
  weights: CombinationWeights = ONE_TO_ONE,
): { visible: PairDashboardResult; dashboard: PairDashboardAnalytics } {
  const visible: PairDashboardResult = "candles" in result
    ? filterLegacyComboRange(result, range)
    : filterAlignedRange(result, range);
  return { visible, dashboard: pairDashboardAnalytics(visible, trimPercent, weights) };
}

export function visibleDashboardAnalytics(
  result: MixedCombinationResult,
  range: ArbitrageChartRange,
  trimPercent: TailTrimPercent,
  weights: CombinationWeights = ONE_TO_ONE,
): { visible: MixedCombinationResult; dashboard: MixedDashboardAnalytics } {
  const visible = filterAlignedRange(result, range);
  return { visible, dashboard: dashboardAnalytics(visible, trimPercent, weights) };
}
