import type { ComboFundingLegObservation, ComboFundingRatePoint, ComboCandleResult } from "../combo";
import type { MixedCombinationResult, SpotContainingCombinationResult, SpotSpotCombinationResult } from "./combine";

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

function latestVisibleClose(visible: SpotContainingCombinationResult): number | null {
  let latestCloseTime = Number.NEGATIVE_INFINITY;
  let latestValue: number | null = null;
  for (const point of visible.points) {
    if (!Number.isFinite(point.closeTime) || point.closeTime <= latestCloseTime) continue;
    latestCloseTime = point.closeTime;
    latestValue = Number.isFinite(point.close) ? point.close : null;
  }
  return latestValue;
}

function average(values: readonly number[]): AverageAnalytics {
  const finite = values.filter(Number.isFinite);
  return {
    mean: finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null,
    count: finite.length,
  };
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

function perpPairFundingAnalytics(visible: ComboCandleResult): Pick<
  PairDashboardAnalytics,
  "fundingAnnualized" | "fundingLeg1" | "fundingLeg2" | "fundingAlignedCount"
> {
  if (!INTRADAY_PERP_PAIR_INTERVALS.has(visible.interval)) {
    const funding = average((visible.dashboardFundingRates ?? []).map((point) => point.annualizedRate));
    return { fundingAnnualized: funding, fundingLeg1: null, fundingLeg2: null, fundingAlignedCount: funding.count };
  }

  const points = [...visible.fundingRates].sort((a, b) => a.time - b.time);
  // Legacy hand-built results may not carry per-leg metadata. Preserve their
  // established aligned dashboard metric; production combo results always do.
  if (points.length === 0 || points.every((point) => point.firstFunding === undefined && point.secondFunding === undefined)) {
    const funding = average((visible.dashboardFundingRates ?? []).map((point) => point.annualizedRate));
    return { fundingAnnualized: funding, fundingLeg1: null, fundingLeg2: null, fundingAlignedCount: funding.count };
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
    if (leg1) leg1Values.push(leg1.annualizedRate);
    if (leg2) leg2Values.push(leg2.annualizedRate);
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
  if (range === "all" || result.candles.length === 0) {
    return {
      ...result,
      candles: [...result.candles],
      fundingRates: [...result.fundingRates],
      ...(result.firstQuoteTurnover ? { firstQuoteTurnover: [...result.firstQuoteTurnover] } : {}),
      ...(result.secondQuoteTurnover ? { secondQuoteTurnover: [...result.secondQuoteTurnover] } : {}),
      ...(result.dashboardFundingRates ? { dashboardFundingRates: [...result.dashboardFundingRates] } : {}),
    };
  }
  const duration = RANGE_MS[range];
  if (duration === null) return result;
  const dataEnd = Math.max(...result.candles.map((point) => point.closeTime).filter(Number.isFinite));
  if (!Number.isFinite(dataEnd)) return { ...result, candles: [], fundingRates: [] };
  const cutoff = dataEnd - duration;
  return {
    ...result,
    candles: result.candles.filter((point) => point.openTime >= cutoff && point.openTime <= dataEnd),
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
): MixedDashboardAnalytics {
  const derivedClose = distributionAnalytics(visible.points.map((point) => point.close), trimPercent);
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
    currentDerivedClose: valueWithRelativeGap(latestVisibleClose(visible), derivedClose.mean),
    fundingAnnualized: average(visible.funding.map((point) => point.annualizedRate)),
    spotTurnover: average(spotTurnovers),
    perpTurnover: average(perpTurnovers),
  };
}

export function pairDashboardAnalytics(
  visible: PairDashboardResult,
  trimPercent: TailTrimPercent,
): PairDashboardAnalytics {
  if ("candles" in visible) {
    const derivedClose = distributionAnalytics(visible.candles.map((point) => Number(point.close)), trimPercent);
    let latestCloseTime = Number.NEGATIVE_INFINITY;
    let latestClose: number | null = null;
    for (const point of visible.candles) {
      if (!Number.isFinite(point.closeTime) || point.closeTime <= latestCloseTime) continue;
      latestCloseTime = point.closeTime;
      const close = Number(point.close);
      latestClose = Number.isFinite(close) ? close : null;
    }
    return {
      derivedClose,
      currentDerivedClose: valueWithRelativeGap(latestClose, derivedClose.mean),
      ...perpPairFundingAnalytics(visible),
      leg1Turnover: average((visible.firstQuoteTurnover ?? []).map((point) => point.value)),
      leg2Turnover: average((visible.secondQuoteTurnover ?? []).map((point) => point.value)),
    };
  }

  const derivedClose = distributionAnalytics(visible.points.map((point) => point.close), trimPercent);
  return {
    derivedClose,
    currentDerivedClose: valueWithRelativeGap(latestVisibleClose(visible), derivedClose.mean),
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
): { visible: PairDashboardResult; dashboard: PairDashboardAnalytics } {
  const visible: PairDashboardResult = "candles" in result
    ? filterLegacyComboRange(result, range)
    : filterAlignedRange(result, range);
  return { visible, dashboard: pairDashboardAnalytics(visible, trimPercent) };
}

export function visibleDashboardAnalytics(
  result: MixedCombinationResult,
  range: ArbitrageChartRange,
  trimPercent: TailTrimPercent,
): { visible: MixedCombinationResult; dashboard: MixedDashboardAnalytics } {
  const visible = filterAlignedRange(result, range);
  return { visible, dashboard: dashboardAnalytics(visible, trimPercent) };
}
