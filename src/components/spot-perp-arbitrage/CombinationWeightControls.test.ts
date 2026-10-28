import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CombinationWeightControls,
  type PairBetaMode,
  pairTradeUnavailableReason,
  combinationResetTransition,
  resolvePairTradeEntryTime,
  resetCombinationTransition,
  resolvePairModelSpec,
  selectionFromPlotPixelX,
  selectedEntryTime,
  setViewTransition,
  validCustomBeta,
  fitWindowPreset,
  DEFAULT_PAIR_FIT_WINDOW_SPEC,
  fitWindowUnavailableCopy,
  fitWindowModeLabel,
  formatRawPriceAxis,
  fitWindowSetEnd,
  fitWindowSetStart,
  pairBetaModeLabel,
  type CombinationViewSnapshot,
} from "./CombinationWeightControls";

const pairTradeCustom: CombinationViewSnapshot = {
  view: "pair-trade",
  customBeta: 1.5,
  betaMode: "custom",
};

describe("combination view switching", () => {
  test("switching to OLS keeps the applied custom beta and its mode untouched", () => {
    expect(setViewTransition(pairTradeCustom, "ols")).toEqual({
      view: "ols",
      customBeta: 1.5,
      betaMode: "custom",
    });
  });

  test("switching back to pair-trade keeps the custom beta and mode", () => {
    const ols: CombinationViewSnapshot = { ...pairTradeCustom, view: "ols" };
    expect(setViewTransition(ols, "pair-trade")).toEqual({
      view: "pair-trade",
      customBeta: 1.5,
      betaMode: "custom",
    });
  });

  test("switching view does not invent a custom beta for the automatic state", () => {
    const initial: CombinationViewSnapshot = { view: "plain", customBeta: null, betaMode: "auto" };
    expect(setViewTransition(initial, "pair-trade")).toEqual({ view: "pair-trade", customBeta: null, betaMode: "auto" });
    expect(setViewTransition(initial, "ols")).toEqual({ view: "ols", customBeta: null, betaMode: "auto" });
    expect(setViewTransition(initial, "plain")).toEqual(initial);
  });

  test("plain and OLS remain automatic: the view transition carries no weighting intent", () => {
    expect(setViewTransition({ view: "pair-trade", customBeta: 2.5, betaMode: "custom" }, "plain")).toEqual({
      view: "plain",
      customBeta: 2.5,
      betaMode: "custom",
    });
  });

  test("custom β is resolved only in pair-trade; switching to OLS restores automatic fit", () => {
    expect(resolvePairModelSpec("pair-trade", 1.5)).toEqual({ mode: "custom", beta: 1.5 });
    expect(resolvePairModelSpec("ols", 1.5)).toEqual({ mode: "ols" });
    expect(resolvePairModelSpec("plain", 1.5)).toEqual({ mode: "ols" });
  });
});

describe("pair-trade beta mode transitions", () => {
  test("mode labels distinguish every source", () => {
    expect(pairBetaModeLabel("auto")).toBe("自动 OLS 拟合");
    expect(pairBetaModeLabel("min-variance")).toBe("最小方差配比");
    expect(pairBetaModeLabel("one")).toBe("1");
    expect(pairBetaModeLabel("custom")).toBe("自定义");
  });

  test("a preset mode carries no frozen numeric beta", () => {
    const preset: CombinationViewSnapshot = { view: "pair-trade", customBeta: null, betaMode: "min-variance" };
    expect(setViewTransition(preset, "pair-trade")).toEqual({ view: "pair-trade", customBeta: null, betaMode: "min-variance" });
  });

  test("a data/preset reset returns beta to automatic mode while a view-only reset preserves it", () => {
    const unit: CombinationViewSnapshot = { view: "pair-trade", customBeta: null, betaMode: "one" };
    expect(combinationResetTransition(unit, true, false)).toEqual({ view: "pair-trade", customBeta: null, betaMode: "auto" });
    expect(combinationResetTransition(unit, false, true)).toEqual({ view: "plain", customBeta: null, betaMode: "one" });
    expect(combinationResetTransition(unit, true, true)).toEqual(resetCombinationTransition());
  });
});

