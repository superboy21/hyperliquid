import { describe, expect, test } from "bun:test";
import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";
import { applySpotQuoteFilter, DEFAULT_SPOT_QUOTE_FILTER, SPOT_QUOTE_FILTERS } from "./market";
import { asPerpMarket, asSpotMarket, marketId, toTableRow } from "./model";
import { parseArbitrageQuery, searchArbitrageMarkets } from "./query";
import { EMPTY_SELECTION, transitionSelection } from "./selection";

function perp(overrides: Partial<SearchExchangeRate> = {}): SearchExchangeRate {
  return {
    exchange: "Binance", exchangeColor: "yellow", symbol: "BTC", rawSymbol: "BTCUSDT",
    fundingRate: 0.0001, markPrice: 100, indexPrice: 99, lastPrice: 100, change24h: 2,
    quoteVolume: 1_000, openInterest: 20, notionalValue: 2_000, fundingInterval: 8,
    assetCategory: "crypto", ...overrides,
  };
}

function spot(overrides: Partial<SpotMarketRow> = {}): SpotMarketRow {
  return {
    exchange: "OKX", exchangeColor: "emerald", pair: "BTC/USDT", baseAsset: "BTC",
    quoteAsset: "USDT", rawSymbol: "BTC-USDT", marketKey: "BTC-USDT", midPrice: 101,
    change24h: 3, quoteVolume: 500, baseVolume: 5, fetchedAt: 1, ...overrides,
  };
}

describe("unified market model", () => {
  test("IDs are kind/exchange/transport qualified and use the accepted perp preference", () => {
    const perpRaw = asPerpMarket(perp({ rawSymbol: "raw", marketId: 7, symbol: "display" }));
    const perpMarketId = asPerpMarket(perp({ rawSymbol: undefined, marketId: 7, symbol: "display" }));
    const perpSymbol = asPerpMarket(perp({ rawSymbol: undefined, marketId: undefined, symbol: "display" }));
    const spotMarket = asSpotMarket(spot({ marketKey: "transport" }));
    expect(marketId(perpRaw)).toBe("perp:Binance:raw");
    expect(marketId(perpMarketId)).toBe("perp:Binance:7");
    expect(marketId(perpSymbol)).toBe("perp:Binance:display");
    expect(marketId(spotMarket)).toBe("spot:OKX:transport");
  });

  test("spot table projection populates supported cells and never zero-fills perp-only cells", () => {
    const source = spot();
    const row = toTableRow(asSpotMarket(source), {
      historicalVolatility: 0.4,
      topSpread: 0.001,
      impactSpread: 0.002,
    });
    expect(row.market.source).toBe(source);
    expect([row.exchange, row.pair, row.midpoint, row.change24h, row.quoteTurnover24h]).toEqual([
      "OKX", "BTC/USDT", 101, 3, 500,
    ]);
    expect([row.historicalVolatility, row.topSpread, row.impactSpread]).toEqual([0.4, 0.001, 0.002]);
    expect([
      row.indexPrice, row.premium, row.predictedFundingRate, row.openInterestNotional,
      row.latestSettlementRate, row.averageFundingRate2d, row.averageFundingRate7d,
      row.averageFundingRate30d,
    ]).toEqual(Array(8).fill(null));
  });

  test("progressive perp detail BBO drives midpoint/premium and settlement projections", () => {
    const market = asPerpMarket(perp({
      bestBid: 90,
      bestAsk: 110,
      indexPrice: 100,
      lastSettlementRate: 0.01,
      avgFundingRate2d: 0.02,
      avgFundingRate7d: 0.03,
      avgFundingRate30d: 0.04,
    }));
    const row = toTableRow(market, {
      bestBid: 100,
      bestAsk: 102,
      lastSettlementRate: 0.11,
      avgFundingRate2d: 0.12,
      avgFundingRate7d: 0.13,
      avgFundingRate30d: 0.14,
    });
    expect(row.midpoint).toBe(101);
    expect(row.premium).toBeCloseTo(0.01);
    expect([
      row.latestSettlementRate, row.averageFundingRate2d, row.averageFundingRate7d,
      row.averageFundingRate30d,
    ]).toEqual([0.11, 0.12, 0.13, 0.14]);
    expect(toTableRow(market, { bestBid: -1, bestAsk: 102 }).midpoint).toBe(100);
    expect(toTableRow(asPerpMarket(perp({ bestBid: undefined, bestAsk: undefined })))).toMatchObject({ midpoint: null, premium: null });
  });

  test("spot detail BBO refreshes midpoint while perp-only detail cells remain null", () => {
    const row = toTableRow(asSpotMarket(spot()), {
      bestBid: 102,
      bestAsk: 104,
      lastSettlementRate: 0.1,
      avgFundingRate2d: 0.2,
    });
    expect(row.midpoint).toBe(103);
    expect(row.latestSettlementRate).toBeNull();
    expect(row.averageFundingRate2d).toBeNull();
  });

  test("quote options/order/default are exact and filtering applies only to spots", () => {
    expect(SPOT_QUOTE_FILTERS).toEqual(["USDT", "USDC", "U", "USD1", "USD", "all"]);
    expect(DEFAULT_SPOT_QUOTE_FILTER).toBe("USDT");
    const markets = [
      asPerpMarket(perp()),
      asSpotMarket(spot()),
      asSpotMarket(spot({ marketKey: "eth-usdc", pair: "ETH/USDC", baseAsset: "ETH", quoteAsset: "USDC" })),
    ];
    expect(applySpotQuoteFilter(markets).map(marketId)).toEqual([marketId(markets[0]), marketId(markets[1])]);
    expect(applySpotQuoteFilter(markets, "USDC").map(marketId)).toEqual([marketId(markets[0]), marketId(markets[2])]);
  });
});

