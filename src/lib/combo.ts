import { SearchExchangeRate } from "./search";
import { SearchCandleResult, SearchCandlePoint, FundingRatePoint } from "./search-candles";

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
}

export function alignComboData(
  first: SearchCandleResult,
  second: SearchCandleResult,
  mode: "spread" | "ratio",
): ComboCandleResult {
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
  for (const { first: firstCandle, second: secondCandle } of candleMap.values()) {
    if (!secondCandle) continue;

    if (mode === "spread") {
      alignedCandles.push({
        openTime: firstCandle.openTime,
        closeTime: firstCandle.closeTime,
        open: String(parseFloat(firstCandle.open) - parseFloat(secondCandle.open)),
        high: "",
        low: "",
        close: String(parseFloat(firstCandle.close) - parseFloat(secondCandle.close)),
        volume: firstCandle.volume,
        quoteVolume: String(Math.min(parseFloat(firstCandle.quoteVolume), parseFloat(secondCandle.quoteVolume))),
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
        quoteVolume: String(Math.min(parseFloat(firstCandle.quoteVolume), parseFloat(secondCandle.quoteVolume))),
      });
    }
  }

  alignedCandles.sort((a, b) => a.openTime - b.openTime);

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

  const alignedFundingRates: FundingRatePoint[] = [];
  for (const { first: firstFr, second: secondFr } of fundingMap.values()) {
    if (!secondFr) continue;
    alignedFundingRates.push({
      time: firstFr.time,
      rate: firstFr.rate - secondFr.rate,
      annualizedRate: firstFr.annualizedRate - secondFr.annualizedRate,
    });
  }

  alignedFundingRates.sort((a, b) => a.time - b.time);

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
