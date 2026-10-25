import type {
  FundingRatePoint,
  FundingSettlementSample,
  SearchCandleResult,
  SearchChartInterval,
} from "../search-candles";
import type { SpotCandleResult } from "../spot-search-candles";
import type { QuoteTurnoverSource } from "../candle-provenance";
import type { PerpMarket, SpotMarket } from "./model";

export type TurnoverProvenance = "official-quote" | "estimated-base-close";

export interface LegTurnover {
  value: number;
  provenance: TurnoverProvenance;
}

export interface LegCandlePoint {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  baseVolume: number;
  turnover: LegTurnover | null;
}

export interface ActualFundingObservation {
  time: number;
  rate: number;
  annualizedRate: number;
  sampleCount: number | null;
  /**
   * This leg's own real settlements for the bucket, passed through verbatim and
   * still carrying the venue's "long pays positive" rates. Absent when the
   * source carried no per-settlement detail (a legacy bucket sum, or a gap), so
   * "no settlement list" stays distinguishable from "an empty one".
   */
  settlements?: FundingSettlementSample[];
}

export interface LegSeries {
  kind: "perp" | "spot";
  interval: SearchChartInterval;
  exchange: string;
  symbol: string;
  points: LegCandlePoint[];
  funding: ActualFundingObservation[];
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoints(
  candles: SearchCandleResult["candles"] | SpotCandleResult["candles"],
  kind: "perp" | "spot",
  quoteTurnover: QuoteTurnoverSource = "official",
): LegCandlePoint[] {
  const points = new Map<number, LegCandlePoint>();
  for (const candle of candles) {
    const openTime = numeric(candle.openTime);
    const closeTime = numeric(candle.closeTime);
    const open = numeric(candle.open);
    const high = numeric(candle.high);
    const low = numeric(candle.low);
    const close = numeric(candle.close);
    const baseVolume = numeric(candle.volume);
    if (
      openTime === null || closeTime === null || closeTime <= openTime || open === null || high === null
      || low === null || close === null || baseVolume === null || baseVolume < 0
    ) continue;

    const official = numeric(candle.quoteVolume);
    let turnover: LegTurnover | null = quoteTurnover === "official" && official !== null && official >= 0
      ? { value: official, provenance: "official-quote" }
      : null;
    if (quoteTurnover === "derived" && official !== null && official >= 0) {
      turnover = { value: official, provenance: "estimated-base-close" };
    }
    if (kind === "spot" && turnover === null) {
      const estimated = baseVolume * close;
      if (Number.isFinite(estimated) && estimated >= 0) {
        turnover = { value: estimated, provenance: "estimated-base-close" };
      }
    }
    points.set(openTime, { openTime, closeTime, open, high, low, close, baseVolume, turnover });
  }
  return [...points.values()].sort((a, b) => a.openTime - b.openTime);
}

function fundingSampleCount(point: FundingRatePoint): { present: boolean; value: number | null } {
  const record = point as FundingRatePoint & { sampleCount?: unknown };
  if (!("sampleCount" in record)) return { present: false, value: null };
  const value = numeric(record.sampleCount);
  return { present: true, value };
}

/**
 * Real settlements of a bucket, copied verbatim apart from validation.
 *
 * `rate` keeps the venue's own sign — no leg/combination sign is applied here.
 * A mark price must be a real positive finite number to survive; a missing,
 * zero, or non-finite one stays absent instead of becoming a fabricated 0.
 */
function normalizeSettlements(point: FundingRatePoint): FundingSettlementSample[] | undefined {
  const raw = (point as FundingRatePoint & { settlements?: unknown }).settlements;
  if (!Array.isArray(raw)) return undefined;
  const settlements: FundingSettlementSample[] = [];
  for (const entry of raw as Array<{ time?: unknown; rate?: unknown; markPrice?: unknown }>) {
    if (entry === null || typeof entry !== "object") continue;
    const time = numeric(entry.time);
    const rate = numeric(entry.rate);
    if (time === null || rate === null) continue;
    const markPrice = numeric(entry.markPrice);
    settlements.push({
      time,
      rate,
      ...(markPrice === null || markPrice <= 0 ? {} : { markPrice }),
    });
  }
  return settlements.sort((a, b) => a.time - b.time);
}

export function normalizeFunding(points: readonly FundingRatePoint[]): ActualFundingObservation[] {
  const observations = new Map<number, ActualFundingObservation>();
  for (const point of points) {
    const time = numeric(point.time);
    const rate = numeric(point.rate);
    const annualizedRate = numeric(point.annualizedRate);
    const count = fundingSampleCount(point);
    if (time === null || rate === null || annualizedRate === null) continue;
    if (count.present && (count.value === null || count.value <= 0)) continue;
    const settlements = normalizeSettlements(point);
    observations.set(time, {
      time,
      rate,
      annualizedRate,
      sampleCount: count.value,
      ...(settlements === undefined ? {} : { settlements }),
    });
  }
  return [...observations.values()].sort((a, b) => a.time - b.time);
}

export function normalizePerpSeries(market: PerpMarket, result: SearchCandleResult): LegSeries {
  return {
    kind: "perp",
    interval: result.interval,
    exchange: result.exchange,
    symbol: result.symbol,
    points: normalizePoints(result.candles, "perp", result.provenance?.quoteTurnover),
    funding: normalizeFunding(result.fundingRates),
  };
}

export function normalizeSpotSeries(market: SpotMarket, result: SpotCandleResult): LegSeries {
  return {
    kind: "spot",
    interval: result.interval,
    exchange: result.exchange,
    symbol: result.symbol,
    points: normalizePoints(result.candles, "spot", result.provenance?.quoteTurnover),
    funding: [],
  };
}
