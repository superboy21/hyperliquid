import {
  normalizeAlignedPairCloses,
  type AlignedPairClose,
  type StatResult,
} from "./pair-statistics";

/**
 * OLS fit of leg1 simple returns on leg2 simple returns, using only adjacent
 * aligned closes whose timestamp spacing is exactly the supplied interval.
 * `beta` is the fitted hedge ratio (covariance / leg2 return variance); a zero
 * or negative slope is a valid numeric result, not an error.
 * `rSquared` is null when every leg1 return is identical (zero variance).
 */
export interface SimpleReturnRegression {
  beta: number;
  intercept: number;
  rSquared: number | null;
  returnCount: number;
}

/** Minimum valid adjacent simple-return observations required for the OLS fit. */
const MIN_RETURN_COUNT = 30;

/** Minimum daily two-leg return observations behind a VaR95 estimate. */
const MIN_DAILY_RETURNS_95 = 100;
/**
 * Minimum daily two-leg return observations behind a VaR99 estimate. It matches
 * the VaR95 gate: at 100 samples `floor((n - 1) * 0.01)` selects the single worst
 * observed day, which is a low-sample (not modelled-tail) 99% reading the UI is
 * expected to flag.
 */
const MIN_DAILY_RETURNS_99 = 100;

/** UTC daily candle spacing (aligned by open time). */
const DAILY_INTERVAL_MS = 86_400_000;

const VAR_95_QUANTILE = 0.05;
const VAR_99_QUANTILE = 0.01;

/**
 * Historical lower-tail daily value-at-risk for a two-leg pair, as a positive
 * loss magnitude percent.
 *
 * `sampleCount` always reports the number of consecutive, already-completed
 * daily two-leg return observations used (zero when the daily interval or beta
 * is rejected, or when `asOfMs` is invalid). Both percentiles share a hard gate
 * of at least 100 daily observations; at exactly 100 the VaR99 reading is the
 * single worst observed sample, so the UI is expected to add low-sample caution
 * between 100 and 249 samples.
 */
export interface DailyPairVaR {
  sampleCount: number;
  var95: StatResult<number>;
  var99: StatResult<number>;
}

function unavailable<T>(reason: string): StatResult<T> {
  return { available: false, value: null, reason };
}

function available<T>(value: T): StatResult<T> {
  return { available: true, value, reason: null };
}

/**
 * Fits `firstReturn = intercept + beta * secondReturn` by ordinary least
 * squares over regular adjacent aligned closes.
 *
 * Only transitions whose timestamp spacing is exactly `intervalMs` contribute
 * a return; gaps are skipped rather than bridged. Missing/non-finite returns
 * are skipped. At least 30 valid returns and a finite, strictly positive leg2
 * return variance are required, so `beta` is always finite. A zero or negative
 * slope is reported as-is for the caller to gate on. The model is gross of
 * rebalancing, fees and funding.
 */
export function estimateSimpleReturnRegression(
  points: readonly AlignedPairClose[],
  intervalMs: number,
): StatResult<SimpleReturnRegression> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return unavailable("invalid-interval");

  const cleaned = normalizeAlignedPairCloses(points);
  const secondReturns: number[] = [];
  const firstReturns: number[] = [];
  for (let index = 1; index < cleaned.length; index += 1) {
    const previous = cleaned[index - 1];
    const current = cleaned[index];
    if (current.closeTime - previous.closeTime !== intervalMs) continue;
    const secondReturn = current.secondClose / previous.secondClose - 1;
    const firstReturn = current.firstClose / previous.firstClose - 1;
    if (!Number.isFinite(secondReturn) || !Number.isFinite(firstReturn)) continue;
    secondReturns.push(secondReturn);
    firstReturns.push(firstReturn);
  }

  const returnCount = secondReturns.length;
  if (returnCount < MIN_RETURN_COUNT) return unavailable("insufficient-returns");

  const meanSecond = secondReturns.reduce((sum, value) => sum + value, 0) / returnCount;
  const meanFirst = firstReturns.reduce((sum, value) => sum + value, 0) / returnCount;
  let varianceSecond = 0;
  let covariance = 0;
  for (let index = 0; index < returnCount; index += 1) {
    const deltaSecond = secondReturns[index] - meanSecond;
    varianceSecond += deltaSecond * deltaSecond;
    covariance += deltaSecond * (firstReturns[index] - meanFirst);
  }
  if (!Number.isFinite(varianceSecond) || varianceSecond <= 0) {
    return unavailable("zero-variance-second-return");
  }

  const beta = covariance / varianceSecond;
  const intercept = meanFirst - beta * meanSecond;
  if (!Number.isFinite(beta) || !Number.isFinite(intercept)) {
    return unavailable("non-finite-regression");
  }

  let sse = 0;
  let total = 0;
  for (let index = 0; index < returnCount; index += 1) {
    const fitted = intercept + beta * secondReturns[index];
    sse += (firstReturns[index] - fitted) ** 2;
    total += (firstReturns[index] - meanFirst) ** 2;
  }
  const rSquared = total === 0 ? null : 1 - sse / total;
  return available({ beta, intercept, rSquared, returnCount });
}

