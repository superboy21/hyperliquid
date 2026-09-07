/**
 * Pure funding-history statistics.
 *
 * Funding history is a series of settled cash flows, not a series of equally
 * weighted observations.  A window's annualized return therefore comes from
 * the sum of the settlements in that window and the actual window duration.
 */

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface FundingStatisticSample {
  time: number | string;
  rate?: number | string;
}

export interface FundingStatistics {
  settledReturn: number;
  annualizedRate: number;
  sampleCount: number;
  /** The same return expressed as one reference settlement interval. */
  referenceIntervalRate: number;
}

/**
 * Calculates settled return for [startTime, endTime).
 *
 * Invalid timestamps/rates are ignored.  Input ordering does not matter and a
 * timestamp is counted at most once; the first valid sample at a duplicate
 * timestamp wins after chronological sorting.  In particular, a finite zero
 * rate is a real settlement and is retained.
 */
export function calculateHistoricalFundingStatistics(
  history: readonly FundingStatisticSample[],
  startTime: number,
  endTime: number,
  referenceIntervalMs: number = 60 * 60 * 1000,
): FundingStatistics | null {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return null;
  }

  const samples = history.flatMap((sample) => {
    const time = Number(sample.time);
    const rate = parseFundingRate(sample.rate);
    if (
      !Number.isFinite(time)
      || rate === null
      || time < startTime
      || time >= endTime
    ) {
      return [];
    }
    return [{ time, rate }];
  })
    .sort((a, b) => a.time - b.time);

  const uniqueSamples: typeof samples = [];
  let lastTime: number | undefined;
  for (const sample of samples) {
    if (sample.time === lastTime) continue;
    uniqueSamples.push(sample);
    lastTime = sample.time;
  }

  if (uniqueSamples.length === 0) return null;

  const settledReturn = uniqueSamples.reduce((sum, sample) => sum + sample.rate, 0);
  const windowDurationMs = endTime - startTime;
  const annualizedRate = settledReturn * YEAR_MS / windowDurationMs;
  const referenceDuration = Number.isFinite(referenceIntervalMs) && referenceIntervalMs > 0
    ? referenceIntervalMs
    : 60 * 60 * 1000;

  return {
    settledReturn,
    annualizedRate,
    sampleCount: uniqueSamples.length,
    referenceIntervalRate: settledReturn * referenceDuration / windowDurationMs,
  };
}

function parseFundingRate(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Express an already calculated window return as one reference interval. */
export function toReferenceIntervalRate(
  settledReturn: number,
  windowDurationMs: number,
  referenceIntervalMs: number,
): number | null {
  if (!Number.isFinite(settledReturn) || !Number.isFinite(windowDurationMs) || windowDurationMs <= 0) {
    return null;
  }
  if (!Number.isFinite(referenceIntervalMs) || referenceIntervalMs <= 0) return null;
  return settledReturn * referenceIntervalMs / windowDurationMs;
}

// Descriptive aliases keep the helper easy to discover for callers using
// either "calculate" or "compute" terminology.
export const computeHistoricalFundingStatistics = calculateHistoricalFundingStatistics;
export const calculateFundingStatistics = calculateHistoricalFundingStatistics;
export const computeHistoricalFundingStats = calculateHistoricalFundingStatistics;
export const calculateHistoricalFundingStats = calculateHistoricalFundingStatistics;
