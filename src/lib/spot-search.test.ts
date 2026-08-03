import { describe, expect, test } from "bun:test";
import {
  calculateSpotHistoricalVolatility,
  filterSpotMarkets,
  normalizeSpotMarkets,
  spotMarketIdentity,
  type SpotMarketRow,
} from "./spot-search";

const row: SpotMarketRow = {
  exchange: "Binance", exchangeColor: "yellow", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTCUSDT", marketKey: "BTCUSDT", midPrice: 100, change24h: 1, quoteVolume: 10,
  baseVolume: 1, fetchedAt: 1,
};

describe("spot search contracts", () => {
  test("identity is exchange plus transport market key; filtering covers published market fields but never the exchange name", () => {
    const rows = [row, { ...row, exchange: "OKX" as const, exchangeColor: "emerald", rawSymbol: "ETH-USDC", marketKey: "ETH-USDC", pair: "ETH/USDC", baseAsset: "ETH", quoteAsset: "USDC" }];
    expect(spotMarketIdentity(row)).toBe("Binance:BTCUSDT");
    expect(filterSpotMarkets(rows, "  ")).toEqual(rows);
    expect(filterSpotMarkets(rows, "usdc")).toHaveLength(1);
    expect(filterSpotMarkets(rows, "okx")).toHaveLength(0);
    expect(filterSpotMarkets(rows, "binance")).toHaveLength(0);
  });

  test("uses PURR/USDC transport for PURR and @index transport for other Hyperliquid spot markets, with assetCtxs read by market index (gaps after delistings)", () => {
    const contexts: Array<Record<string, unknown> | undefined> = [];
    contexts[0] = { midPx: "0.1", prevDayPx: "0.1", dayNtlVlm: "100", dayBaseVlm: "1000" };
    contexts[1] = { midPx: "0.01", prevDayPx: "0.02", dayNtlVlm: "5", dayBaseVlm: "500" };
    contexts[107] = { midPx: "20", prevDayPx: "10", dayNtlVlm: "1000", dayBaseVlm: "50" };
    const rows = normalizeSpotMarkets("Hyperliquid", [
      {
        tokens: [{ index: 0, name: "USDC" }, { index: 1, name: "PURR" }, { index: 2, name: "HYPE" }],
        universe: [
          { index: 0, name: "PURR/USDC", tokens: [1, 0] },
          { index: 107, name: "@107", tokens: [2, 0] },
        ],
      },
      contexts,
    ], 123);
    expect(rows[0]).toMatchObject({ pair: "PURR/USDC", rawSymbol: "PURR/USDC", marketKey: "PURR/USDC" });
    expect(rows[1]).toMatchObject({ pair: "HYPE/USDC", rawSymbol: "@107", marketKey: "@107", change24h: 100, quoteVolume: 1000, fetchedAt: 123 });
    expect(rows[1].midPrice).toBe(20);
  });

  test("normalizes documented Bitget field variants", () => {
    const rows = normalizeSpotMarkets("Bitget", { data: [{
      symbol: "BTCUSDT", lastPr: "100", bid1Pr: "99", ask1Pr: "101", change24h: "0.02",
      usdtVolume: "500", baseVolume: "5",
    }] }, 1);
    expect(rows[0]).toMatchObject({ bestBid: 99, bestAsk: 101, change24h: 2, quoteVolume: 500 });
  });

  test("retains Binance U and USD1 quote markets with exact transport decomposition", () => {
    const rows = normalizeSpotMarkets("Binance", [
      { symbol: "BTCU", lastPrice: "100", quoteVolume: "10", volume: "1" },
      { symbol: "BNBU", lastPrice: "20", quoteVolume: "20", volume: "2" },
      { symbol: "ETHUSD1", lastPrice: "5", quoteVolume: "30", volume: "3" },
    ], 1);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ pair: "BTC/U", baseAsset: "BTC", quoteAsset: "U", rawSymbol: "BTCU" });
    expect(rows[1]).toMatchObject({ pair: "BNB/U", baseAsset: "BNB", quoteAsset: "U", rawSymbol: "BNBU" });
    expect(rows[2]).toMatchObject({ pair: "ETH/USD1", baseAsset: "ETH", quoteAsset: "USD1", rawSymbol: "ETHUSD1" });
  });

  test("uses close-to-close sample variance annualized by sqrt(365)", () => {
    const closes = [100, 110, 99].map((close) => ({ close: String(close) }));
    const returns = [Math.log(1.1), Math.log(0.9)];
    const mean = (returns[0] + returns[1]) / 2;
    const expected = Math.sqrt(((returns[0] - mean) ** 2 + (returns[1] - mean) ** 2) / 1) * Math.sqrt(365) * 100;
    expect(calculateSpotHistoricalVolatility(closes)).toBeCloseTo(expected, 12);
    expect(calculateSpotHistoricalVolatility(closes.slice(0, 2))).toBeNull();
  });
});
