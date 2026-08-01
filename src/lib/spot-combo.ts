import type { SpotCandlePoint, SpotCandleResult } from "./spot-search-candles";

export type SpotComboMode = "spread" | "ratio";

export interface SpotComboCandleResult extends SpotCandleResult {
  mode: SpotComboMode;
  firstSymbol: string;
  firstExchange: string;
  secondSymbol: string;
  secondExchange: string;
}

function finite(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function combineSpotCandles(
  first: SpotCandleResult,
  second: SpotCandleResult,
  mode: SpotComboMode,
): SpotComboCandleResult {
  const secondByTime = new Map(second.candles.map((point) => [point.openTime, point]));
  const candles: SpotCandlePoint[] = [];
  for (const a of first.candles) {
    const b = secondByTime.get(a.openTime);
    if (!b) continue;
    const av = [a.open, a.high, a.low, a.close].map(finite);
    const bv = [b.open, b.high, b.low, b.close].map(finite);
    if ([...av, ...bv].some((value) => value === null)) continue;
    const [ao, ah, al, ac] = av as number[];
    const [bo, bh, bl, bc] = bv as number[];
    if (mode === "ratio" && [bo, bh, bl, bc].some((value) => value <= 0)) continue;
    const quoteVolume = a.quoteVolume !== undefined && b.quoteVolume !== undefined
      ? String(Math.min(Number(a.quoteVolume), Number(b.quoteVolume))) : undefined;
    candles.push({
      openTime: a.openTime,
      closeTime: Math.min(a.closeTime, b.closeTime),
      open: String(mode === "spread" ? ao - bo : ao / bo),
      high: String(mode === "spread" ? ah - bl : ah / bl),
      low: String(mode === "spread" ? al - bh : al / bh),
      close: String(mode === "spread" ? ac - bc : ac / bc),
      volume: String(Math.min(Number(a.volume), Number(b.volume))),
      ...(quoteVolume === undefined || !Number.isFinite(Number(quoteVolume)) ? {} : { quoteVolume }),
    });
  }
  return {
    candles,
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

const QUOTE_ASSETS = new Set(["USD", "USDT", "USDC", "FDUSD", "TUSD", "DAI", "BTC", "ETH", "EUR"]);

export function parseSpotComboSearch(term: string): { keyword1: string; keyword2: string; mode: SpotComboMode | null } {
  const value = term.trim();
  const separators = [...value.matchAll(/[/-]/g)];
  if (separators.length !== 1) return { keyword1: value.toLowerCase(), keyword2: "", mode: null };
  const index = separators[0].index ?? -1;
  const first = value.slice(0, index).trim().toLowerCase();
  const second = value.slice(index + 1).trim().toLowerCase();
  if (!first || !second || first === second || QUOTE_ASSETS.has(second.toUpperCase())) {
    return { keyword1: value.toLowerCase(), keyword2: "", mode: null };
  }
  return { keyword1: first, keyword2: second, mode: value[index] === "/" ? "ratio" : "spread" };
}

export function isSpotComboSearch(term: string): boolean {
  return parseSpotComboSearch(term).mode !== null;
}
