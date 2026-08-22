import { DEFAULT_IMPACT_NOTIONAL, type ImpactSpreadDetailResult } from "../impact-price";
import { marketDisplaySymbol, marketId, type ArbitrageMarket } from "./model";

export interface StrategySettings {
  impactNotional: number;
  minGross: number;
  maxGross: number;
  totalFee: number;
  spotOnlyBuy: boolean;
  convergenceDays: number;
}

export interface StrategyDraftSettings {
  minGross: string;
  maxGross: string;
  totalFee: string;
  spotOnlyBuy: boolean;
  convergenceDays: string;
}

export interface StrategyLeg {
  id: string;
  exchange: string;
  symbol: string;
  kind: ArbitrageMarket["kind"];
  price: number;
}

export interface StrategyRecommendation {
  rank: number;
  buy: StrategyLeg;
  sell: StrategyLeg;
  gross: number;
  netReturn: number;
  annualized: number;
}

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  impactNotional: DEFAULT_IMPACT_NOTIONAL,
  minGross: 0.3,
  maxGross: 1.5,
  totalFee: 0.1,
  spotOnlyBuy: true,
  convergenceDays: 3,
};

export const MAX_STRATEGY_RECOMMENDATIONS = 5;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeConvergenceDays(value: number, fallback = DEFAULT_STRATEGY_SETTINGS.convergenceDays): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeRange(minGross: number, maxGross: number): { minGross: number; maxGross: number } {
  const min = finiteOr(minGross, DEFAULT_STRATEGY_SETTINGS.minGross);
  const max = finiteOr(maxGross, DEFAULT_STRATEGY_SETTINGS.maxGross);
  return min <= max ? { minGross: min, maxGross: max } : { minGross: max, maxGross: min };
}

/** Convert editable strings into one validated set of applied strategy settings. */
export function applyStrategyDraft(
  draft: StrategyDraftSettings,
  impactNotional: number,
): StrategySettings {
  const minGross = Number(draft.minGross);
  const maxGross = Number(draft.maxGross);
  const range = normalizeRange(minGross, maxGross);
  const fee = Number(draft.totalFee);
  const days = Number(draft.convergenceDays);
  return {
    impactNotional: Number.isFinite(impactNotional) && impactNotional > 0
      ? impactNotional
      : DEFAULT_STRATEGY_SETTINGS.impactNotional,
    ...range,
    totalFee: Number.isFinite(fee) && fee >= 0 ? fee : DEFAULT_STRATEGY_SETTINGS.totalFee,
    spotOnlyBuy: draft.spotOnlyBuy,
    convergenceDays: normalizeConvergenceDays(days, DEFAULT_STRATEGY_SETTINGS.convergenceDays),
  };
}

function impactPrices(detail: ImpactSpreadDetailResult | undefined): { ask: number; bid: number } | null {
  if (detail === null || typeof detail !== "object") return null;
  if (
    typeof detail.askPrice !== "number" || !Number.isFinite(detail.askPrice) || detail.askPrice <= 0
    || typeof detail.bidPrice !== "number" || !Number.isFinite(detail.bidPrice) || detail.bidPrice <= 0
  ) return null;
  return { ask: detail.askPrice, bid: detail.bidPrice };
}

function leg(market: ArbitrageMarket, price: number): StrategyLeg {
  return {
    id: String(marketId(market)),
    exchange: market.source.exchange,
    symbol: marketDisplaySymbol(market),
    kind: market.kind,
    price,
  };
}

/** Enumerate executable cross-market directions, rank by gross spread, and keep only the top five. */
export function computeStrategyRecommendations(
  markets: readonly ArbitrageMarket[],
  impactResults: ReadonlyMap<string, ImpactSpreadDetailResult>,
  settings: StrategySettings,
): StrategyRecommendation[] {
  const range = normalizeRange(settings.minGross, settings.maxGross);
  const feeValue = finiteOr(settings.totalFee, DEFAULT_STRATEGY_SETTINGS.totalFee);
  const fee = feeValue >= 0 ? feeValue : DEFAULT_STRATEGY_SETTINGS.totalFee;
  const days = normalizeConvergenceDays(settings.convergenceDays);
  const candidates: Array<Omit<StrategyRecommendation, "rank">> = [];
  const seenCombinations = new Set<string>();

  for (const buyMarket of markets) {
    const buyId = String(marketId(buyMarket));
    const buyPrices = impactPrices(impactResults.get(buyId));
    if (!buyPrices) continue;
    for (const sellMarket of markets) {
      const sellId = String(marketId(sellMarket));
      if (buyId === sellId || (settings.spotOnlyBuy && sellMarket.kind === "spot")) continue;
      const combinationKey = `${buyId}->${sellId}`;
      if (seenCombinations.has(combinationKey)) continue;
      seenCombinations.add(combinationKey);
      const sellPrices = impactPrices(impactResults.get(sellId));
      if (!sellPrices) continue;

      const gross = (sellPrices.bid - buyPrices.ask) / buyPrices.ask * 100;
      if (!Number.isFinite(gross) || gross < range.minGross || gross > range.maxGross) continue;
      const netReturn = gross - fee;
      candidates.push({
        buy: leg(buyMarket, buyPrices.ask),
        sell: leg(sellMarket, sellPrices.bid),
        gross,
        netReturn,
        annualized: netReturn * 365 / days,
      });
    }
  }

  candidates.sort((first, second) => second.gross - first.gross || first.buy.id.localeCompare(second.buy.id) || first.sell.id.localeCompare(second.sell.id));
  return candidates.slice(0, MAX_STRATEGY_RECOMMENDATIONS).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
