import { DEFAULT_IMPACT_NOTIONAL, type ImpactSpreadDetailResult } from "../impact-price";
import { toAnnualizedRate } from "../types";
import { marketDisplaySymbol, marketId, type ArbitrageMarket } from "./model";

export interface StrategySettings {
  impactNotional: number;
  minGross: number;
  maxGross: number;
  totalFee: number;
  spotOnlyBuy: boolean;
  convergenceDays: number;
  recommendationLimit: StrategyRecommendationLimit;
}

export interface StrategyDraftSettings {
  minGross: string;
  maxGross: string;
  totalFee: string;
  spotOnlyBuy: boolean;
  convergenceDays: string;
}

/** Per-leg funding rate sources, mirroring the search result table's funding columns. */
export interface StrategyLegFunding {
  latestSettlementRate: number | null;
  predictedFundingRate: number | null;
  averageFundingRate2d: number | null;
  averageFundingRate7d: number | null;
  averageFundingRate30d: number | null;
}

/** Which funding rate source feeds the portfolio funding rate column. */
export type FundingRateMode = "average2d" | "latest" | "predicted" | "average7d" | "average30d";

export const FUNDING_RATE_MODE_OPTIONS: readonly { value: FundingRateMode; label: string }[] = [
  { value: "average2d", label: "平均费率（2天）" },
  { value: "latest", label: "最新结算费率" },
  { value: "predicted", label: "预测费率" },
  { value: "average7d", label: "平均费率（7天）" },
  { value: "average30d", label: "平均费率（30天）" },
];

export const DEFAULT_FUNDING_RATE_MODE: FundingRateMode = "average2d";

export interface StrategyLeg {
  id: string;
  exchange: string;
  symbol: string;
  kind: ArbitrageMarket["kind"];
  price: number;
  /** Settlement interval (seconds) used to annualize this leg's funding rate; null for spot. */
  fundingIntervalSeconds?: number | null;
  /** Funding rates per mode; spot legs carry nulls and are treated as 0 by callers. */
  funding?: StrategyLegFunding;
  /** Bid-ask spread (percent) at the current impact value, from the search result table. */
  impactSpread?: number | null;
  /** Best bid-ask spread (percent) from the search result table. */
  topSpread?: number | null;
}

export interface StrategyRecommendation {
  rank: number;
  buy: StrategyLeg;
  sell: StrategyLeg;
  gross: number;
  netReturn: number;
  usdReturn: number;
  annualized: number;
}

export const STRATEGY_RECOMMENDATION_LIMITS = [3, 5, 7, 10, "all"] as const;
export type StrategyRecommendationLimit = typeof STRATEGY_RECOMMENDATION_LIMITS[number];

export const DEFAULT_STRATEGY_SETTINGS: StrategySettings = {
  impactNotional: DEFAULT_IMPACT_NOTIONAL,
  minGross: 0.2,
  maxGross: 1.5,
  totalFee: 0.1,
  spotOnlyBuy: true,
  convergenceDays: 3,
  recommendationLimit: 5,
};

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
  recommendationLimit: StrategyRecommendationLimit = DEFAULT_STRATEGY_SETTINGS.recommendationLimit,
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
    recommendationLimit,
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

const EMPTY_LEG_FUNDING: StrategyLegFunding = {
  latestSettlementRate: null,
  predictedFundingRate: null,
  averageFundingRate2d: null,
  averageFundingRate7d: null,
  averageFundingRate30d: null,
};

/**
 * Lighter funding history reports settled 1h rates in percentage points
 * (e.g. 0.0123 = 0.0123% per hour), while latest/predicted funding is stored
 * as an 8h-equivalent fraction. Dividing by 100/8 converts the percentage
 * points to that shared 8h-equivalent scale (mirrors lighter.ts / 12.5).
 */
const LIGHTER_PERCENT_TO_8H_SCALE = 12.5;

function finiteRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function legFundingFromSource(market: ArbitrageMarket): StrategyLegFunding {
  if (market.kind === "spot") return EMPTY_LEG_FUNDING;
  const source = market.source;
  return {
    latestSettlementRate: finiteRate(source.lastSettlementRate),
    predictedFundingRate: finiteRate(source.fundingRate),
    averageFundingRate2d: finiteRate(source.avgFundingRate2d),
    averageFundingRate7d: finiteRate(source.avgFundingRate7d),
    averageFundingRate30d: finiteRate(source.avgFundingRate30d),
  };
}

function leg(
  market: ArbitrageMarket,
  price: number,
  fundingByMarket?: ReadonlyMap<string, StrategyLegFunding>,
  impactSpreadByMarket?: ReadonlyMap<string, number | null>,
  topSpreadByMarket?: ReadonlyMap<string, number | null>,
): StrategyLeg {
  const id = String(marketId(market));
  return {
    id,
    exchange: market.source.exchange,
    symbol: marketDisplaySymbol(market),
    kind: market.kind,
    price,
    fundingIntervalSeconds: market.kind === "perp" ? market.source.fundingInterval : null,
    funding: fundingByMarket?.get(id) ?? legFundingFromSource(market),
    impactSpread: impactSpreadByMarket?.get(id) ?? null,
    topSpread: topSpreadByMarket?.get(id) ?? null,
  };
}

