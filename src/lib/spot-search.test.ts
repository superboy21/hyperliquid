import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  calculateSpotHistoricalVolatility,
  fetchAllSpotMarkets,
  fetchSpotDetail,
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

const bitgetRow: SpotMarketRow = {
  exchange: "Bitget", exchangeColor: "teal", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTCUSDT", marketKey: "BTCUSDT", midPrice: 100, bestBid: 99, bestAsk: 101,
  change24h: 1, quoteVolume: 10, baseVolume: 1, fetchedAt: 1,
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

  test("normalizes Bybit V5 spot tickers, keeping only known-quote markets and decomposing BTCUSDT exactly", () => {
    const rows = normalizeSpotMarkets("Bybit", {
      retCode: 0,
      retMsg: "OK",
      result: { list: [
        { symbol: "BTCUSDT", lastPrice: "100", bid1Price: "99.5", ask1Price: "100.5", price24hPcnt: "0.025", turnover24h: "5000", volume24h: "50" },
        { symbol: "ETHUSDC", lastPrice: "2000", bid1Price: "1999", ask1Price: "2001", price24hPcnt: "-0.01", turnover24h: "3000", volume24h: "1.5" },
        { symbol: "1000PEPEUSDT", lastPrice: "0.01", bid1Price: "0.0099", ask1Price: "0.0101", price24hPcnt: "0.5", turnover24h: "700", volume24h: "70000" },
        { symbol: "NOPEXXX", lastPrice: "1", turnover24h: "1" },
      ] },
    }, 1);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      exchange: "Bybit", exchangeColor: "orange", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
      rawSymbol: "BTCUSDT", marketKey: "BTCUSDT", bestBid: 99.5, bestAsk: 100.5, midPrice: 100,
      change24h: 2.5, quoteVolume: 5000, baseVolume: 50, fetchedAt: 1,
    });
    expect(rows[1]).toMatchObject({ pair: "ETH/USDC", baseAsset: "ETH", quoteAsset: "USDC", change24h: -1 });
    expect(rows[2]).toMatchObject({ pair: "1000PEPE/USDT", baseAsset: "1000PEPE", quoteAsset: "USDT" });
  });

  test("participates in fetchAllSpotMarkets through the direct-first transport", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("api.bybit.com")) {
        return Response.json({ retCode: 0, result: { list: [
          { symbol: "BTCUSDT", lastPrice: "100", bid1Price: "99.5", ask1Price: "100.5", price24hPcnt: "0.025", turnover24h: "5000", volume24h: "50" },
        ] } });
      }
      return Response.json([]);
    });
    const rows = await fetchAllSpotMarkets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exchange: "Bybit", pair: "BTC/USDT", rawSymbol: "BTCUSDT", marketKey: "BTCUSDT" });
  });

  test("reads Bybit best bid/ask from the V5 book envelope for spot detail", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v5/market/kline")) return Response.json({ retCode: 0, result: { list: [] } });
      return Response.json({ retCode: 0, result: { s: "BTCUSDT", b: [["99", "3"]], a: [["101", "3"]] } });
    });
    const detail = await fetchSpotDetail({ ...row, exchange: "Bybit", exchangeColor: "orange", rawSymbol: "BTCUSDT", marketKey: "BTCUSDT" }, undefined);
    expect(detail.bestBid).toBe(99);
    expect(detail.bestAsk).toBe(101);
    expect(detail.topSpread).toBeCloseTo(2, 10);
    expect(detail.historicalVolatility).toBeNull();
  });

  test("uses populated orderbook BBO without requesting Bitget metadata", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/v2/spot/market/orderbook")) return Response.json({ data: { bids: [["99", "1"]], asks: [["101", "1"]] } });
      return Response.json({ data: [] });
    });
    const detail = await fetchSpotDetail(bitgetRow);
    expect(detail).toMatchObject({ bestBid: 99, bestAsk: 101, topSpreadSource: "orderbook" });
    expect(urls.some((url) => url.includes("/api/v3/market/instruments"))).toBe(false);
  });

  test("guards Bitget ticker BBO fallback with an exact reality instrument match", async () => {
    const cases: Array<[string, unknown, boolean]> = [
      ["yes", { data: [{ symbol: "BTCUSDT", isReality: "yes" }] }, true],
      ["no", { data: [{ symbol: "BTCUSDT", isReality: "no" }] }, false],
      ["missing", { data: [{ symbol: "BTCUSDT" }] }, false],
      ["mismatched", { data: [{ symbol: "ETHUSDT", isReality: "yes" }] }, false],
    ];
    for (const [, metadata, shouldFallback] of cases) {
      (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
      spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/v3/market/instruments")) return Response.json(metadata);
        if (url.includes("/api/v2/spot/market/orderbook")) return Response.json({ data: { bids: [], asks: [] } });
        return Response.json({ data: [] });
      });
      const detail = await fetchSpotDetail(bitgetRow);
      expect(detail.topSpreadSource).toBe(shouldFallback ? "ticker-bbo" : null);
      if (shouldFallback) expect(detail.topSpread).toBeCloseTo(2, 10);
      else expect(detail.topSpread).toBeNull();
      expect(detail.bestBid).toBe(shouldFallback ? 99 : undefined);
      expect(detail.bestAsk).toBe(shouldFallback ? 101 : undefined);
    }
  });

  test("treats Bitget metadata failure as best effort", async () => {
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/market/instruments")) throw new Error("metadata unavailable");
      if (url.includes("/api/v2/spot/market/orderbook")) return Response.json({ data: { bids: [], asks: [] } });
      return Response.json({ data: [] });
    });
    await expect(fetchSpotDetail(bitgetRow)).resolves.toMatchObject({ topSpread: null, topSpreadSource: null });
  });

  test("does not use ticker fallback for a non-Bitget empty book", async () => {
    const urls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/v3/depth")) return Response.json({ bids: [], asks: [] });
      return Response.json([]);
    });
    const detail = await fetchSpotDetail(row);
    expect(detail).toMatchObject({ topSpread: null, topSpreadSource: null });
    expect(urls.some((url) => url.includes("/api/v3/market/instruments"))).toBe(false);
  });
});

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
});
