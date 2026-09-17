/** A close for two markets which has already been aligned to one timestamp. */
export interface AlignedPairClose {
  closeTime: number;
  firstClose: number;
  secondClose: number;
}

/** A close for a single timed market (used for the BTC control series). */
export interface TimedClose {
  closeTime: number;
  close: number;
  source?: string;
}

/** OLS estimates the hedge ratio; custom uses second / first as that ratio. */
export type PairModelSpec =
  | { mode: "ols" }
  | { mode: "custom"; first: number; second: number };

export interface StatResult<T> {
  available: boolean;
  value: T | null;
  reason: string | null;
}

export interface PairResidualPoint extends AlignedPairClose {
  /** Alias for closeTime for chart-oriented consumers. */
  time: number;
  logFirst: number;
  logSecond: number;
  residual: number;
  /** exp(residual) - 1, expressed in percent. */
  modelDeviationPercent: number;
  zScore: number | null;
}

export interface PairModelEstimate {
  kind: PairModelSpec["mode"];
  alpha: number;
  beta: number;
  count: number;
  rSquared: number | null;
}

export interface Adf0Estimate {
  statistic: number;
  coefficient: number;
  intercept: number | null;
  criticalValue: number;
  stationary: boolean;
  levelCount: number;
  transitionCount: number;
  regularTransitionRatio: number;
}

export interface HalfLifeEstimate {
  phi: number;
  halfLifePeriods: number;
  halfLifeMs: number | null;
  oscillatory: boolean;
  transitionCount: number;
}

export interface RollingBetaEstimate {
  latest: number;
  mean: number;
  sampleStdDev: number;
  coefficientOfVariation: number | null;
  estimateCount: number;
}

export interface BtcBetaEstimate {
  beta: number;
  intercept: number;
  rSquared: number | null;
  returnCount: number;
  source: string | null;
}

export interface PairDiagnostics {
  alignedPointCount: number;
  intervalMs: number | null;
}

export interface PairAnalysis {
  aligned: AlignedPairClose[];
  model: StatResult<PairModelEstimate>;
  residuals: PairResidualPoint[];
  /** Chart-facing alias for residuals. */
  points: PairResidualPoint[];
  adf: StatResult<Adf0Estimate>;
  /** UI-facing alias for adf. */
  stationarity: StatResult<Adf0Estimate>;
  halfLife: StatResult<HalfLifeEstimate>;
  rollingBeta: StatResult<RollingBetaEstimate>;
  /** UI-facing alias for rollingBeta. */
  hedgeStability: StatResult<RollingBetaEstimate>;
  btcBeta: StatResult<BtcBetaEstimate>;
  diagnostics: PairDiagnostics;
}

export interface PairAnalysisOptions {
  /** Expected close-to-close spacing. Unequal spacing breaks a rolling run. */
  intervalMs?: number;
  btcCloses?: readonly TimedClose[];
  btcSource?: string;
}

const MIN_MODEL_POINTS = 20;
const Z_WINDOW = 60;
const ADF_MIN_LEVELS = 100;
const HALF_LIFE_MIN_TRANSITIONS = 29;
const ROLLING_BETA_MIN_ESTIMATES = 20;
const BTC_MIN_RETURNS = 30;

function unavailable<T>(reason: string): StatResult<T> {
  return { available: false, value: null, reason };
}

function available<T>(value: T): StatResult<T> {
  return { available: true, value, reason: null };
}

function sampleStdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function sameInterval(previous: number, current: number, intervalMs?: number): boolean {
  return intervalMs === undefined || !Number.isFinite(intervalMs) || intervalMs <= 0
    ? current > previous
    : current - previous === intervalMs;
}

/** Filters non-positive prices, keeps the last observation at a timestamp, and sorts ascending. */
export function normalizeAlignedPairCloses(points: readonly AlignedPairClose[]): AlignedPairClose[] {
  const byTime = new Map<number, AlignedPairClose>();
  for (const point of points) {
    if (
      !Number.isFinite(point.closeTime) || !Number.isFinite(point.firstClose) || !Number.isFinite(point.secondClose)
      || point.firstClose <= 0 || point.secondClose <= 0
    ) continue;
    byTime.set(point.closeTime, { closeTime: point.closeTime, firstClose: point.firstClose, secondClose: point.secondClose });
  }
  return [...byTime.values()].sort((a, b) => a.closeTime - b.closeTime);
}

