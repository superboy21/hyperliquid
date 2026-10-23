import { describe, expect, test } from "bun:test";
import { createIdleBookState } from "@/lib/order-book/session";
import type { BookSessionState } from "@/lib/order-book/types";
import { createChartPlan, type ChartPlan } from "@/lib/spot-perp-arbitrage/chart-plan";
import type { ParsedArbitrageQuery } from "@/lib/spot-perp-arbitrage/query";
import { asPerpMarket, asSpotMarket, marketId, type ArbitrageMarket } from "@/lib/spot-perp-arbitrage/model";
import {
  EMPTY_COMBINATION_PREFERENCE,
  combinationPreferenceKey,
  preferenceForCombinationChange,
  shouldShowCombinationToggle,
} from "./CombinationOrderBookPanel";
import type { LiveBookPreference } from "./LiveOrderBookPanel";
import { comboPlanKey, resolveLiveBookWiring } from "./SpotPerpArbitrageController";

/** Binance spot BTC/USDT, quoted in USDT and therefore combinable. */
const BTC_SPOT = asSpotMarket({
  exchange: "Binance", exchangeColor: "#f0b90b", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTCUSDT", marketKey: "BTC_USDT", midPrice: 60_000, change24h: 0,
  quoteVolume: 1_000_000, baseVolume: 16, fetchedAt: 1, isRealityToken: false,
});
/** Gate.io spot BTC/USDT, the second leg of the pair. */
const BTC_SPOT_GATE = asSpotMarket({
  exchange: "Gate.io", exchangeColor: "#2354e6", pair: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT",
  rawSymbol: "BTC_USDT", marketKey: "BTC_USDT", midPrice: 60_010, change24h: 0,
  quoteVolume: 900_000, baseVolume: 15, fetchedAt: 1, isRealityToken: false,
});
/** A third market used for leg-swap and removal cases. */
const ETH_SPOT = asSpotMarket({
  exchange: "OKX", exchangeColor: "#ffffff", pair: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT",
  rawSymbol: "ETH-USDT", marketKey: "ETH-USDT", midPrice: 3_000, change24h: 0,
  quoteVolume: 500_000, baseVolume: 166, fetchedAt: 1, isRealityToken: false,
});
const BTC_PERP = asPerpMarket({
  exchange: "Binance", exchangeColor: "#f0b90b", symbol: "BTC", fundingRate: 0.0001,
  predictedFundingRate: 0.0001, markPrice: 60_100, indexPrice: 60_050, lastPrice: 60_090,
  change24h: 0, quoteVolume: 5_000_000, openInterest: 1_000, notionalValue: 60_000_000,
  fundingInterval: 8 * 3600, assetCategory: "Crypto",
});

const MARKETS: readonly ArbitrageMarket[] = [BTC_SPOT, BTC_SPOT_GATE, ETH_SPOT, BTC_PERP];
const ID_A = String(marketId(BTC_SPOT));
const ID_B = String(marketId(BTC_SPOT_GATE));
const ID_ETH = String(marketId(ETH_SPOT));

const SINGLE_QUERY: ParsedArbitrageQuery = { kind: "normal", term: "btc" };
const COMBO_QUERY: ParsedArbitrageQuery = { kind: "combo", mode: "ratio", firstTerm: "btc", secondTerm: "btc" };

function comboPlan(
  leg1: ArbitrageMarket = BTC_SPOT,
  leg2: ArbitrageMarket = BTC_SPOT_GATE,
  mode: "spread" | "ratio" = "ratio",
): ChartPlan {
  return { kind: "combo", mode, leg1, leg2, source: "query" };
}

function singlePlan(market: ArbitrageMarket = BTC_SPOT): ChartPlan {
  return { kind: "single", leg1: market };
}

const CLOSED_SINGLE: LiveBookPreference = { targetId: null, open: false, wsMode: false };
const OPENED_PAIR = {
  key: combinationPreferenceKey(ID_A, ID_B),
  open: true,
  wsMode: true,
};

/** Plan → wiring, as the controller does on every render. */
function wiring(
  plan: ChartPlan,
  options: {
    markets?: readonly ArbitrageMarket[];
    singlePreference?: LiveBookPreference;
    combinationPreference?: typeof EMPTY_COMBINATION_PREFERENCE;
  } = {},
) {
  return resolveLiveBookWiring({
    plan,
    markets: options.markets ?? MARKETS,
    singlePreference: options.singlePreference ?? CLOSED_SINGLE,
    combinationPreference: options.combinationPreference ?? EMPTY_COMBINATION_PREFERENCE,
  });
}

