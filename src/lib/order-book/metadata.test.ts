import { afterEach, describe, expect, it } from "bun:test";
import { clearBookQuantityMultiplierCache, getBookQuantityMultiplier } from "./metadata";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearBookQuantityMultiplierCache(); });
const target = (exchange: any, kind: "spot" | "perp", rawSymbol = "BTC-USDT-SWAP") => ({ id: rawSymbol, exchange, kind, rawSymbol, baseAsset: "BTC", quoteAsset: "USDT" });

describe("getBookQuantityMultiplier", () => {
  it("returns one for spot and uncontracted perpetuals", async () => {
    expect(await getBookQuantityMultiplier(target("OKX", "spot"))).toBe(1);
    expect(await getBookQuantityMultiplier(target("Binance", "perp"))).toBe(1);
  });

  it("requires proven linear base currency metadata for OKX", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => { requestedUrl = String(input); return Response.json({ code: "0", data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01", ctValCcy: "BTC", ctType: "linear" }] }); };
    expect(await getBookQuantityMultiplier(target("OKX", "perp", "BTC-USDT-SWAP"))).toBe(0.01);
    expect(requestedUrl).toContain("/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP");
    globalThis.fetch = async () => Response.json({ code: "0", data: [{ instId: "ETH-USDT-SWAP", ctVal: "1", ctValCcy: "ETH", ctType: "linear" }] });
    await expect(getBookQuantityMultiplier(target("OKX", "perp", "ETH-USDT-SWAP"))).rejects.toMatchObject({ code: "unsupported-quantity-unit" });
  });
});
