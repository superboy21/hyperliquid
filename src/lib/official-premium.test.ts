import { describe, expect, test } from "bun:test";
import { fetchOfficialPremium, type OfficialPremiumContext } from "./official-premium";

type ExchangeName = "Hyperliquid" | "Gate.io" | "Binance" | "Lighter" | "OKX" | "Bitget" | "Bybit";

function context(overrides: Partial<OfficialPremiumContext> = {}): OfficialPremiumContext {
  return {
    hyperliquidNative: new Map([
      ["BTC", 0.001],
      ["ETH", -0.002],
    ]),
    hyperliquidHip3: new Map([
      ["xyz:TSLA", 0.003],
      ["para:BTCD", -0.004],
    ]),
    okx: new Map([
      ["BTC-USDT-SWAP", 0.005],
    ]),
    ...overrides,
  };
}

function rate(exchange: ExchangeName, rawSymbol: string) {
  return { exchange, symbol: rawSymbol, rawSymbol, marketId: undefined };
}

describe("fetchOfficialPremium 分流", () => {
  test("Hyperliquid 原生（rawSymbol 无冒号）查 native 表", async () => {
    expect(await fetchOfficialPremium(rate("Hyperliquid", "BTC"), undefined, context())).toBe(0.001);
  });

  test("Hyperliquid HIP-3（rawSymbol 含冒号）查 hip3 表", async () => {
    expect(await fetchOfficialPremium(rate("Hyperliquid", "xyz:TSLA"), undefined, context())).toBe(0.003);
    expect(await fetchOfficialPremium(rate("Hyperliquid", "para:BTCD"), undefined, context())).toBe(-0.004);
  });

  test("OKX 直接查 okx 表", async () => {
    expect(await fetchOfficialPremium(rate("OKX", "BTC-USDT-SWAP"), undefined, context())).toBe(0.005);
  });

  test("缺失时返回 null", async () => {
    expect(await fetchOfficialPremium(rate("Hyperliquid", "SOL"), undefined, context())).toBeNull();
    expect(await fetchOfficialPremium(rate("OKX", "ETH-USDT-SWAP"), undefined, context())).toBeNull();
  });
});
