import type { ComboCandleResult, ComboFundingLegObservation } from "../combo";
import { getSearchIntervalMs, type FundingSettlementSample } from "../search-candles";
import type { SpotContainingCombinationResult } from "./combine";
import type { PairTradeSeries } from "./pair-trade";
import { ANALYTICS_YEAR_MS } from "./single-market-analytics";

/** Where the price used for a settlement's funding notional came from. */
export type FundingPriceBasis = "settlement-mark" | "candle-proxy" | "mixed" | "bucket-candle";

/**
 * Why a leg's funding lane has no number, or why its number is an estimate.
 *
 * - `spot`: the leg has no funding by construction (never a warning).
 * - `no-post-entry-window`: the current viewport supplies no post-entry candle,
 *   so nothing has accrued yet. This is "not yet", not "bad data".
 * - `no-funding-data`: no funding history was read for this leg at all — the
 *   only real warning.
 * - `no-post-entry-settlements`: history exists but no settlement falls inside
 *   the holding window, so the accrued funding is exactly 0.
 * - `missing-entry-time`: the real entry close is unknown, so the holding window
 *   cannot be opened.
 * - `settlement-price-missing`: a needed settlement price is unavailable, so the
 *   funding amount cannot be stated. Not a funding-history problem.
 * - `entry-price-missing`: the leg's entry close is unusable, so funding cannot
 *   be expressed against the entry notional.
 * - `non-finite-funding`: the accumulation is not a finite number.
 */
export type PairLegFundingNote =
  | "spot"
  | "no-post-entry-window"
  | "no-funding-data"
  | "no-post-entry-settlements"
  | "missing-entry-time"
  | "settlement-price-missing"
  | "entry-price-missing"
  | "non-finite-funding";

/** One leg of a hypothetical long-leg1 / short-leg2 pair trade. */
export interface PairLegReturn {
  /**
   * Price-only return in percent on the leg's own entry notional:
   * `(last / entry - 1) * 100` for the long leg1 and
   * `(1 - last / entry) * 100` for the short leg2. β is deliberately not
   * applied: each card states its own leg, sizing lives in the trade series.
   */
  priceReturnPercent: number | null;
  /**
   * Cumulative funding in percent of the leg's own entry notional:
   * `-side * Σ(rate × settlementPrice / entryPrice) × 100`, summed over the
   * settlements whose real time falls in [entry close, window end). A long leg
   * pays a positive rate (negative here), a short leg receives it (positive
   * here). β does not scale this percentage and spot legs are exactly 0.
   */
  fundingReturnPercent: number | null;
  /** `priceReturnPercent + fundingReturnPercent`, only when both are known. */
  totalReturnPercent: number | null;
  /**
   * `fundingReturnPercent` extrapolated over the real holding duration
   * (`windowEnd - windowStart`). It is a holding-period normalization, not a
   * forecast and not the unrelated weighted historical-rate indicator.
   */
  fundingAnnualizedPercent: number | null;
  /**
   * True only when this leg's funding history was not readable at all. Readable
   * history counts as complete even when the window holds no settlement or shows
   * a gap; a missing settlement price is reported separately via `priceMissing`.
   */
  fundingIncomplete: boolean;
  /** A funding price (settlement mark or candle proxy) was unavailable. */
  priceMissing: boolean;
  /** Actual price source of the funding notionals; null when none were priced. */
  fundingPriceBasis: FundingPriceBasis | null;
  isSpot: boolean;
  entryPrice: number | null;
  latestPrice: number | null;
  /** Funding observations included in the window (settlements, or legacy buckets). */
  fundingSampleBuckets: number;
  /** Sum of the venues' own sample counts for the included observations. */
  fundingSampleCount: number;
  /** First included settlement/bucket time, or null when none fell in the window. */
  fundingCoverageStartTime: number | null;
  /** Last included settlement/bucket time, or null when none fell in the window. */
  fundingCoverageEndTime: number | null;
  fundingNote: PairLegFundingNote | null;
}

/** Both legs plus the concrete window that was actually used. */
export interface PairLegReturns {
  first: PairLegReturn;
  second: PairLegReturn;
  /** Aligned open time of the candle whose closes supplied the latest price. */
  latestTime: number | null;
  /** Exclusive funding window start (the real entry close), or null. */
  fundingWindowStartTime: number | null;
  /** Exclusive funding window end, clamped to `now`, or null. */
  fundingWindowEndTime: number | null;
}

