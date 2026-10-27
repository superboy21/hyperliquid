import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComboCandleResult } from "@/lib/combo";
import type { MixedCombinationResult, SpotSpotCombinationResult } from "@/lib/spot-perp-arbitrage/combine";
import type { PairHistoricalVolatility } from "@/lib/spot-perp-arbitrage/pair-risk";
import { calculatePairTradeSeries, type PairTradeSeries } from "@/lib/spot-perp-arbitrage/pair-trade";
import { asPerpMarket, asSpotMarket } from "@/lib/spot-perp-arbitrage/model";
import { calculatePairLegReturns } from "@/lib/spot-perp-arbitrage/pair-leg-returns";
import type { SearchExchangeRate } from "@/lib/search";
import type { SpotMarketRow } from "@/lib/spot-search";
import MixedAnalyticsDashboard, {
  COMBINED_PNL_BASIS_USD,
  combinedAnnualizedContribution,
  combinedReturnAmounts,
  legAmountUsd,
  legReturnAmountsUsd,
  signedUsd,
} from "./MixedAnalyticsDashboard";
import { ANALYTICS_YEAR_MS } from "@/lib/spot-perp-arbitrage/single-market-analytics";

const HOUR_MS = 60 * 60 * 1000;

function mixedResult(): MixedCombinationResult {
  return {
    kind: "spot-containing",
    composition: "mixed",
    mode: "spread",
    interval: "1h",
    leg1: asPerpMarket({
      exchange: "Binance", exchangeColor: "yellow", symbol: "BTC",
      fundingRate: 0, markPrice: 100, indexPrice: 100, lastPrice: 100, change24h: 0,
      quoteVolume: 0, openInterest: 0, notionalValue: 0, fundingInterval: 8, assetCategory: "crypto",
    } satisfies SearchExchangeRate),
    leg2: asSpotMarket({
      exchange: "OKX", exchangeColor: "green", pair: "ETH/USDT", baseAsset: "ETH",
      quoteAsset: "USDT", rawSymbol: "ETH-USDT", marketKey: "ETH-USDT", midPrice: 100,
      change24h: 0, quoteVolume: 0, baseVolume: 0, fetchedAt: 1,
    } satisfies SpotMarketRow),
    points: [0, 1, 2].map((index) => ({
      openTime: index * HOUR_MS,
      closeTime: (index + 1) * HOUR_MS,
      open: 10 + index,
      close: 10 + index,
      leg1Turnover: null,
      leg2Turnover: null,
      minimumTurnover: null,
    })),
    funding: [],
    legProvenance: [] as never,
  };
}

function legacyResult(): ComboCandleResult {
  return {
    mode: "spread",
    firstSymbol: "BTC",
    firstExchange: "Binance",
    secondSymbol: "ETH",
    secondExchange: "Bybit",
    candles: [0, 1, 2].map((index) => ({
      openTime: index * HOUR_MS,
      closeTime: (index + 1) * HOUR_MS,
      open: String(10 + index),
      high: String(10 + index),
      low: String(10 + index),
      close: String(10 + index),
      volume: "1",
      quoteVolume: "10",
    })),
    fundingRates: [],
    legProvenance: [] as never,
  } as ComboCandleResult;
}

const unavailableVolatility: PairHistoricalVolatility = {
  sampleCount: 0,
  annualizedPercent: { available: false, value: null, reason: "insufficient-returns" },
};

/* ------------------------------------------------------------------ *
 * Pair-trade scenario cards (six cards, two per-leg return cards)
 * ------------------------------------------------------------------ */

const LEG1_CLOSES = [99, 100, 102, 105, 108, 110];
const LEG2_CLOSES = [50, 50, 51, 52, 54, 55];
const ENTRY_INDEX = 1;
const ENTRY_OPEN_TIME = ENTRY_INDEX * HOUR_MS;
const ENTRY_CLOSE_TIME = (ENTRY_INDEX + 1) * HOUR_MS;

function legPoint(openTime: number, close: number) {
  return { openTime, closeTime: openTime + HOUR_MS, open: close, high: close, low: close, close };
}

/**
 * A USD-priced preset holding only the given candle indices. Funding
 * observations are stamped at whole hours starting from the entry close (2h),
 * which is where the helper's inclusive window begins.
 */
function pricedMixed(
  indices: number[],
  fundingIndices: number[],
  leg1Closes: number[] = LEG1_CLOSES,
  leg2Closes: number[] = LEG2_CLOSES,
): MixedCombinationResult {
  const base = mixedResult();
  return {
    ...base,
    points: indices.map((index) => ({
      openTime: index * HOUR_MS,
      closeTime: (index + 1) * HOUR_MS,
      open: leg1Closes[index] - leg2Closes[index],
      close: leg1Closes[index] - leg2Closes[index],
      leg1Turnover: null,
      leg2Turnover: null,
      minimumTurnover: null,
      leg1Point: legPoint(index * HOUR_MS, leg1Closes[index]),
      leg2Point: legPoint(index * HOUR_MS, leg2Closes[index]),
    })),
    funding: fundingIndices.map((index) => ({
      time: index * HOUR_MS,
      rate: 0.000125,
      annualizedRate: 0.1095,
      sampleCount: 1,
      perpLeg: 1 as const,
    })),
  };
}

/** The four settlements that cover the perp leg's whole post-entry window. */
const COMPLETE_FUNDING = [2, 3, 4, 5];

/** Same prices, but both legs are spot: no funding exists at all. */
function pricedSpotSpot(indices: number[]): SpotSpotCombinationResult {
  const mixed = pricedMixed(indices, []);
  return {
    ...mixed,
    composition: "spot-spot",
    leg1: mixed.leg2,
    leg2: mixed.leg2,
  } as unknown as SpotSpotCombinationResult;
}

