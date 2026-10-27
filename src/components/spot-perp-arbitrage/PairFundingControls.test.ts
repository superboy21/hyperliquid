import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComboCandleResult, ComboFundingRatePoint } from "@/lib/combo";
import type { SearchChartInterval } from "@/lib/search-candles";
import type { CombinationViewMode } from "@/lib/combo-weighting";
import type { CandleSourceProvenance } from "@/lib/candle-provenance";
import type { SpotMarketRow } from "@/lib/spot-search";
import type { SearchExchangeRate } from "@/lib/search";
import type { MixedCombinationResult, SpotSpotCombinationResult } from "@/lib/spot-perp-arbitrage/combine";
import type { PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { calculatePairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { asPerpMarket, asSpotMarket } from "@/lib/spot-perp-arbitrage/model";
import ComboSearchCandlesChart from "@/components/search/ComboSearchCandlesChart";
import SpotContainingCombinationChart from "./SpotContainingCombinationChart";

const HOUR_MS = 60 * 60 * 1000;
const TIMES = [0, 1, 2, 3, 4, 5].map((index) => index * HOUR_MS);
const LEG1_CLOSES = [100, 101, 102, 103, 104, 105];
const LEG2_CLOSES = [50, 50.5, 51, 51.5, 52, 52.5];

const FUNDING_ONE_TO_ONE = "年化资金费率差（1:1）";
const FUNDING_ONE_TO_BETA = "年化资金费率差（1:β）";
const BETA_DISABLED_REASON = "当前配对的 β 不可用，1:β 暂不可用。";
const LEGACY_CONTROL_GROUP = "配对交易图表控制";
const SPOT_CONTROL_GROUP = "配对交易视图控制";

function provenance(exchange: string): CandleSourceProvenance {
  return {
    exchange,
    requestedInterval: "1h",
    sourceInterval: "1h",
    sourceKind: "official native interval",
    quoteTurnover: "official",
  };
}

function legPoint(openTime: number, close: number) {
  return { openTime, closeTime: openTime + HOUR_MS, open: close, high: close, low: close, close };
}

function perpFunding(index: number): ComboFundingRatePoint {
  return {
    time: TIMES[index],
    rate: 0.0001,
    annualizedRate: 0.1,
    sampleCount: 1,
    firstFunding: { rate: 0.0002, annualizedRate: 0.2 },
    secondFunding: { rate: 0.0001, annualizedRate: 0.1 },
  };
}

/** Perp/perp combination shaped exactly like the controller's aligned result. */
function comboResult(options: { interval?: SearchChartInterval; funding?: boolean } = {}): ComboCandleResult {
  const { interval = "1h", funding = true } = options;
  return {
    mode: "spread",
    interval,
    exchange: "Binance",
    symbol: "BTCUSDT",
    firstSymbol: "BTC",
    firstExchange: "Binance",
    secondSymbol: "ETH",
    secondExchange: "Bybit",
    candles: TIMES.map((openTime, index) => ({
      openTime,
      closeTime: openTime + HOUR_MS,
      open: String(LEG1_CLOSES[index] - LEG2_CLOSES[index]),
      high: String(LEG1_CLOSES[index] - LEG2_CLOSES[index]),
      low: String(LEG1_CLOSES[index] - LEG2_CLOSES[index]),
      close: String(LEG1_CLOSES[index] - LEG2_CLOSES[index]),
      volume: "1",
      quoteVolume: "10",
    })),
    leg1Points: TIMES.map((openTime, index) => legPoint(openTime, LEG1_CLOSES[index])),
    leg2Points: TIMES.map((openTime, index) => legPoint(openTime, LEG2_CLOSES[index])),
    fundingRates: funding ? TIMES.map((_time, index) => perpFunding(index)) : [],
    legProvenance: [provenance("Binance"), provenance("Bybit")],
  };
}

function perpMarket(): ReturnType<typeof asPerpMarket> {
  return asPerpMarket({
    exchange: "Binance",
    exchangeColor: "yellow",
    symbol: "BTC",
    fundingRate: 0,
    markPrice: 100,
    indexPrice: 100,
    lastPrice: 100,
    change24h: 0,
    quoteVolume: 0,
    openInterest: 0,
    notionalValue: 0,
    fundingInterval: 8,
    assetCategory: "crypto",
  } satisfies SearchExchangeRate);
}

function spotMarket(): ReturnType<typeof asSpotMarket> {
  return asSpotMarket({
    exchange: "OKX",
    exchangeColor: "green",
    pair: "ETH/USDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    rawSymbol: "ETH-USDT",
    marketKey: "ETH-USDT",
    midPrice: 50,
    change24h: 0,
    quoteVolume: 0,
    baseVolume: 0,
    fetchedAt: 1,
  } satisfies SpotMarketRow);
}

function mixedPoints() {
  return TIMES.map((openTime, index) => ({
    openTime,
    closeTime: openTime + HOUR_MS,
    open: LEG1_CLOSES[index] - LEG2_CLOSES[index],
    close: LEG1_CLOSES[index] - LEG2_CLOSES[index],
    leg1Turnover: null,
    leg2Turnover: null,
    minimumTurnover: null,
    leg1Point: legPoint(openTime, LEG1_CLOSES[index]),
    leg2Point: legPoint(openTime, LEG2_CLOSES[index]),
  }));
}

/** One perp leg on leg1; the combiner already signed the perp rate for leg1. */
function mixedResult(options: { interval?: SearchChartInterval; funding?: boolean } = {}): MixedCombinationResult {
  const { interval = "1h", funding = true } = options;
  return {
    kind: "spot-containing",
    composition: "mixed",
    mode: "spread",
    interval,
    leg1: perpMarket(),
    leg2: spotMarket(),
    points: mixedPoints(),
    funding: funding
      ? TIMES.map((time) => ({ time, rate: 0.0001, annualizedRate: 0.1, sampleCount: 1, perpLeg: 1 as const }))
      : [],
    legProvenance: [provenance("Binance"), provenance("OKX")],
  };
}

/** Spot/spot has no funding leg at all. */
function spotSpotResult(options: { interval?: SearchChartInterval } = {}): SpotSpotCombinationResult {
  return {
    kind: "spot-containing",
    composition: "spot-spot",
    mode: "spread",
    interval: options.interval ?? "1h",
    leg1: spotMarket(),
    leg2: spotMarket(),
    points: mixedPoints(),
    funding: [],
    legProvenance: [provenance("OKX"), provenance("OKX")],
  };
}

/** Real helper output (apply β = 2), so the scenario shape is never hand-faked. */
function pairTrade(beta = 2): PairTradeSeries {
  const aligned = TIMES.map((time, index) => ({
    closeTime: time,
    firstClose: LEG1_CLOSES[index],
    secondClose: LEG2_CLOSES[index],
  }));
  const series = calculatePairTradeSeries(aligned, beta, 10_000, TIMES[1]);
  if (!series.available || !series.value) throw new Error(`pair trade unavailable: ${series.reason}`);
  return series.value;
}

/** Same real series, with the applied β forced to an unusable value. */
function tradeWithBeta(beta: number): PairTradeSeries {
  return { ...pairTrade(2), beta };
}

function renderCombo(options: {
  interval?: SearchChartInterval;
  funding?: boolean;
  trade?: PairTradeSeries | null;
  view?: CombinationViewMode;
} = {}): string {
  const { interval = "1h", funding = true, trade = pairTrade(2), view = "pair-trade" } = options;
  const data = comboResult({ interval, funding });
  return renderToStaticMarkup(createElement(ComboSearchCandlesChart, {
    data,
    pairAnalysis: null,
    pairTradeAnalysis: null,
    pairTrade: trade,
    pairTradeReason: trade ? null : "invalid-beta",
    interval,
    showVolume: false,
    onToggleVolume: () => {},
    view,
    timeZone: "UTC",
  }));
}

function renderSpot(options: {
  result?: MixedCombinationResult | SpotSpotCombinationResult;
  trade?: PairTradeSeries | null;
  view?: CombinationViewMode;
} = {}): string {
  const { result = mixedResult(), trade = pairTrade(2), view = "pair-trade" } = options;
  return renderToStaticMarkup(createElement(SpotContainingCombinationChart, {
    result,
    pairAnalysis: null,
    pairTradeAnalysis: null,
    pairTrade: trade,
    pairTradeReason: trade ? null : "invalid-beta",
    view,
    timeZone: "UTC",
  }));
}

/** One `<label>…</label>` block whose visible text is exactly `text`. */
function labelBlock(markup: string, text: string): string | null {
  for (const match of markup.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)) {
    const block = match[0];
    const visible = block.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (visible === text) return block;
  }
  return null;
}

interface Toggle {
  block: string;
  input: string;
  checked: boolean;
  disabled: boolean;
}

/**
 * Reads one funding toggle from inside its own label. Scoping to the label keeps
 * the explanation paragraphs (which repeat the same wording) and the two raw-leg
 * checkboxes out of the assertion.
 */
function toggle(markup: string, text: string): Toggle | null {
  const block = labelBlock(markup, text);
  if (block === null) return null;
  const input = block.match(/<input\b[^>]*>/)?.[0];
  if (!input) return null;
  return {
    block,
    input,
    checked: /\bchecked=/.test(input),
    disabled: /\bdisabled=/.test(input),
  };
}

/** The pair-trade switch row itself (labels only; explanation copy lives outside). */
function controlGroup(markup: string, ariaLabel: string): string {
  const marker = markup.indexOf(`aria-label="${ariaLabel}"`);
  if (marker < 0) return "";
  const start = markup.lastIndexOf("<div", marker);
  const end = markup.indexOf("</div>", marker);
  if (start < 0 || end < start) return "";
  return markup.slice(start, end);
}

function checkboxCount(group: string): number {
  return group.match(/<input\b[^>]*type="checkbox"[^>]*>/g)?.length ?? 0;
}

function expectBothFundingTogglesOffered(markup: string, ariaLabel: string) {
  // 4 = 腿1原始K线, 腿2原始K线, 1:1, 1:β — no stray checkbox is counted as a toggle.
  expect(checkboxCount(controlGroup(markup, ariaLabel))).toBe(4);

  const oneToOne = toggle(markup, FUNDING_ONE_TO_ONE);
  expect(oneToOne).not.toBeNull();
  expect(oneToOne?.checked).toBe(false);
  expect(oneToOne?.disabled).toBe(false);

  const oneToBeta = toggle(markup, FUNDING_ONE_TO_BETA);
  expect(oneToBeta).not.toBeNull();
  expect(oneToBeta?.checked).toBe(false);
  expect(oneToBeta?.disabled).toBe(false);
  expect(markup).not.toContain(BETA_DISABLED_REASON);
}

function expectFundingTogglesHidden(markup: string, ariaLabel: string) {
  // The switch row still renders, so only the two raw-leg boxes remain.
  expect(checkboxCount(controlGroup(markup, ariaLabel))).toBe(2);
  expect(labelBlock(markup, FUNDING_ONE_TO_ONE)).toBeNull();
  expect(labelBlock(markup, FUNDING_ONE_TO_BETA)).toBeNull();
  expect(toggle(markup, FUNDING_ONE_TO_ONE)).toBeNull();
  expect(toggle(markup, FUNDING_ONE_TO_BETA)).toBeNull();
  expect(markup).not.toContain(BETA_DISABLED_REASON);
}

function expectOneToOneUsableBetaDisabled(markup: string, ariaLabel: string) {
  expect(checkboxCount(controlGroup(markup, ariaLabel))).toBe(4);

  const oneToOne = toggle(markup, FUNDING_ONE_TO_ONE);
  expect(oneToOne).not.toBeNull();
  expect(oneToOne?.checked).toBe(false);
  expect(oneToOne?.disabled).toBe(false);

  const oneToBeta = toggle(markup, FUNDING_ONE_TO_BETA);
  expect(oneToBeta).not.toBeNull();
  // Unavailable ⇒ shown unchecked so the control never claims a pane it will not draw.
  expect(oneToBeta?.checked).toBe(false);
  expect(oneToBeta?.disabled).toBe(true);
  // The reason is wired to the input, not just floating nearby.
  expect(oneToBeta?.input).toContain('aria-describedby="pair-weighted-funding-reason"');
  expect(markup).toContain(`id="pair-weighted-funding-reason"`);
  expect(markup).toContain(BETA_DISABLED_REASON);
}

describe("ComboSearchCandlesChart pair-trade funding toggles", () => {
  test("perp pair with funding and β=2 offers both toggles, unchecked and enabled", () => {
    expectBothFundingTogglesOffered(renderCombo(), LEGACY_CONTROL_GROUP);
  });

  test("without a pair-trade scenario the 1:1 toggle stays usable and 1:β is disabled with its reason", () => {
    expectOneToOneUsableBetaDisabled(renderCombo({ trade: null }), LEGACY_CONTROL_GROUP);
  });

  test("an unusable applied β (0 or NaN) disables only the 1:β toggle", () => {
    for (const beta of [0, Number.NaN]) {
      expectOneToOneUsableBetaDisabled(renderCombo({ trade: tradeWithBeta(beta) }), LEGACY_CONTROL_GROUP);
    }
  });

  test("1m and funding-less pairs hide both toggles", () => {
    expectFundingTogglesHidden(renderCombo({ interval: "1m" }), LEGACY_CONTROL_GROUP);
    expectFundingTogglesHidden(renderCombo({ funding: false }), LEGACY_CONTROL_GROUP);
  });

  test("plain and OLS views never offer the toggles", () => {
    for (const view of ["plain", "ols"] as const) {
      const markup = renderCombo({ view });
      expect(controlGroup(markup, LEGACY_CONTROL_GROUP)).toBe("");
      expect(toggle(markup, FUNDING_ONE_TO_ONE)).toBeNull();
      expect(toggle(markup, FUNDING_ONE_TO_BETA)).toBeNull();
    }
  });
});

describe("SpotContainingCombinationChart pair-trade funding toggles (mixed)", () => {
  test("mixed pair with funding and β=2 offers both toggles, unchecked and enabled", () => {
    expectBothFundingTogglesOffered(renderSpot(), SPOT_CONTROL_GROUP);
  });

  test("without a pair-trade scenario the 1:1 toggle stays usable and 1:β is disabled with its reason", () => {
    expectOneToOneUsableBetaDisabled(renderSpot({ trade: null }), SPOT_CONTROL_GROUP);
  });

  test("an unusable applied β (0 or NaN) disables only the 1:β toggle", () => {
    for (const beta of [0, Number.NaN]) {
      expectOneToOneUsableBetaDisabled(renderSpot({ trade: tradeWithBeta(beta) }), SPOT_CONTROL_GROUP);
    }
  });

  test("1m and funding-less mixed pairs hide both toggles", () => {
    expectFundingTogglesHidden(renderSpot({ result: mixedResult({ interval: "1m" }) }), SPOT_CONTROL_GROUP);
    expectFundingTogglesHidden(renderSpot({ result: mixedResult({ funding: false }) }), SPOT_CONTROL_GROUP);
  });

  test("spot/spot hides both toggles even with a usable β", () => {
    expectFundingTogglesHidden(renderSpot({ result: spotSpotResult() }), SPOT_CONTROL_GROUP);
  });

  test("plain and OLS views never offer the toggles", () => {
    for (const view of ["plain", "ols"] as const) {
      const markup = renderSpot({ view });
      expect(controlGroup(markup, SPOT_CONTROL_GROUP)).toBe("");
      expect(toggle(markup, FUNDING_ONE_TO_ONE)).toBeNull();
      expect(toggle(markup, FUNDING_ONE_TO_BETA)).toBeNull();
    }
  });
});
