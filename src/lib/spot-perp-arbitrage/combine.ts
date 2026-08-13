import { alignComboData, type ComboCandleResult } from "../combo";
import type { FundingRatePoint, SearchCandlePoint, SearchCandleResult, SearchChartInterval } from "../search-candles";
import type { LoadedLeg, LoadedPerpLeg } from "./load";
import type { PerpMarket, SpotMarket } from "./model";
import type { ActualFundingObservation, LegCandlePoint, LegTurnover } from "./series";
import { createCandleSourceProvenance, type CandleSourceProvenance } from "../candle-provenance";

export type CombinationMode = "spread" | "ratio";

export interface CombinedPoint {
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  leg1Turnover: LegTurnover | null;
  leg2Turnover: LegTurnover | null;
  minimumTurnover: number | null;
}

export interface SignedFundingObservation extends ActualFundingObservation {
  perpLeg: 1 | 2;
}

interface SpotContainingCombinationBase {
  kind: "spot-containing";
  mode: CombinationMode;
  interval: SearchChartInterval;
  points: CombinedPoint[];
  funding: SignedFundingObservation[];
  legProvenance: [CandleSourceProvenance, CandleSourceProvenance];
}

export interface SpotSpotCombinationResult extends SpotContainingCombinationBase {
  composition: "spot-spot";
  leg1: SpotMarket;
  leg2: SpotMarket;
}

export type MixedCombinationResult = SpotContainingCombinationBase & {
  composition: "mixed";
} & (
  | { leg1: PerpMarket; leg2: SpotMarket }
  | { leg1: SpotMarket; leg2: PerpMarket }
);

export type SpotContainingCombinationResult = SpotSpotCombinationResult | MixedCombinationResult;

export type ArbitrageCombinationResult = ComboCandleResult | SpotContainingCombinationResult;

function sanitizeLegacyResult(result: SearchCandleResult): SearchCandleResult {
  const candles = new Map<number, SearchCandlePoint>();
  for (const candle of result.candles) {
    const values = [candle.openTime, candle.closeTime, candle.open, candle.close, candle.volume].map(Number);
    if (!values.every(Number.isFinite) || candle.closeTime <= candle.openTime) continue;
    if (candle.quoteVolume !== undefined && (!Number.isFinite(Number(candle.quoteVolume)) || Number(candle.quoteVolume) < 0)) {
      const { quoteVolume: _ignored, ...withoutQuote } = candle;
      candles.set(candle.openTime, withoutQuote);
    } else {
      candles.set(candle.openTime, candle);
    }
  }
  const funding = new Map<number, FundingRatePoint>();
  for (const point of result.fundingRates) {
    if (Number.isFinite(point.time) && Number.isFinite(point.rate) && Number.isFinite(point.annualizedRate)) {
      funding.set(point.time, point);
    }
  }
  return {
    ...result,
    candles: [...candles.values()].sort((a, b) => a.openTime - b.openTime),
    fundingRates: [...funding.values()].sort((a, b) => a.time - b.time),
  };
}

function prepareLegacyPair(
  firstLeg: LoadedPerpLeg,
  secondLeg: LoadedPerpLeg,
  mode: CombinationMode,
): [SearchCandleResult, SearchCandleResult] {
  let first = sanitizeLegacyResult(firstLeg.original);
  let second = sanitizeLegacyResult(secondLeg.original);
  const secondByTime = new Map(second.candles.map((point) => [point.openTime, point]));

  first = {
    ...first,
    candles: first.candles.flatMap((point) => {
      const other = secondByTime.get(point.openTime);
      if (!other) return [point];
      if (mode === "ratio") {
        const prices = [point.open, point.close, other.open, other.close].map(Number);
        if (!prices.every((price) => Number.isFinite(price) && price > 0)) return [];
      }
      const closeTime = Math.min(point.closeTime, other.closeTime);
      return closeTime === point.closeTime ? [point] : [{ ...point, closeTime }];
    }),
  };
  if (mode === "ratio") {
    const retained = new Set(first.candles.map((point) => point.openTime));
    second = { ...second, candles: second.candles.filter((point) => retained.has(point.openTime)) };
  }
  return [first, second];
}