interface AlignedRow {
  /** Aligned candle open time (the two legs' shared key). */
  time: number;
  /** Real end of the latest of the two legs' candles for this row. */
  endTime: number;
  firstClose: number | null;
  secondClose: number | null;
}

/** One leg's own candle, with an explicit exclusive interval end. */
interface LegCandle {
  openTime: number;
  /** Exclusive end, normalized from this candle's own interval length. */
  endTime: number;
  /** Null when the candle exists but its own close is unusable. */
  close: number | null;
}

interface PendingLegCandle {
  openTime: number;
  /** Null when this candle's own interval cannot be bounded at all. */
  endTime: number | null;
  close: number | null;
}


/** One settlement (or legacy bucket) of a single leg. */
interface FundingObservation {
  /** Real settlement time when available; bucket open otherwise. */
  time: number;
  /** Venue rate in the "long pays a positive rate" convention. */
  rawRate: number;
  sampleCount: number;
  /** Venue settlement mark price, when supplied and usable. */
  markPrice: number | null;
  /**
   * True when this row is a bucket sum rather than a single settlement, so its
   * price must come from the bucket candle and its result is labelled as such.
   */
  bucketLevel: boolean;
}

interface FundingWindow {
  /** Real entry close; settlement times are inclusive from here. */
  start: number;
  end: number;
}

interface FundingAssessment {
  percent: number | null;
  annualizedPercent: number | null;
  buckets: number;
  sampleCount: number;
  coverageStartTime: number | null;
  coverageEndTime: number | null;
  incomplete: boolean;
  priceMissing: boolean;
  basis: FundingPriceBasis | null;
  note: PairLegFundingNote | null;
}