describe("controller combination book identity", () => {
  test("exposes both resolved legs and no single target for a spread/ratio chart", () => {
    const result = wiring(comboPlan());
    expect(result.target).toBeNull();
    expect(result.targetId).toBeNull();
    expect(result.targetA?.id).toBe(ID_A);
    expect(result.targetB?.id).toBe(ID_B);
    expect(result.combinationKey).toBe(combinationPreferenceKey(ID_A, ID_B));
  });

  test("keeps the session across a timeframe change because the plan is unchanged", () => {
    const opened = wiring(comboPlan(), { combinationPreference: OPENED_PAIR });
    expect(opened.combinationOpen).toBe(true);
    expect(opened.combinationWsMode).toBe(true);
    // A 1d → 4h switch reruns the chart effect but reuses the identical plan.
    expect(wiring(comboPlan(), { combinationPreference: OPENED_PAIR }).combinationKey).toBe(opened.combinationKey);
  });

  test("keeps the session across a spread/ratio switch", () => {
    const opened = wiring(comboPlan(undefined, undefined, "ratio"), { combinationPreference: OPENED_PAIR });
    const switched = wiring(comboPlan(undefined, undefined, "spread"), { combinationPreference: OPENED_PAIR });
    expect(switched.combinationKey).toBe(opened.combinationKey);
    expect(switched.combinationOpen).toBe(true);
    expect(switched.combinationWsMode).toBe(true);
  });

  test("closes and resets WS when either leg changes, including a reversal", () => {
    const swapped = wiring(comboPlan(BTC_SPOT, ETH_SPOT), { combinationPreference: OPENED_PAIR });
    expect(swapped.combinationKey).toBe(combinationPreferenceKey(ID_A, ID_ETH));
    expect(swapped.combinationOpen).toBe(false);
    expect(swapped.combinationWsMode).toBe(false);

    const reversed = wiring(comboPlan(BTC_SPOT_GATE, BTC_SPOT), { combinationPreference: OPENED_PAIR });
    expect(reversed.combinationKey).toBe(combinationPreferenceKey(ID_B, ID_A));
    expect(reversed.combinationOpen).toBe(false);
    expect(reversed.combinationWsMode).toBe(false);
  });

  test("closes the pair book when the chart becomes single or closes", () => {
    const single = wiring(singlePlan(), { combinationPreference: OPENED_PAIR });
    expect(single.combinationKey).toBeNull();
    expect(single.combinationOpen).toBe(false);
    expect(single.combinationWsMode).toBe(false);
    expect(single.target?.id).toBe(ID_A);

    const closed = wiring(null, { combinationPreference: OPENED_PAIR });
    expect(closed.combinationKey).toBeNull();
    expect(closed.combinationOpen).toBe(false);
    expect(closed.target).toBeNull();
  });

  test("a stale preference key never opens a book for a different pair", () => {
    const stale = { key: combinationPreferenceKey(ID_A, ID_ETH), open: true, wsMode: true };
    const result = wiring(comboPlan(), { combinationPreference: stale });
    expect(result.combinationOpen).toBe(false);
    // The render-phase adjustment then rewrites the scope to the current pair.
    expect(preferenceForCombinationChange(stale, result.combinationKey)).toEqual({
      key: combinationPreferenceKey(ID_A, ID_B), open: false, wsMode: false,
    });
  });

  test("a half-selected pair has no key, so the toggle stays hidden", () => {
    expect(resolveLiveBookWiring({
      plan: null,
      markets: MARKETS,
      singlePreference: CLOSED_SINGLE,
      combinationPreference: OPENED_PAIR,
    }).combinationKey).toBeNull();
    expect(comboPlanKey(null)).toBeNull();
  });

  test("resolves each leg against refreshed rows so revived markets keep their identity", () => {
    // Simulate a refresh that replaced the row with a reality-token variant.
    const refreshed = asSpotMarket({ ...BTC_SPOT.source, baseAsset: "RAAPLUS", isRealityToken: true });
    const result = wiring(comboPlan(), { markets: [refreshed, BTC_SPOT_GATE] });
    expect(result.targetA?.id).toBe(ID_A);
    expect(result.targetA?.baseAsset).toBe("RAAPLUS");
    expect(result.targetA?.isRealityToken).toBe(true);
  });

  test("a leg missing from the refreshed universe yields no target but keeps the pair identity", () => {
    const result = wiring(comboPlan(), { markets: [BTC_SPOT, ETH_SPOT] });
    expect(result.targetB).toBeNull();
    // Identity comes from the plan, so an unquotable leg still shows a clear
    // "cannot locate this leg" state instead of silently reusing old depth.
    expect(result.combinationKey).toBe(combinationPreferenceKey(ID_A, ID_B));
  });
});