function validSpotContainingPoint(first: LegCandlePoint, second: LegCandlePoint): boolean {
  return first.open > 0 && first.close > 0 && second.open > 0 && second.close > 0;
}

function combineSpotContaining(
  first: LoadedLeg,
  second: LoadedLeg,
  mode: CombinationMode,
): SpotContainingCombinationResult {
  const secondByTime = new Map(second.series.points.map((point) => [point.openTime, point]));
  const points: CombinedPoint[] = [];
  const alignedTimes = new Set<number>();
  for (const firstPoint of first.series.points) {
    const secondPoint = secondByTime.get(firstPoint.openTime);
    if (!secondPoint || !validSpotContainingPoint(firstPoint, secondPoint)) continue;
    const open = mode === "spread" ? firstPoint.open - secondPoint.open : firstPoint.open / secondPoint.open;
    const close = mode === "spread" ? firstPoint.close - secondPoint.close : firstPoint.close / secondPoint.close;
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const firstTurnover = firstPoint.turnover;
    const secondTurnover = secondPoint.turnover;
    points.push({
      openTime: firstPoint.openTime,
      closeTime: Math.min(firstPoint.closeTime, secondPoint.closeTime),
      open,
      close,
      leg1Turnover: firstTurnover,
      leg2Turnover: secondTurnover,
      minimumTurnover: firstTurnover && secondTurnover
        ? Math.min(firstTurnover.value, secondTurnover.value)
        : null,
    });
    alignedTimes.add(firstPoint.openTime);
  }

  const perp = first.kind === "perp" ? first : second.kind === "perp" ? second : null;
  const perpLeg: 1 | 2 = first.kind === "perp" ? 1 : 2;
  const sign = perpLeg === 1 ? 1 : -1;
  const funding: SignedFundingObservation[] = perp
    ? perp.series.funding
      .filter((point) => alignedTimes.has(point.time))
      .map((point) => ({ ...point, rate: point.rate * sign, annualizedRate: point.annualizedRate * sign, perpLeg }))
    : [];

  const sourceProvenance = (leg: LoadedLeg): CandleSourceProvenance => leg.original.provenance
    ?? createCandleSourceProvenance(leg.original.exchange, leg.original.interval, leg.original.interval, false);
  const base = {
    kind: "spot-containing" as const,
    mode,
    interval: first.series.interval,
    points,
    funding,
    legProvenance: [sourceProvenance(first), sourceProvenance(second)] as [CandleSourceProvenance, CandleSourceProvenance],
  };
  if (first.kind === "spot" && second.kind === "spot") {
    return { ...base, composition: "spot-spot", leg1: first.market, leg2: second.market };
  }
  if (first.kind === "perp" && second.kind === "spot") {
    return { ...base, composition: "mixed", leg1: first.market, leg2: second.market };
  }
  if (first.kind === "spot" && second.kind === "perp") {
    return { ...base, composition: "mixed", leg1: first.market, leg2: second.market };
  }
  throw new TypeError("Spot-containing combination requires at least one spot leg");
}

/** Pure combination boundary. Throws before combining mismatched requested intervals. */
export function combineLoadedLegs(
  first: LoadedLeg,
  second: LoadedLeg,
  mode: CombinationMode,
): ArbitrageCombinationResult {
  if (first.series.interval !== second.series.interval) {
    throw new RangeError(`Cannot combine ${first.series.interval} with ${second.series.interval}`);
  }
  if (first.kind === "perp" && second.kind === "perp") {
    const [sanitizedFirst, sanitizedSecond] = prepareLegacyPair(first, second, mode);
    return alignComboData(sanitizedFirst, sanitizedSecond, mode);
  }
  return combineSpotContaining(first, second, mode);
}
