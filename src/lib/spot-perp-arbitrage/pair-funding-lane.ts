import type { ComboCandleResult, ComboFundingLegObservation, ComboFundingRatePoint } from "../combo";
import type { SearchChartInterval } from "../search-candles";
import type { SignedFundingObservation, SpotContainingCombinationResult } from "./combine";

/**
 * Shared pair-trade pane names/copy. Both combination charts must use the exact
 * same strings so the legend, the checkbox and the tooltip never disagree.
 */
export const PAIR_PNL_PANE_NAME = "配对交易 PnL";
/**
 * The funding lane is the plain view's raw 1:1 annualized difference, replayed
 * on the pair-trade timeline. The "(1:1)" suffix is load-bearing: this lane is
 * never β-weighted, never multiplied by a settlement/entry price, and is not a
 * combined return. The suffix keeps that visible in the legend and the control.
 */
export const PAIR_FUNDING_PANE_NAME = "年化资金费率差（1:1）";
/**
 * The optional β-weighted funding lane. It is a second, independent lane: the
 * per-leg raw rates replayed through `leg1 − β×leg2` with the pair-trade's
 * effective β. It is still only a funding-rate difference — never multiplied by
 * a settlement/entry price — so it is not a combined funding-return annualization.
 */
export const PAIR_WEIGHTED_FUNDING_PANE_NAME = "年化资金费率差（1:β）";
export const PAIR_TEMPORARY_ZERO_NAME = "含临时0的费率差";
/** Weighted lane's own marker name so two funding panes never share a legend item. */
export const PAIR_WEIGHTED_TEMPORARY_ZERO_NAME = "含临时0的费率差（1:β）";

/**
 * The effective β for the weighted lane: the pair-trade scenario's applied β
 * (never the fit-window β). A non-finite or non-positive value is unavailable —
 * it must never be replaced by 1, which would silently draw a 1:1 line.
 */
