import type { ComboFundingLegObservation, ComboFundingRatePoint, ComboCandleResult } from "../combo";
import type { MixedCombinationResult, SpotContainingCombinationResult, SpotSpotCombinationResult } from "./combine";
import { combineWeightedPrice, type CombinationWeights } from "../combo-weighting";
import { ANALYTICS_YEAR_MS } from "./single-market-analytics";

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
  /**
   * Oldest retained perp settlement inside the visible window, or null when no
   * funding is available. When venue retention is shorter than the candle
   * range this is later than the window start; annualization already uses the
   * funding-covered sub-window and the UI should disclose the gap.
   */
  fundingCoverageStartTime: number | null;
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
  /** Oldest settlement where both legs retain funding (shared window start). */
  fundingCoverageStartTime: number | null;
  leg1Turnover: AverageAnalytics;
  leg2Turnover: AverageAnalytics;
}

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

interface FundingWindow {
  startTime: number;
  endTime: number;
}

function visibleFundingWindow(points: ReadonlyArray<{ openTime: number; closeTime: number }>): FundingWindow | null {
  const valid = points.filter((point) => (
    Number.isFinite(point.openTime)
    && Number.isFinite(point.closeTime)
    && point.closeTime > point.openTime
  ));
  if (valid.length === 0) return null;
  const startTime = Math.min(...valid.map((point) => point.openTime));
  const endTime = Math.max(...valid.map((point) => point.closeTime));
  return endTime > startTime ? { startTime, endTime } : null;
}

