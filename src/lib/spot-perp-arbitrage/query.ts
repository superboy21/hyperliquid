import { applySpotQuoteFilter, DEFAULT_SPOT_QUOTE_FILTER, type SpotQuoteFilter } from "./market";
import { marketId, type ArbitrageMarket } from "./model";

export type ParsedArbitrageQuery =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "normal"; term: string }
  | { kind: "combo"; mode: "spread" | "ratio"; firstTerm: string; secondTerm: string };

export function parseArbitrageQuery(input: string): ParsedArbitrageQuery {
  const value = input.trim();
  if (!value) return { kind: "empty" };

  const operators = [...value].filter((character) => character === "-" || character === "/");
  if (operators.length === 0) return { kind: "normal", term: value.toLowerCase() };
  if (operators.length !== 1) return { kind: "invalid" };

  const operator = operators[0];
  const index = value.indexOf(operator);
  const firstTerm = value.slice(0, index).trim().toLowerCase();
  const secondTerm = value.slice(index + 1).trim().toLowerCase();
  if (!firstTerm || !secondTerm) return { kind: "invalid" };
  return {
    kind: "combo",
    mode: operator === "-" ? "spread" : "ratio",
    firstTerm,
    secondTerm,
  };
}

function identifiers(market: ArbitrageMarket): string[] {
  if (market.kind === "perp") {
    const source = market.source;
    return [source.exchange, source.symbol, source.rawSymbol ?? "", source.marketId?.toString() ?? ""];
  }
  const source = market.source;
  return [
    source.exchange,
    source.pair,
    source.baseAsset,
    source.quoteAsset,
    source.rawSymbol,
    source.marketKey,
    source.marketId?.toString() ?? "",
  ];
}

export function marketMatches(market: ArbitrageMarket, term: string): boolean {
  const needle = term.trim().toLowerCase();
  return needle.length > 0 && identifiers(market).some((value) => value.toLowerCase().includes(needle));
}

export interface MarketSearchResult {
  query: ParsedArbitrageQuery;
  markets: ArbitrageMarket[];
}

export function searchArbitrageMarkets(
  markets: readonly ArbitrageMarket[],
  input: string,
  quote: SpotQuoteFilter = DEFAULT_SPOT_QUOTE_FILTER,
): MarketSearchResult {
  const query = parseArbitrageQuery(input);
  if (query.kind === "empty" || query.kind === "invalid") return { query, markets: [] };
  const eligible = applySpotQuoteFilter(markets, quote);
  if (query.kind === "normal") {
    return { query, markets: eligible.filter((market) => marketMatches(market, query.term)) };
  }

  const result: ArbitrageMarket[] = [];
  const seen = new Set<string>();
  for (const term of [query.firstTerm, query.secondTerm]) {
    for (const market of eligible) {
      const id = marketId(market);
      if (marketMatches(market, term) && !seen.has(id)) {
        seen.add(id);
        result.push(market);
      }
    }
  }
  return { query, markets: result };
}