export function pairFundingBeta(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Whether the β-weighted lane may be offered: same funding gate AND a usable β. */
export function pairWeightedFundingAvailable(
  result: ComboCandleResult | SpotContainingCombinationResult,
  interval: SearchChartInterval,
  beta: number | null | undefined,
): boolean {
  return pairFundingBeta(beta) !== null && pairFundingAvailable(result, interval);
}

/**
 * Intraday intervals where funding settles sparsely inside a candle bucket.
 * Only these intervals get visible settlement points; dense data keeps the
 * continuous line. 1m is deliberately absent: the pair charts do not offer the
 * funding lane there at all (same as the plain combination chart).
 */
const SETTLEMENT_POINT_INTERVALS: ReadonlySet<SearchChartInterval> = new Set(["4h", "1h", "5m"]);

/** One funding datum on the pair-trade timeline. */
export interface PairFundingLanePoint {
  time: number;
  /**
   * Plotted annualized difference in percent, using the lane's 1:1 or 1:β
   * weights. Null means the bucket has no usable funding sample
   * at this time — rendered as a gap, never as 0 and never bridged.
   */
  value: number | null;
  /** Interval-cumulative difference rate (decimal) for the tooltip; null with a gap. */
  rate: number | null;
  /**
   * True when the plotted value embeds the chart-only temporary zero (one leg
   * had an explicit no-settlement bucket). It is a rendering convention, not a
   * real settlement, so the chart marks it and the tooltip says so.
   */
  temporaryZero: boolean;
  /**
   * Per-leg observations for the tooltip. In a spot-containing result only the
   * perp side is populated; the spot side has no funding at all.
   */
  first: ComboFundingLegObservation | null;
  second: ComboFundingLegObservation | null;
}

export interface PairFundingLane {
  points: PairFundingLanePoint[];
  /** Aligned scatter values for the temporary-zero diamond; null everywhere else. */
  temporaryZero: (number | null)[];
  hasTemporaryZero: boolean;
  /** At least one settlement point AND one gap on an intraday interval. */
  sparse: boolean;
  /** A real settlement exists somewhere in the aligned range. */
  hasActual: boolean;
  /** Whether leg1 / leg2 can carry funding at all (false for a spot leg). */
  firstHasFunding: boolean;
  secondHasFunding: boolean;
}

/**
 * Whether the pair-trade view may offer the funding lane at all.
 *
 * Mirrors each chart's own plain view rather than inventing a third rule:
 * - 1m: never (the plain combination charts do not draw funding there).
 * - spot/spot: never (no funding leg exists at all).
 * - mixed: only when the perp leg actually brought funding buckets, so the
 *   control never opens an empty pane.
 * - perp/perp: only when the result carries funding buckets, exactly like
 *   `hasFunding` in the plain combo chart.
 */
export function pairFundingAvailable(
  result: ComboCandleResult | SpotContainingCombinationResult,
  interval: SearchChartInterval,
): boolean {
  if (interval === "1m") return false;
  if (!("candles" in result)) return result.composition === "mixed" && (result.funding ?? []).length > 0;
  return (result.fundingRates ?? []).length > 0;
}

function signedNumberText(value: number, digits: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

const TEMPORARY_ZERO_NOTE = "资金费率差：含临时0，仅图表显示";

function legTooltipRows(
  point: PairFundingLanePoint,
  firstLabel: string | null,
  secondLabel: string | null,
): string[] {
  const rows: string[] = [];
  for (const [label, observation] of [[firstLabel, point.first], [secondLabel, point.second]] as const) {
    if (label === null) continue;
    rows.push(observation === null
      ? `${label}: 无结算费率`
      : `${label}: ${signedNumberText(observation.annualizedRate * 100, 2)}（区间累计费率 ${signedNumberText(observation.rate * 100, 4)}）`);
  }
  return rows;
}

/**
 * Tooltip rows for one bucket of the 1:1 funding lane, in plain-view wording.
 *
 * `secondLabel === null` means "this leg carries no funding at all" (a spot
 * leg), so no row is printed for it instead of claiming "无结算费率". The leg
 * rows always keep each venue's own sign; only the difference line is derived.
 */
export function pairFundingTooltipLines(
  point: PairFundingLanePoint | undefined,
  firstLabel: string | null,
  secondLabel: string | null,
): string[] {
  if (!point || point.value === null) return ["年化资金费率差（1:1）：无"];
  const lines = [
    point.rate === null
      ? `年化资金费率差（1:1）：${signedNumberText(point.value, 2)}`
      : `年化资金费率差（1:1）：${signedNumberText(point.value, 2)}（区间累计费率 ${signedNumberText(point.rate * 100, 4)}）`,
  ];
  if (point.temporaryZero) lines.push(TEMPORARY_ZERO_NOTE);
  lines.push(...legTooltipRows(point, firstLabel, secondLabel));
  return lines;
}

/**
 * Tooltip rows for the β-weighted lane. The title names the applied β so two
 * funding lanes never read as one line, and the weight expression is stated on
 * the difference itself: the per-leg rows stay venue-signed and unweighted.
 */
export function pairWeightedFundingTooltipLines(
  point: PairFundingLanePoint | undefined,
  firstLabel: string | null,
  secondLabel: string | null,
  beta: number,
): string[] {
  const betaText = beta.toFixed(4);
  if (!point || point.value === null) return [`年化资金费率差（1:β，β=${betaText}）：无`];
  const lines = [
    point.rate === null
      ? `年化资金费率差（1:β，β=${betaText}）：${signedNumberText(point.value, 2)}`
      : `年化资金费率差（1:β，β=${betaText}）：${signedNumberText(point.value, 2)}（区间累计费率 ${signedNumberText(point.rate * 100, 4)}）`,
    `加权：腿1 − ${betaText} × 腿2；仅资金费率差，不乘结算价或入场价，也不是合并资金收益年化`,
  ];
  if (point.temporaryZero) lines.push(TEMPORARY_ZERO_NOTE);
  lines.push(...legTooltipRows(point, firstLabel, secondLabel));
  return lines;
}

function gap(time: number): PairFundingLanePoint {
  return { time, value: null, rate: null, temporaryZero: false, first: null, second: null };
}

function percentOf(annualizedRate: number): number | null {
  const percent = annualizedRate * 100;
  return Number.isFinite(percent) ? percent : null;
}

/**
 * Perp/perp buckets arrive as `leg1 - leg2` (already the plain view's 1:1
 * difference, signed as displayed). `sampleCount === 0` is an explicit
 * no-sample bucket and stays a gap; a real observed zero keeps rendering as 0.
 */
function perpLanePoint(time: number, point: ComboFundingRatePoint | undefined): PairFundingLanePoint {
  if (!point || point.sampleCount === 0) return gap(time);
  const value = percentOf(point.annualizedRate);
  if (value === null) return gap(time);
  const first = point.firstFunding ?? null;
  const second = point.secondFunding ?? null;
  return {
    time,
    value,
    rate: Number.isFinite(point.rate) ? point.rate : null,
    temporaryZero: (first === null) !== (second === null),
    first,
    second,
  };
}

/**
 * β-weighted equivalent of `perpLanePoint`.
 *
 * The weighted value must come from the two per-leg observations
 * (`leg1 − β×leg2`), never from the bucket's stored 1:1 difference multiplied by
 * β. So a bucket that has no per-leg detail at all cannot produce a weighted
 * value and stays a gap — the chart never guesses one.
 *
 * The one exception is the existing chart-only temporary-zero rule: an actual
 * bucket where exactly one side reports no settlement is drawn with that side
 * as 0 (a rendering convention, marked as such), exactly like the 1:1 lane.
 * If leg2 is missing the value is unchanged; if leg1 is missing the surviving
 * leg2 contribution still carries β.
 */
function weightedPerpLanePoint(
  time: number,
  point: ComboFundingRatePoint | undefined,
  beta: number,
): PairFundingLanePoint {
  if (!point || point.sampleCount === 0) return gap(time);
  const first = point.firstFunding ?? null;
  const second = point.secondFunding ?? null;
  const temporaryZero = (first === null) !== (second === null);
  if (first === null && second === null) return gap(time);

  const firstAnnualized = first === null ? 0 : first.annualizedRate;
  const secondAnnualized = second === null ? 0 : second.annualizedRate;
  const firstRate = first === null ? 0 : first.rate;
  const secondRate = second === null ? 0 : second.rate;
  const value = percentOf(firstAnnualized - beta * secondAnnualized);
  if (value === null) return gap(time);
  const rate = firstRate - beta * secondRate;
  return {
    time,
    value,
    rate: Number.isFinite(rate) ? rate : null,
    temporaryZero,
    first,
    second,
  };
}

/**
 * Spot-containing buckets carry one perp leg whose rate the combiner already
 * signed by leg position (perp on leg 2 is negated once, at the source). It is
 * replayed verbatim: no second sign flip, no β, no price scaling. A missing key
 * is a gap; a spot/spot result has no funding data at all.
 */
function mixedLanePoint(
  time: number,
  point: SignedFundingObservation | undefined,
  perpLeg: 1 | 2 | null,
): PairFundingLanePoint {
  if (!point || point.sampleCount === 0 || perpLeg === null) return gap(time);
  const value = percentOf(point.annualizedRate);
  if (value === null) return gap(time);
  // The plotted difference stays signed; the labelled venue leg must show its
  // original rate, just like the per-leg rows in the perp/perp tooltip.
  const legSign = perpLeg === 1 ? 1 : -1;
  const observation: ComboFundingLegObservation = {
    rate: point.rate * legSign,
    annualizedRate: point.annualizedRate * legSign,
    ...(point.settlements === undefined
      ? {}
      : { settlements: point.settlements.map((settlement) => ({ ...settlement })) }),
    ...(typeof point.sampleCount === "number" && point.sampleCount > 1 ? { sampleCount: point.sampleCount } : {}),
  };
  return {
    time,
    value,
    rate: Number.isFinite(point.rate) ? point.rate : null,
    temporaryZero: false,
    first: perpLeg === 1 ? observation : null,
    second: perpLeg === 2 ? observation : null,
  };
}

/**
 * β-weighted equivalent of `mixedLanePoint`.
 *
 * Exactly one leg is a perp, and the combiner already applied the single sign
 * for that leg's position. The weight is applied on top of that signed rate and
 * the sign is never re-applied: perp on leg 1 keeps its signed rate (the weight
 * coefficient there is 1), perp on leg 2 is scaled by β. The spot leg is 0, so
 * the weighted difference equals `leg1 − β×leg2` in venue terms while the
 * labelled perp row still shows the venue's own rate sign.
 */
function weightedMixedLanePoint(
  time: number,
  point: SignedFundingObservation | undefined,
  perpLeg: 1 | 2 | null,
  beta: number,
): PairFundingLanePoint {
  if (!point || point.sampleCount === 0 || perpLeg === null) return gap(time);
  const coefficient = perpLeg === 1 ? 1 : beta;
  const value = percentOf(point.annualizedRate * coefficient);
  if (value === null) return gap(time);
  const rate = point.rate * coefficient;
  const legSign = perpLeg === 1 ? 1 : -1;
  const observation: ComboFundingLegObservation = {
    rate: point.rate * legSign,
    annualizedRate: point.annualizedRate * legSign,
    ...(point.settlements === undefined
      ? {}
      : { settlements: point.settlements.map((settlement) => ({ ...settlement })) }),
    ...(typeof point.sampleCount === "number" && point.sampleCount > 1 ? { sampleCount: point.sampleCount } : {}),
  };
  return {
    time,
    value,
    rate: Number.isFinite(rate) ? rate : null,
    temporaryZero: false,
    first: perpLeg === 1 ? observation : null,
    second: perpLeg === 2 ? observation : null,
  };
}


function buildFundingLane(
  result: ComboCandleResult | SpotContainingCombinationResult,
  alignedTimes: readonly number[],
  interval: SearchChartInterval,
  /** null = the 1:1 lane; a number = the β-weighted lane. */
  beta: number | null,
): PairFundingLane {
  let points: PairFundingLanePoint[];
  let firstHasFunding: boolean;
  let secondHasFunding: boolean;

  if ("candles" in result) {
    const byTime = new Map<number, ComboFundingRatePoint>();
    for (const point of result.fundingRates ?? []) byTime.set(point.time, point);
    points = alignedTimes.map((time) => {
      const point = byTime.get(time);
      return beta === null ? perpLanePoint(time, point) : weightedPerpLanePoint(time, point, beta);
    });
    // Both legs are perps in a perp/perp combination.
    firstHasFunding = true;
    secondHasFunding = true;
  } else {
    const byTime = new Map<number, SignedFundingObservation>();
    for (const point of result.funding ?? []) byTime.set(point.time, point);
    const perpLeg: 1 | 2 | null = result.composition !== "mixed"
      ? null
      : result.leg1.kind === "perp" ? 1 : 2;
    points = alignedTimes.map((time) => {
      const point = perpLeg === null ? undefined : byTime.get(time);
      return beta === null
        ? mixedLanePoint(time, point, perpLeg)
        : weightedMixedLanePoint(time, point, perpLeg, beta);
    });
    // Exactly one leg is a perp here; the spot leg has no funding at all, so its
    // tooltip row is omitted rather than reported as "无结算费率". A spot/spot
    // combination has no funding on either leg.
    firstHasFunding = perpLeg === 1;
    secondHasFunding = perpLeg === 2;
  }

  const hasActual = points.some((point) => point.value !== null);
  const hasGap = points.some((point) => point.value === null);
  return {
    points,
    temporaryZero: points.map((point) => (point.temporaryZero ? point.value : null)),
    hasTemporaryZero: points.some((point) => point.temporaryZero),
    sparse: SETTLEMENT_POINT_INTERVALS.has(interval) && hasActual && hasGap,
    hasActual,
    firstHasFunding,
    secondHasFunding,
  };
}

/**
 * Maps the plain view's funding lane onto the pair-trade timeline.
 *
 * `alignedTimes` are the pair-trade bucket open times (`pairTrade.points[].time`
 * is the bucket openTime), and they are matched to funding by time through a
 * Map — never by array index — so reordered, filtered, duplicated or missing
 * funding rows can only produce a gap, never a shifted value.
 */
export function alignedPairFundingLane(
  result: ComboCandleResult | SpotContainingCombinationResult,
  alignedTimes: readonly number[],
  interval: SearchChartInterval,
): PairFundingLane {
  return buildFundingLane(result, alignedTimes, interval, null);
}

/**
 * Same timeline and the same gap/zero rules, but each bucket's per-leg rates are
 * replayed through `leg1 − β×leg2` with the pair-trade's effective β.
 *
 * This is a second, independent lane — the 1:1 lane is never scaled as a whole,
 * because `β×(a−b)` is not `a − β×b`. Nothing is multiplied by a settlement or
 * entry price, so the result is still a funding-rate difference, not a combined
 * funding-return annualization.
 *
 * Callers must gate the control with `pairWeightedFundingAvailable`. An unusable
 * β therefore yields an all-gap lane rather than a substituted β=1 line: the
 * chart can never quietly draw a 1:1 series under a 1:β label.
 */
export function alignedPairWeightedFundingLane(
  result: ComboCandleResult | SpotContainingCombinationResult,
  alignedTimes: readonly number[],
  interval: SearchChartInterval,
  beta: number,
): PairFundingLane {
  const effective = pairFundingBeta(beta);
  if (effective === null) {
    return {
      points: alignedTimes.map(gap),
      temporaryZero: alignedTimes.map(() => null),
      hasTemporaryZero: false,
      sparse: false,
      hasActual: false,
      firstHasFunding: false,
      secondHasFunding: false,
    };
  }
  return buildFundingLane(result, alignedTimes, interval, effective);
}

/**
 * Pane topology for the pair-trade chart, shared by both combination charts.
 *
 * Optional panes are appended in a fixed order (raw legs, then 1:1 funding, then
 * β-weighted funding) so enabling one never renumbers the panes already shown;
 * every axis/series/dataZoom/brush index is read from here instead of being
 * hardcoded. Returns null for a pane that is not shown.
 */
export interface PairPaneLayout {
  names: string[];
  pnl: number;
  derived: number;
  firstRaw: number | null;
  secondRaw: number | null;
  funding: number | null;
  weightedFunding: number | null;
}

export function pairPaneLayout(panes: {
  derived: string;
  firstRaw?: string | null;
  secondRaw?: string | null;
  funding?: string | null;
  weightedFunding?: string | null;
}): PairPaneLayout {
  const names = [PAIR_PNL_PANE_NAME, panes.derived];
  const add = (name: string | null | undefined): number | null => {
    if (!name) return null;
    names.push(name);
    return names.length - 1;
  };
  const firstRaw = add(panes.firstRaw);
  const secondRaw = add(panes.secondRaw);
  const funding = add(panes.funding);
  const weightedFunding = add(panes.weightedFunding);
  return { names, pnl: 0, derived: 1, firstRaw, secondRaw, funding, weightedFunding };
}