const YEAR_MS = ANALYTICS_YEAR_MS;

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function sampleCountValue(value: unknown): number | null {
  if (value === undefined || value === null) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function candleEnd(time: number, ...candidates: unknown[]): number {
  const ends = candidates
    .map(finiteNumber)
    .filter((value): value is number => value !== null && value > time);
  return ends.length ? Math.max(...ends) : time;
}

/**
 * Aligned raw-leg closes keyed by the shared candle open. Composite spread or
 * ratio prices are never inverted; a row without both raw legs is dropped.
 */
function alignedRows(result: ComboCandleResult | SpotContainingCombinationResult): AlignedRow[] {
  const rows = new Map<number, AlignedRow>();
  if ("candles" in result) {
    const candles = new Map<number, number>();
    for (const candle of result.candles ?? []) {
      const time = finiteNumber(candle.openTime);
      if (time !== null) candles.set(time, finiteNumber(candle.closeTime) ?? time);
    }
    const second = new Map<number, { close: number | null; closeTime: unknown }>();
    for (const point of result.leg2Points ?? []) {
      const time = finiteNumber(point.openTime);
      if (time !== null) second.set(time, { close: finiteNumber(point.close), closeTime: point.closeTime });
    }
    for (const point of result.leg1Points ?? []) {
      const time = finiteNumber(point.openTime);
      if (time === null) continue;
      const other = second.get(time);
      if (!other) continue;
      rows.set(time, {
        time,
        endTime: candleEnd(time, point.closeTime, other.closeTime, candles.get(time)),
        firstClose: finiteNumber(point.close),
        secondClose: other.close,
      });
    }
  } else {
    for (const point of result.points ?? []) {
      const time = finiteNumber(point.openTime);
      if (time === null) continue;
      const first = point.leg1Point;
      const other = point.leg2Point;
      if (!first || !other) continue;
      rows.set(time, {
        time,
        endTime: candleEnd(time, first.closeTime, other.closeTime, point.closeTime),
        firstClose: finiteNumber(first.close),
        secondClose: finiteNumber(other.close),
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

/**
 * The aligned candle named by `latestTime`, or null.
 *
 * `latestTime === null` means the current chart viewport holds no post-entry
 * point, so there is no "latest" to quote — it must never fall back to the last
 * retained candle, which would silently show a full-range return while the PnL
 * card shows nothing. Non-finite values and times that do not exactly match an
 * aligned candle fail closed for the same reason: the caller derives the time
 * from the pair-trade point grid of the same aligned series, so a mismatch
 * means this result does not extend that far.
 */
function selectLatestRow(rows: readonly AlignedRow[], latestTime: number | null): AlignedRow | null {
  if (latestTime === null || rows.length === 0) return null;
  return rows.find((row) => row.time === latestTime) ?? null;
}

function longReturnPercent(entry: number | null, latest: number | null): number | null {
  if (entry === null || latest === null) return null;
  const value = (latest / entry - 1) * 100;
  return Number.isFinite(value) ? value : null;
}

function shortReturnPercent(entry: number | null, latest: number | null): number | null {
  if (entry === null || latest === null) return null;
  const value = (1 - latest / entry) * 100;
  return Number.isFinite(value) ? value : null;
}

/**
 * Exclusive end of one candle, derived from that candle's own open time, its own
 * reported close time, and the chart's explicit interval length.
 *
 * The series is NOT contiguous: candles can be missing or carry an unusable
 * close, so neither the next candle's open nor the previous candle's spacing may
 * be used to extend this candle's interval (that would price a settlement in a
 * gap with a neighbouring candle's close). Exchange conventions are normalized
 * against the known interval instead: an inclusive `open + interval - 1` end and
 * an exclusive `open + interval` end both resolve to `open + interval`, a
 * shorter reported end (a close time trimmed to the other leg's) keeps its own
 * bound, and anything longer than one interval is not trusted.
 */
function normalizeCandleEnd(openTime: number, closeTime: number | null, intervalMs: number | null): number | null {
  if (intervalMs === null || intervalMs <= 0) {
    // Without a known interval only an explicitly usable reported end can bound
    // this candle; guessing would re-create the neighbour-spacing bug.
    return closeTime !== null && closeTime > openTime ? closeTime + 1 : null;
  }
  const nominal = openTime + intervalMs;
  if (closeTime === null || closeTime <= openTime) return nominal;
  const span = closeTime - openTime;
  if (span === intervalMs - 1 || span === intervalMs) return nominal;
  if (span < intervalMs) return closeTime + 1;
  return nominal;
}

/** One leg's own candles, for settlement-price proxying. */
function legCandles(result: ComboCandleResult | SpotContainingCombinationResult, leg: 1 | 2): LegCandle[] {
  const intervalMs = finiteNumber(getSearchIntervalMs(result.interval));
  const series = new Map<number, PendingLegCandle>();
  const push = (point: { openTime: unknown; closeTime: unknown; close: unknown } | null | undefined) => {
    if (!point) return;
    const openTime = finiteNumber(point.openTime);
    if (openTime === null) return;
    // A bad or non-positive close keeps the candle's interval reserved so the
    // settlement that falls in it is reported as an unavailable price instead of
    // borrowing a neighbour's close.
    series.set(openTime, {
      openTime,
      endTime: normalizeCandleEnd(openTime, finiteNumber(point.closeTime), intervalMs),
      close: positiveNumber(point.close),
    });
  };
  if ("candles" in result) {
    for (const point of leg === 1 ? result.leg1Points ?? [] : result.leg2Points ?? []) push(point);
  } else {
    for (const point of result.points ?? []) push(leg === 1 ? point.leg1Point : point.leg2Point);
  }
  return [...series.values()]
    .filter((candle): candle is LegCandle & { endTime: number } => candle.endTime !== null)
    .sort((a, b) => a.openTime - b.openTime);
}

/**
 * Close of the candle whose own interval contains `time`, or null when this leg
 * has no usable close there.
 *
 * A missing candle (a hole in the middle of the series) and a candle whose own
 * close is unusable both yield null: the settlement then has no price and is
 * reported as `settlement-price-missing`. Neighbouring candles are never used as
 * a substitute, and the newest or entry price is never used either.
 */
function candleCloseAt(series: readonly LegCandle[], time: number): number | null {
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (series[mid].openTime <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found < 0) return null;
  const candle = series[found];
  if (time >= candle.endTime) return null;
  return candle.close;
}

/** Per-settlement payload of a funding bucket, when the source provides it. */
interface SettlementCarrier {
  settlements?: readonly FundingSettlementSample[];
}

function settlementList(carrier: unknown): readonly FundingSettlementSample[] | null {
  if (carrier === null || typeof carrier !== "object") return null;
  const settlements = (carrier as SettlementCarrier).settlements;
  return Array.isArray(settlements) ? settlements : null;
}

function settlementsToObservations(
  settlements: readonly FundingSettlementSample[],
): FundingObservation[] {
  const observations: FundingObservation[] = [];
  for (const settlement of settlements) {
    const time = finiteNumber(settlement?.time);
    const rate = finiteNumber(settlement?.rate);
    if (time === null || rate === null) continue;
    observations.push({
      time,
      rawRate: rate,
      sampleCount: 1,
      markPrice: positiveNumber(settlement?.markPrice),
      bucketLevel: false,
    });
  }
  return observations;
}

/**
 * Per-leg funding observations of a perp-perp aligned combo.
 *
 * Per-settlement rows are used whenever this leg has any: the bucket's aggregate
 * rate is then redundant, and a bucket whose settlement array is empty simply
 * had no settlement. A bucket that carries no per-settlement array at all while
 * other buckets of the same leg do is a partial payload; its bucket rate is kept
 * but priced from that bucket's candle and labelled `bucket-candle`. A legacy
 * result that never carries per-settlement rows falls back to one bucket-level
 * observation per bucket the same way.
 *
 * `hasHistory` describes readable history on this leg, not the window: a leg
 * with a real settlement anywhere counts, even if none falls after the entry.
 */
function perpPairObservations(
  result: ComboCandleResult,
  leg: "firstFunding" | "secondFunding",
): { observations: FundingObservation[]; hasHistory: boolean } {
  const points = result.fundingRates ?? [];
  const legPoints = points.flatMap((point) => {
    const legPoint = point[leg] as (ComboFundingLegObservation & SettlementCarrier) | null | undefined;
    const time = finiteNumber(point.time);
    return legPoint && time !== null ? [{ time, legPoint, sampleCount: point.sampleCount }] : [];
  });
  const settlementAuthoritative = legPoints.some(({ legPoint }) => (
    (settlementList(legPoint) ?? []).length > 0
  ));
  const observations: FundingObservation[] = [];
  for (const { time, legPoint, sampleCount } of legPoints) {
    const settlements = settlementList(legPoint);
    if (settlements !== null && settlementAuthoritative) {
      observations.push(...settlementsToObservations(settlements));
      continue;
    }
    // No per-settlement rows: only a bucket with a real sample can contribute.
    // A bucket flagged `sampleCount` 0 is the chart-only temporary zero.
    if (sampleCount !== undefined && sampleCountValue(sampleCount) === null) continue;
    const rate = finiteNumber(legPoint.rate);
    if (rate === null) continue;
    const count = sampleCountValue(sampleCount);
    if (count === null) continue;
    observations.push({ time, rawRate: rate, sampleCount: count, markPrice: null, bucketLevel: true });
  }
  // A leg whose buckets are all chart-only zeros carries no readable funding
  // history; only real observations make the lane "read".
  return { observations, hasHistory: observations.length > 0 };
}

/**
 * Funding observations of the single perp leg of a spot-containing combo.
 * Settlement rates are the venue's own (long pays positive); the legacy
 * bucket-level `point.rate` is pre-signed by `combine.ts` as "long leg1 minus
 * long leg2" and must be inverted back for a perp sitting on leg 2.
 */
function mixedPerpObservations(
  result: SpotContainingCombinationResult,
  perpLeg: 1 | 2,
): { observations: FundingObservation[]; hasHistory: boolean } {
  const points = result.funding ?? [];
  const legPoints = points.flatMap((point) => {
    const time = finiteNumber(point.time);
    return point.perpLeg === perpLeg && time !== null ? [{ time, point }] : [];
  });
  const settlementAuthoritative = legPoints.some(({ point }) => (
    (settlementList(point) ?? []).length > 0
  ));

  const observations: FundingObservation[] = [];
  for (const { time, point } of legPoints) {
    const settlements = settlementList(point);
    if (settlements !== null && settlementAuthoritative) {
      observations.push(...settlementsToObservations(settlements));
      continue;
    }
    const count = sampleCountValue(point.sampleCount);
    if (count === null) continue;
    const signed = finiteNumber(point.rate);
    if (signed === null) continue;
    observations.push({
      time,
      rawRate: perpLeg === 1 ? signed : -signed,
      sampleCount: count,
      markPrice: null,
      bucketLevel: true,
    });
  }
  // `observations` is the leg's whole readable history (the window is applied
  // later), so a non-empty list means this leg's funding data was read.
  return { observations, hasHistory: observations.length > 0 };
}

function emptyAssessment(note: PairLegFundingNote, incomplete = false): FundingAssessment {
  return {
    percent: null,
    annualizedPercent: null,
    buckets: 0,
    sampleCount: 0,
    coverageStartTime: null,
    coverageEndTime: null,
    incomplete,
    priceMissing: false,
    basis: null,
    note,
  };
}

/**
 * A spot leg has no funding by construction: exactly 0, and never a warning,
 * because nothing is missing.
 */
function spotAssessment(): FundingAssessment {
  return {
    percent: 0,
    annualizedPercent: 0,
    buckets: 0,
    sampleCount: 0,
    coverageStartTime: null,
    coverageEndTime: null,
    incomplete: false,
    priceMissing: false,
    basis: null,
    note: "spot",
  };
}

function combineBasis(bases: ReadonlySet<Exclude<FundingPriceBasis, "mixed">>): FundingPriceBasis {
  if (bases.size === 1) return [...bases][0];
  return "mixed";
}

/**
 * Accumulates one leg's funding: `-side × Σ(rate × settlementPrice / entryPrice)`.
 *
 * `side` is +1 for the long leg1 and −1 for the short leg2, so a positive venue
 * rate costs the long leg and pays the short leg. The settlement price is the
 * venue's mark price when available and otherwise this leg's own candle close
 * for the interval containing the settlement — that proxy is labelled and is
 * only as precise as the chart interval.
 *
 * Completeness follows the agreed policy: any readable funding history for this
 * leg counts as complete, so a window without settlements, or a visible gap,
 * does not raise a warning. Only unreadable history does. A missing price is a
 * separate status (`priceMissing`), never folded into "incomplete funding".
 */
function assessFunding(options: {
  observations: readonly FundingObservation[];
  /** The leg's upstream payload exists, even if the window holds nothing. */
  hasHistory: boolean;
  side: 1 | -1;
  window: FundingWindow;
  entryPrice: number | null;
  candles: readonly LegCandle[];
}): FundingAssessment {
  const { observations, hasHistory, side, window, entryPrice, candles } = options;
  if (!hasHistory) return emptyAssessment("no-funding-data", true);
  if (entryPrice === null) {
    return { ...emptyAssessment("entry-price-missing"), priceMissing: true };
  }

  // Each observation carries its own real settlement time (bucket opens only for
  // legacy sums), so the window is applied per settlement: one late in the entry
  // bucket is not post-entry, one early in the next bucket already is.
  const included = observations.filter((observation) => (
    observation.time >= window.start && observation.time < window.end
  ));
  const durationMs = window.end - window.start;

  if (included.length === 0) {
    // Readable history, but nothing settled inside the holding window: the
    // accrued funding really is zero, so the total is the price return.
    // Annualized on the real holding duration, which may be a partial period.
    return {
      percent: 0,
      annualizedPercent: durationMs > 0 ? 0 : null,
      buckets: 0,
      sampleCount: 0,
      coverageStartTime: null,
      coverageEndTime: null,
      incomplete: false,
      priceMissing: false,
      basis: null,
      note: "no-post-entry-settlements",
    };
  }

  const bases = new Set<Exclude<FundingPriceBasis, "mixed">>();
  let weighted = 0;
  let sampleCount = 0;
  let priceMissing = false;
  let nonFinite = false;
  let coverageStartTime: number | null = null;
  let coverageEndTime: number | null = null;

  for (const observation of included) {
    const price = observation.bucketLevel || observation.markPrice === null
      ? candleCloseAt(candles, observation.time)
      : observation.markPrice;
    if (price === null) {
      priceMissing = true;
      continue;
    }
    bases.add(observation.bucketLevel
      ? "bucket-candle"
      : observation.markPrice === null ? "candle-proxy" : "settlement-mark");
    const contribution = observation.rawRate * price / entryPrice;
    if (!Number.isFinite(contribution)) nonFinite = true;
    weighted += contribution;
    sampleCount += observation.sampleCount;
    if (coverageStartTime === null || observation.time < coverageStartTime) coverageStartTime = observation.time;
    if (coverageEndTime === null || observation.time > coverageEndTime) coverageEndTime = observation.time;
  }

  if (priceMissing) {
    // Never drop an unpriced settlement, and never substitute 1 or the entry
    // price: the whole amount is unstated until every included settlement has a
    // price.
    return {
      ...emptyAssessment("settlement-price-missing"),
      priceMissing: true,
      buckets: included.length,
      sampleCount,
      coverageStartTime,
      coverageEndTime,
    };
  }
  if (nonFinite) return emptyAssessment("non-finite-funding");

  const rawPercent = -side * weighted * 100;
  const percent = rawPercent === 0 ? 0 : rawPercent;
  if (!Number.isFinite(percent)) return emptyAssessment("non-finite-funding");

  // An extreme percent or an extremely short holding window can overflow the
  // extrapolation, so the annualized value is guarded rather than handed to the
  // UI as Infinity.
  const annualizedRaw = durationMs > 0 ? percent * YEAR_MS / durationMs : null;
  const annualizedPercent = annualizedRaw !== null && Number.isFinite(annualizedRaw) ? annualizedRaw : null;

  return {
    percent,
    annualizedPercent,
    buckets: included.length,
    sampleCount,
    coverageStartTime,
    coverageEndTime,
    incomplete: false,
    priceMissing: false,
    basis: combineBasis(bases),
    note: null,
  };
}

function buildLeg(
  isSpot: boolean,
  entryPrice: number | null,
  latestPrice: number | null,
  priceReturnPercent: number | null,
  funding: FundingAssessment,
): PairLegReturn {
  const fundingPercent = funding.percent;
  const total = priceReturnPercent !== null && fundingPercent !== null
    ? priceReturnPercent + fundingPercent
    : null;
  return {
    priceReturnPercent,
    fundingReturnPercent: fundingPercent,
    totalReturnPercent: total !== null && Number.isFinite(total) ? total : null,
    fundingAnnualizedPercent: funding.annualizedPercent,
    fundingIncomplete: funding.incomplete,
    priceMissing: funding.priceMissing,
    fundingPriceBasis: funding.basis,
    isSpot,
    entryPrice,
    latestPrice,
    fundingSampleBuckets: funding.buckets,
    fundingSampleCount: funding.sampleCount,
    fundingCoverageStartTime: funding.coverageStartTime,
    fundingCoverageEndTime: funding.coverageEndTime,
    fundingNote: funding.note,
  };
}

function legIsSpot(result: ComboCandleResult | SpotContainingCombinationResult, leg: 1 | 2): boolean {
  if (!("kind" in result)) return false;
  return (leg === 1 ? result.leg1.kind : result.leg2.kind) === "spot";
}

/**
 * Splits a hypothetical long-leg1 / short-leg2 pair trade into two per-leg
 * return cards.
 *
 * Prices: both raw legs are read at the aligned candle named by `latestTime`
 * inside the *uncropped* preset result, so a chart viewport can only ever move
 * the right end. `latestTime === null` (viewport holds no post-entry point),
 * an unknown time, or a time that is not a post-entry aligned candle yields no
 * price at all — never a fallback to the preset's last candle.
 * Entry prices always come from the trade itself (`entryFirstClose` /
 * `entrySecondClose`), so a cropped result still yields correct returns; only
 * its funding history looks short, which is exactly what passing the uncropped
 * preset result exists to prevent.
 *
 * Funding: every settlement of each leg is filtered by its own real time from
 * the entry's real close (`entryCloseTime`) to the selected candle's real close
 * clamped to `now`. Settlement prices come from the venue mark price when
 * available and otherwise from the leg's own candle for the interval containing
 * that settlement. A legacy result without per-settlement data falls back to
 * `bucket rate × that bucket's candle close` and is labelled `bucket-candle`.
 * When the real entry close is unknown the funding lane reports
 * `missing-entry-time` rather than charging the entry candle's own settlement.
 *
 * Each leg sizes funding on its own entry notional (β is not applied), spot legs
 * are exactly 0, and nothing is ever zero-filled or priced with an unrelated
 * fallback. The result is a historical funding estimate, not settled account
 * cash flow.
 */
export function calculatePairLegReturns(
  result: ComboCandleResult | SpotContainingCombinationResult,
  trade: PairTradeSeries,
  latestTime: number | null,
  entryCloseTime: number | null,
  /** Injectable clock so the future-clamping rule stays pure in tests. */
  now: number = Date.now(),
): PairLegReturns {
  const firstSpot = legIsSpot(result, 1);
  const secondSpot = legIsSpot(result, 2);
  const rows = alignedRows(result);
  const requestedLatest = finiteNumber(latestTime);
  const latestRow = selectLatestRow(rows, requestedLatest);
  // The trade grid is the canonical anchor: `points[entryIndex].time` is the
  // aligned candle key the entry was opened on. `entryTime` is the same value
  // for trades built by calculatePairTradeSeries and a safe fallback for
  // hand-built series.
  const entryOpenTime = finiteNumber(trade?.points?.[trade?.entryIndex]?.time)
    ?? finiteNumber(trade?.entryTime);
  const entryBoundary = finiteNumber(entryCloseTime);
  // The funding window only ever starts at the real entry close. Falling back
  // to the entry candle's open would include that candle's own settlement.
  const windowStart = entryBoundary;

  // The latest candle must be strictly after the entry candle: the entry candle
  // itself is not a post-entry observation, so it cannot price a return.
  const postEntry = latestRow !== null
    && entryOpenTime !== null
    && latestRow.time > entryOpenTime;
  // A price-only read stays possible even if a hand-built row has no usable
  // close time; only the funding window then fails closed.
  const windowEnd = postEntry && latestRow.endTime > latestRow.time
    ? Math.min(latestRow.endTime, Number.isFinite(now) ? now : latestRow.endTime)
    : null;

  const entryFirst = positiveNumber(trade?.entryFirstClose);
  const entrySecond = positiveNumber(trade?.entrySecondClose);
  // A non-positive or non-finite close is not a usable mark for a percentage
  // return; fail closed rather than printing a fabricated -100%.
  const latestFirst = postEntry ? positiveNumber(latestRow.firstClose) : null;
  const latestSecond = postEntry ? positiveNumber(latestRow.secondClose) : null;
  const firstPrice = postEntry ? longReturnPercent(entryFirst, latestFirst) : null;
  const secondPrice = postEntry ? shortReturnPercent(entrySecond, latestSecond) : null;

  const window: FundingWindow | null = windowStart === null || windowEnd === null || windowEnd <= windowStart
    ? null
    : { start: windowStart, end: windowEnd };

  // No post-entry candle is "not yet observable", not "bad data": the legs
  // report nulls with an explanatory note and stay un-flagged. An unknown entry
  // close makes the holding window itself unknown, which is its own status.
  const windowNote: PairLegFundingNote = windowStart === null
    ? "missing-entry-time"
    : "no-post-entry-window";

  const assessPerpLeg = (leg: 1 | 2): FundingAssessment => {
    const source = "candles" in result
      ? perpPairObservations(result, leg === 1 ? "firstFunding" : "secondFunding")
      : mixedPerpObservations(result, leg);
    if (window === null) {
      // Still distinguish "no history at all" (a real warning) from "nothing
      // observable yet" (not a warning).
      return emptyAssessment(source.hasHistory ? windowNote : "no-funding-data", !source.hasHistory);
    }
    return assessFunding({
      observations: source.observations,
      hasHistory: source.hasHistory,
      side: leg === 1 ? 1 : -1,
      window,
      entryPrice: leg === 1 ? entryFirst : entrySecond,
      candles: legCandles(result, leg),
    });
  };

  return {
    first: buildLeg(
      firstSpot,
      postEntry ? entryFirst : null,
      latestFirst,
      firstPrice,
      firstSpot ? spotAssessment() : assessPerpLeg(1),
    ),
    second: buildLeg(
      secondSpot,
      postEntry ? entrySecond : null,
      latestSecond,
      secondPrice,
      secondSpot ? spotAssessment() : assessPerpLeg(2),
    ),
    latestTime: postEntry ? latestRow.time : null,
    fundingWindowStartTime: window?.start ?? null,
    fundingWindowEndTime: window?.end ?? null,
  };
}
