import { marketId, type ArbitrageMarket } from "./model";
import type { ParsedArbitrageQuery } from "./query";
import type { OrderedSelection } from "./selection";

export interface StrategyChartOverride {
  buyId: string;
  sellId: string;
  /** Defaults to "ratio"; "spread" renders A − B instead of A / B. */
  mode?: "spread" | "ratio";
}

export type ChartPlan =
  | null
  | { kind: "single"; leg1: ArbitrageMarket }
  | { kind: "combo"; mode: "spread" | "ratio"; leg1: ArbitrageMarket; leg2: ArbitrageMarket; source: "query" | "strategy" };

/** Build the chart legs from the current query/selection, with strategy taking precedence. */
export function createChartPlan(
  query: ParsedArbitrageQuery,
  selection: OrderedSelection,
  strategyOverride: StrategyChartOverride | null,
  markets: readonly ArbitrageMarket[],
): ChartPlan {
  if (strategyOverride !== null) {
    if (strategyOverride.buyId === strategyOverride.sellId) return null;
    const marketsById = new Map(markets.map((market) => [String(marketId(market)), market]));
    const buy = marketsById.get(strategyOverride.buyId);
    const sell = marketsById.get(strategyOverride.sellId);
    if (!buy || !sell) return null;
    return { kind: "combo", mode: strategyOverride.mode === "spread" ? "spread" : "ratio", leg1: buy, leg2: sell, source: "strategy" };
  }

  if (query.kind === "normal") {
    return selection.leg1 ? { kind: "single", leg1: selection.leg1 } : null;
  }
  if (query.kind !== "combo" || !selection.leg1 || !selection.leg2) return null;
  return {
    kind: "combo",
    mode: query.mode,
    leg1: selection.leg1,
    leg2: selection.leg2,
    source: "query",
  };
}