describe("reset transition", () => {
  test("reset returns to the plain automatic default with no custom beta", () => {
    expect(resetCombinationTransition()).toEqual({
      view: "plain",
      customBeta: null,
      betaMode: "auto",
    });
  });

  test("data range or interval resets clear β and return the mode to auto while preserving views", () => {
    expect(combinationResetTransition({ view: "ols", customBeta: 1.7, betaMode: "custom" }, true, false)).toEqual({ view: "ols", customBeta: null, betaMode: "auto" });
    expect(combinationResetTransition({ view: "pair-trade", customBeta: 1.7, betaMode: "min-variance" }, true, false)).toEqual({ view: "pair-trade", customBeta: null, betaMode: "auto" });
  });

  test("market identity changes reset to plain and clear custom β", () => {
    expect(combinationResetTransition({ view: "pair-trade", customBeta: 2.25, betaMode: "custom" }, true, true)).toEqual({ view: "plain", customBeta: null, betaMode: "auto" });
    expect(combinationResetTransition({ view: "ols", customBeta: null, betaMode: "auto" }, false, true)).toEqual({ view: "plain", customBeta: null, betaMode: "auto" });
  });

  test("a view-only reset preserves β and mode, and a single reset key retains legacy full reset semantics", () => {
    expect(combinationResetTransition({ view: "pair-trade", customBeta: 1.2, betaMode: "custom" }, false, true)).toEqual({ view: "plain", customBeta: 1.2, betaMode: "custom" });
    expect(combinationResetTransition({ view: "pair-trade", customBeta: 1.2, betaMode: "custom" }, true, true)).toEqual(resetCombinationTransition());
  });
});

describe("fit window control transitions", () => {
  test("the initial and reset fit window preserves full-preset behavior", () => {
    expect(DEFAULT_PAIR_FIT_WINDOW_SPEC).toEqual({ mode: "all" });
    expect(fitWindowModeLabel(DEFAULT_PAIR_FIT_WINDOW_SPEC.mode)).toBe("全部对齐样本");
    expect(fitWindowModeLabel("custom")).toBe("自定义起止");
    expect(fitWindowPreset("all", 10, 90)).toEqual({ mode: "all", startTime: 10, endTime: 90 });
  });
  test("preset starts fresh and all resets both endpoints", () => {
    expect(fitWindowPreset("30d", 10, 90)).toEqual({ mode: "30d" });
    expect(fitWindowPreset("7d", 10, 90, { mode: "30d", endTime: 70 })).toEqual({ mode: "7d", endTime: 70 });
    expect(fitWindowPreset("all", 10, 90)).toEqual({ mode: "all", startTime: 10, endTime: 90 });
  });
  test("manual start preserves effective end and switches to custom mode", () => {
    expect(fitWindowSetStart({ mode: "90d", endTime: 90 }, 40)).toEqual({ mode: "custom", startTime: 40, endTime: 90 });
    expect(fitWindowSetStart({ mode: "all", startTime: 10, endTime: 90 }, 40)).toEqual({ mode: "custom", startTime: 40, endTime: 90 });
  });
  test("all-mode manual end starts custom fit at first sample; duration mode stays preset", () => {
    expect(fitWindowSetEnd({ mode: "all", startTime: 10, endTime: 90 }, 50, 10)).toEqual({ mode: "custom", startTime: 10, endTime: 50 });
    expect(fitWindowSetEnd({ mode: "30d" }, 50, 10)).toEqual({ mode: "30d", endTime: 50 });
  });
  test("custom beta diagnostics use the custom regression spec and fit copy distinguishes scenario availability", () => {
    expect(resolvePairModelSpec("pair-trade", 1.4)).toEqual({ mode: "custom", beta: 1.4 });
    expect(fitWindowUnavailableCopy(null, 12, false)).toContain("自动 β 不可用");
    expect(fitWindowUnavailableCopy(null, 12, true)).toContain("自定义 β 情景仍可运行");
    expect(fitWindowUnavailableCopy("fit-start-unavailable", 0, true)).toContain("拟合起点");
    expect(fitWindowUnavailableCopy("model-unavailable", 24, true)).toContain("自定义 β 情景仍可运行");
  });
});