/**
 * Estimates historical lower-tail daily VaR for the daily ratio proxy of a
 * two-leg pair.
 *
 * `AlignedPairClose.closeTime` is the candle OPEN timestamp while the close
 * values are that candle's latest close, so the most recent daily bar may still
 * be in progress. A UTC close-to-close daily VaR sample must therefore only use
 * fully closed days: a daily candle ending exactly at `asOfMs` is complete, and
 * the current in-progress bar (whose end `openTime + 86_400_000` is after
 * `asOfMs`) is excluded. A transition is accepted only when both its previous
 * and current candles have completed by `asOfMs`.
 *
 * Only consecutive daily closes one UTC day apart are used; a missing day skips
 * that transition (no bridging), and non-finite or invalid closes are skipped.
 * For each accepted transition the two-leg return is
 * `(r1 - beta * r2) / (1 + beta)`, i.e. the leg1 simple return minus β times the
 * leg2 simple return, divided by the gross notional `1 + beta`.
 *
 * That ratio assumes the 1:β INITIAL NOTIONAL ratio is re-established every
 * historical day before the next close, so each day's leg2 exposure is sized to
 * the current leg1 value rather than to a frozen token count. It is therefore a
 * per-day ratio/notional risk proxy, deliberately distinct from the pair-trade
 * PnL path (calculatePairTradeSeries), which holds quantities fixed from a
 * single entry and lets the 1:β notional ratio drift as prices move. The two
 * do not coincide once prices drift, and this function makes no attempt to model
 * a fixed-token position. No execution, rebalancing, fee or funding cost is
 * applied, and the result is neither a guaranteed nor a conservative bound: it
 * is a descriptive historical sample quantile of that ratio proxy.
 *
 * The reported value is the positive loss magnitude in percent,
 * `max(0, -quantile) * 100`, with a documented deterministic lower-tail index
 * `floor((n - 1) * q)` into the ascending return sample.
 *
 * Any interval other than 86_400_000 is rejected with
 * `daily-interval-required`; a null, non-finite or non-positive beta is
 * rejected with `invalid-beta`; a non-finite `asOfMs` is rejected with
 * `invalid-as-of`; each percentile below the shared 100-observation gate is
 * rejected with `insufficient-daily-returns`. Estimates are gross of
 * rebalancing, fees and funding and are historical descriptions, not a
 * guarantee of future losses.
 */
export function estimateDailyPairVaR(
  points: readonly AlignedPairClose[],
  beta: number | null,
  intervalMs: number,
  asOfMs: number = Date.now(),
): DailyPairVaR {
  const daily = intervalMs === DAILY_INTERVAL_MS;
  const validAsOf = Number.isFinite(asOfMs);
  const validBeta = beta !== null && Number.isFinite(beta) && beta > 0;
  const netReturns: number[] = [];

  if (daily && validAsOf && validBeta) {
    const hedge = beta as number;
    const grossNotional = 1 + hedge;
    const cleaned = normalizeAlignedPairCloses(points);
    for (let index = 1; index < cleaned.length; index += 1) {
      const previous = cleaned[index - 1];
      const current = cleaned[index];
      if (current.closeTime - previous.closeTime !== DAILY_INTERVAL_MS) continue;
      // Both candles must be fully closed by asOfMs. A candle is complete once
      // its open plus one day is reached, so a bar ending exactly at asOfMs
      // counts and an in-progress current bar is excluded.
      if (previous.closeTime + DAILY_INTERVAL_MS > asOfMs) continue;
      if (current.closeTime + DAILY_INTERVAL_MS > asOfMs) continue;
      const firstReturn = current.firstClose / previous.firstClose - 1;
      const secondReturn = current.secondClose / previous.secondClose - 1;
      if (!Number.isFinite(firstReturn) || !Number.isFinite(secondReturn)) continue;
      const netReturn = (firstReturn - hedge * secondReturn) / grossNotional;
      if (!Number.isFinite(netReturn)) continue;
      netReturns.push(netReturn);
    }
  }

  const sampleCount = netReturns.length;
  const gate = (minimum: number, quantile: number): StatResult<number> => {
    if (!daily) return unavailable("daily-interval-required");
    if (!validAsOf) return unavailable("invalid-as-of");
    if (!validBeta) return unavailable("invalid-beta");
    if (sampleCount < minimum) return unavailable("insufficient-daily-returns");
    const sorted = [...netReturns].sort((a, b) => a - b);
    const index = Math.floor((sorted.length - 1) * quantile);
    const quantileValue = sorted[index];
    return available(Math.max(0, -quantileValue) * 100);
  };

  return {
    sampleCount,
    var95: gate(MIN_DAILY_RETURNS_95, VAR_95_QUANTILE),
    var99: gate(MIN_DAILY_RETURNS_99, VAR_99_QUANTILE),
  };
}