/**
 * Funding rate of one leg under the selected mode, normalized to the shared
 * 8h-equivalent fraction scale used by the search result table. Spot legs
 * always contribute 0; a perp leg whose data is unavailable returns null.
 * Lighter average rates are percentage points and get converted (/ 12.5).
 */
export function legFundingRateValue(leg: StrategyLeg, mode: FundingRateMode): number | null {
  if (leg.kind === "spot") return 0;
  const funding = leg.funding;
  if (funding === undefined) return null;
  let value: number | null;
  switch (mode) {
    case "latest": value = funding.latestSettlementRate; break;
    case "predicted": value = funding.predictedFundingRate; break;
    case "average7d": value = funding.averageFundingRate7d; break;
    case "average30d": value = funding.averageFundingRate30d; break;
    case "average2d": value = funding.averageFundingRate2d; break;
  }
  if (value === null) return null;
  const isLighterAverage = leg.exchange === "Lighter"
    && (mode === "average2d" || mode === "average7d" || mode === "average30d");
  return isLighterAverage ? value / LIGHTER_PERCENT_TO_8H_SCALE : value;
}

/** 组合资金费率 = 买入腿资金费率 − 卖出腿资金费率；任一条腿数据缺失时为 null。 */
export function comboFundingRate(buy: StrategyLeg, sell: StrategyLeg, mode: FundingRateMode): number | null {
  const buyRate = legFundingRateValue(buy, mode);
  const sellRate = legFundingRateValue(sell, mode);
  if (buyRate === null || sellRate === null) return null;
  return buyRate - sellRate;
}

/** Which bid-ask spread feeds the impact cost column. */
export type ImpactCostMode = "impact" | "top";

export const IMPACT_COST_MODE_OPTIONS: readonly { value: ImpactCostMode; label: string }[] = [
  { value: "impact", label: "Impact" },
  { value: "top", label: "Top" },
];

export const DEFAULT_IMPACT_COST_MODE: ImpactCostMode = "impact";

/** 冲击成本 = 买入腿买卖价差 + 卖出腿买卖价差（百分数）；mode 选择 impact（默认）或 top 盘口价差，任一条腿缺失时为 null。 */
export function comboImpactCost(buy: StrategyLeg, sell: StrategyLeg, mode: ImpactCostMode = DEFAULT_IMPACT_COST_MODE): number | null {
  const buySpread = mode === "impact" ? buy.impactSpread : buy.topSpread;
  const sellSpread = mode === "impact" ? sell.impactSpread : sell.topSpread;
  if (buySpread === null || buySpread === undefined || sellSpread === null || sellSpread === undefined) return null;
  return buySpread + sellSpread;
}

/** Annualized percent of one leg's funding rate (spot = 0; Lighter feeds an 8h-equivalent rate). */
export function legAnnualizedFundingPercent(leg: StrategyLeg, rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  if (leg.kind === "spot") return 0;
  const interval = leg.exchange === "Lighter" ? 8 * 3600 : leg.fundingIntervalSeconds;
  if (interval === null || interval === undefined || !Number.isFinite(interval) || interval <= 0) return null;
  return toAnnualizedRate(rate, interval);
}

/** Enumerate executable cross-market directions, rank by gross spread, and apply the configured result limit. */
export function computeStrategyRecommendations(
  markets: readonly ArbitrageMarket[],
  impactResults: ReadonlyMap<string, ImpactSpreadDetailResult>,
  settings: StrategySettings,
  fundingByMarket?: ReadonlyMap<string, StrategyLegFunding>,
  impactSpreadByMarket?: ReadonlyMap<string, number | null>,
  topSpreadByMarket?: ReadonlyMap<string, number | null>,
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
        buy: leg(buyMarket, buyPrices.ask, fundingByMarket, impactSpreadByMarket, topSpreadByMarket),
        sell: leg(sellMarket, sellPrices.bid, fundingByMarket, impactSpreadByMarket, topSpreadByMarket),
        gross,
        netReturn,
        usdReturn: settings.impactNotional * netReturn / 100,
        annualized: netReturn * 365 / days,
      });
    }
  }

  candidates.sort((first, second) => second.gross - first.gross || first.buy.id.localeCompare(second.buy.id) || first.sell.id.localeCompare(second.sell.id));
  const recommendationLimit = settings.recommendationLimit ?? DEFAULT_STRATEGY_SETTINGS.recommendationLimit;
  const limitedCandidates = recommendationLimit === "all"
    ? candidates
    : candidates.slice(0, recommendationLimit);
  return limitedCandidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