describe("custom beta validation", () => {
  test("accepts positive finite numbers, including fractions", () => {
    expect(validCustomBeta("1")).toBe(1);
    expect(validCustomBeta("0.25")).toBe(0.25);
    expect(validCustomBeta("2.75")).toBe(2.75);
  });

  test("rejects empty, zero, negative and non-finite input", () => {
    expect(validCustomBeta("")).toBeNull();
    expect(validCustomBeta("0")).toBeNull();
    expect(validCustomBeta("-1")).toBeNull();
    expect(validCustomBeta("Infinity")).toBeNull();
    expect(validCustomBeta("NaN")).toBeNull();
    expect(validCustomBeta("abc")).toBeNull();
    expect(validCustomBeta(null)).toBeNull();
    expect(validCustomBeta(undefined)).toBeNull();
  });
});

describe("raw subplot axis formatting", () => {
  test("small positive prices remain distinguishable instead of rounding to zero", () => {
    expect(formatRawPriceAxis(0.000011)).not.toBe("0.0000");
    expect(formatRawPriceAxis(0.000011)).not.toBe(formatRawPriceAxis(0.000021));
    expect(formatRawPriceAxis(0.00000123)).toContain("e-");
    expect(formatRawPriceAxis(0)).toBe("0");
  });
});

describe("pair-trade unavailable copy", () => {
  test("maps each library reason to honest, non-promissory copy", () => {
    expect(pairTradeUnavailableReason("invalid-beta")).toContain("β");
    expect(pairTradeUnavailableReason("insufficient-points")).toContain("对齐收盘点");
    expect(pairTradeUnavailableReason("model-unavailable")).toContain("自动情景");
    expect(pairTradeUnavailableReason("insufficient-fit-points")).toContain("自定义 β");
    expect(pairTradeUnavailableReason("invalid-notional")).toContain("名义本金");
    expect(pairTradeUnavailableReason("something-new")).toContain("something-new");
    expect(pairTradeUnavailableReason(null)).toContain("缺少");
  });
});

describe("custom pair-trade entry selection", () => {
  test("mouse plot x maps to a numeric candle index and feeds the entry-candidate selection", () => {
    const times = [1_000, 2_000, 3_000];
    const selection = selectionFromPlotPixelX(times, 184, (index) => [100, 145, 190][index] ?? Number.NaN);
    expect(selection?.cursorIndex).toBe(2);
    expect(selectedEntryTime(times, selection)).toBe(3_000);
  });

  test("uses the selection cursor candle, not the earlier range start", () => {
    const times = [10, 20, 30];
    const forwardRange = { startTime: 10, endTime: 30, startIndex: 0, endIndex: 2, anchorIndex: 0, cursorIndex: 2 };
    const reverseRange = { startTime: 10, endTime: 30, startIndex: 0, endIndex: 2, anchorIndex: 2, cursorIndex: 0 };
    expect(selectedEntryTime(times, forwardRange)).toBe(30);
    expect(selectedEntryTime(times, reverseRange)).toBe(10);
    expect(selectedEntryTime(times, null)).toBeNull();
  });

  test("uses custom entry only for matching chart identity and restores first-entry fallback after reset", () => {
    const choice = { snapshotKey: "preset-A", time: 20 };
    expect(resolvePairTradeEntryTime(choice, "preset-A", 10)).toBe(20);
    expect(resolvePairTradeEntryTime(choice, "preset-B", 15)).toBe(15);
    expect(resolvePairTradeEntryTime(null, "preset-A", 10)).toBe(10);
    expect(resolvePairTradeEntryTime(choice, "", 10)).toBe(10);
  });
});

const SSR_BASE = {
  firstLabel: "现货",
  secondLabel: "永续",
  view: "pair-trade" as const,
  customBeta: null,
  effectiveBeta: 1.2,
  betaMode: "auto" as PairBetaMode,
  minVarianceBeta: 0.85 as number | null,
  betaDraft: "",
  betaError: null,
  entryCandidateLabel: "2024-01-02 09:00",
  entryCandidateIsRange: false,
  appliedEntryLabel: "2024-01-01 00:00",
  entryIsCustom: false,
  fitWindow: DEFAULT_PAIR_FIT_WINDOW_SPEC,
  fitStartLabel: "2024-01-01 00:00",
  fitEndLabel: "2024-01-10 00:00",
  fitFirstLabel: "2024-01-01 00:00",
  fitLastLabel: "2024-01-10 00:00",
  fitPointCount: 240,
  fitUnavailableReason: null,
  lookahead: false,
  canResetFitToViewport: true,
  onSetView: () => {},
  onBetaDraftChange: () => {},
  onApplyBeta: () => {},
  onUseAutoBeta: () => {},
  onUseMinVarianceBeta: () => {},
  onUseUnitBeta: () => {},
  onSetEntry: () => {},
  onResetEntry: () => {},
  onSetFitMode: () => {},
  onSetFitStart: () => {},
  onSetFitEnd: () => {},
  onResetFitToViewport: () => {},
};

