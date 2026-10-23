import { describe, expect, test } from "bun:test";
import { projectFiveLevels, projectOrderBook, toBookTarget } from "./project";
import { marketId, type ArbitrageMarket } from "../spot-perp-arbitrage/model";
import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";

describe("projectOrderBook", () => {
  test("aggregates prices before taking five and cumulatively sums each side from the best", () => {
    const book = {
      bids: [1, 7, 3, 6, 4, 2, 5].map((price) => ({ price, quantity: 1 })),
      asks: [14, 11, 17, 13, 16, 12, 15].map((price) => ({ price, quantity: 2 })),
    };
    book.bids.push({ price: 7, quantity: 2 });
    book.asks.push({ price: 11, quantity: 3 });
    expect(projectOrderBook(book)).toEqual({
      bids: [7, 6, 5, 4, 3].map((price, i) => ({ price, quantity: i === 0 ? 3 : 1, cumulativeQuantity: i + 3, rank: i + 1 })),
      asks: [11, 12, 13, 14, 15].map((price, i) => ({ price, quantity: i === 0 ? 5 : 2, cumulativeQuantity: i * 2 + 5, rank: i + 1 })),
    });
  });

  test("filters invalid levels without inventing missing levels", () => {
    const projected = projectOrderBook({ bids: [
      { price: NaN, quantity: 1 }, { price: Infinity, quantity: 1 },
      { price: 0, quantity: 1 }, { price: -1, quantity: 1 },
      { price: 10, quantity: NaN }, { price: 10, quantity: Infinity },
      { price: 10, quantity: 0 }, { price: 10, quantity: -2 }, { price: 9, quantity: 0.5 },
    ], asks: [] });
    expect(projected).toEqual({ bids: [{ price: 9, quantity: 0.5, cumulativeQuantity: 0.5, rank: 1 }], asks: [] });
    expect(projectOrderBook({ bids: [], asks: [] })).toEqual({ bids: [], asks: [] });
  });

  test("does not mutate input arrays or their levels", () => {
    const book = { bids: [{ price: 2, quantity: 3 }, { price: 3, quantity: 4 }], asks: [{ price: 5, quantity: 6 }] };
    const copy = structuredClone(book);
    Object.freeze(book); Object.freeze(book.bids); Object.freeze(book.asks);
    for (const level of [...book.bids, ...book.asks]) Object.freeze(level);
    const result = projectOrderBook(book);
    result.bids[0].quantity = 100;
    expect(book).toEqual(copy);
  });

  test("never publishes infinite aggregation or cumulative quantities", () => {
    const result = projectOrderBook({ bids: [{ price: 3, quantity: Number.MAX_VALUE }, { price: 3, quantity: Number.MAX_VALUE },
      { price: 2, quantity: Number.MAX_VALUE }, { price: 1, quantity: Number.MAX_VALUE }], asks: [] });
    expect(result.bids).toEqual([{ price: 2, quantity: Number.MAX_VALUE, cumulativeQuantity: Number.MAX_VALUE, rank: 1 }]);
  });

  test("projectFiveLevels is the same five-price projection contract", () => {
    expect(projectFiveLevels).toBe(projectOrderBook);
    expect(projectFiveLevels({ bids: [], asks: [] })).toEqual({ bids: [], asks: [] });
  });
});

