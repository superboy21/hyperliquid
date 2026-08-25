import { describe, expect, test } from "bun:test";
import { buildSpotUpstreamRequest } from "./spot-upstream";

const params = (query: string) => new URLSearchParams(query);

describe("Bybit spot upstream requests", () => {
  test("is allowlisted and builds the bulk spot ticker request", () => {
    const built = buildSpotUpstreamRequest("bybit", params("action=list"));
    expect(typeof built).not.toBe("string");
    if (typeof built !== "string") expect(built.url).toBe("https://api.bybit.com/v5/market/tickers?category=spot");
  });

  test("maps every candle interval to V5 kline values with category=spot and clamps limit to 1000", () => {
    const cases: Array<[string, string]> = [
      ["1m", "1"], ["5m", "5"], ["1h", "60"], ["4h", "240"], ["1d", "D"], ["1w", "W"],
    ];
    for (const [interval, api] of cases) {
      const built = buildSpotUpstreamRequest("bybit", params(`action=candles&symbol=BTCUSDT&interval=${interval}&limit=9999`));
      expect(typeof built).not.toBe("string");
      if (typeof built !== "string") {
        const url = new URL(built.url);
        expect(url.pathname).toBe("/v5/market/kline");
        expect(url.searchParams.get("category")).toBe("spot");
        expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
        expect(url.searchParams.get("interval")).toBe(api);
        expect(url.searchParams.get("limit")).toBe("1000");
      }
    }
  });

  test("maps startTime/endTime to V5 start/end and rejects unknown parameters", () => {
    const built = buildSpotUpstreamRequest("bybit", params("action=candles&symbol=BTCUSDT&interval=1h&limit=100&startTime=1000&endTime=2000"));
    expect(typeof built).not.toBe("string");
    if (typeof built !== "string") {
      const url = new URL(built.url);
      expect(url.searchParams.get("start")).toBe("1000");
      expect(url.searchParams.get("end")).toBe("2000");
    }
    expect(buildSpotUpstreamRequest("bybit", params("action=book&symbol=BTCUSDT&limit=1&evil=true"))).toBe("Unknown or repeated parameter");
  });

  test("builds the spot orderbook request with category=spot and clamps depth to the documented 200 max", () => {
    const built = buildSpotUpstreamRequest("bybit", params("action=book&symbol=BTCUSDT&limit=999"));
    expect(typeof built).not.toBe("string");
    if (typeof built !== "string") {
      const url = new URL(built.url);
      expect(url.pathname).toBe("/v5/market/orderbook");
      expect(url.searchParams.get("category")).toBe("spot");
      expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
      expect(url.searchParams.get("limit")).toBe("200");
    }
  });
});

describe("UTC spot candle mappings", () => {
  test.each([
    ["bitget", "1d", "1Dutc"],
    ["bitget", "1w", "1Wutc"],
    ["okx", "1d", "1Dutc"],
    ["okx", "1w", "1Wutc"],
  ])("maps %s %s to official %s candles", (exchange, interval, expected) => {
    const built = buildSpotUpstreamRequest(exchange, params(`action=candles&symbol=BTCUSDT&interval=${interval}`));
    expect(typeof built).not.toBe("string");
    if (typeof built !== "string") {
      const url = new URL(built.url);
      expect(url.searchParams.get(exchange === "bitget" ? "granularity" : "bar")).toBe(expected);
    }
  });
});

describe("Bitget Spot instrument requests", () => {
  test("injects the SPOT category and forwards only the raw symbol", () => {
    const built = buildSpotUpstreamRequest("bitget", params("action=instrument&symbol=BTCUSDT"));
    expect(typeof built).not.toBe("string");
    if (typeof built !== "string") expect(built.url).toBe("https://api.bitget.com/api/v3/market/instruments?category=SPOT&symbol=BTCUSDT");
  });

  test("rejects instrument requests for other exchanges and malformed parameters", () => {
    expect(buildSpotUpstreamRequest("binance", params("action=instrument&symbol=BTCUSDT"))).toBe("Unknown or missing action");
    expect(buildSpotUpstreamRequest("bitget", params("action=instrument"))).toBe("Missing symbol");
    expect(buildSpotUpstreamRequest("bitget", params("action=instrument&symbol=BTCUSDT&limit=1"))).toBe("Unknown or repeated parameter");
    expect(buildSpotUpstreamRequest("bitget", params("action=instrument&symbol=BTC USDT"))).toBe("Invalid symbol");
  });
});

describe("RPI spot book requests", () => {
  test("routes rpi=1 to the dedicated RPI endpoints per exchange", () => {
    const cases: Array<[string, string]> = [
      ["gateio", "https://api.gateio.ws/api/v4/spot/rpi_order_book?currency_pair=BTC_USDT&limit=5"],
      ["bybit", "https://api.bybit.com/v5/market/rpi_orderbook?category=spot&symbol=BTCUSDT&limit=5"],
      ["okx", "https://www.okx.com/api/v5/market/books-rpi?instId=BTC-USDT&sz=5"],
      ["bitget", "https://api.bitget.com/api/v3/market/rpi-orderbook?category=SPOT&symbol=BTCUSDT&limit=5"],
    ];
    for (const [exchange, expected] of cases) {
      const symbol = exchange === "gateio" ? "BTC_USDT" : exchange === "okx" ? "BTC-USDT" : "BTCUSDT";
      const built = buildSpotUpstreamRequest(exchange, params(`action=book&symbol=${symbol}&limit=5&rpi=1`));
      expect(typeof built).not.toBe("string");
      if (typeof built !== "string") expect(built.url).toBe(expected);
    }
  });

  test("rejects rpi book requests for exchanges without an RPI endpoint", () => {
    expect(buildSpotUpstreamRequest("hyperliquid", params("action=book&symbol=BTC&limit=5&rpi=1"))).toBe("RPI book not supported for this exchange");
    expect(buildSpotUpstreamRequest("lighter", params("action=book&marketId=1&limit=5&rpi=1"))).toBe("RPI book not supported for this exchange");
    expect(buildSpotUpstreamRequest("binance", params("action=book&symbol=BTCUSDT&limit=5&rpi=1"))).toBe("RPI book not supported for this exchange");
  });
});
