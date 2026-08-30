/** A numeric field as returned by the normalized perp and spot candle layers. */
export type NumericField = number | string;

/**
 * The subset shared by SearchCandlePoint and SpotCandlePoint. Extra transport
 * fields are intentionally not needed by these pure calculations.
 */
export interface SingleMarketCandleLike {
  openTime: NumericField;
  closeTime: NumericField;
  close: NumericField;
  volume: NumericField;
  quoteVolume?: NumericField | null;
}

export interface SingleMarketFundingLike {
  time: NumericField;
  rate?: NumericField | null;
  annualizedRate: NumericField;
  sampleCount?: NumericField | null;
}

export interface AverageMetric {
  mean: number | null;
  count: number;
}

export interface QuoteTurnoverMetric extends AverageMetric {
  officialCount: number;
  estimatedCount: number;
}

export interface WeightedDistributionMetric {
  mean: number | null;
  populationSigma: number | null;
  minus2Sigma: number | null;
  minus1Sigma: number | null;
  plus1Sigma: number | null;
  plus2Sigma: number | null;
  /** Number of valid candle values considered, including zero-weight values. */
  count: number;
  totalWeight: number;
}

export interface AnnualizedVolatilityMetric {
  percent: number | null;
  returnCount: number;
  averageIntervalMs: number | null;
}

export interface VolatilityCandleLike {
  openTime: NumericField;
  closeTime: NumericField;
  close: NumericField;
}

export interface SingleMarketAnalytics {
  latestClose: number | null;
  baseVolume: AverageMetric;
  quoteTurnover: QuoteTurnoverMetric;
  candleCloseVwap: WeightedDistributionMetric;
  candleCloseTwap: WeightedDistributionMetric;
  annualizedVolatility: AnnualizedVolatilityMetric;
  /** Null when no funding series was supplied; an empty supplied series is an empty metric. */
  fundingRate: AverageMetric | null;
  /** Null when no funding series was supplied; an empty supplied series is an empty metric. */
  fundingAnnualized: AverageMetric | null;
}

/** Per-market source policy for quote-turnover data. */
export interface SingleMarketAnalyticsOptions {
  /** Estimate unavailable quote turnover as base volume × close. Defaults to false. */
  estimateMissingQuoteTurnover?: boolean;
}

export const ANALYTICS_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function average(values: readonly number[]): AverageMetric {
  return {
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    count: values.length,
  };
}

function emptyWeightedDistribution(count = 0, totalWeight = 0): WeightedDistributionMetric {
  return {
    mean: null,
    populationSigma: null,
    minus2Sigma: null,
    minus1Sigma: null,
    plus1Sigma: null,
    plus2Sigma: null,
    count,
    totalWeight,
  };
}

function weightedDistribution(samples: readonly { value: number; weight: number }[]): WeightedDistributionMetric {
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  if (totalWeight === 0) return emptyWeightedDistribution(samples.length, totalWeight);

  const mean = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / totalWeight;
  const populationSigma = Math.sqrt(
    samples.reduce((sum, sample) => sum + sample.weight * (sample.value - mean) ** 2, 0) / totalWeight,
  );
  return {
    mean,
    populationSigma,
    minus2Sigma: mean - 2 * populationSigma,
    minus1Sigma: mean - populationSigma,
    plus1Sigma: mean + populationSigma,
    plus2Sigma: mean + 2 * populationSigma,
    count: samples.length,
    totalWeight,
  };
}

/** Returns points whose open timestamp is in the exact inclusive range. */
export function filterCandlesInTimeRange<T extends { openTime: unknown }>(
  candles: readonly T[],
  startTime: number,
  endTime: number,
): T[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) return [];
  return candles.filter((candle) => {
    const time = finiteNumber(candle.openTime);
    return time !== null && time >= startTime && time <= endTime;
  });
}

/** Returns funding observations whose timestamp is in the exact inclusive range. */
export function filterFundingInTimeRange<T extends { time: unknown }>(
  funding: readonly T[],
  startTime: number,
  endTime: number,
): T[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) return [];
  return funding.filter((observation) => {
    const time = finiteNumber(observation.time);
    return time !== null && time >= startTime && time <= endTime;
  });
}