/** Long leg1 at 100 → 110, short leg2 at 50 → 55, entered on candle 1. */
function pricedTrade(lastPoint = 5): PairTradeSeries {
  return {
    beta: 1.25,
    firstNotionalUsd: 10_000,
    secondNotionalUsd: 12_500,
    entryIndex: ENTRY_INDEX,
    entryTime: ENTRY_OPEN_TIME,
    entryFirstClose: 100,
    entrySecondClose: 50,
    points: LEG1_CLOSES.slice(0, lastPoint + 1).map((_, index) => (index < ENTRY_INDEX
      ? { time: index * HOUR_MS, pnlUsd: null, returnPercent: null }
      : { time: index * HOUR_MS, pnlUsd: index === 5 ? 123.45 : index, returnPercent: index === 5 ? 1.2345 : index })),
  };
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/**
 * Slices one scenario card's markup. The last card is followed by the
 * diagnostics section, so that boundary is used as a second stopping point.
 */
function cardMarkup(markup: string, key: string): string {
  const start = markup.indexOf(`data-scenario-card="${key}"`);
  if (start < 0) return "";
  const nextCard = markup.indexOf("data-scenario-card=", start + 1);
  const nextSection = markup.indexOf("配对诊断</h4>", start + 1);
  const candidates = [nextCard, nextSection].filter((index) => index > start);
  const end = candidates.length ? Math.min(...candidates) : markup.length;
  return markup.slice(start, end);
}
/** Reads the three `data-leg-amount` values of one card, in DOM order. */
function legAmounts(markup: string, leg: 1 | 2): string[] {
  return [...cardMarkup(markup, `leg-${leg}-returns`).matchAll(/data-leg-amount="(?:price|funding|total)">([^<]*)</g)]
    .map((match) => match[1]);
}

/** Same reader for the combined card. */
function combinedAmounts(markup: string): string[] {
  return [...cardMarkup(markup, "merged-pnl").matchAll(/data-leg-amount="(?:price|funding|total)">([^<]*)</g)]
    .map((match) => match[1]);
}

/** Percentages printed on one card, in DOM order (`--` when a value is unknown). */
function cardPercents(markup: string, key: string): string[] {
  return [...cardMarkup(markup, key).matchAll(/font-semibold [^"]*">([^<]+)</g)]
    .map((match) => match[1])
    .filter((text) => /^(?:[+\-]?\d+\.\d{2}%|--)$/.test(text));
}

/** A perp-perp (legacy) preset with real funding on both legs. */
function perpPerpResult(fundingIndices: number[] = COMPLETE_FUNDING) {
  return {
    mode: "spread",
    firstSymbol: "BTC",
    firstExchange: "Binance",
    secondSymbol: "ETH",
    secondExchange: "Bybit",
    interval: "1h",
    candles: LEG1_CLOSES.map((_, index) => ({
      openTime: String(index * HOUR_MS),
      closeTime: String((index + 1) * HOUR_MS),
      open: "1", high: "1", low: "1", close: "1", volume: "1", quoteVolume: "10",
    })),
    leg1Points: LEG1_CLOSES.map((close, index) => legPoint(index * HOUR_MS, close)),
    leg2Points: LEG2_CLOSES.map((close, index) => legPoint(index * HOUR_MS, close)),
    fundingRates: fundingIndices.map((index) => ({
      time: index * HOUR_MS,
      rate: 0.0001,
      annualizedRate: 0.1,
      sampleCount: 1,
      firstFunding: { rate: 0.0002, annualizedRate: 0.2 },
      secondFunding: { rate: 0.0001, annualizedRate: 0.1 },
    })),
    legProvenance: [] as never,
  } as unknown as ComboCandleResult;
}

/** Builds a trade from the real helper, so amounts are never hand-faked. */
function helperTrade(beta: number, firstNotionalUsd = 10_000): PairTradeSeries {
  const aligned = LEG1_CLOSES.map((close, index) => ({
    closeTime: index * HOUR_MS,
    firstClose: close,
    secondClose: LEG2_CLOSES[index],
  }));
  const series = calculatePairTradeSeries(aligned, beta, firstNotionalUsd, ENTRY_OPEN_TIME);
  if (!series.available || !series.value) throw new Error(`trade unavailable: ${series.reason}`);
  return series.value;
}

function renderPairTrade(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MixedAnalyticsDashboard, {
    result: pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING),
    pairTrade: pricedTrade(),
    pairTradeReason: null,
    pairTradeEntryCloseTime: ENTRY_CLOSE_TIME,
    pairHistoricalVolatility: unavailableVolatility,
    view: "pair-trade",
    range: "all",
    timeZone: "UTC",
    ...overrides,
  }));
}

function render(view: "pair-trade" | "ols", result = mixedResult(), volatility?: PairHistoricalVolatility) {
  return renderToStaticMarkup(createElement(MixedAnalyticsDashboard, {
    result,
    pairTrade: null,
    pairTradeReason: "invalid-beta",
    pairHistoricalVolatility: volatility,
    dailyVar: {
      sampleCount: 100,
      var95: { available: true, value: 2.5, reason: null },
      var99: { available: true, value: 4.5, reason: null },
    },
    riskBeta: 1.25,
    view,
    range: "all",
    timeZone: "UTC",
  }));
}

describe("MixedAnalyticsDashboard historical risk cards", () => {
  test("renders the pair-trade annualized volatility card for mixed and legacy perp pairs", () => {
    const volatility: PairHistoricalVolatility = {
      sampleCount: 17,
      annualizedPercent: { available: true, value: 12.345, reason: null },
    };

    for (const result of [mixedResult(), legacyResult()]) {
      const markup = render("pair-trade", result, volatility);
      expect(markup).toContain("历史年化组合波动率（占腿1名义本金 %）");
      expect(markup).toContain("12.35%");
      expect(markup).toContain("17 个相邻有效收益样本");
      expect(markup).toContain("(r1 − β×r2)/1");
      expect(markup).toContain("腿1名义本金为基准");
      expect(markup).toContain("每期重设 1:β 名义暴露");
      expect(markup).not.toContain("(1+β)");
      expect(markup).not.toContain("占组合总名义本金");
      expect(markup).toContain("所选拟合窗口内");
    }
  });

  test("preserves exact zero and shows unavailable reason with a placeholder", () => {
    const zeroMarkup = render("pair-trade", mixedResult(), {
      sampleCount: 2,
      annualizedPercent: { available: true, value: 0, reason: null },
    });
    expect(zeroMarkup).toContain("0.00%");

    const unavailableMarkup = render("pair-trade", mixedResult(), unavailableVolatility);
    expect(unavailableMarkup).toContain("历史年化组合波动率（占腿1名义本金 %）");
    expect(unavailableMarkup).toContain(">--</span>");
    expect(unavailableMarkup).toContain("有效相邻收益不足 2 个（当前 0 个）。");
  });

  test("describes VaR fit-window scope in pair-trade and full-preset scope in OLS only", () => {
    const pairMarkup = render("pair-trade");
    expect(pairMarkup).toContain("历史日线 VaR（占腿1名义本金 %）");
    expect(pairMarkup).toContain("收益代理 = (r1 − β×r2)/1");
    expect(pairMarkup).toContain("分母为腿1参考名义本金（腿1=1）");
    expect(pairMarkup).not.toContain("组合总名义本金");
    expect(pairMarkup).toContain("仅取所选拟合窗口内的 UTC 日线");
    expect(pairMarkup).not.toContain("独立于拟合窗口与图表视窗");

    const olsMarkup = render("ols");
    expect(olsMarkup).toContain("历史日线 VaR（占腿1名义本金 %）");
    expect(olsMarkup).toContain("收益代理 = (r1 − β×r2)/1");
    expect(olsMarkup).toContain("分母为腿1参考名义本金（腿1=1）");
    expect(olsMarkup).not.toContain("组合总名义本金");
    expect(olsMarkup).toContain("取自完整预设范围的 UTC 日线");
    expect(olsMarkup).toContain("日线 VaR 使用完整预设范围的 UTC 日线");
    expect(olsMarkup).not.toContain("历史年化组合波动率（占腿1名义本金 %）");
  });
});