/** Same cleaning policy as pair closes, for an independently supplied BTC series. */
export function normalizeTimedCloses(points: readonly TimedClose[]): TimedClose[] {
  const byTime = new Map<number, TimedClose>();
  for (const point of points) {
    if (!Number.isFinite(point.closeTime) || !Number.isFinite(point.close) || point.close <= 0) continue;
    byTime.set(point.closeTime, { closeTime: point.closeTime, close: point.close, ...(point.source ? { source: point.source } : {}) });
  }
  return [...byTime.values()].sort((a, b) => a.closeTime - b.closeTime);
}

function regression(rows: readonly { x: number; y: number }[], withIntercept: boolean): {
  slope: number; intercept: number; rSquared: number | null; slopeStdError: number | null;
} | null {
  if (rows.length === 0) return null;
  const meanX = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
  const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const denominator = withIntercept
    ? rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0)
    : rows.reduce((sum, row) => sum + row.x ** 2, 0);
  if (denominator <= 0 || !Number.isFinite(denominator)) return null;
  const numerator = withIntercept
    ? rows.reduce((sum, row) => sum + (row.x - meanX) * (row.y - meanY), 0)
    : rows.reduce((sum, row) => sum + row.x * row.y, 0);
  const slope = numerator / denominator;
  const intercept = withIntercept ? meanY - slope * meanX : 0;
  const fitted = rows.map((row) => intercept + slope * row.x);
  const sse = rows.reduce((sum, row, index) => sum + (row.y - fitted[index]) ** 2, 0);
  const total = rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0);
  const degreesOfFreedom = rows.length - (withIntercept ? 2 : 1);
  const slopeStdError = degreesOfFreedom > 0 ? Math.sqrt(sse / degreesOfFreedom / denominator) : null;
  return { slope, intercept, rSquared: total === 0 ? null : 1 - sse / total, slopeStdError };
}

/** Fits ln(P1) = alpha + beta ln(P2) + residual. */
export function estimatePairModel(
  points: readonly AlignedPairClose[],
  spec: PairModelSpec,
): StatResult<PairModelEstimate> {
  const cleaned = normalizeAlignedPairCloses(points);
  if (cleaned.length < MIN_MODEL_POINTS) return unavailable("insufficient-points");
  const rows = cleaned.map((point) => ({ x: Math.log(point.secondClose), y: Math.log(point.firstClose) }));
  let beta: number;
  let alpha: number;
  let rSquared: number | null;
  if (spec.mode === "custom") {
    if (!Number.isFinite(spec.first) || !Number.isFinite(spec.second) || spec.first <= 0 || spec.second <= 0) {
      return unavailable("invalid-custom-ratio");
    }
    beta = spec.second / spec.first;
    alpha = rows.reduce((sum, row) => sum + row.y - beta * row.x, 0) / rows.length;
    const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
    const sse = rows.reduce((sum, row) => sum + (row.y - alpha - beta * row.x) ** 2, 0);
    const total = rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0);
    rSquared = total === 0 ? null : 1 - sse / total;
  } else {
    const fit = regression(rows, true);
    if (!fit) return unavailable("zero-variance-second-price");
    beta = fit.slope;
    alpha = fit.intercept;
    rSquared = fit.rSquared;
  }
  return available({ kind: spec.mode, alpha, beta, count: rows.length, rSquared });
}

/** Adds 60-point, sample-standard-deviation rolling Z scores, resetting after a time gap. */
export function residualPoints(
  points: readonly AlignedPairClose[],
  model: PairModelEstimate,
  intervalMs?: number,
): PairResidualPoint[] {
  const cleaned = normalizeAlignedPairCloses(points);
  const result: PairResidualPoint[] = [];
  let run: number[] = [];
  let previousTime: number | null = null;
  for (const point of cleaned) {
    if (previousTime !== null && !sameInterval(previousTime, point.closeTime, intervalMs)) run = [];
    const logFirst = Math.log(point.firstClose);
    const logSecond = Math.log(point.secondClose);
    const residual = logFirst - model.alpha - model.beta * logSecond;
    run.push(residual);
    if (run.length > Z_WINDOW) run.shift();
    const deviation = run.length >= MIN_MODEL_POINTS ? sampleStdDev(run) : null;
    const mean = run.reduce((sum, value) => sum + value, 0) / run.length;
    result.push({
      ...point, time: point.closeTime, logFirst, logSecond, residual,
      modelDeviationPercent: (Math.exp(residual) - 1) * 100,
      zScore: deviation === null || deviation === 0 ? null : (residual - mean) / deviation,
    });
    previousTime = point.closeTime;
  }
  return result;
}