function fundingSampleCount(value: unknown): number | null {
  if (value === undefined || value === null) return 1;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function actualLegFunding(
  point: ComboFundingRatePoint,
  observation: ComboFundingLegObservation | null | undefined,
): { rate: number; count: number } | null {
  if (
    point.sampleCount !== undefined
    && (!Number.isFinite(point.sampleCount) || point.sampleCount <= 0)
  ) return null;
  if (
    observation == null
    || !Number.isFinite(observation.rate)
  ) return null;
  const observationRecord = observation as ComboFundingLegObservation & { sampleCount?: unknown };
  const count = fundingSampleCount(
    observationRecord.sampleCount === undefined ? point.sampleCount : observationRecord.sampleCount,
  );
  return count === null ? null : { rate: observation.rate, count };
}

interface CumulativeLegFunding {
  total: number | null;
  count: number;
  actualPointCount: number;
  /** Oldest retained settlement inside the queried window, or null when empty. */
  firstTime: number | null;
}

function cumulativeLegFunding(
  points: readonly ComboFundingRatePoint[],
  leg: "firstFunding" | "secondFunding",
  window: FundingWindow | null,
): CumulativeLegFunding {
  let total = 0;
  let count = 0;
  let actualPointCount = 0;
  let firstTime: number | null = null;
  for (const point of points) {
    if (window === null || point.time < window.startTime || point.time >= window.endTime) continue;
    const actual = actualLegFunding(point, point[leg]);
    if (!actual) continue;
    total += actual.rate;
    count += actual.count;
    actualPointCount += 1;
    if (firstTime === null || point.time < firstTime) firstTime = point.time;
  }
  return { total: actualPointCount === 0 ? null : total, count, actualPointCount, firstTime };
}

interface CoveredFundingAnalytics {
  mean: number | null;
  count: number;
  /** Oldest retained settlement driving the annualization window. */
  coverageStartTime: number | null;
}

function mixedFundingAnalytics(
  visible: MixedCombinationResult,
  weights: CombinationWeights,
): CoveredFundingAnalytics {
  const window = visibleFundingWindow(visible.points);
  if (window === null) return { mean: null, count: 0, coverageStartTime: null };

  let weightedSettledReturn = 0;
  let count = 0;
  let actualPointCount = 0;
  let firstTime: number | null = null;
  for (const point of visible.funding) {
    if (
      !Number.isFinite(point.time)
      || point.time < window.startTime
      || point.time >= window.endTime
      || !Number.isFinite(point.rate)
    ) continue;
    const sampleCount = fundingSampleCount(point.sampleCount);
    if (sampleCount === null || (point.perpLeg !== 1 && point.perpLeg !== 2)) continue;
    weightedSettledReturn += point.rate * (point.perpLeg === 1 ? weights.first : weights.second);
    count += sampleCount;
    actualPointCount += 1;
    if (firstTime === null || point.time < firstTime) firstTime = point.time;
  }

  // Annualize over [first retained settlement, window end). A venue that
  // retains less funding history than the visible candle range must not have
  // its cumulative return diluted by uncovered candles.
  const fundingDurationMs = firstTime === null || window.endTime <= firstTime
    ? null
    : window.endTime - firstTime;
  return {
    mean: actualPointCount === 0 || fundingDurationMs === null || fundingDurationMs <= 0
      ? null
      : weightedSettledReturn * ANALYTICS_YEAR_MS / fundingDurationMs,
    count,
    coverageStartTime: firstTime,
  };
}

function perpPairFundingAnalytics(visible: ComboCandleResult, weights: CombinationWeights): Pick<
  PairDashboardAnalytics,
  "fundingAnnualized" | "fundingLeg1" | "fundingLeg2" | "fundingAlignedCount" | "fundingCoverageStartTime"
> {
  const points = [...visible.fundingRates].sort((a, b) => a.time - b.time);
  const window = visibleFundingWindow(visible.candles);
  // Legacy hand-built results may not carry per-leg metadata. Preserve their
  // dashboard funding lane, but use cumulative bucket rates over the visible
  // candle window rather than averaging bucket annualized rates.
  if (points.length === 0 || points.every((point) => point.firstFunding === undefined && point.secondFunding === undefined)) {
    if (!isOneToOne(weights)) {
      return {
        fundingAnnualized: { mean: null, count: 0 },
        fundingLeg1: null,
        fundingLeg2: null,
        fundingAlignedCount: 0,
        fundingCoverageStartTime: null,
      };
    }
    const legacy = (visible.dashboardFundingRates ?? []).filter((point) => (
      window !== null
      && Number.isFinite(point.time)
      && point.time >= window.startTime
      && point.time < window.endTime
      && (point.sampleCount === undefined || (Number.isFinite(point.sampleCount) && point.sampleCount > 0))
      && Number.isFinite(point.rate)
    )).sort((a, b) => a.time - b.time);
    const total = legacy.reduce((sum, point) => sum + point.rate, 0);
    const count = legacy.reduce((sum, point) => sum + (point.sampleCount === undefined ? 1 : point.sampleCount), 0);
    // Annualize from the oldest retained settlement so a venue retention
    // limit (funding history shorter than the candle range) does not dilute
    // the return with uncovered candles.
    const firstTime = legacy.length === 0 ? null : legacy[0].time;
    const fundingDurationMs = window !== null && firstTime !== null && window.endTime > firstTime
      ? window.endTime - firstTime
      : null;
    return {
      fundingAnnualized: {
        mean: legacy.length === 0 || fundingDurationMs === null || fundingDurationMs <= 0
          ? null
          : total * ANALYTICS_YEAR_MS / fundingDurationMs,
        count,
      },
      fundingLeg1: null,
      fundingLeg2: null,
      fundingAlignedCount: legacy.length,
      fundingCoverageStartTime: firstTime,
    };
  }

  // Both legs expose per-settlement rows. Each leg's own annualized lane is
  // based on its own retained coverage ([leg.firstTime, window end)) so a leg
  // whose funding history starts later is not diluted. The funded difference
  // can only be stated over the shared window where BOTH legs retain
  // settlements, so it is accumulated from the later of the two starts.
  const alignedCount = points.filter((point) => (
    window !== null
    && point.time >= window.startTime
    && point.time < window.endTime
    && actualLegFunding(point, point.firstFunding)
    && actualLegFunding(point, point.secondFunding)
  )).length;
  const leg1Window = cumulativeLegFunding(points, "firstFunding", window);
  const leg2Window = cumulativeLegFunding(points, "secondFunding", window);
  const legAnnualized = (leg: CumulativeLegFunding, weight: number): AverageAnalytics => {
    const durationMs = window !== null && leg.firstTime !== null && window.endTime > leg.firstTime
      ? window.endTime - leg.firstTime
      : null;
    return {
      mean: leg.total === null || durationMs === null || durationMs <= 0
        ? null
        : weight * leg.total * ANALYTICS_YEAR_MS / durationMs,
      count: leg.count,
    };
  };
  const fundingLeg1 = legAnnualized(leg1Window, weights.first);
  const fundingLeg2 = legAnnualized(leg2Window, weights.second);
  if (
    window === null || leg1Window.total === null || leg2Window.total === null
    || leg1Window.firstTime === null || leg2Window.firstTime === null
  ) {
    return {
      fundingAnnualized: { mean: null, count: alignedCount },
      fundingLeg1,
      fundingLeg2,
      fundingAlignedCount: alignedCount,
      fundingCoverageStartTime: leg1Window.firstTime !== null && leg2Window.firstTime !== null
        ? Math.max(leg1Window.firstTime, leg2Window.firstTime)
        : null,
    };
  }
  const commonStartTime = Math.max(leg1Window.firstTime, leg2Window.firstTime);
  const commonWindow: FundingWindow = { startTime: commonStartTime, endTime: window.endTime };
  const leg1 = cumulativeLegFunding(points, "firstFunding", commonWindow);
  const leg2 = cumulativeLegFunding(points, "secondFunding", commonWindow);
  const commonDurationMs = window.endTime - commonStartTime;
  if (leg1.total === null || leg2.total === null || commonDurationMs <= 0) {
    return {
      fundingAnnualized: { mean: null, count: alignedCount },
      fundingLeg1,
      fundingLeg2,
      fundingAlignedCount: alignedCount,
      fundingCoverageStartTime: commonStartTime,
    };
  }
  return {
    fundingAnnualized: {
      mean: (weights.first * leg1.total - weights.second * leg2.total) * ANALYTICS_YEAR_MS / commonDurationMs,
      count: alignedCount,
    },
    fundingLeg1,
    fundingLeg2,
    fundingAlignedCount: alignedCount,
    fundingCoverageStartTime: commonStartTime,
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
  const mixedFunding = mixedFundingAnalytics(visible, weights);
  return {
    derivedClose,
    currentDerivedClose: valueWithRelativeGap(derived?.latest ?? null, derivedClose.mean),
    fundingAnnualized: { mean: mixedFunding.mean, count: mixedFunding.count },
    fundingCoverageStartTime: mixedFunding.coverageStartTime,
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
    fundingCoverageStartTime: null,
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