describe("controller single-leg book regression", () => {
  test("single charts keep their own target, open flag and WS preference", () => {
    const opened: LiveBookPreference = { targetId: ID_A, open: true, wsMode: true };
    const result = wiring(singlePlan(), { singlePreference: opened });
    expect(result.targetId).toBe(ID_A);
    expect(result.singleOpen).toBe(true);
    expect(result.singleWsMode).toBe(true);
    expect(result.combinationKey).toBeNull();
    expect(result.combinationOpen).toBe(false);
  });

  test("a single target change closes the previous book and drops WS", () => {
    const opened: LiveBookPreference = { targetId: ID_A, open: true, wsMode: true };
    const result = wiring(singlePlan(ETH_SPOT), { singlePreference: opened });
    expect(result.targetId).toBe(ID_ETH);
    expect(result.singleOpen).toBe(false);
    expect(result.singleWsMode).toBe(false);
  });

  test("the pair chart never reuses a single target's open book", () => {
    const opened: LiveBookPreference = { targetId: ID_A, open: true, wsMode: true };
    const result = wiring(comboPlan(), { singlePreference: opened });
    expect(result.targetId).toBeNull();
    expect(result.singleOpen).toBe(false);
  });

  test("perp legs are identified by their own transport identity", () => {
    const result = wiring(comboPlan(BTC_PERP, BTC_SPOT));
    expect(result.targetA?.kind).toBe("perp");
    expect(result.targetA?.id).toBe(String(marketId(BTC_PERP)));
    expect(result.combinationKey).toBe(combinationPreferenceKey(String(marketId(BTC_PERP)), ID_A));
  });
});

describe("controller chart plan integration", () => {
  test("a query plan yields the same pair key as the wiring", () => {
    const plan = createChartPlan(COMBO_QUERY, { leg1: BTC_SPOT, leg2: BTC_SPOT_GATE }, null, MARKETS);
    expect(plan?.kind).toBe("combo");
    expect(comboPlanKey(plan?.kind === "combo" ? plan : null)).toBe(combinationPreferenceKey(ID_A, ID_B));
  });

  test("a strategy plan switches mode without changing the pair key", () => {
    const ratio = createChartPlan(
      { kind: "normal", term: "btc" },
      { leg1: null, leg2: null },
      { buyId: ID_A, sellId: ID_B, mode: "ratio" },
      MARKETS,
    );
    const spread = createChartPlan(
      { kind: "normal", term: "btc" },
      { leg1: null, leg2: null },
      { buyId: ID_A, sellId: ID_B, mode: "spread" },
      MARKETS,
    );
    expect(ratio?.kind).toBe("combo");
    expect(spread?.kind).toBe("combo");
    expect(ratio?.kind === "combo" && ratio.mode).toBe("ratio");
    expect(spread?.kind === "combo" && spread.mode).toBe("spread");
    expect(comboPlanKey(ratio?.kind === "combo" ? ratio : null))
      .toBe(comboPlanKey(spread?.kind === "combo" ? spread : null));
    // Strategy legs follow the buy/sell order, so A and B are never silent swaps.
    expect(wiring(ratio).targetA?.id).toBe(ID_A);
    expect(wiring(ratio).targetB?.id).toBe(ID_B);
  });

  test("strategy plans missing a market produce no book at all", () => {
    const plan = createChartPlan(
      SINGLE_QUERY,
      { leg1: null, leg2: null },
      { buyId: ID_A, sellId: "missing" },
      MARKETS,
    );
    expect(plan).toBeNull();
    const result = wiring(plan);
    expect(result.combinationKey).toBeNull();
    expect(result.targetA).toBeNull();
    expect(result.targetB).toBeNull();
  });
});

describe("controller toggle gating and payload identity", () => {
  test("a loading or failed payload does not authorise the toggle", () => {
    const key = combinationPreferenceKey(ID_A, ID_B);
    expect(shouldShowCombinationToggle({ open: false, planKey: key, payloadKey: null, hasValidCandles: false })).toBe(false);
    expect(shouldShowCombinationToggle({ open: false, planKey: key, payloadKey: null, hasValidCandles: true })).toBe(false);
  });

  test("an open panel stays closable while candles reload", () => {
    const key = combinationPreferenceKey(ID_A, ID_B);
    expect(shouldShowCombinationToggle({ open: true, planKey: key, payloadKey: null, hasValidCandles: false })).toBe(true);
  });

  test("a payload from a previous pair cannot authorise the current pair", () => {
    const current = combinationPreferenceKey(ID_A, ID_ETH);
    const previous = combinationPreferenceKey(ID_A, ID_B);
    expect(shouldShowCombinationToggle({ open: false, planKey: current, payloadKey: previous, hasValidCandles: true })).toBe(false);
    expect(shouldShowCombinationToggle({ open: false, planKey: current, payloadKey: current, hasValidCandles: true })).toBe(true);
  });
});

describe("controller session teardown", () => {
  test("the idle state a closed panel holds performs no I/O and reports idle", () => {
    const idle: BookSessionState = createIdleBookState({ bookMode: "rpi", wsMode: false });
    expect(idle.status).toBe("idle");
    expect(idle.frame).toBeNull();
    expect(idle.attempt).toBeNull();
    expect(idle.requested).toEqual({ transport: "rest", bookMode: "rpi" });
  });

  test("disposing the store leaves the panel with the same idle server snapshot", () => {
    // A closed panel subscribes to nothing, so both legs keep returning the idle
    // snapshot forever — this is what makes "hidden means no network" true.
    const a = createIdleBookState({ bookMode: "normal", wsMode: true });
    const b = createIdleBookState({ bookMode: "normal", wsMode: true });
    expect(a).toEqual(b);
    expect(a.status).not.toBe("live");
  });
});