describe("MixedAnalyticsDashboard pair-trade scenario cards", () => {
  test("renders exactly six scenario cards in a fixed three-column grid", () => {
    const markup = renderPairTrade();
    expect(count(markup, "data-scenario-card=")).toBe(6);
    expect(markup).toContain("grid-cols-3");
    expect(markup).toContain("腿1 收益（多）");
    expect(markup).toContain("腿2 收益（空）");
  });

  test("merges the old β and leg-side cards into one and keeps the combined PnL card", () => {
    const markup = renderPairTrade();
    expect(markup).toContain("β 与腿位（多/空）");
    expect(markup).toContain("多 腿1 · 空 腿2");
    expect(markup).toContain("β = 1.250000");
    expect(markup).toContain("最新合并 PnL");
    // Price row is the canonical curve value, unchanged.
    expect(markup).toContain("+1.23%");
    expect(markup).toContain("+$123.45");
    // The curve itself is still price-only; the card says so explicitly.
    expect(markup).toContain("价格收益即价格 PnL 曲线末点，仍不含资金、手续费与滑点");
    expect(markup).toContain("曲线不因本卡列示资金而改变口径");
    // The card's basis is the fixed 10,000 quote-currency reference.
    expect(markup).toContain("以 10,000 报价币（当前界面 USDT）为基准折算百分比");
    // The stale "funding not included in combined PnL" copy is gone.
    expect(markup).not.toContain("单腿卡片里的资金部分不计入");
    expect(markup).not.toContain("最新合并 PnL（价格口径）");
  });

  test("each leg card labels price, funding and total with the funding annualized in grey", () => {
    const markup = renderPairTrade();
    for (const label of ["价格收益", "资金费率收益", "总收益"]) {
      expect(count(markup, label)).toBeGreaterThanOrEqual(2);
    }
    // Two leg lines plus the combined card's own annualized line (the aside note
    // also mentions 资金费率年化, so scope the count to the scenario cards).
    expect(count(markup.slice(0, markup.indexOf("配对诊断</h4>")), "资金费率年化")).toBe(3);
    // Long leg1: 100 → 110 price, minus four 0.0125% bucket rates priced at their
    // own candle closes (102/105/108/110) → ≈0.053% paid.
    expect(markup).toContain("+10.00%");
    expect(markup).toContain("-0.05%");
    expect(markup).toContain("+9.95%");
    // Short leg2 is spot: 50 → 55 loses 10% on price and has no funding.
    expect(markup).toContain("-10.00%");
    expect(markup).toContain("+0.00%");
    // The annualized funding line stays small grey text, not a headline number.
    expect(markup).toContain("text-gray-500\">资金费率年化");
    // ...and it says the normalization is the holding period, not a forecast.
    expect(markup).toContain("（按持有时长折算，非未来收益预测）");
    // Readable history counts as complete: no red funding warning at all.
    expect(markup).not.toContain("未读取到资金费率历史数据");
    // Bucket-level rates are priced with candle closes, so they carry a badge.
    expect(markup).toContain(">估算<");
    expect(markup).toContain("上游仅提供桶内合计费率，按该桶本腿 K 线收盘价代理，不是逐笔结算价。");
    // The spot leg carries no warning and no badge.
    const leg2 = markup.slice(markup.indexOf("leg-2-returns"));
    expect(leg2.slice(0, leg2.indexOf("merged-pnl"))).not.toContain("未读取到资金费率历史数据");
    expect(leg2.slice(0, leg2.indexOf("merged-pnl"))).not.toContain(">估算<");
  });

  test("history without a settlement in the window is zero funding, not a red flag", () => {
    // Funding history exists (a settlement on the entry candle), but none falls
    // after the entry close: funding is exactly 0 and the total equals price.
    const noSettlement = renderPairTrade({
      result: pricedMixed([0, 1, 2, 3, 4, 5], [0]),
    });
    expect(noSettlement).toContain("+10.00%");
    expect(noSettlement).toContain("入场后尚无结算，资金收益按 0 计。");
    expect(noSettlement).not.toContain("未读取到资金费率历史数据");
    expect(noSettlement).not.toContain(">估算<");

    // Entry close unknown: price is computable, the holding window is not.
    const noEntryClose = renderPairTrade({ pairTradeEntryCloseTime: null });
    expect(noEntryClose).toContain("+10.00%");
    expect(noEntryClose).toContain("入场 K 线的真实收盘时间未知，资金费率窗口无法开启。");
    // An unknown entry close is not a missing-history warning.
    expect(noEntryClose).not.toContain("未读取到资金费率历史数据");
  });

  test("only unreadable funding history is red, and a spot leg is never red", () => {
    // A single bucket rate is readable history: the number shows as a
    // candle-priced estimate, with no red history warning.
    const single = renderPairTrade({
      result: pricedMixed([0, 1, 2, 3, 4, 5], [5]),
    });
    expect(single).not.toContain("未读取到资金费率历史数据");
    expect(single).toContain(">估算<");
    expect(single).toContain("-0.01%");
    expect(single).toContain("+9.99%");
    // Percentage badges only on the two values that exist; the price figure is
    // exact and the amount row has its own smaller badges. Counted per leg card
    // so the combined card's funding badges do not leak into the total.
    const leg1Card = cardMarkup(single, "leg-1-returns");
    expect(count(leg1Card, "data-estimate=\"percent\"")).toBe(2);
    expect(count(leg1Card, "data-estimate=\"amount\"")).toBe(2);
    expect(count(leg1Card, ">估算<")).toBe(4);
    // Leg1 (4) plus the combined card's funding and total (4). Leg2 is spot.
    expect(count(single, ">估算<")).toBe(8);

    // A legacy perp leg with no per-leg funding rows at all is the one warning.
    const noHistory = renderPairTrade({ result: legacyResult() as never });
    expect(noHistory).toContain("未读取到资金费率历史数据");

    // Spot-spot has no funding at all: exactly zero, never a red warning.
    const spotSpot = renderPairTrade({
      result: pricedSpotSpot([0, 1, 2, 3, 4, 5]),
      pairTradeEntryCloseTime: ENTRY_CLOSE_TIME,
    });
    expect(spotSpot).not.toContain("未读取到资金费率历史数据");
    expect(spotSpot).toContain("现货腿没有资金费率（按 0 计），价格收益即总收益。");
    expect(spotSpot).toContain("+10.00%");
  });

  test("a missing settlement price is reported separately from missing funding history", () => {
    // Candle prices are unusable, so the funding price cannot be proxied. The
    // lane still has history; only the price is missing.
    const noPrice = renderPairTrade({
      result: pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING, [...LEG1_CLOSES.slice(0, 5), Number.NaN]),
    });
    expect(noPrice).toContain("缺少可用的价格（结算价或入场价），资金收益暂不计算（非资金费率历史缺失）");
    expect(noPrice).not.toContain("未读取到资金费率历史数据");
  });

  test("shows placeholders instead of returns when nothing follows the entry candle", () => {
    const markup = renderPairTrade({
      result: pricedMixed([0, 1], []),
      pairTrade: pricedTrade(ENTRY_INDEX),
    });
    expect(markup).toContain("入场后尚无后续 K 线，暂无收益。");
    // "Not yet" must not turn red: no post-entry candle means nothing accrued.
    expect(markup).not.toContain("未读取到资金费率历史数据");
    // Every price/funding/total value is a placeholder, on both legs plus the
    // three combined values.
    expect(count(markup, "font-mono text-[13px] font-semibold text-gray-500\">--")).toBe(9);
  });

  test("fails closed when the viewport excludes every post-entry candle", () => {
    // The preset itself holds post-entry candles, but the chart viewport ends at
    // the entry candle: the cards must not borrow the full-preset last close.
    const full = pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING);
    const markup = renderPairTrade({
      result: full,
      pairTradeSourceResult: full,
      pairViewport: { startTime: 0, endTime: ENTRY_OPEN_TIME },
    });
    expect(markup).toContain("入场后尚无后续 K 线，暂无收益。");
    // No +10%/−10% price returns and no full-range funding may leak in.
    expect(markup).not.toContain("+10.00%");
    expect(markup).not.toContain("-10.00%");
    expect(markup).not.toContain("-0.05%");
    expect(markup).not.toContain("未读取到资金费率历史数据");
    expect(count(markup, "font-mono text-[13px] font-semibold text-gray-500\">--")).toBe(9);
  });

  test("reads funding from the uncropped preset source, not the viewport-cropped result", () => {
    const full = pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING);
    // The chart viewport starts at candle 4, so the cropped result no longer
    // retains the earlier settlements.
    const cropped = pricedMixed([4, 5], [4, 5]);
    const withSource = renderPairTrade({ result: cropped, pairTradeSourceResult: full });
    // All four post-entry settlements survive: the full accumulated funding.
    expect(withSource).toContain("-0.05%");
    expect(withSource).toContain("+9.95%");

    // Without the source prop only the cropped settlements remain, so the
    // earlier settlements are lost.
    const withoutSource = renderPairTrade({ result: cropped });
    expect(withoutSource).toContain("-0.03%");
    expect(withoutSource).toContain("+9.97%");
  });
});