function regularTransitions(points: readonly PairResidualPoint[], intervalMs?: number): Array<{ previous: PairResidualPoint; current: PairResidualPoint }> {
  const transitions: Array<{ previous: PairResidualPoint; current: PairResidualPoint }> = [];
  for (let index = 1; index < points.length; index += 1) {
    if (sameInterval(points[index - 1].closeTime, points[index].closeTime, intervalMs)) {
      transitions.push({ previous: points[index - 1], current: points[index] });
    }
  }
  return transitions;
}

/** Augmented Dickey-Fuller(0) approximation on residual levels. */
export function adf0(
  points: readonly PairResidualPoint[],
  mode: PairModelSpec["mode"],
  intervalMs?: number,
): StatResult<Adf0Estimate> {
  if (points.length < ADF_MIN_LEVELS) return unavailable("insufficient-level-points");
  const transitions = regularTransitions(points, intervalMs);
  const possible = points.length - 1;
  const regularTransitionRatio = possible === 0 ? 0 : transitions.length / possible;
  if (regularTransitionRatio < 0.9) return unavailable("irregular-series");
  const withIntercept = mode === "custom";
  const fit = regression(transitions.map(({ previous, current }) => ({
    x: previous.residual,
    y: current.residual - previous.residual,
  })), withIntercept);
  if (!fit || fit.slopeStdError === null) return unavailable("degenerate-series");
  const statistic = fit.slopeStdError === 0
    ? (fit.slope === 0 ? 0 : Math.sign(fit.slope) * Infinity)
    : fit.slope / fit.slopeStdError;
  const criticalValue = withIntercept ? -2.86 : -3.34;
  return available({
    statistic, coefficient: fit.slope, intercept: withIntercept ? fit.intercept : null,
    criticalValue, stationary: statistic < criticalValue, levelCount: points.length,
    transitionCount: transitions.length, regularTransitionRatio,
  });
}

/** AR(1) half-life in observations, using only regular adjacent transitions. */
export function ar1HalfLife(points: readonly PairResidualPoint[], intervalMs?: number): StatResult<HalfLifeEstimate> {
  const transitions = regularTransitions(points, intervalMs);
  if (transitions.length < HALF_LIFE_MIN_TRANSITIONS) return unavailable("insufficient-transitions");
  const fit = regression(transitions.map(({ previous, current }) => ({ x: previous.residual, y: current.residual })), true);
  if (!fit) return unavailable("degenerate-series");
  const phi = fit.slope;
  if (!(Math.abs(phi) > 0 && Math.abs(phi) < 1)) return unavailable("non-mean-reverting");
  const halfLifePeriods = Math.log(0.5) / Math.log(Math.abs(phi));
  return available({
    phi, halfLifePeriods, halfLifeMs: intervalMs !== undefined && Number.isFinite(intervalMs) && intervalMs > 0 ? halfLifePeriods * intervalMs : null,
    oscillatory: phi < 0, transitionCount: transitions.length,
  });
}

