import { describe, expect, test } from "bun:test";
import { binanceFetch } from "../adapters/binance";
import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";
import {
  applyBinanceOpenInterestHydration,
  selectPendingBinanceOpenInterestTargets,
} from "./market";
import { asPerpMarket, asSpotMarket, marketId, type ArbitrageMarket } from "./model";

function perp(overrides: Partial<SearchExchangeRate> = {}): SearchExchangeRate {
  return {
    exchange: "Binance",
    exchangeColor: "yellow",
    symbol: "BTC",
    rawSymbol: "BTCUSDT",
    fundingRate: 0.0001,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 1,
    quoteVolume: 5_000,
    openInterest: 0,
    notionalValue: 5_000,
    oiLoaded: false,
    fundingInterval: 8,
    assetCategory: "crypto",
    ...overrides,
  };
}

function spot(): SpotMarketRow {
  return {
    exchange: "Binance",
    exchangeColor: "yellow",
    pair: "BTC/USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    rawSymbol: "BTCUSDT",
    marketKey: "BTCUSDT",
    midPrice: 100,
    change24h: 1,
    quoteVolume: 5_000,
    baseVolume: 50,
    fetchedAt: 1,
  };
}

describe("Binance open-interest hydration helpers", () => {
  test("targets only pending Binance perps in the matched result set", () => {
    const pending = asPerpMarket(perp());
    const loaded = asPerpMarket(perp({ symbol: "ETH", rawSymbol: "ETHUSDT", oiLoaded: true }));
    const okx = asPerpMarket(perp({ exchange: "OKX", symbol: "SOL", rawSymbol: "SOL-USDT-SWAP" }));
    const binanceSpot = asSpotMarket(spot());
    expect(selectPendingBinanceOpenInterestTargets([pending, loaded, okx, binanceSpot])).toEqual([pending.source]);
    expect(selectPendingBinanceOpenInterestTargets([])).toEqual([]);
  });

  test("replaces the matched placeholder while preserving unrelated rows and stable IDs", () => {
    const pending = asPerpMarket(perp());
    const missing = asPerpMarket(perp({ symbol: "ETH", rawSymbol: "ETHUSDT", quoteVolume: 2_000, notionalValue: 2_000 }));
    const okx = asPerpMarket(perp({ exchange: "OKX", symbol: "SOL", rawSymbol: "SOL-USDT-SWAP" }));
    const binanceSpot = asSpotMarket(spot());
    const universe: ArbitrageMarket[] = [pending, missing, okx, binanceSpot];
    const idsBefore = universe.map(marketId);

    const updated = applyBinanceOpenInterestHydration(universe, new Map([
      ["BTC", { openInterest: 12, notionalValue: 1_200 }],
    ]));

    expect(updated[0]).not.toBe(pending);
    expect(updated[0].source).toMatchObject({ openInterest: 12, notionalValue: 1_200, oiLoaded: true });
    expect(updated[1]).toBe(missing);
    expect(updated[1].source).toMatchObject({ notionalValue: 2_000, oiLoaded: false });
    expect(updated[2]).toBe(okx);
    expect(updated[3]).toBe(binanceSpot);
    expect(updated.map(marketId)).toEqual(idsBefore);
  });

  test("missing or empty hydration entries leave the universe unchanged", () => {
    const pending = asPerpMarket(perp());
    const universe: ArbitrageMarket[] = [pending];
    expect(applyBinanceOpenInterestHydration(universe, new Map())).toBe(universe);
    expect(applyBinanceOpenInterestHydration(universe, new Map([
      ["ETH", { openInterest: 1, notionalValue: 100 }],
    ]))).toBe(universe);
  });

  test("reselects a same-ID pending row after refresh and restores its OI notional", () => {
    const hydratedBeforeRefresh = asPerpMarket(perp({
      openInterest: 12,
      notionalValue: 1_200,
      oiLoaded: true,
    }));
    const pendingAfterRefresh = asPerpMarket(perp({
      openInterest: 0,
      notionalValue: 5_000,
      oiLoaded: false,
    }));
    expect(marketId(pendingAfterRefresh)).toBe(marketId(hydratedBeforeRefresh));
    expect(selectPendingBinanceOpenInterestTargets([hydratedBeforeRefresh])).toEqual([]);

    const targets = selectPendingBinanceOpenInterestTargets([pendingAfterRefresh]);
    expect(targets).toEqual([pendingAfterRefresh.source]);

    const updated = applyBinanceOpenInterestHydration([pendingAfterRefresh], new Map([
      [pendingAfterRefresh.source.symbol, { openInterest: 12, notionalValue: 1_200 }],
    ]));
    expect(updated[0].source).toMatchObject({ openInterest: 12, notionalValue: 1_200, oiLoaded: true });
  });

  test("does not fall back to the proxy after an aborted direct request", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }) as typeof fetch;

    try {
      await expect(binanceFetch("openInterest", "symbol=BTCUSDT", { signal: controller.signal }))
        .rejects.toMatchObject({ name: "AbortError" });
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
