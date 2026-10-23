import { afterEach, describe, expect, it, mock } from "bun:test";
import { buildBitgetUrl } from "../adapters/bitget";
import { buildBybitUrl } from "../adapters/bybit";
import { createOrderBookRestFetcher, fetchOrderBookRest } from "./rest";
import { clearBookQuantityMultiplierCache } from "./metadata";
import { cacheGateMultipliers, clearGateMultiplierCache } from "../gateio";

const target = (exchange: "Hyperliquid" | "Gate.io" | "Binance" | "Lighter" | "OKX" | "Bitget" | "Bybit", kind: "spot" | "perp" = "spot", rawSymbol = "BTCUSDT") => ({ id: "BTC", exchange, kind, rawSymbol, baseAsset: "BTC", quoteAsset: "USDT" });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mock.restore(); clearBookQuantityMultiplierCache(); clearGateMultiplierCache(); });

describe("fetchOrderBookRest", () => {
  it("normalizes valid spot depth and preserves empty one-sided books", async () => {
    globalThis.fetch = mock(async () => Response.json({ lastUpdateId: 42, E: 1234, bids: [["10", "2"]], asks: [] }));
    const frame = await fetchOrderBookRest(target("Binance"), { bookMode: "normal" });
    expect(frame.book.bids).toEqual([{ price: 10, quantity: 2 }]);
    expect(frame.book.asks).toEqual([]);
    expect(frame.exchangeTimeMs).toBe(1234);
    expect(frame.sequence).toBe("42");
    expect(frame.source.transport).toBe("rest");
  });

  it("rejects unsupported RPI without falling back", async () => {
    const request = mock(() => Promise.resolve(Response.json({}))); globalThis.fetch = request;
    await expect(fetchOrderBookRest(target("Binance"), { bookMode: "rpi" })).rejects.toMatchObject({ code: "unsupported" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects Hyperliquid spot RPI before making a request", async () => {
    const request = mock(() => Promise.resolve(Response.json({ levels: [[], []] })));
    globalThis.fetch = request;
    await expect(fetchOrderBookRest(target("Hyperliquid"), { bookMode: "rpi" })).rejects.toMatchObject({ code: "unsupported" });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects error envelopes rather than treating them as empty live books", async () => {
    globalThis.fetch = mock(async () => Response.json({ code: "-1", msg: "error" }));
    await expect(fetchOrderBookRest(target("OKX"), { bookMode: "normal" })).rejects.toMatchObject({ code: "invalid-payload" });
  });

  it("honors an already-aborted signal and preserves its reason", async () => {
    const controller = new AbortController(); controller.abort(new Error("stop"));
    await expect(fetchOrderBookRest(target("Binance"), { bookMode: "rpi", signal: controller.signal })).rejects.toThrow("stop");
  });

  it("uses Hyperliquid spot l2Book levels", async () => {
    globalThis.fetch = mock(async () => Response.json({ levels: [[{ px: "10", sz: "3" }], [{ px: "11", sz: "4" }]] }));
    const frame = await fetchOrderBookRest(target("Hyperliquid"), { bookMode: "normal" });
    expect(frame.book.bids[0]?.quantity).toBe(3);
    expect(frame.book.asks[0]?.quantity).toBe(4);
  });

  it.each([
    ["Bybit", "https://api.bybit.com/v5/market/rpi_orderbook", { retCode: 0, result: { b: [["10", "2", "3"]], a: [["11", "4", "5"]] } }],
    ["Bitget", "https://api.bitget.com/api/v3/market/rpi-orderbook", { code: "00000", data: { b: [["10", "2", "3"]], a: [["11", "4", "5"]] } }],
  ] as const)("combines RPI split quantities for %s spot", async (exchange, expectedUrl, body) => {
    let requested = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { requested = String(input); return Response.json(body); });
    const frame = await fetchOrderBookRest(target(exchange), { bookMode: "rpi" });
    expect(requested).toContain(expectedUrl);
    expect(frame.book.bids[0]?.quantity).toBe(5);
    expect(frame.book.asks[0]?.quantity).toBe(9);
  });

  it("fetches Bitget reality tokens from real V3 depth", async () => {
    let requested = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { requested = String(input); return Response.json({ code: "00000", data: { b: [["10", "3"]], a: [["11", "2"]] } }); });
    const frame = await fetchOrderBookRest({ ...target("Bitget"), isRealityToken: true }, { bookMode: "normal" });
    expect(requested).toContain("/api/v3/market/orderbook");
    expect(frame.book.bids[0]?.quantity).toBe(3);
  });

  it.each(["normal", "rpi"] as const)("parses Gate spot %s book payloads", async (bookMode) => {
    globalThis.fetch = mock(async () => Response.json({ id: 123, current: 1_700_000_000_000, bids: [["10", "2"]], asks: [["11", "3"]] }));
    const frame = await fetchOrderBookRest(target("Gate.io"), { bookMode });
    expect(frame.book.bids[0]?.quantity).toBe(2);
    expect(frame.sequence).toBe("123");
    expect(frame.exchangeTimeMs).toBe(1_700_000_000_000);
  });

  it.each(["normal", "rpi"] as const)("applies Gate quanto multiplier to %s perpetual book quantities", async (bookMode) => {
    cacheGateMultipliers([{ contract: "BTC_USDT", quanto_multiplier: "0.01" }]);
    let url = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { url = String(input); return Response.json({ id: 8, current: 1_700_000_000, bids: [{ p: "10", s: 200 }], asks: [{ p: "11", s: 300 }] }); });
    const frame = await fetchOrderBookRest(target("Gate.io", "perp", "BTC_USDT"), { bookMode });
    expect(frame.book.bids[0]?.quantity).toBe(2);
    expect(frame.book.asks[0]?.quantity).toBe(3);
    expect(frame.exchangeTimeMs).toBe(1_700_000_000_000);
    expect(url).toContain(bookMode === "rpi" ? "/futures/usdt/rpi_order_book" : "/futures/usdt/order_book");
  });

  it("uses OKX public market/books REST URL rather than a malformed versioned endpoint", async () => {
    let requested = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("public/instruments")) return Response.json({ code: "0", data: [{ instId: "BTC-USDT-SWAP", ctVal: "1", ctValCcy: "BTC", ctType: "linear" }] });
      requested = url;
      return Response.json({ code: "0", data: [{ bids: [["10", "2"]], asks: [["11", "3"]], ts: "1234", seqId: "7" }] });
    });
    const frame = await fetchOrderBookRest(target("OKX", "perp", "BTC-USDT-SWAP"), { bookMode: "normal" });
    expect(requested).toContain("https://www.okx.com/api/v5/market/books?");
    expect(requested).toContain("instId=BTC-USDT");
    expect(frame.source.route).toBe("/api/v5/market/books");
  });

  it("rejects Lighter without a numeric market id", async () => {
    await expect(fetchOrderBookRest(target("Lighter"), { bookMode: "normal" })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("accepts Lighter market id zero and aggregates same-price orders", async () => {
    let url = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => { url = String(input); return Response.json({ bids: [["10", "2"], ["10", "3"]], asks: [["11", "4"], ["11", "5"]], block_height: 99 }); });
    const frame = await fetchOrderBookRest({ ...target("Lighter"), marketId: 0 }, { bookMode: "normal" });
    expect(url).toContain("market_id=0");
    expect(frame.book.bids).toEqual([{ price: 10, quantity: 5 }]);
    expect(frame.book.asks).toEqual([{ price: 11, quantity: 9 }]);
  });

  it("maps perp adapter baseQty and preserves mode-specific Bitget/Bybit depth", async () => {
    for (const [exchange, mode, expectedLimit] of [
      ["Bitget", "normal", 100], ["Bitget", "rpi", 100],
      ["Bybit", "normal", 100], ["Bybit", "rpi", 50],
    ] as const) {
      let invoked = false;
      const fetcher = createOrderBookRestFetcher({
        fetchBitgetOrderBook: async (_symbol, limit, _signal, _request, modeArg) => {
          if (exchange !== "Bitget") throw new Error("unexpected Bitget call");
          invoked = true; expect(limit).toBe(expectedLimit); expect(modeArg).toBe(mode);
          return { bids: [{ price: 10, baseQty: 5 }], asks: [{ price: 11, baseQty: 6 }] };
        },
        fetchBybitOrderBook: async (_symbol, limit, _signal, _request, modeArg) => {
          if (exchange !== "Bybit") throw new Error("unexpected Bybit call");
          invoked = true; expect(limit).toBe(expectedLimit); expect(modeArg).toBe(mode);
          return { bids: [{ price: 10, baseQty: 5 }], asks: [{ price: 11, baseQty: 6 }] };
        },
      });
      const frame = await fetcher(target(exchange, "perp"), { bookMode: mode });
      expect(invoked).toBe(true);
      expect(frame.book.bids[0]?.quantity).toBe(5);
      expect(frame.source.bookMode).toBe(mode);
      expect(frame.source.route).toBe(exchange === "Bybit" ? (mode === "rpi" ? "/v5/market/rpi_orderbook" : "/v5/market/orderbook") : (mode === "rpi" ? "/api/v3/market/rpi-orderbook" : "/api/v3/market/orderbook"));
    }
    expect(buildBitgetUrl("rpi-orderbook", { symbol: "BTCUSDT", limit: "100" })).toContain("/api/v3/market/rpi-orderbook");
    expect(buildBybitUrl("rpi-orderbook", { symbol: "BTCUSDT", limit: "50" })).toContain("/v5/market/rpi_orderbook");
  });

  it("fetches the complete Binance perpetual RPI depth and preserves its sequence", async () => {
    const bids = Array.from({ length: 1000 }, (_, i) => [String(2000 - i), "1"]);
    const asks = Array.from({ length: 1000 }, (_, i) => [String(2001 + i), "2"]);
    let requested = "";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requested = String(input);
      return Response.json({ lastUpdateId: 987654, E: 1_700_000_000_000, bids, asks });
    });
    const frame = await fetchOrderBookRest(target("Binance", "perp"), { bookMode: "rpi" });
    expect(requested).toContain("https://fapi.binance.com/fapi/v1/rpiDepth?");
    expect(requested).toContain("limit=1000");
    expect(frame.book.bids).toHaveLength(1000);
    expect(frame.book.asks).toHaveLength(1000);
    expect(frame.sequence).toBe("987654");
    expect(frame.source.bookMode).toBe("rpi");
  });
});