/** Summarises 60-observation rolling OLS hedge-ratio estimates. */
export function rollingBetaStability(points: readonly AlignedPairClose[], intervalMs?: number): StatResult<RollingBetaEstimate> {
  const cleaned = normalizeAlignedPairCloses(points);
  const estimates: number[] = [];
  let run: AlignedPairClose[] = [];
  for (const point of cleaned) {
    if (run.length > 0 && !sameInterval(run[run.length - 1].closeTime, point.closeTime, intervalMs)) run = [];
    run.push(point);
    if (run.length > Z_WINDOW) run.shift();
    if (run.length !== Z_WINDOW) continue;
    const fit = regression(run.map((row) => ({ x: Math.log(row.secondClose), y: Math.log(row.firstClose) })), true);
    if (fit) estimates.push(fit.slope);
  }
  if (estimates.length < ROLLING_BETA_MIN_ESTIMATES) return unavailable("insufficient-rolling-estimates");
  const mean = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  const stdDev = sampleStdDev(estimates);
  if (stdDev === null) return unavailable("insufficient-rolling-estimates");
  return available({
    latest: estimates[estimates.length - 1], mean, sampleStdDev: stdDev,
    coefficientOfVariation: mean === 0 ? null : stdDev / Math.abs(mean), estimateCount: estimates.length,
  });
}

/** Regresses residual changes on exact-time BTC log returns. */
export function btcResidualBeta(
  residuals: readonly PairResidualPoint[],
  btcCloses?: readonly TimedClose[],
  intervalMs?: number,
  source?: string,
): StatResult<BtcBetaEstimate> {
  if (!btcCloses) return unavailable("btc-unavailable");
  const btc = normalizeTimedCloses(btcCloses);
  const byTime = new Map(btc.map((point) => [point.closeTime, point]));
  const rows: Array<{ x: number; y: number }> = [];
  for (let index = 1; index < residuals.length; index += 1) {
    const previous = residuals[index - 1];
    const current = residuals[index];
    if (!sameInterval(previous.closeTime, current.closeTime, intervalMs)) continue;
    const previousBtc = byTime.get(previous.closeTime);
    const currentBtc = byTime.get(current.closeTime);
    if (!previousBtc || !currentBtc) continue;
    rows.push({ x: Math.log(currentBtc.close / previousBtc.close), y: current.residual - previous.residual });
  }
  if (rows.length < BTC_MIN_RETURNS) return unavailable("insufficient-common-returns");
  const fit = regression(rows, true);
  if (!fit) return unavailable("zero-variance-btc-return");
  return available({ beta: fit.slope, intercept: fit.intercept, rSquared: fit.rSquared, returnCount: rows.length, source: source ?? btc[btc.length - 1]?.source ?? null });
}

/** Runs the complete pair-statistics pipeline without fetching data or mutating inputs. */
export function analyzePair(
  points: readonly AlignedPairClose[],
  spec: PairModelSpec,
  options: PairAnalysisOptions = {},
): PairAnalysis {
  const aligned = normalizeAlignedPairCloses(points);
  const model = estimatePairModel(aligned, spec);
  if (!model.available || model.value === null) {
    const rollingBeta = rollingBetaStability(aligned, options.intervalMs);
    const stationarity = unavailable<Adf0Estimate>(model.reason ?? "model-unavailable");
    return {
      aligned, model, residuals: [], points: [], adf: stationarity, stationarity,
      halfLife: unavailable(model.reason ?? "model-unavailable"), rollingBeta, hedgeStability: rollingBeta,
      btcBeta: unavailable("model-unavailable"),
      diagnostics: { alignedPointCount: aligned.length, intervalMs: options.intervalMs ?? null },
    };
  }
  const residuals = residualPoints(aligned, model.value, options.intervalMs);
  const stationarity = adf0(residuals, spec.mode, options.intervalMs);
  const rollingBeta = rollingBetaStability(aligned, options.intervalMs);
  return {
    aligned, model, residuals, points: residuals, adf: stationarity, stationarity,
    halfLife: ar1HalfLife(residuals, options.intervalMs),
    rollingBeta, hedgeStability: rollingBeta,
    btcBeta: btcResidualBeta(residuals, options.btcCloses, options.intervalMs, options.btcSource),
    diagnostics: { alignedPointCount: aligned.length, intervalMs: options.intervalMs ?? null },
  };
}

// Readable aliases for consumers that prefer verb-based names.
export const cleanAlignedPairCloses = normalizeAlignedPairCloses;
export const calculateResiduals = residualPoints;
export const calculateAdf0 = adf0;
export const calculateAr1HalfLife = ar1HalfLife;
export const calculateRollingBetaStability = rollingBetaStability;
export const calculateBtcResidualBeta = btcResidualBeta;
