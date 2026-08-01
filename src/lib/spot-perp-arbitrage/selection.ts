import { marketId, type ArbitrageMarket } from "./model";

export interface OrderedSelection {
  leg1: ArbitrageMarket | null;
  leg2: ArbitrageMarket | null;
}

export type SelectionAction =
  | { type: "click"; market: ArbitrageMarket; combo: boolean }
  | { type: "reset"; reason: "query" | "quote" };

export const EMPTY_SELECTION: OrderedSelection = { leg1: null, leg2: null };

export function transitionSelection(
  state: OrderedSelection,
  action: SelectionAction,
): OrderedSelection {
  if (action.type === "reset") return EMPTY_SELECTION;
  const clickedId = marketId(action.market);

  if (!action.combo) {
    return state.leg1 && marketId(state.leg1) === clickedId
      ? EMPTY_SELECTION
      : { leg1: action.market, leg2: null };
  }

  if (state.leg1 && marketId(state.leg1) === clickedId) {
    return { leg1: state.leg2, leg2: null };
  }
  if (state.leg2 && marketId(state.leg2) === clickedId) {
    return { leg1: state.leg1, leg2: null };
  }
  if (!state.leg1) return { leg1: action.market, leg2: null };
  if (!state.leg2) return { leg1: state.leg1, leg2: action.market };
  return state;
}