describe("strict query grammar and matching", () => {
  test("parses compact normal/combo cases, including BTC/USDT as ratio", () => {
    expect(parseArbitrageQuery("  ")).toEqual({ kind: "empty" });
    expect(parseArbitrageQuery("BTC")).toEqual({ kind: "normal", term: "btc" });
    expect(parseArbitrageQuery("BTC/USDT")).toEqual({ kind: "combo", mode: "ratio", firstTerm: "btc", secondTerm: "usdt" });
    expect(parseArbitrageQuery("BTC - ETH")).toEqual({ kind: "combo", mode: "spread", firstTerm: "btc", secondTerm: "eth" });
    for (const invalid of ["-BTC", "BTC/", "BTC-ETH/USDT", "BTC--ETH", "/"]) {
      expect(parseArbitrageQuery(invalid)).toEqual({ kind: "invalid" });
    }
  });

  test("normal matching covers display, transport, and market ID but never the exchange name", () => {
    const markets = [
      asPerpMarket(perp({ symbol: "Bitcoin", rawSymbol: "XBTUSDT", marketId: 71 })),
      asSpotMarket(spot({ pair: "WBTC/USDT", rawSymbol: "WBTC-USDT", marketKey: "spot-42", marketId: 42 })),
    ];
    expect(searchArbitrageMarkets(markets, "bitcoin").markets).toEqual([markets[0]]);
    expect(searchArbitrageMarkets(markets, "xbtusdt").markets).toEqual([markets[0]]);
    expect(searchArbitrageMarkets(markets, "spot-42").markets).toEqual([markets[1]]);
    expect(searchArbitrageMarkets(markets, "OKX").markets).toEqual([]);
    expect(searchArbitrageMarkets(markets, "binance").markets).toEqual([]);
    expect(searchArbitrageMarkets(markets, "").markets).toEqual([]);
  });

  test("combo search is a term-ordered, de-duplicated union", () => {
    const both = asSpotMarket(spot({ pair: "BTC/USDT", marketKey: "both" }));
    const btc = asPerpMarket(perp());
    const usdt = asSpotMarket(spot({ pair: "ETH/USDT", baseAsset: "ETH", marketKey: "usdt" }));
    const found = searchArbitrageMarkets([both, btc, usdt], "BTC/USDT").markets;
    expect(found.map(marketId)).toEqual([marketId(both), marketId(btc), marketId(usdt)]);
  });

  test("kind filter narrows results to spot-only or perp-only, defaulting to all", () => {
    const markets = [
      asPerpMarket(perp({ symbol: "Bitcoin", rawSymbol: "XBTUSDT" })),
      asSpotMarket(spot({ pair: "BTC/USDT" })),
      asSpotMarket(spot({ pair: "ETH/USDT", baseAsset: "ETH", marketKey: "eth" })),
    ];
    expect(searchArbitrageMarkets(markets, "usdt").markets.map(marketId)).toEqual([
      marketId(markets[0]), marketId(markets[1]), marketId(markets[2]),
    ]);
    expect(searchArbitrageMarkets(markets, "usdt", DEFAULT_SPOT_QUOTE_FILTER, "spot").markets.map(marketId)).toEqual([
      marketId(markets[1]), marketId(markets[2]),
    ]);
    expect(searchArbitrageMarkets(markets, "usdt", DEFAULT_SPOT_QUOTE_FILTER, "perp").markets.map(marketId)).toEqual([
      marketId(markets[0]),
    ]);
    expect(searchArbitrageMarkets(markets, "usdt", DEFAULT_SPOT_QUOTE_FILTER, "all").markets.map(marketId)).toEqual([
      marketId(markets[0]), marketId(markets[1]), marketId(markets[2]),
    ]);
  });

  test("excluded exchanges are dropped from normal and combo results, defaulting to none excluded", () => {
    const binancePerp = asPerpMarket(perp({ symbol: "Bitcoin", rawSymbol: "XBTUSDT" }));
    const okxSpot = asSpotMarket(spot({ pair: "BTC/USDT" }));
    const binanceSpot = asSpotMarket(spot({ exchange: "Binance", exchangeColor: "yellow", pair: "ETH/USDT", baseAsset: "ETH", marketKey: "eth" }));
    const markets = [binancePerp, okxSpot, binanceSpot];
    const excludedBinance = new Set<"Binance">(["Binance"]);

    expect(searchArbitrageMarkets(markets, "usdt").markets.map(marketId)).toEqual([
      marketId(binancePerp), marketId(okxSpot), marketId(binanceSpot),
    ]);
    expect(searchArbitrageMarkets(markets, "usdt", DEFAULT_SPOT_QUOTE_FILTER, "all", excludedBinance).markets.map(marketId)).toEqual([
      marketId(okxSpot),
    ]);
    expect(searchArbitrageMarkets(markets, "btc", DEFAULT_SPOT_QUOTE_FILTER, "all", excludedBinance).markets.map(marketId)).toEqual([
      marketId(okxSpot),
    ]);
    expect(searchArbitrageMarkets(markets, "usdt", DEFAULT_SPOT_QUOTE_FILTER, "all", new Set<"Binance" | "OKX">(["Binance", "OKX"])).markets).toEqual([]);
  });
});

describe("ordered selection transition", () => {
  test("click order, promotion, third-click ignore, single mode, and resets are deterministic", () => {
    const first = asPerpMarket(perp());
    const second = asSpotMarket(spot());
    const third = asSpotMarket(spot({ marketKey: "third", pair: "ETH/USDT", baseAsset: "ETH" }));
    const one = transitionSelection(EMPTY_SELECTION, { type: "click", market: first, combo: true });
    const two = transitionSelection(one, { type: "click", market: second, combo: true });
    expect(two).toEqual({ leg1: first, leg2: second });
    expect(transitionSelection(two, { type: "click", market: third, combo: true })).toBe(two);
    expect(transitionSelection(two, { type: "click", market: first, combo: true })).toEqual({ leg1: second, leg2: null });
    expect(transitionSelection(two, { type: "click", market: third, combo: false })).toEqual({ leg1: third, leg2: null });
    expect(transitionSelection(two, { type: "reset", reason: "query" })).toEqual(EMPTY_SELECTION);
    expect(transitionSelection(two, { type: "reset", reason: "quote" })).toEqual(EMPTY_SELECTION);
  });
});
