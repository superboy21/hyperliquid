import { describe, expect, test } from "bun:test";
import { createBookAttemptPlan, getBookCapabilities } from "./capabilities";
import type { BookTarget, SpotExchangeName } from "./types";

const target: BookTarget = { id: "spot:Gate:BTC", exchange: "Gate.io", kind: "spot", rawSymbol: "BTC_USDT", baseAsset: "BTC", quoteAsset: "USDT" };

describe("order book capabilities and attempt policy", () => {
  test("supports RPI by product and transport rather than display name alone", () => {
    const exchanges: SpotExchangeName[] = ["Hyperliquid", "Gate.io", "Binance", "Lighter", "OKX", "Bitget", "Bybit"];
    for (const exchange of exchanges) for (const kind of ["spot", "perp"] as const) {
      const rpi = exchange !== "Hyperliquid" && exchange !== "Lighter" && !(exchange === "Binance" && kind === "spot");
      expect(getBookCapabilities({ ...target, exchange, kind })).toEqual({ rest: { normal: true, rpi }, ws: { normal: true, rpi } });
    }
  });
  test("WS RPI plan proceeds from both WS candidates to RPI REST then normal REST", () => {
    expect(createBookAttemptPlan(target, { bookMode: "rpi", wsMode: true })).toEqual({ attempts: [
      { transport: "ws", bookMode: "rpi" }, { transport: "ws", bookMode: "normal" },
      { transport: "rest", bookMode: "rpi" }, { transport: "rest", bookMode: "normal" },
    ], notices: [] });
  });
  test("normal WS and REST modes have exact non-duplicated fallback chains", () => {
    expect(createBookAttemptPlan(target, { bookMode: "normal", wsMode: true }).attempts).toEqual([
      { transport: "ws", bookMode: "normal" }, { transport: "rest", bookMode: "normal" },
    ]);
    expect(createBookAttemptPlan(target, { bookMode: "rpi", wsMode: false }).attempts).toEqual([
      { transport: "rest", bookMode: "rpi" }, { transport: "rest", bookMode: "normal" },
    ]);
    expect(createBookAttemptPlan(target, { bookMode: "normal", wsMode: false }).attempts).toEqual([{ transport: "rest", bookMode: "normal" }]);
  });
  test("unsupported RPI generates an explicit notice in both modes", () => {
    for (const wsMode of [true, false]) {
      const plan = createBookAttemptPlan({ ...target, exchange: "Binance" }, { bookMode: "rpi", wsMode });
      expect(plan.attempts[0]).toEqual({ transport: wsMode ? "ws" : "rest", bookMode: "normal" });
      expect(plan.notices).toHaveLength(1);
      expect(plan.notices[0]).toMatchObject({ code: "unsupported", reason: "unsupported", from: { bookMode: "rpi" }, to: { bookMode: "normal" } });
      expect(plan.notices[0].message).toContain("不支持");
    }
  });
  test("Reality spot tokens explicitly force ordinary REST, not synthetic quantities", () => {
    const reality: BookTarget = { ...target, exchange: "Bitget", isRealityToken: true };
    expect(getBookCapabilities(reality)).toEqual({ rest: { normal: true, rpi: false }, ws: { normal: false, rpi: false } });
    const plan = createBookAttemptPlan(reality, { bookMode: "rpi", wsMode: true });
    expect(plan.attempts).toEqual([{ transport: "rest", bookMode: "normal" }]);
    expect(plan.notices[0]).toMatchObject({ code: "policy", reason: "reality-token" });
    expect(createBookAttemptPlan({ ...reality, kind: "perp" }, { bookMode: "rpi", wsMode: true }).attempts[0]).toEqual({ transport: "ws", bookMode: "rpi" });
  });
});