describe("MixedAnalyticsDashboard per-leg USDT amounts", () => {
  test("scales each percentage by its own entry notional, with leg2 already holding β", () => {
    // Real helper output: leg2 notional is β × leg1 notional.
    const betaTwo = helperTrade(2);
    expect(betaTwo.firstNotionalUsd).toBe(10_000);
    expect(betaTwo.secondNotionalUsd).toBe(20_000);

    const markup = renderPairTrade({ pairTrade: betaTwo });
    const [leg1Price, leg1Funding, leg1Total] = legAmounts(markup, 1);
    const [leg2Price, leg2Funding, leg2Total] = legAmounts(markup, 2);

    // Leg1 long 100 → 110: +10% of $10,000. β must not touch this.
    expect(leg1Price).toBe("+$1,000.00");
    expect(leg1Funding).toBe("-$5.31");
    expect(leg1Total).toBe("+$994.69");
    // Leg2 short 50 → 55: −10% *of its own $20,000 notional* = −$2,000.
    expect(leg2Price).toBe("-$2,000.00");
    expect(leg2Funding).toBe("$0.00");
    expect(leg2Total).toBe("-$2,000.00");
  });

  test("β=2 doubles only the leg2 amount; percentages and leg1 stay identical", () => {
    const betaOne = renderPairTrade({ pairTrade: helperTrade(1) });
    const betaTwo = renderPairTrade({ pairTrade: helperTrade(2) });

    expect(legAmounts(betaOne, 1)[0]).toBe("+$1,000.00");
    expect(legAmounts(betaTwo, 1)[0]).toBe("+$1,000.00");
    expect(legAmounts(betaOne, 2)[0]).toBe("-$1,000.00");
    expect(legAmounts(betaTwo, 2)[0]).toBe("-$2,000.00");

    // The percentages are unchanged: they are per-leg, never β-scaled.
    for (const pct of ["+10.00%", "-10.00%"]) {
      expect(betaOne).toContain(pct);
      expect(betaTwo).toContain(pct);
    }
    expect(count(betaTwo, ">-$2,000.00<")).toBeGreaterThanOrEqual(2);
    expect(betaOne).not.toContain("-$2,000.00");
  });

  test("the two price amounts add up to the combined card's price PnL", () => {
    const cents = (label: string) => {
      const negative = label.startsWith("-");
      const value = Number(label.replace(/[+$,\-]/g, ""));
      return Math.round(value * 100) * (negative ? -1 : 1);
    };
    for (const beta of [1, 2, 1.25, 0.5]) {
      const trade = helperTrade(beta);
      const markup = renderPairTrade({ pairTrade: trade });
      const leg1Price = legAmounts(markup, 1)[0];
      const leg2Price = legAmounts(markup, 2)[0];
      const sumCents = cents(leg1Price) + cents(leg2Price);
      const expected = trade.points[trade.points.length - 1].pnlUsd!;
      // Rounded cents agree with the helper's unrounded PnL to within a cent.
      expect(Math.abs(sumCents / 100 - expected)).toBeLessThan(0.011);
      // The combined card's price row is the helper's own PnL for that candle,
      // in the same signed-thousands shape as the leg rows.
      expect(combinedAmounts(markup)[0]).toBe(signedUsd(expected));
      expect(cents(combinedAmounts(markup)[0])).toBe(sumCents);
    }
  });

  test("funding amount plus price amount equals the total amount before rounding", () => {
    const result = pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING);
    const trade = helperTrade(1.25);
    const legReturns = calculatePairLegReturns(result, trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);

    for (const [legReturn, notional] of [
      [legReturns.first, trade.firstNotionalUsd],
      [legReturns.second, trade.secondNotionalUsd],
    ] as const) {
      const amounts = legReturnAmountsUsd(legReturn, notional);
      // Exact identity on the unrounded values the UI scales.
      expect(amounts.price! + amounts.funding!).toBeCloseTo(amounts.total!, 10);
      // The percentages themselves satisfy the same identity.
      expect(legReturn.priceReturnPercent! + legReturn.fundingReturnPercent!).toBeCloseTo(legReturn.totalReturnPercent!, 10);
    }
  });

  test("unknown or absent inputs render -- and never a fabricated zero", () => {
    // No post-entry candle: every percentage and amount is a placeholder.
    const noCandle = renderPairTrade({
      result: pricedMixed([0, 1], []),
      pairTrade: pricedTrade(ENTRY_INDEX),
    });
    for (const leg of [1, 2] as const) {
      expect(legAmounts(noCandle, leg)).toEqual(["--", "--", "--"]);
    }

    // An unusable notional makes every amount unknowable while percentages stay.
    const badNotional = renderPairTrade({
      pairTrade: { ...helperTrade(1), secondNotionalUsd: Number.NaN },
    });
    expect(legAmounts(badNotional, 2)).toEqual(["--", "--", "--"]);
    expect(legAmounts(badNotional, 1)[0]).toBe("+$1,000.00");
    expect(badNotional).toContain("-10.00%");
    expect(badNotional).toContain("本金不可用");
  });

  test("exact zero amounts stay $0.00, and rounded-away negatives never print -$0.00", () => {
    // Spot leg2 funding is exactly 0: a real zero, not missing data.
    const markup = renderPairTrade();
    expect(legAmounts(markup, 2)[1]).toBe("$0.00");
    expect(legAmounts(markup, 2)[2]).toBe("-$1,250.00");
    expect(markup).not.toContain("-$0.00");

    // A sub-cent negative must not surface as -$0.00.
    expect(signedUsd(-0.001)).toBe("$0.00");
    expect(signedUsd(-0.004)).toBe("$0.00");
    expect(signedUsd(-0)).toBe("$0.00");
    expect(signedUsd(-0.005)).toBe("-$0.01");
    expect(signedUsd(0)).toBe("$0.00");
    expect(signedUsd(1234.5)).toBe("+$1,234.50");
    expect(signedUsd(null)).toBe("--");
    expect(signedUsd(Number.NaN)).toBe("--");
    expect(signedUsd(Number.POSITIVE_INFINITY)).toBe("--");
  });

  test("amount colors follow the amount's own sign, not the percentage's", () => {
    const markup = renderPairTrade();
    // Leg2 price is negative, funding is exactly zero, total is negative.
    const start = markup.indexOf('data-scenario-card="leg-2-returns"');
    const card = markup.slice(start, markup.indexOf("data-scenario-card=", start + 1));
    expect(card).toMatch(/text-red-300" data-leg-amount="price">-\$1,250\.00</);
    // An exact-zero amount is neutral grey, never red or green.
    expect(card).toMatch(/text-gray-200" data-leg-amount="funding">\$0\.00</);
    expect(card).toMatch(/text-red-300" data-leg-amount="total">-\$1,250\.00</);
    // Leg1's positive price amount is positive-toned.
    const leg1Start = markup.indexOf('data-scenario-card="leg-1-returns"');
    const leg1Card = markup.slice(leg1Start, markup.indexOf("data-scenario-card=", leg1Start + 1));
    expect(leg1Card).toMatch(/text-emerald-300" data-leg-amount="price">\+\$1,000\.00</);
  });

  test("guards against overflow and invalid percentages", () => {
    expect(legAmountUsd(10, 10_000)).toBeCloseTo(1000, 10);
    // Scaling by MAX_VALUE/100 stays finite, so it is representable, not guarded.
    expect(legAmountUsd(10, Number.MAX_VALUE)).toBeCloseTo(Number.MAX_VALUE / 10, -10);
    // Genuine overflow of the product fails closed.
    expect(legAmountUsd(1e308, 1e308)).toBeNull();
    expect(legAmountUsd(1e308, 1e3)).toBeNull();
    expect(legAmountUsd(Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    expect(legAmountUsd(null, 10_000)).toBeNull();
    expect(legAmountUsd(Number.NaN, 10_000)).toBeNull();
    expect(legAmountUsd(Number.POSITIVE_INFINITY, 10_000)).toBeNull();
    expect(legAmountUsd(10, null)).toBeNull();
    expect(legAmountUsd(10, Number.NaN)).toBeNull();
    expect(legAmountUsd(10, 0)).toBeNull();
    expect(legAmountUsd(10, -100)).toBeNull();
    // A genuine zero percentage is a real 0, not a missing amount.
    expect(legAmountUsd(0, 10_000)).toBe(0);
    expect(signedUsd(legAmountUsd(0, 10_000))).toBe("$0.00");
  });

  test("shows each leg's own notional so the amount can be checked", () => {
    const markup = renderPairTrade({ pairTrade: helperTrade(2) });
    expect(markup).toContain("USDT 金额按本腿入场名义本金 $10,000.00 折算");
    expect(markup).toContain("USDT 金额按本腿入场名义本金 $20,000.00 折算（已含 β）");
  });
});

describe("MixedAnalyticsDashboard combined PnL card", () => {
  /** Both legs perp and funded, so funding is never trivially zero. */
  function perpMarkup(overrides: Record<string, unknown> = {}) {
    return renderPairTrade({
      result: perpPerpResult(),
      pairTrade: helperTrade(2),
      ...overrides,
    });
  }

  test("sums both legs' funding amounts (β≠1, both legs funded) and never adds the leg percentages", () => {
    const trade = helperTrade(2);
    const result = perpPerpResult();
    const legReturns = calculatePairLegReturns(result, trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);

    // The funding amounts the card must add: each leg's own notional, so β is
    // already inside leg2's figure.
    const firstFunding = legReturnAmountsUsd(legReturns.first, trade.firstNotionalUsd).funding!;
    const secondFunding = legReturnAmountsUsd(legReturns.second, trade.secondNotionalUsd).funding!;
    // Neither leg is zero here, which is exactly what a spot-only test cannot prove.
    expect(firstFunding).toBeCloseTo(-8.5, 10);
    expect(secondFunding).toBeCloseTo(8.48, 10);

    const markup = perpMarkup();
    const [priceLabel, fundingLabel, totalLabel] = combinedAmounts(markup);

    // price row is the canonical price PnL of the latest candle.
    const pricePnl = trade.points[trade.points.length - 1].pnlUsd!;
    expect(priceLabel).toBe(signedUsd(pricePnl));
    expect(priceLabel).toBe("-$1,000.00");
    // funding is the two amounts added, not one leg and not 0.
    expect(fundingLabel).toBe(signedUsd(firstFunding + secondFunding));
    expect(fundingLabel).toBe("-$0.02");
    // total = price + funding.
    expect(totalLabel).toBe(signedUsd(pricePnl + firstFunding + secondFunding));
    expect(totalLabel).toBe("-$1,000.02");
  });

  test("combined percentages use the fixed 10,000 basis, not summed leg percentages", () => {
    const trade = helperTrade(2);
    const result = perpPerpResult();
    const legReturns = calculatePairLegReturns(result, trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);
    const markup = perpMarkup();

    const pricePnl = trade.points[trade.points.length - 1].pnlUsd!;
    const funding = legReturnAmountsUsd(legReturns.first, trade.firstNotionalUsd).funding!
      + legReturnAmountsUsd(legReturns.second, trade.secondNotionalUsd).funding!;

    const combined = combinedReturnAmounts({
      priceUsd: pricePnl,
      firstLeg: legReturns.first,
      firstNotionalUsd: trade.firstNotionalUsd,
      secondLeg: legReturns.second,
      secondNotionalUsd: trade.secondNotionalUsd,
    });
    expect(combined.basisUsd).toBe(10_000);
    // −1000 USD on a 10,000 basis is exactly −10%, regardless of the 30,000
    // total notional or the two legs' own percentages.
    expect(combined.pricePercent).toBeCloseTo(-10, 10);
    expect(combined.pricePercent).toBeCloseTo((pricePnl / 10_000) * 100, 12);
    expect(combined.fundingPercent).toBeCloseTo((funding / 10_000) * 100, 10);
    expect(combined.totalPercent).toBeCloseTo(((pricePnl + funding) / 10_000) * 100, 10);

    // The printed percentages must not be the sum of the two leg percentages.
    const legPercentSum = legReturns.first.totalReturnPercent! + legReturns.second.totalReturnPercent!;
    expect(combined.totalPercent).not.toBeCloseTo(legPercentSum, 3);
    expect(markup).toContain("以 10,000 报价币（当前界面 USDT）为基准折算百分比");
    // −10% price + −0.0002% funding ≈ −10.00% total, all on the same basis.
    const percents = cardPercents(markup, "merged-pnl");
    expect(percents[0]).toBe("-10.00%");
    expect(percents[2]).toBe("-10.00%");
  });

  test("price plus funding equals the total amount before rounding", () => {
    for (const beta of [1, 2, 1.25, 0.5]) {
      const trade = helperTrade(beta);
      const result = perpPerpResult();
      const legReturns = calculatePairLegReturns(result, trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);
      const combined = combinedReturnAmounts({
        priceUsd: trade.points[trade.points.length - 1].pnlUsd,
        firstLeg: legReturns.first,
        firstNotionalUsd: trade.firstNotionalUsd,
        secondLeg: legReturns.second,
        secondNotionalUsd: trade.secondNotionalUsd,
      });
      expect(combined.priceUsd).not.toBeNull();
      expect(combined.fundingUsd).not.toBeNull();
      expect(combined.totalUsd).toBeCloseTo(combined.priceUsd! + combined.fundingUsd!, 10);
      // The same identity holds for the printed percentages (same basis).
      expect(combined.totalPercent).toBeCloseTo(combined.pricePercent! + combined.fundingPercent!, 10);
    }
  });

  test("every combined row shows both a percentage and a USDT amount", () => {
    const markup = perpMarkup();
    const percents = cardPercents(markup, "merged-pnl");
    const amounts = combinedAmounts(markup);
    expect(percents).toHaveLength(3);
    expect(amounts).toHaveLength(3);
    for (const percent of percents) expect(percent).toMatch(/^[+\-]?\d+\.\d{2}%$/);
    for (const amount of amounts) expect(amount).toMatch(/^[+\-]?\$[\d,]+\.\d{2}$/);
  });

  test("a leg with unknown funding keeps the price row and explains the gap", () => {
    // Second notional unusable → leg2 funding amount unknown → funding total
    // unknown, but the price row survives.
    const markup = perpMarkup({ pairTrade: { ...helperTrade(2), secondNotionalUsd: Number.NaN } });
    const [price, funding, total] = combinedAmounts(markup);
    expect(price).toBe("-$1,000.00");
    expect(funding).toBe("--");
    expect(total).toBe("--");
    expect(markup).toContain("资金收益暂无可用值，仅保留价格收益");
    // No false "history incomplete" claim on the combined card.
    expect(cardMarkup(markup, "merged-pnl")).not.toContain("未读取到资金费率历史数据");
  });

  test("spot funding is a real zero, so the combined total still resolves", () => {
    const markup = renderPairTrade();
    const [, funding, total] = combinedAmounts(markup);
    // Leg2 spot contributes exactly 0; leg1's funding is still added.
    expect(funding).toBe("-$5.31");
    expect(total).toBe("+$118.14");
    // A genuine zero is never rendered as unknown.
    expect(funding).not.toBe("--");
  });

  test("no post-entry candle blanks all three combined rows", () => {
    const markup = renderPairTrade({
      result: pricedMixed([0, 1], []),
      pairTrade: pricedTrade(ENTRY_INDEX),
    });
    expect(combinedAmounts(markup)).toEqual(["--", "--", "--"]);
    expect(cardPercents(markup, "merged-pnl")).toEqual(["--", "--", "--"]);
    // Not a fabricated $0.00 and not a missing-data alarm.
    expect(cardMarkup(markup, "merged-pnl")).not.toContain("$0.00");
    expect(cardMarkup(markup, "merged-pnl")).not.toContain("未读取到资金费率历史数据");
  });

  test("guards non-finite inputs and keeps sign/zero handling", () => {
    const legReturn = {
      priceReturnPercent: null,
      fundingReturnPercent: 0,
      totalReturnPercent: null,
      fundingAnnualizedPercent: null,
      fundingIncomplete: false,
      priceMissing: false,
      fundingPriceBasis: null,
      isSpot: true,
      entryPrice: null,
      latestPrice: null,
      fundingSampleBuckets: 0,
      fundingSampleCount: 0,
      fundingCoverageStartTime: null,
      fundingCoverageEndTime: null,
      fundingNote: "spot" as const,
    };

    // NaN price is unknown, never 0.
    const nanPrice = combinedReturnAmounts({
      priceUsd: Number.NaN, firstLeg: legReturn, firstNotionalUsd: 10_000,
      secondLeg: legReturn, secondNotionalUsd: 10_000,
    });
    expect(nanPrice.priceUsd).toBeNull();
    expect(nanPrice.pricePercent).toBeNull();
    expect(nanPrice.fundingUsd).toBe(0);
    expect(nanPrice.totalUsd).toBeNull();

    // Overflow in the funding sum fails closed rather than printing Infinity.
    const overflow = combinedReturnAmounts({
      priceUsd: 10,
      firstLeg: { ...legReturn, fundingReturnPercent: Number.MAX_VALUE },
      firstNotionalUsd: 10_000,
      secondLeg: { ...legReturn, fundingReturnPercent: Number.MAX_VALUE },
      secondNotionalUsd: 10_000,
    });
    expect(overflow.fundingUsd).toBeNull();
    expect(overflow.totalUsd).toBeNull();
    // The price row is unaffected by the funding overflow.
    expect(overflow.priceUsd).toBe(10);

    // Signed zero and exact zero amounts.
    const zero = combinedReturnAmounts({
      priceUsd: 0, firstLeg: legReturn, firstNotionalUsd: 10_000,
      secondLeg: legReturn, secondNotionalUsd: 10_000,
    });
    expect(zero.priceUsd).toBe(0);
    expect(zero.totalUsd).toBe(0);
    expect(signedUsd(zero.totalUsd)).toBe("$0.00");
    expect(signedUsd(-0)).toBe("$0.00");
  });

  test("propagates the proxy estimate badge to funding and total only", () => {
    // Perp-perp buckets are priced with candle closes, so funding is estimated.
    const markup = perpMarkup();
    const card = cardMarkup(markup, "merged-pnl");
    // The price row is exact: no badge before the funding column.
    const priceSection = card.slice(0, card.indexOf("资金费率收益"));
    expect(priceSection).not.toContain("data-estimate");
    expect(count(card, "data-estimate=\"percent\"")).toBe(2);
    expect(count(card, "data-estimate=\"amount\"")).toBe(2);
  });

  test("funding with an all-mark basis carries no estimate badge", () => {
    const result = pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING);
    const combined = combinedReturnAmounts({
      priceUsd: 100,
      firstLeg: { ...calculatePairLegReturns(result, helperTrade(1.25), 5 * HOUR_MS, ENTRY_CLOSE_TIME).first, fundingPriceBasis: "settlement-mark" },
      firstNotionalUsd: 10_000,
      secondLeg: { ...calculatePairLegReturns(result, helperTrade(1.25), 5 * HOUR_MS, ENTRY_CLOSE_TIME).second, fundingPriceBasis: "settlement-mark" },
      secondNotionalUsd: 12_500,
    });
    expect(combined.fundingEstimated).toBe(false);
  });
});

describe("MixedAnalyticsDashboard combined annualized funding", () => {
  /** Both legs perp and funded; β and leg-1 notional stay configurable. */
  function combinedFor(beta: number, firstNotionalUsd = 10_000) {
    const trade = helperTrade(beta, firstNotionalUsd);
    const result = perpPerpResult();
    const legReturns = calculatePairLegReturns(result, trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);
    const combined = combinedReturnAmounts({
      priceUsd: trade.points[trade.points.length - 1].pnlUsd,
      firstLeg: legReturns.first,
      firstNotionalUsd: trade.firstNotionalUsd,
      secondLeg: legReturns.second,
      secondNotionalUsd: trade.secondNotionalUsd,
    });
    return { trade, legReturns, combined };
  }

  test("with β=1 and a 10,000 leg-1 notional the combined rate is the two legs added", () => {
    const { trade, legReturns, combined } = combinedFor(1);
    expect(trade.firstNotionalUsd).toBe(10_000);
    expect(trade.secondNotionalUsd).toBe(10_000);
    const annual1 = legReturns.first.fundingAnnualizedPercent!;
    const annual2 = legReturns.second.fundingAnnualizedPercent!;
    // Both legs genuinely contribute (one negative, one positive), so a
    // spot-only fixture could not prove this.
    expect(annual1).toBeCloseTo(-186.15, 6);
    expect(annual2).toBeCloseTo(92.856, 6);
    expect(combined.annualizedPercent).toBeCloseTo(annual1 + annual2, 10);
    expect(combined.annualizedPercent).toBeCloseTo(-93.294, 6);
  });

  test("β=2 adds the second leg twice: annual1 + 2 × annual2", () => {
    const { trade, legReturns, combined } = combinedFor(2);
    expect(trade.secondNotionalUsd).toBe(20_000);
    const annual1 = legReturns.first.fundingAnnualizedPercent!;
    const annual2 = legReturns.second.fundingAnnualizedPercent!;
    expect(combined.annualizedPercent).toBeCloseTo(annual1 + 2 * annual2, 10);
    // β is already the notional ratio: it must not be applied a second time.
    expect(combined.annualizedPercent).not.toBeCloseTo(annual1 + 4 * annual2, 6);
    expect(combined.annualizedPercent).toBeCloseTo(-0.438, 6);
  });

  test("a non-10,000 leg-1 notional is still restated on the fixed 10,000 basis", () => {
    const oneX = combinedFor(2, 10_000);
    const twoX = combinedFor(2, 20_000);
    expect(twoX.trade.firstNotionalUsd).toBe(20_000);
    expect(twoX.trade.secondNotionalUsd).toBe(40_000);
    // Each leg's rate is weighted by its own notional and divided by the *fixed*
    // 10,000 reference, so doubling both notionals doubles the combined rate
    // instead of leaving it unchanged (that would be normalising by the notional).
    expect(twoX.combined.annualizedPercent).toBeCloseTo(2 * oneX.combined.annualizedPercent!, 8);
    expect(oneX.combined.annualizedPercent).toBeCloseTo(-0.438, 6);
    expect(twoX.combined.annualizedPercent).toBeCloseTo(-0.876, 6);

    // A 5,000 leg-1 notional halves leg1's weight while leg2 keeps its own.
    const half = combinedFor(2, 5_000);
    expect(half.trade.firstNotionalUsd).toBe(5_000);
    expect(half.combined.annualizedPercent).toBeCloseTo(-0.219, 6);
  });

  test("equals the combined funding percent extrapolated over the real holding window", () => {
    for (const [beta, notional] of [[1, 10_000], [2, 10_000], [2, 20_000], [1.25, 5_000]] as const) {
      const { combined } = combinedFor(beta, notional);
      // Real helper windows, never a hand-coded duration.
      const holdingMs = 4 * HOUR_MS;
      const fromFundingPercent = combined.fundingPercent! * ANALYTICS_YEAR_MS / holdingMs;
      expect(combined.annualizedPercent).toBeCloseTo(fromFundingPercent, 8);
    }
  });

  test("spot annualized is a real zero and never breaks the combined rate", () => {
    const trade = helperTrade(1.25);
    const legReturns = calculatePairLegReturns(pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING), trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);
    expect(legReturns.second.isSpot).toBe(true);
    expect(legReturns.second.fundingAnnualizedPercent).toBe(0);
    const combined = combinedReturnAmounts({
      priceUsd: 0,
      firstLeg: legReturns.first,
      firstNotionalUsd: trade.firstNotionalUsd,
      secondLeg: legReturns.second,
      secondNotionalUsd: trade.secondNotionalUsd,
    });
    // Leg2 contributes exactly 0, so the combined rate is leg1's weighted rate.
    expect(combined.annualizedPercent).toBeCloseTo(legReturns.first.fundingAnnualizedPercent!, 10);
    expect(combined.annualizedPercent).not.toBeNull();
  });

  test("unknown annualized, unusable notional and overflow all fail closed", () => {
    const spotLeg = {
      priceReturnPercent: 0,
      fundingReturnPercent: 0,
      totalReturnPercent: 0,
      fundingAnnualizedPercent: 0,
      fundingIncomplete: false,
      priceMissing: false,
      fundingPriceBasis: null,
      isSpot: true,
      entryPrice: null,
      latestPrice: null,
      fundingSampleBuckets: 0,
      fundingSampleCount: 0,
      fundingCoverageStartTime: null,
      fundingCoverageEndTime: null,
      fundingNote: "spot" as const,
    };
    const base = { priceUsd: 0, firstNotionalUsd: 10_000, secondNotionalUsd: 10_000 };

    // A null annualized rate on either leg makes the combined rate unknown.
    for (const leg of [
      { ...spotLeg, fundingAnnualizedPercent: null },
      { ...spotLeg, fundingAnnualizedPercent: Number.NaN },
      { ...spotLeg, fundingAnnualizedPercent: Number.POSITIVE_INFINITY },
    ]) {
      expect(combinedReturnAmounts({ ...base, firstLeg: leg, secondLeg: spotLeg }).annualizedPercent).toBeNull();
      expect(combinedReturnAmounts({ ...base, firstLeg: spotLeg, secondLeg: leg }).annualizedPercent).toBeNull();
    }

    // An unusable notional is unknown, not zero.
    for (const notional of [null, Number.NaN, 0, -1_000, Number.POSITIVE_INFINITY]) {
      expect(combinedAnnualizedContribution(100, notional)).toBeNull();
      expect(combinedReturnAmounts({ ...base, firstLeg: spotLeg, secondLeg: spotLeg, secondNotionalUsd: notional }).annualizedPercent).toBeNull();
    }

    // Overflowing weights fail closed instead of printing Infinity.
    expect(combinedAnnualizedContribution(Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    expect(combinedAnnualizedContribution(1e308, 1e308)).toBeNull();
    expect(combinedReturnAmounts({
      ...base, firstLeg: { ...spotLeg, fundingAnnualizedPercent: 1e308 },
      secondLeg: { ...spotLeg, fundingAnnualizedPercent: 1e308 },
      firstNotionalUsd: 1e308, secondNotionalUsd: 1e308,
    }).annualizedPercent).toBeNull();

    // Exact zero is preserved as a real 0, never converted to unknown.
    expect(combinedAnnualizedContribution(0, 10_000)).toBe(0);
    expect(combinedReturnAmounts({ ...base, firstLeg: spotLeg, secondLeg: spotLeg }).annualizedPercent).toBe(0);
  });

  test("no post-entry candle blanks the annualized rate", () => {
    const markup = renderPairTrade({
      result: pricedMixed([0, 1], []),
      pairTrade: pricedTrade(ENTRY_INDEX),
    });
    const card = cardMarkup(markup, "merged-pnl");
    expect(card).toContain("资金费率年化 --");
    // Not a fabricated 0.00%.
    expect(card).not.toContain("资金费率年化 $0.00");
    expect(card).not.toMatch(/资金费率年化 [+-]?0\.00%/);
  });

  test("renders the annualized line in grey under the three columns, with basis copy", () => {
    // Spot-spot has no funding lane at all, so no basis is proxied and the copy
    // closes its bracket cleanly (the perp fixtures carry an 估算 badge here).
    const markup = renderPairTrade({
      result: pricedSpotSpot([0, 1, 2, 3, 4, 5]),
      pairTradeEntryCloseTime: ENTRY_CLOSE_TIME,
    });
    const card = cardMarkup(markup, "merged-pnl");
    expect(card).toContain("资金费率年化");
    expect(card).toContain("（按持有时长折算，非未来收益预测）");
    expect(card).toContain("以 10,000 报价币（当前界面 USDT）为基准折算百分比");
    // The line sits after the amounts and uses the same small grey styling.
    const amountIndex = card.lastIndexOf("data-leg-amount");
    expect(card.indexOf("资金费率年化")).toBeGreaterThan(amountIndex);
    expect(card).toMatch(/text-gray-500">资金费率年化/);
    // Still six cards in two rows of three.
    expect(count(markup, "data-scenario-card=")).toBe(6);
    expect(markup).toContain("grid-cols-3");
  });

  test("propagates the proxy estimate badge to the annualized line only when it is a real value", () => {
    // Perp-perp bucket pricing is a proxy, so the annualized rate is an estimate.
    const proxied = cardMarkup(renderPairTrade({ result: perpPerpResult(), pairTrade: helperTrade(2) }), "merged-pnl");
    expect(proxied).toContain("data-estimate=\"annualized\"");
    expect(proxied).toContain("，估算");

    // Unknown rate: no badge on a placeholder.
    const missing = cardMarkup(renderPairTrade({
      result: pricedMixed([0, 1], []),
      pairTrade: pricedTrade(ENTRY_INDEX),
    }), "merged-pnl");
    expect(missing).not.toContain("data-estimate=\"annualized\"");

    // All-mark basis carries no estimate badge.
    const trade = helperTrade(1.25);
    const legReturns = calculatePairLegReturns(pricedMixed([0, 1, 2, 3, 4, 5], COMPLETE_FUNDING), trade, 5 * HOUR_MS, ENTRY_CLOSE_TIME);
    const exact = combinedReturnAmounts({
      priceUsd: 0,
      firstLeg: { ...legReturns.first, fundingPriceBasis: "settlement-mark" },
      firstNotionalUsd: trade.firstNotionalUsd,
      secondLeg: { ...legReturns.second, fundingPriceBasis: "settlement-mark" },
      secondNotionalUsd: trade.secondNotionalUsd,
    });
    expect(exact.fundingEstimated).toBe(false);
    expect(exact.annualizedPercent).not.toBeNull();
  });
});