const SPOT: SpotMarketRow = { exchange: "Gate.io", exchangeColor: "red", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTC_USDT", marketKey: "BTC_USDT", midPrice: 100, change24h: 0, quoteVolume: 0, baseVolume: 0, fetchedAt: 0 };
const PERP: SearchExchangeRate = { exchange: "Gate.io", exchangeColor: "red", symbol: "BTC", rawSymbol: "BTC_USDT",
  fundingRate: 0, predictedFundingRate: null, markPrice: 100, indexPrice: 100, lastPrice: 100, change24h: 0,
  quoteVolume: 0, openInterest: 0, notionalValue: 0, fundingInterval: 28800, assetCategory: "Crypto" };

describe("toBookTarget", () => {
  test("retains the native symbol and uses the existing kind-qualified market identity", () => {
    const spot: ArbitrageMarket = { kind: "spot", source: SPOT };
    const perp: ArbitrageMarket = { kind: "perp", source: PERP };
    expect(toBookTarget(spot)).toEqual({ id: marketId(spot), exchange: "Gate.io", kind: "spot", rawSymbol: "BTC_USDT", baseAsset: "BTC", quoteAsset: "USDT" });
    expect(toBookTarget(perp)).toEqual({ id: marketId(perp), exchange: "Gate.io", kind: "perp", rawSymbol: "BTC_USDT", baseAsset: "BTC", quoteAsset: "USDT" });
    expect(toBookTarget(spot)?.id).not.toBe(toBookTarget(perp)?.id);
    expect(toBookTarget(spot)?.exchange).not.toBe("gateio");
  });

  test("supports native per-exchange perp symbols and does not append quote twice", () => {
    for (const [exchange, rawSymbol, base, quote] of [
      ["Binance", "1000PEPEUSDT", "1000PEPE", "USDT"], ["OKX", "BTC-USDC-SWAP", "BTC", "USDC"],
      ["Bitget", "SKHYNIXUSDT", "SKHYNIX", "USDT"], ["Bybit", "BTCUSDT", "BTC", "USDT"],
    ] as const) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange, rawSymbol } })).toMatchObject({ exchange, rawSymbol, baseAsset: base, quoteAsset: quote });
    }
    for (const [exchange, symbol, rawSymbol] of [
      ["Binance", "BTC", "BTCUSDT"], ["Binance", "BTCUSDT", "BTCUSDT"], ["Gate.io", "BTC", "BTC_USDT"],
      ["Gate.io", "BTC_USDT", "BTC_USDT"], ["OKX", "BTC", "BTC-USDT-SWAP"], ["OKX", "BTC-USDT-SWAP", "BTC-USDT-SWAP"],
    ] as const) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange, symbol, rawSymbol: undefined } })?.rawSymbol).toBe(rawSymbol);
    }
  });

  test("requires rawSymbol for Bitget and Bybit on both market kinds", () => {
    for (const exchange of ["Bitget", "Bybit"] as const) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange, rawSymbol: undefined } })).toBeNull();
      expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange, rawSymbol: " " } })).toBeNull();
      expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange, rawSymbol: "" } })).toBeNull();
    }
  });

  test("Lighter keeps marketId zero and never resolves an absent ID from a name", () => {
    const source = { ...PERP, exchange: "Lighter" as const, rawSymbol: "BTC", marketId: 0 };
    const market: ArbitrageMarket = { kind: "perp", source };
    expect(toBookTarget(market)).toMatchObject({ id: marketId(market), rawSymbol: "BTC", marketId: 0, baseAsset: "BTC", quoteAsset: "USDC" });
    expect(toBookTarget({ kind: "perp", source: { ...source, rawSymbol: undefined } })).toMatchObject({ marketId: 0, rawSymbol: "BTC" });
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange: "Lighter", marketId: 0 } })?.marketId).toBe(0);
    for (const marketId of [undefined, -1, NaN, 0.5]) {
      expect(toBookTarget({ kind: "perp", source: { ...source, marketId } })).toBeNull();
    }
  });

  test("preserves HIP3 transport namespaces and Hyperliquid spot @indices", () => {
    expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange: "Hyperliquid", rawSymbol: "xyz:NVDA", symbol: "NVDA" } }))
      .toMatchObject({ rawSymbol: "xyz:NVDA", baseAsset: "NVDA", quoteAsset: "USDC" });
    expect(toBookTarget({ kind: "perp", source: { ...PERP, exchange: "Hyperliquid", rawSymbol: undefined, symbol: "xyz:NVDA" } })?.rawSymbol).toBe("xyz:NVDA");
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange: "Hyperliquid", rawSymbol: "@107", quoteAsset: "USDC" } }))
      .toMatchObject({ rawSymbol: "@107", baseAsset: "BTC", quoteAsset: "USDC" });
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange: "Hyperliquid", rawSymbol: "" } })).toBeNull();
  });

  test("uses explicit spot assets for safe fallbacks and preserves the Reality flag", () => {
    for (const [exchange, rawSymbol] of [["Gate.io", "BTC_USDT"], ["Binance", "BTCUSDT"], ["OKX", "BTC-USDT"]] as const) {
      expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange, rawSymbol: "" } })?.rawSymbol).toBe(rawSymbol);
    }
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange: "Bitget", rawSymbol: "RBTCUSDT", isRealityToken: true } })?.isRealityToken).toBe(true);
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, baseAsset: "" } })).toBeNull();
    expect(toBookTarget({ kind: "spot", source: { ...SPOT, exchange: "gateio" as SpotMarketRow["exchange"] } })).toBeNull();
  });

  test("explicitly separated quotes accept any USD-pegged name", () => {
    // A separator states the boundary, so unmapped-but-USD names resolve too.
    for (const [rawSymbol, base, quote] of [
      ["BTC_USDD", "BTC", "USDD"], ["BTC-IBUSD", "BTC", "IBUSD"], ["ETH/USD1", "ETH", "USD1"],
      ["BTC_FDUSD", "BTC", "FDUSD"], ["SOL_husd", "SOL", "husd"], ["BTC-USDE", "BTC", "USDE"],
    ] as const) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol } }))
        .toMatchObject({ rawSymbol, baseAsset: base, quoteAsset: quote });
    }
  });

  test("a separated pair with a non-USD quote is not re-split as a contiguous symbol", () => {
    // BTC_BTC must not become BTCB/BTC or silently fall back to USDT.
    for (const rawSymbol of ["BTC_BTC", "BTC-ETH", "ETH_EUR", "BTC/JPY"]) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol } })).toBeNull();
    }
  });

  test("contiguous symbols only strip a known USD quote and never invent a split", () => {
    for (const [rawSymbol, base, quote] of [
      ["BTCFDUSD", "BTC", "FDUSD"], ["BTCUSDT", "BTC", "USDT"], ["ETHUSDC", "ETH", "USDC"],
      ["1000PEPEUSDT", "1000PEPE", "USDT"], ["BTCUSDE", "BTC", "USDE"],
    ] as const) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol } }))
        .toMatchObject({ baseAsset: base, quoteAsset: quote });
    }
    // No recognised whole quote suffix: stay conservative instead of guessing.
    for (const rawSymbol of ["BTCUSDD", "BTCEUR", "WBTC", "USDT"]) {
      expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol } })).toBeNull();
    }
  });

  test("a base asset containing USD never lends its quote eligibility", () => {
    // USD is the base, EUR the quote: the pair is not USD-quoted.
    expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol: "USD_EUR" } })).toBeNull();
    expect(toBookTarget({ kind: "perp", source: { ...PERP, rawSymbol: "USDTBTC" } })).toBeNull();
  });
});