export function annualizedVolatilityForCandles(candles: readonly VolatilityCandleLike[]): AnnualizedVolatilityMetric {
  const closes = candles.flatMap((candle) => {
    const closeTime = finiteNumber(candle.closeTime);
    const close = finiteNumber(candle.close);
    return closeTime !== null && close !== null && close > 0 ? [{ closeTime, close }] : [];
  }).sort((first, second) => first.closeTime - second.closeTime);

  const returns: number[] = [];
  const intervals: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    const interval = current.closeTime - previous.closeTime;
    if (interval <= 0) continue;
    const logReturn = Math.log(current.close / previous.close);
    if (!Number.isFinite(logReturn)) continue;
    returns.push(logReturn);
    intervals.push(interval);
  }

  const averageIntervalMs = intervals.length === 0
    ? null
    : intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  if (returns.length < 2 || averageIntervalMs === null || averageIntervalMs <= 0) {
    return { percent: null, returnCount: returns.length, averageIntervalMs };
  }

  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const sampleVariance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (returns.length - 1);
  return {
    percent: Math.sqrt(sampleVariance) * Math.sqrt(ANALYTICS_YEAR_MS / averageIntervalMs) * 100,
    returnCount: returns.length,
    averageIntervalMs,
  };
}

/**
 * Annualized close-to-close volatility for the candles currently visible in a
 * chart. The range is inclusive and is deliberately applied before returns are
 * built, so a return never crosses a hidden candle.
 */
export function annualizedVolatilityForVisibleRange(
  candles: readonly VolatilityCandleLike[],
  startTime?: number,
  endTime?: number,
): AnnualizedVolatilityMetric {
  const visible = startTime === undefined || endTime === undefined
    ? [...candles]
    : filterCandlesInTimeRange(candles, startTime, endTime);
  return annualizedVolatilityForCandles(visible);
}

/**
 * Calculates untrimmed, single-market candle metrics. A malformed field only
 * removes that candle from metrics that require the field; it is never filled
 * with a synthetic zero.
 */
export function singleMarketAnalytics(
  candles: readonly SingleMarketCandleLike[],
  funding?: readonly SingleMarketFundingLike[],
  options: SingleMarketAnalyticsOptions = {},
): SingleMarketAnalytics {
  let latestCloseTime = Number.NEGATIVE_INFINITY;
  let latestClose: number | null = null;
  const baseVolumes: number[] = [];
  const quoteTurnovers: number[] = [];
  let officialCount = 0;
  let estimatedCount = 0;
  const vwapSamples: { value: number; weight: number }[] = [];
  const twapSamples: { value: number; weight: number }[] = [];

  for (const candle of candles) {
    const openTime = finiteNumber(candle.openTime);
    const closeTime = finiteNumber(candle.closeTime);
    const close = positiveNumber(candle.close);
    const volume = finiteNumber(candle.volume);

    if (closeTime !== null && close !== null && closeTime > latestCloseTime) {
      latestCloseTime = closeTime;
      latestClose = close;
    }
    if (volume !== null && volume >= 0) baseVolumes.push(volume);

    if (volume !== null && volume >= 0 && close !== null) {
      vwapSamples.push({ value: close, weight: volume });
    }
    if (openTime !== null && closeTime !== null && closeTime > openTime && close !== null) {
      twapSamples.push({ value: close, weight: closeTime - openTime });
    }

    const officialQuoteVolume = finiteNumber(candle.quoteVolume);
    if (officialQuoteVolume !== null && officialQuoteVolume >= 0) {
      quoteTurnovers.push(officialQuoteVolume);
      officialCount += 1;
    } else if (options.estimateMissingQuoteTurnover && volume !== null && volume >= 0 && close !== null) {
      const estimate = volume * close;
      if (Number.isFinite(estimate)) {
        quoteTurnovers.push(estimate);
        estimatedCount += 1;
      }
    }
  }

  const actualFundingBuckets = funding?.filter((observation) => {
    const time = finiteNumber(observation.time);
    const sampleCount = observation.sampleCount === undefined ? undefined : finiteNumber(observation.sampleCount);
    return time !== null && (sampleCount === undefined || (sampleCount !== null && sampleCount > 0));
  });
  const fundingRate = actualFundingBuckets === undefined ? null : average(
    actualFundingBuckets.flatMap((observation) => {
      const rate = finiteNumber(observation.rate);
      return rate === null ? [] : [rate];
    }),
  );
  const fundingAnnualized = actualFundingBuckets === undefined ? null : average(
    actualFundingBuckets.flatMap((observation) => {
      const rate = finiteNumber(observation.annualizedRate);
      return rate === null ? [] : [rate];
    }),
  );
  const quoteAverage = average(quoteTurnovers);

  return {
    latestClose,
    baseVolume: average(baseVolumes),
    quoteTurnover: { ...quoteAverage, officialCount, estimatedCount },
    candleCloseVwap: weightedDistribution(vwapSamples),
    candleCloseTwap: weightedDistribution(twapSamples),
    annualizedVolatility: annualizedVolatilityForCandles(candles),
    fundingRate,
    fundingAnnualized,
  };
}

export const analyzeSingleMarket = singleMarketAnalytics;
