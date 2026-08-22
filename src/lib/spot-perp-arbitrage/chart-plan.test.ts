import { describe, expect, test } from "bun:test";
import { asPerpMarket, marketId, type ArbitrageMarket } from "./model";
import type { OrderedSelection } from "./selection";
import { createChartPlan } from "./chart-plan";

function perp(exchange: "Binance" | "OKX" | "Bybit", symbol: string): ArbitrageMarket {
  return asPerpMarket({
    exchange,
    exchangeColor: "yellow",
    symbol,
    rawSymbol: `${symbol}USDT`,
    fundingRate: 0,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 0,
    openInterest: 0,
    notionalValue: 0,
    fundingInterval: 8 * 3600,
    assetCategory: "Crypto",
  });
}

function selection(leg1: ArbitrageMarket | null, leg2: ArbitrageMarket | null = null): OrderedSelection {
  return { leg1, leg2 };
}

describe("chart plan", () => {
  const btc = perp("Binance", "BTC");
  const eth = perp("OKX", "ETH");
  const markets = [btc, eth];

  test("builds a normal-query single plan", () => {
    expect(createChartPlan({ kind: "normal", term: "btc" }, selection(btc), null, markets)).toEqual({
      kind: "single",
      leg1: btc,
    });
  });

  test("builds spread and ratio query combo plans", () => {
    const spread = createChartPlan(
      { kind: "combo", mode: "spread", firstTerm: "btc", secondTerm: "eth" },
      selection(btc, eth),
      null,
      markets,
    );
    const ratio = createChartPlan(
      { kind: "combo", mode: "ratio", firstTerm: "btc", secondTerm: "eth" },
      selection(btc, eth),
      null,
      markets,
    );
    expect(spread).toMatchObject({ kind: "combo", mode: "spread", leg1: btc, leg2: eth, source: "query" });
    expect(ratio).toMatchObject({ kind: "combo", mode: "ratio", leg1: btc, leg2: eth, source: "query" });
  });

  test("strategy override wins over normal and spread queries, forcing buy then sell ratio legs", () => {
    const override = { buyId: String(marketId(eth)), sellId: String(marketId(btc)) };
    const normalPlan = createChartPlan({ kind: "normal", term: "btc" }, selection(btc), override, markets);
    const spreadPlan = createChartPlan(
      { kind: "combo", mode: "spread", firstTerm: "btc", secondTerm: "eth" },
      selection(btc, eth),
      override,
      markets,
    );

    expect(normalPlan).toMatchObject({ kind: "combo", mode: "ratio", leg1: eth, leg2: btc, source: "strategy" });
    expect(spreadPlan).toMatchObject({ kind: "combo", mode: "ratio", leg1: eth, leg2: btc, source: "strategy" });
  });

  test("strategy override can switch to an A − B spread chart while keeping buy/sell legs", () => {
    const override = { buyId: String(marketId(eth)), sellId: String(marketId(btc)), mode: "spread" as const };
    const plan = createChartPlan({ kind: "normal", term: "btc" }, selection(btc), override, markets);

    expect(plan).toMatchObject({ kind: "combo", mode: "spread", leg1: eth, leg2: btc, source: "strategy" });
  });

  test("returns null for stale, missing, or same-ID overrides", () => {
    const btcId = String(marketId(btc));
    const ethId = String(marketId(eth));
    const query = { kind: "normal", term: "btc" } as const;

    expect(createChartPlan(query, selection(btc), { buyId: "stale", sellId: ethId }, markets)).toBeNull();
    expect(createChartPlan(query, selection(btc), { buyId: btcId, sellId: "missing" }, markets)).toBeNull();
    expect(createChartPlan(query, selection(btc), { buyId: btcId, sellId: btcId }, markets)).toBeNull();
  });

  test("returns null for empty, invalid, or incomplete query selections", () => {
    expect(createChartPlan({ kind: "empty" }, selection(btc), null, markets)).toBeNull();
    expect(createChartPlan({ kind: "invalid" }, selection(btc, eth), null, markets)).toBeNull();
    expect(createChartPlan({ kind: "combo", mode: "ratio", firstTerm: "btc", secondTerm: "eth" }, selection(btc), null, markets)).toBeNull();
    expect(createChartPlan({ kind: "normal", term: "btc" }, selection(null), null, markets)).toBeNull();
  });
});
