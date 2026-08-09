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
