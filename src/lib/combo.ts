import { SearchExchangeRate } from "./search";
import { SearchCandleResult, SearchCandlePoint, FundingRatePoint, SearchChartInterval } from "./search-candles";
import { createCandleSourceProvenance, type CandleSourceProvenance } from "./candle-provenance";

export type ComboMode = "spread" | "ratio" | null;

export interface ComboSelection {
  first: SearchExchangeRate | null;
  second: SearchExchangeRate | null;
  mode: ComboMode;
}

export interface ComboCandleResult extends SearchCandleResult {
  mode: ComboMode;
  firstSymbol: string;
  firstExchange: string;
  secondSymbol: string;
  secondExchange: string;
  fundingRates: ComboFundingRatePoint[];
  firstQuoteTurnover?: ComboAnalysisValuePoint[];
  secondQuoteTurnover?: ComboAnalysisValuePoint[];
  dashboardFundingRates?: FundingRatePoint[];
  legProvenance: [CandleSourceProvenance, CandleSourceProvenance];
}

export interface ComboAnalysisValuePoint {
  time: number;
  value: number;
}

/** Raw funding observation for one leg of a combo pair in a bucket where that
 * leg had an actual settlement. Null means no actual settlement in that
 * bucket — including the explicit sampleCount 0 bucket used as a temporary
 * chart-only zero. The temporary zero is never represented as a real leg
 * observation. */
export interface ComboFundingLegObservation {
  rate: number;
  annualizedRate: number;
}

/** Combo funding point: the derived difference plus each leg's own raw funding
 * observation (or null when that leg had no actual settlement). The metadata
 * fields are optional so hand-built fixtures stay structurally compatible with
 * FundingRatePoint; alignComboData always sets them on every derived point. */
export interface ComboFundingRatePoint extends FundingRatePoint {
  firstFunding?: ComboFundingLegObservation | null;
  secondFunding?: ComboFundingLegObservation | null;
}

function minimumOfficialQuoteVolume(
  first: SearchCandlePoint,
  second: SearchCandlePoint,
): string | undefined {
  if (first.quoteVolume === undefined || second.quoteVolume === undefined) return undefined;
  const firstValue = Number(first.quoteVolume);
  const secondValue = Number(second.quoteVolume);
  return Number.isFinite(firstValue) && Number.isFinite(secondValue)
    ? String(Math.min(firstValue, secondValue))
    : undefined;
}