function renderControls(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CombinationWeightControls, { ...SSR_BASE, ...overrides } as Parameters<typeof CombinationWeightControls>[0]),
  );
}

/** Locates the whole opening tag + label of the button whose text is exactly `label`. */
function buttonBlock(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<button\\b[^>]*>${label}</button>`));
  if (!match) throw new Error(`button "${label}" not found`);
  return match[0];
}

function titleOf(block: string): string {
  const match = block.match(/title="([^"]*)"/);
  if (!match) throw new Error("button has no title");
  return match[1];
}

/** True only for the real `disabled` attribute, not the `disabled:` utility classes. */
function isDisabled(block: string): boolean {
  return /\sdisabled(?:="(?:|true)")?(?=[\s>])/.test(block);
}

const MIN_VARIANCE_MEANING = "看的是每根 K 线的涨跌幅";
const AUTO_BETA_MEANING = "对两腿价格取对数做回归";

describe("SSR copy: minimum-variance β tooltip", () => {
  test("an available minimum-variance β is enabled and explains returns-based PnL variance plus its technical details", () => {
    const markup = renderControls({ minVarianceBeta: 0.85 });
    const block = buttonBlock(markup, "最小方差配比");
    expect(isDisabled(block)).toBe(false);
    const title = titleOf(block);
    expect(title).toContain(MIN_VARIANCE_MEANING);
    expect(title).toContain("每期盈亏");
    expect(title).toContain("不代表最赚钱或回撤最小");
    expect(title).toContain("β = 0.85");
    expect(title).toContain("简单收益率");
    expect(title).toContain("$10,000");
    expect(title).toContain("固定总名义");
    expect(title).toContain("拟合窗口变化时自动更新");
  });

  test("a null minimum-variance β is disabled and keeps the original reason alongside the meaning", () => {
    const markup = renderControls({ minVarianceBeta: null });
    const block = buttonBlock(markup, "最小方差配比");
    expect(isDisabled(block)).toBe(true);
    const title = titleOf(block);
    expect(title).toContain("不可用");
    expect(title).toContain("30 个连续相邻 K 线收益样本");
    expect(title).toContain(MIN_VARIANCE_MEANING);
  });

  test("a non-positive minimum-variance β is disabled and keeps the original reason alongside the meaning", () => {
    for (const beta of [0, -0.5]) {
      const markup = renderControls({ minVarianceBeta: beta });
      const block = buttonBlock(markup, "最小方差配比");
      expect(isDisabled(block)).toBe(true);
      const title = titleOf(block);
      expect(title).toContain("不是正数");
      expect(title).toContain(MIN_VARIANCE_MEANING);
    }
  });
});

describe("SSR copy: restore automatic β tooltip", () => {
  test("a non-auto β mode shows the restore button with the levels-vs-changes explanation", () => {
    const markup = renderControls({ betaMode: "min-variance", effectiveBeta: 0.85, minVarianceBeta: 0.85 });
    const block = buttonBlock(markup, "恢复自动 β");
    expect(isDisabled(block)).toBe(false);
    const title = titleOf(block);
    expect(title).toContain(AUTO_BETA_MEANING);
    expect(title).toContain("价格相对于拟合关系的偏离尽量小");
    expect(title).toContain("不直接最小化每期盈亏波动");
    expect(title).toContain("不保证偏离后会回归");
    expect(title).toContain("点击后恢复自动 OLS β");
  });

  test("the restore button also appears for a custom β and stays hidden in auto mode", () => {
    expect(renderControls({ betaMode: "custom", customBeta: 1.5 })).toContain("恢复自动 β");
    expect(renderControls({ betaMode: "one" })).toContain("恢复自动 β");
    expect(renderControls({ betaMode: "auto" })).not.toContain("恢复自动 β");
  });
});