function officialQuoteTurnover(candle: SearchCandlePoint): number | null {
  if (candle.quoteVolume === undefined) return null;
  const value = Number(candle.quoteVolume);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function hasActualFundingSample(point: FundingRatePoint): boolean {
  return Number.isFinite(point.rate)
    && Number.isFinite(point.annualizedRate)
    && (point.sampleCount === undefined || point.sampleCount > 0);
}

// Chart intervals where a missing funding bucket (explicit sampleCount 0) is
// rendered as a chart-only zero so the derived line stays continuous. This is
// interval-scoped chart rendering semantics only — it is NOT a fabricated
// historical observation, and it never feeds dashboard averages (see
// dashboardFundingRates below). The zero applies only when the opposite leg
// carries the explicit sampleCount === 0 flag; malformed or non-finite
// non-actual data never triggers it. All other intervals (1d, 1w, 1m, ...)
// stay strict: a missing bucket keeps the derived point unavailable.
const CHART_ZERO_INTERVALS: ReadonlySet<SearchChartInterval> = new Set(["4h", "1h", "5m"]);

export function alignComboData(
  first: SearchCandleResult,
  second: SearchCandleResult,
  mode: "spread" | "ratio",
): ComboCandleResult {
  const sourceProvenance = (result: SearchCandleResult): CandleSourceProvenance => result.provenance
    ?? createCandleSourceProvenance(result.exchange, result.interval, result.interval, false);
  // 1. Timestamp intersection for candles
  const candleMap = new Map<number, { first: SearchCandlePoint; second: SearchCandlePoint }>();

  for (const candle of first.candles) {
    candleMap.set(candle.openTime, { first: candle, second: null as unknown as SearchCandlePoint });
  }

  for (const candle of second.candles) {
    const entry = candleMap.get(candle.openTime);
    if (entry) {
      entry.second = candle;
    }
  }

  const alignedCandles: SearchCandlePoint[] = [];
  const firstQuoteTurnover: ComboAnalysisValuePoint[] = [];
  const secondQuoteTurnover: ComboAnalysisValuePoint[] = [];
  for (const { first: firstCandle, second: secondCandle } of candleMap.values()) {
    if (!secondCandle) continue;
    const quoteVolume = minimumOfficialQuoteVolume(firstCandle, secondCandle);

    if (mode === "spread") {
      alignedCandles.push({
        openTime: firstCandle.openTime,
        closeTime: firstCandle.closeTime,
        open: String(parseFloat(firstCandle.open) - parseFloat(secondCandle.open)),
        high: "",
        low: "",
        close: String(parseFloat(firstCandle.close) - parseFloat(secondCandle.close)),
        volume: firstCandle.volume,
        ...(quoteVolume === undefined ? {} : { quoteVolume }),
      });
    } else {
      // ratio mode
      if (secondCandle.open === "0" || secondCandle.close === "0") {
        continue;
      }
      alignedCandles.push({
        openTime: firstCandle.openTime,
        closeTime: firstCandle.closeTime,
        open: String(parseFloat(firstCandle.open) / parseFloat(secondCandle.open)),
        high: "",
        low: "",
        close: String(parseFloat(firstCandle.close) / parseFloat(secondCandle.close)),
        volume: firstCandle.volume,
        ...(quoteVolume === undefined ? {} : { quoteVolume }),
      });
    }

    const firstTurnover = officialQuoteTurnover(firstCandle);
    const secondTurnover = officialQuoteTurnover(secondCandle);
    if (firstTurnover !== null) firstQuoteTurnover.push({ time: firstCandle.openTime, value: firstTurnover });
    if (secondTurnover !== null) secondQuoteTurnover.push({ time: secondCandle.openTime, value: secondTurnover });
  }

  alignedCandles.sort((a, b) => a.openTime - b.openTime);
  firstQuoteTurnover.sort((a, b) => a.time - b.time);
  secondQuoteTurnover.sort((a, b) => a.time - b.time);

  // 2. Funding rate alignment
  const fundingMap = new Map<number, { first: FundingRatePoint; second: FundingRatePoint }>();

  for (const fr of first.fundingRates) {
    fundingMap.set(fr.time, { first: fr, second: null as unknown as FundingRatePoint });
  }

  for (const fr of second.fundingRates) {
    const entry = fundingMap.get(fr.time);
    if (entry) {
      entry.second = fr;
    }
  }

  const alignedFundingRates: ComboFundingRatePoint[] = [];
  const dashboardFundingRates: FundingRatePoint[] = [];
  const chartZero = CHART_ZERO_INTERVALS.has(first.interval);
  for (const { first: firstFr, second: secondFr } of fundingMap.values()) {
    if (!secondFr) continue;
    const firstActual = hasActualFundingSample(firstFr);
    const secondActual = hasActualFundingSample(secondFr);
    // Leg metadata: each leg's raw observation when it had an actual
    // settlement, null otherwise (missing bucket, explicit sampleCount 0
    // temporary chart-only zero, or malformed non-actual data). The temporary
    // zero is never represented as a real leg observation.
    const firstFunding: ComboFundingLegObservation | null = firstActual
      ? { rate: firstFr.rate, annualizedRate: firstFr.annualizedRate }
      : null;
    const secondFunding: ComboFundingLegObservation | null = secondActual
      ? { rate: secondFr.rate, annualizedRate: secondFr.annualizedRate }
      : null;

    let difference: ComboFundingRatePoint;
    if (firstActual && secondActual) {
      // Both legs have real samples: leg1 - leg2.
      difference = {
        time: firstFr.time,
        rate: firstFr.rate - secondFr.rate,
        annualizedRate: firstFr.annualizedRate - secondFr.annualizedRate,
        firstFunding,
        secondFunding,
      };
    } else if (chartZero && firstActual && secondFr.sampleCount === 0) {
      // 4h/1h/5m chart-only zero: leg2 is an explicit no-settlement bucket
      // (sampleCount === 0) and renders as 0, so the derived point is leg1 - 0.
      // Only that explicit flag triggers the zero — malformed or non-finite
      // non-actual opposite data stays unavailable. Renderable actual point
      // (not sampleCount 0); it never enters dashboardFundingRates below.
      difference = {
        time: firstFr.time,
        rate: firstFr.rate,
        annualizedRate: firstFr.annualizedRate,
        firstFunding,
        secondFunding,
      };
    } else if (chartZero && firstFr.sampleCount === 0 && secondActual) {
      // 4h/1h/5m chart-only zero: leg1 is an explicit no-settlement bucket
      // (sampleCount === 0) and renders as 0, so the derived point is 0 - leg2.
      difference = {
        time: firstFr.time,
        rate: -secondFr.rate,
        annualizedRate: -secondFr.annualizedRate,
        firstFunding,
        secondFunding,
      };
    } else {
      // Both legs explicitly unavailable, or a strict interval (1d/1w/1m/...):
      // the derived difference must be marked unavailable too — computing
      // `0 - validRate` would fabricate a real-looking spread. The numeric
      // zero + sampleCount 0 shape matches aggregateFundingRatesToCandles, so
      // the visual lane renders these as gaps via sampleCount.
      difference = {
        time: firstFr.time,
        rate: 0,
        annualizedRate: 0,
        sampleCount: 0,
        firstFunding,
        secondFunding,
      };
    }
    alignedFundingRates.push(difference);
    // Dashboard averages stay actual-both-legs-only at every interval, so the
    // temporary chart-only zero never enters them. Dashboard points stay plain
    // FundingRatePoint values (no leg metadata).
    if (firstActual && secondActual) {
      dashboardFundingRates.push({
        time: difference.time,
        rate: difference.rate,
        annualizedRate: difference.annualizedRate,
      });
    }
  }

  alignedFundingRates.sort((a, b) => a.time - b.time);
  dashboardFundingRates.sort((a, b) => a.time - b.time);

  return {
    candles: alignedCandles,
    fundingRates: alignedFundingRates,
    interval: first.interval,
    exchange: first.exchange,
    symbol: mode === "spread" ? `${first.symbol}-${second.symbol}` : `${first.symbol}/${second.symbol}`,
    mode,
    firstSymbol: first.symbol,
    firstExchange: first.exchange,
    secondSymbol: second.symbol,
    secondExchange: second.exchange,
    firstQuoteTurnover,
    secondQuoteTurnover,
    dashboardFundingRates,
    provenance: first.provenance,
    legProvenance: [sourceProvenance(first), sourceProvenance(second)],
  };
}

export function parseComboSearch(term: string): {
  keyword1: string;
  keyword2: string;
  mode: ComboMode;
} {
  const trimmed = term.trim();
  const dashIndex = trimmed.indexOf("-");
  const slashIndex = trimmed.indexOf("/");

  let separatorIndex = -1;
  let mode: ComboMode = null;

  if (dashIndex !== -1 && slashIndex !== -1) {
    if (dashIndex < slashIndex) {
      separatorIndex = dashIndex;
      mode = "spread";
    } else {
      separatorIndex = slashIndex;
      mode = "ratio";
    }
  } else if (dashIndex !== -1) {
    separatorIndex = dashIndex;
    mode = "spread";
  } else if (slashIndex !== -1) {
    separatorIndex = slashIndex;
    mode = "ratio";
  }

  if (separatorIndex === -1) {
    return { keyword1: trimmed.toLowerCase(), keyword2: "", mode: null };
  }

  const keyword1 = trimmed.slice(0, separatorIndex).trim().toLowerCase();
  const keyword2 = trimmed.slice(separatorIndex + 1).trim().toLowerCase();

  return { keyword1, keyword2, mode };
}

export function isComboSearch(term: string): boolean {
  const trimmed = term.trim();
  const dashCount = (trimmed.match(/-/g) || []).length;
  const slashCount = (trimmed.match(/\//g) || []).length;

  if (dashCount + slashCount !== 1) {
    return false;
  }

  const { keyword1, keyword2 } = parseComboSearch(trimmed);
  return keyword1.length > 0 && keyword2.length > 0;
}
