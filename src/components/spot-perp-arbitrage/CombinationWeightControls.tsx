"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CombinationViewMode } from "@/lib/combo-weighting";
import type { PairModelSpec } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { PairFitWindowMode, PairFitWindowSpec } from "@/lib/spot-perp-arbitrage/pair-fit-window";
import { chartSelectionIndices, chartTimeSelectionFromIndices, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";

export const DEFAULT_PAIR_FIT_WINDOW_SPEC: PairFitWindowSpec = { mode: "all" };

/**
 * Which β source the pair-trade scenario applies. Presets ("min-variance"/"one")
 * store only the mode, never a frozen number, so a recomputed fit-window value
 * always applies without re-entry.
 */
export type PairBetaMode = "auto" | "min-variance" | "one" | "custom";

/** Short, honest label for the currently applied β source. */
export function pairBetaModeLabel(mode: PairBetaMode): string {
  if (mode === "min-variance") return "最小方差配比";
  if (mode === "one") return "1";
  return mode === "custom" ? "自定义" : "自动 OLS 拟合";
}

interface Props {
  firstLabel: string;
  secondLabel: string;
  view: CombinationViewMode;
  /** Applied custom hedge ratio, or null while the automatic OLS fit is used. */
  customBeta: number | null;
  /** The currently effective β (custom when applied, otherwise the OLS fit). */
  effectiveBeta: number | null;
  /** Which β source the pair-trade view currently applies. */
  betaMode: PairBetaMode;
  /** Fit-window minimum-variance hedge ratio, or null when unavailable. */
  minVarianceBeta: number | null;
  betaDraft: string;
  betaError: string | null;
  entryCandidateLabel: string | null;
  entryCandidateIsRange: boolean;
  appliedEntryLabel: string | null;
  entryIsCustom: boolean;
  fitWindow: PairFitWindowSpec;
  fitStartLabel: string | null;
  fitEndLabel: string | null;
  fitFirstLabel: string | null;
  fitLastLabel: string | null;
  fitPointCount: number;
  fitUnavailableReason: string | null;
  lookahead: boolean;
  /** Whether the fit window can be reset to the current visible chart range. */
  canResetFitToViewport: boolean;
  onSetView: (view: CombinationViewMode) => void;
  onBetaDraftChange: (value: string) => void;
  onApplyBeta: () => void;
  onUseAutoBeta: () => void;
  onUseMinVarianceBeta: () => void;
  onUseUnitBeta: () => void;
  onSetEntry: () => void;
  onResetEntry: () => void;
  onSetFitMode: (mode: PairFitWindowMode) => void;
  onSetFitStart: () => void;
  onSetFitEnd: () => void;
  /** Copies the pair-trade chart's visible first/last aligned candle into the fit start/end. */
  onResetFitToViewport: () => void;
}

function compactBeta(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return Math.abs(value) >= 100 ? value.toFixed(3) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function viewButtonClass(active: boolean): string {
  return `rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`;
}

function betaModeButtonClass(active: boolean): string {
  return `h-7 rounded border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-fuchsia-400/70 bg-fuchsia-500/25 text-fuchsia-100" : "border-gray-600 text-gray-300 hover:bg-gray-700"}`;
}

/** True only when the fit-window minimum-variance β can actually be applied. */
function hasMinVarianceBeta(beta: number | null): beta is number {
  return beta !== null && Number.isFinite(beta) && beta > 0;
}

function minVarianceBetaTitle(beta: number | null): string {
  if (beta === null) return "最小方差配比不可用：拟合窗口需要至少 30 个连续相邻 K 线收益样本";
  if (!Number.isFinite(beta) || beta <= 0) return "最小方差配比不可用：拟合窗口计算出的配比不是正数";
  return `最小方差配比 β = ${compactBeta(beta)}：按拟合窗口（所选 K 线周期）的简单收益率拟合，在腿1名义固定 $10,000 下最小化每期 PnL 方差；不等同于固定总名义本金下的波动率最小化。拟合窗口变化时自动更新。`;
}

export function fitWindowModeLabel(mode: PairFitWindowMode): string {
  if (mode === "all") return "全部对齐样本";
  if (mode === "custom") return "自定义起止";
  return `最近 ${mode}`;
}

/**
 * Compact view controls shared by every two-leg combination chart.
 *
 * The view switch picks the visualisation: the classic raw 1:1 spread/ratio
 * candles, the log-price regression residual/Z chart, or the in-sample pair-trade
 * PnL scenario. Only the pair-trade view exposes a β input; the plain and OLS
 * views are always automatic (plain is a raw 1:1 price spread/ratio, OLS always
 * fits its own β). Pair analysis uses custom β only while pair-trade is active;
 * switching to OLS restores the automatic fit. The pair-trade β quick buttons
 * select a source mode only — the value itself always comes from the controller.
 */
export function CombinationWeightControls({
  firstLabel,
  secondLabel,
  view,
  effectiveBeta,
  betaMode,
  minVarianceBeta,
  betaDraft,
  betaError,
  entryCandidateLabel,
  entryCandidateIsRange,
  appliedEntryLabel,
  entryIsCustom,
  fitWindow, fitStartLabel, fitEndLabel, fitFirstLabel, fitLastLabel, fitPointCount, fitUnavailableReason, lookahead,
  canResetFitToViewport,
  onSetView,
  onBetaDraftChange,
  onApplyBeta,
  onUseAutoBeta,
  onUseMinVarianceBeta,
  onUseUnitBeta,
  onSetEntry,
  onResetEntry,
  onSetFitStart, onSetFitEnd, onResetFitToViewport,
}: Props) {
  const isPairTrade = view === "pair-trade";
  const minVarianceAvailable = hasMinVarianceBeta(minVarianceBeta);

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="组合视图控制">
      <span className="mr-0.5 text-xs text-gray-500">视图</span>
      <button
        type="button"
        aria-pressed={view === "plain"}
        onClick={() => onSetView("plain")}
        title="普通价差图：原始价格价差/比值，固定按 1:1，不含回归"
        className={viewButtonClass(view === "plain")}
      >
        普通价差图
      </button>
      <button
        type="button"
        aria-pressed={view === "ols"}
        onClick={() => onSetView("ols")}
        title="OLS 回归：ln(腿1)=α+β·ln(腿2)+ε，自动拟合 β"
        className={viewButtonClass(view === "ols")}
      >
        OLS 回归
      </button>
      <button
        type="button"
        aria-pressed={isPairTrade}
        onClick={() => onSetView("pair-trade")}
        title="配对交易：默认以预设范围首根 K 线收盘价入场，也可显式选择其他入场 K 线"
        className={viewButtonClass(isPairTrade)}
      >
        配对交易
      </button>

      {isPairTrade && (
        <>
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <span>β</span>
            <input
              aria-label="自定义 β（腿1 对腿2 的配比；仅在点击“应用 β”后生效）"
              inputMode="decimal"
              type="number"
              min="0"
              step="any"
              value={betaDraft}
              onChange={(event) => onBetaDraftChange(event.target.value)}
              placeholder="输入 β"
              className="h-7 w-24 rounded border border-gray-600 bg-gray-800 px-2 text-xs text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
            />
          </label>
          <button
            type="button"
            onClick={onApplyBeta}
            className="h-7 rounded border border-violet-400/70 bg-violet-600/25 px-2.5 text-xs font-medium text-violet-100 hover:bg-violet-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            应用 β
          </button>
          <button
            type="button"
            aria-pressed={betaMode === "min-variance"}
            onClick={onUseMinVarianceBeta}
            disabled={!minVarianceAvailable}
            title={minVarianceBetaTitle(minVarianceBeta)}
            className={betaModeButtonClass(betaMode === "min-variance")}
          >
            最小方差配比
          </button>
          <button
            type="button"
            aria-pressed={betaMode === "one"}
            onClick={onUseUnitBeta}
            title="设定 β = 1：两腿初始名义本金相等（各 $10,000），不是数量相等；名义金额相等，代币数量按各自价格不同"
            className={betaModeButtonClass(betaMode === "one")}
          >
            1
          </button>
          {betaMode !== "auto" && (
            <button
              type="button"
              onClick={onUseAutoBeta}
              className="h-7 rounded border border-gray-600 px-2.5 text-xs text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              恢复自动 β
            </button>
          )}
          <span className="text-xs text-violet-300" title="配对交易当前使用的 β 来源">
            {effectiveBeta === null
              ? betaMode === "min-variance"
                ? "β 不可用（拟合窗口最小方差配比不可用）"
                : "β 不可用（自动拟合所需样本不足）"
              : `β = ${compactBeta(effectiveBeta)}（${pairBetaModeLabel(betaMode)}）`}
          </span>
          {betaMode === "custom" && (
            <span className="text-[11px] text-gray-500">
              自定义 β 来自手动输入；OLS β 与对数回归诊断仍以自动拟合为准。
            </span>
          )}
          {betaMode === "min-variance" && (
            <span className="text-[11px] text-gray-500">
              按拟合窗口简单收益率拟合，腿1名义固定 $10,000 下最小化每期 PnL 方差；非固定总名义的波动率最小化。
            </span>
          )}
          <span className="basis-full text-[11px] text-gray-500">
            固定数量情景：多 {firstLabel} $10,000、空 {secondLabel} β × $10,000；PnL 不含资金费率、手续费与滑点。
          </span>
          <div className="basis-full grid grid-cols-1 gap-2 lg:grid-cols-2">
            <fieldset className="min-w-0 rounded border border-cyan-800/60 bg-gray-900/40 px-2.5 py-2 text-[11px] text-gray-300">
              <legend className="px-1 font-medium text-cyan-200">β 拟合范围 · {fitWindowModeLabel(fitWindow.mode)}</legend>
              <p className="truncate" title={`${fitStartLabel ?? "--"} → ${fitEndLabel ?? "--"}`}>拟合边界：{fitStartLabel ?? "--"} → {fitEndLabel ?? "--"} <span className="text-gray-500">（不改变显示范围或入场）</span></p>
              <p className="mt-0.5 truncate text-gray-400" title={`${fitFirstLabel ?? "--"} → ${fitLastLabel ?? "--"}`}>实际样本：{fitFirstLabel ?? "--"} → {fitLastLabel ?? "--"} · {fitPointCount} 点</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={onSetFitStart} disabled={entryCandidateLabel === null} className="rounded border border-cyan-700 px-2 py-1 text-cyan-200 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">设为拟合起点</button>
                <button type="button" onClick={onSetFitEnd} disabled={entryCandidateLabel === null} className="rounded border border-cyan-700 px-2 py-1 text-cyan-200 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">设为拟合终点</button>
                <button
                  type="button"
                  onClick={onResetFitToViewport}
                  disabled={!canResetFitToViewport}
                  title="重置拟合范围：把配对交易图当前可视区间的首/末对齐 K 线复制为拟合起止；未缩放时为整段图表。不改变图表视窗或入场，也不使用当前光标候选 K 线。"
                  className="rounded border border-cyan-700/70 bg-cyan-950/30 px-2 py-1 text-cyan-200 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  重置
                </button>
                <span className="text-gray-500" title="起点/终点按钮作用于当前光标候选 K 线；「重置」改用图表可视区间。">起止按钮用光标候选；「重置」用可视区间</span>
              </div>
              {fitUnavailableReason && <p className="mt-1 text-amber-300" role="status" aria-live="polite">{fitUnavailableReason}</p>}
              {lookahead && <p className="mt-1 text-amber-300" role="status" aria-live="polite">拟合结束晚于入场，情景含前视信息，非回测。</p>}
            </fieldset>
            <fieldset className="min-w-0 rounded border border-gray-700/70 bg-gray-900/35 px-2.5 py-2 text-[11px] text-gray-300">
              <legend className="px-1 font-medium text-gray-300">独立入场设置</legend>
              <p className="truncate text-gray-400" title={entryCandidateLabel ?? undefined}>候选：{entryCandidateLabel ?? "先选中一根 K 线"}{entryCandidateIsRange && " · 区间取光标位置"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={onSetEntry} disabled={entryCandidateLabel === null || entryCandidateLabel === appliedEntryLabel} className="rounded border border-violet-400/60 px-2 py-1 text-violet-200 hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">设为入场点</button>
                {entryIsCustom && <button type="button" onClick={onResetEntry} className="rounded border border-gray-600 px-2 py-1 text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">恢复首根</button>}
                <span className="min-w-0 flex-1 truncate" title={appliedEntryLabel ?? undefined}>当前：{appliedEntryLabel ?? "暂不可用"}（{entryIsCustom ? "自选" : "预设首根"}）</span>
              </div>
              <p className="mt-1 text-gray-500">时间戳标记开盘，入场价取收盘。拟合起止与入场互不影响；配对图拖动缩放后，下方诊断随可视范围更新。</p>
            </fieldset>
          </div>
          {betaError && <p className="basis-full text-xs text-amber-300" role="alert" aria-live="assertive">{betaError}</p>}
        </>
      )}
    </div>
  );
}

export interface CombinationWeightingState {
  view: CombinationViewMode;
  /** Applied custom β, or null while the automatic OLS fit owns the value. */
  customBeta: number | null;
  /**
   * Which β source pair-trade applies. Presets store only the mode so a
   * recomputed fit-window value always applies without re-entry.
   */
  betaMode: PairBetaMode;
  betaDraft: string;
  betaError: string | null;
  setView: (view: CombinationViewMode) => void;
  setBetaDraft: (value: string) => void;
  applyCustomBeta: () => void;
  useAutoBeta: () => void;
  useMinVarianceBeta: () => void;
  useUnitBeta: () => void;
}

/** The view-and-β fields shared by every transition seam. */
export interface CombinationViewSnapshot {
  view: CombinationViewMode;
  customBeta: number | null;
  betaMode: PairBetaMode;
}

export type CombinationViewTransition = CombinationViewSnapshot;

/** Accepts only a positive finite β; everything else is rejected. */
export function validCustomBeta(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Magnitude-aware labels for raw price/ratio subplot axes. */
export function formatRawPriceAxis(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute < 0.0001 || absolute >= 1e8) return value.toExponential(2);
  const precision = absolute < 0.01 ? 4 : absolute < 1 ? 5 : absolute < 1000 ? 6 : 5;
  return Number(value.toPrecision(precision)).toString();
}

/** Custom β is applied only to pair-trade; plain and OLS always use automatic OLS. */
export function resolvePairModelSpec(view: CombinationViewMode, customBeta: number | null): PairModelSpec {
  const beta = validCustomBeta(customBeta);
  return view === "pair-trade" && beta !== null
    ? { mode: "custom", beta }
    : { mode: "ols" };
}

/** Uses the current cursor candle, not the range's earlier endpoint, as a custom entry candidate. */
export function selectedEntryTime(times: readonly number[], selection: ChartTimeSelection | null | undefined): number | null {
  const indices = chartSelectionIndices(times, selection);
  if (!indices) return null;
  const time = times[indices.cursorIndex];
  return Number.isFinite(time) ? time : null;
}

/** Maps a chart-plot x pixel to the nearest numeric category index and selection. */
export function selectionFromPlotPixelX(
  times: readonly number[],
  pixelX: number,
  projectCategoryX: (index: number) => number,
): ChartTimeSelection | null {
  if (times.length === 0 || !Number.isFinite(pixelX)) return null;
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const projectedX = projectCategoryX(index);
    if (!Number.isFinite(projectedX)) continue;
    const distance = Math.abs(projectedX - pixelX);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex < 0 ? null : chartTimeSelectionFromIndices(times, closestIndex, closestIndex);
}

export interface PairTradeEntryChoice {
  snapshotKey: string;
  time: number;
}

/** UI-only fit-window transitions; chart candidates are applied explicitly. */
export function fitWindowPreset(mode: PairFitWindowMode, firstTime: number | null, lastTime: number | null, current?: PairFitWindowSpec): PairFitWindowSpec {
  if (mode === "all") return { mode: "all", startTime: firstTime, endTime: lastTime };
  return { mode, ...(current?.endTime == null ? {} : { endTime: current.endTime }) };
}

export function fitWindowSetStart(current: PairFitWindowSpec, time: number): PairFitWindowSpec {
  return { mode: "custom", startTime: time, endTime: current.endTime ?? null };
}

export function fitWindowSetEnd(current: PairFitWindowSpec, time: number, firstTime: number | null): PairFitWindowSpec {
  return current.mode === "all"
    ? { mode: "custom", startTime: firstTime, endTime: time }
    : { ...current, endTime: time };
}

export function fitWindowUnavailableCopy(reason: string | null, pointCount: number, customBetaApplied: boolean): string | null {
  if (reason === "invalid-fit-range") return "拟合窗口无效：起点晚于终点。";
  if (reason === "fit-start-unavailable") return "拟合起点不属于当前预设范围的对齐 K 线；请重新选择。";
  if (reason === "fit-end-unavailable") return "拟合终点不属于当前预设范围的对齐 K 线；请重新选择。";
  if (reason === "insufficient-fit-points" || (reason !== null && pointCount === 0)) return "拟合窗口没有匹配的对齐点，无法估计 β 或回归诊断。";
  if (pointCount > 0 && pointCount < 20) {
    return `拟合诊断不可用：当前 ${pointCount} 个匹配点，至少需要 20 个。${customBetaApplied ? "自定义 β 情景仍可运行；回归诊断不显示。" : "自动 β 不可用，不会回退到其他窗口。"}`;
  }
  if (reason === "model-unavailable") return `所选拟合窗口有 ${pointCount} 个匹配点，但回归未提供有效模型。${customBetaApplied ? "自定义 β 情景仍可运行。" : "自动 β 不可用；可输入正数自定义 β。"}`;
  return null;
}

/** Fail closed to the preset's first entry when a stored choice belongs to another chart identity. */
export function resolvePairTradeEntryTime(
  choice: PairTradeEntryChoice | null,
  snapshotKey: string,
  defaultEntryTime: number | null,
): number | null {
  return choice !== null && snapshotKey !== "" && choice.snapshotKey === snapshotKey
    ? choice.time
    : defaultEntryTime;
}

/**
 * Switching the view is intentionally a no-op for the applied custom β and the
 * β mode: the view change never refits or rebases anything, and the controller
 * only consumes the pair-trade β while that view is active.
 */
export function setViewTransition(
  snapshot: CombinationViewSnapshot,
  view: CombinationViewMode,
): CombinationViewSnapshot {
  return { ...snapshot, view };
}

/** Fresh chart state: classic view, automatic OLS β, no custom input. */
export function resetCombinationTransition(): CombinationViewSnapshot {
  return { view: "plain", customBeta: null, betaMode: "auto" };
}

/**
 * Applies data/preset β resets independently from market/view identity resets.
 * A data/preset reset returns β to automatic OLS mode; a view-only reset keeps
 * both the custom β and the β mode.
 */
export function combinationResetTransition(
  snapshot: CombinationViewSnapshot,
  resetKeyChanged: boolean,
  viewResetKeyChanged: boolean,
): CombinationViewSnapshot {
  return {
    view: viewResetKeyChanged ? "plain" : snapshot.view,
    customBeta: resetKeyChanged ? null : snapshot.customBeta,
    betaMode: resetKeyChanged ? "auto" : snapshot.betaMode,
  };
}

/** UI state only. Regression fitting is intentionally owned by pair-statistics. */
export function useCombinationWeighting(resetKey?: unknown, viewResetKey: unknown = resetKey): CombinationWeightingState {
  const [view, setViewState] = useState<CombinationViewMode>("plain");
  const [customBeta, setCustomBeta] = useState<number | null>(null);
  const [betaMode, setBetaMode] = useState<PairBetaMode>("auto");
  const [betaDraft, setBetaDraftState] = useState("");
  const [betaError, setBetaError] = useState<string | null>(null);
  const previousResetKey = useRef(resetKey);
  const previousViewResetKey = useRef(viewResetKey);

  const setView = useCallback((next: CombinationViewMode) => {
    // View only: the applied custom β and β mode stay untouched.
    setViewState(next);
    setBetaError(null);
  }, []);
  const setBetaDraft = useCallback((value: string) => {
    setBetaDraftState(value);
    setBetaError(null);
  }, []);
  const applyCustomBeta = useCallback(() => {
    const parsed = validCustomBeta(betaDraft.trim());
    if (parsed === null) {
      setBetaError("β 必须为大于 0 的有限数字，不能留空。");
      return;
    }
    setCustomBeta(parsed);
    setBetaMode("custom");
    setBetaError(null);
  }, [betaDraft]);
  const useAutoBeta = useCallback(() => {
    setCustomBeta(null);
    setBetaMode("auto");
    setBetaDraftState("");
    setBetaError(null);
  }, []);
  // Presets record only the source mode; the value is always supplied by the
  // controller, so a recomputed fit-window minimum-variance β is picked up.
  const useMinVarianceBeta = useCallback(() => {
    setCustomBeta(null);
    setBetaMode("min-variance");
    setBetaError(null);
  }, []);
  const useUnitBeta = useCallback(() => {
    setCustomBeta(null);
    setBetaMode("one");
    setBetaError(null);
  }, []);

  useEffect(() => {
    const resetKeyChanged = !Object.is(previousResetKey.current, resetKey);
    const viewResetKeyChanged = !Object.is(previousViewResetKey.current, viewResetKey);
    previousResetKey.current = resetKey;
    previousViewResetKey.current = viewResetKey;
    if (!resetKeyChanged && !viewResetKeyChanged) return;

    const next = combinationResetTransition({ view, customBeta, betaMode }, resetKeyChanged, viewResetKeyChanged);
    // Data/preset identity resets β draft/error and returns β to automatic
    // mode; only market/view identity resets the selected view. The one-key API
    // keeps its historical behavior.
    if (next.view !== view) setViewState(next.view);
    if (next.customBeta !== customBeta) setCustomBeta(next.customBeta);
    if (next.betaMode !== betaMode) setBetaMode(next.betaMode);
    if (resetKeyChanged) {
      setBetaDraftState("");
      setBetaError(null);
    }
  }, [betaMode, customBeta, resetKey, view, viewResetKey]);

  return { view, customBeta, betaMode, betaDraft, betaError, setView, setBetaDraft, applyCustomBeta, useAutoBeta, useMinVarianceBeta, useUnitBeta };
}

/**
 * Human copy for an unavailable pair-trade series. Never promises a number it
 * does not have: an unavailable scenario stays visibly unavailable.
 */
export function pairTradeUnavailableReason(reason: string | null | undefined): string {
  switch (reason) {
    case "invalid-beta":
      return "β 无效（必须为大于 0 的有限数字）";
    case "invalid-custom-beta":
      return "自定义 β 无效";
    case "invalid-notional":
      return "名义本金无效";
    case "insufficient-points":
      return "对齐收盘点不足（配对交易至少需要 2 个）";
    case "entry-not-found":
      return "所选入场 K 线已不在当前预设范围内，请重新选择或恢复首根入场";
    case "non-finite-pnl":
      return "模拟 PnL 出现非有限值";
    case "model-unavailable":
      return "所选窗口未提供有效 OLS β；自动情景不可用，可输入正数自定义 β 继续运行情景";
    case "insufficient-fit-points":
      return "所选拟合窗口不足 20 个匹配点；自动 β 与拟合诊断不可用，不会回退。已输入的正数自定义 β 仍可运行情景";
    case "invalid-fit-range":
      return "拟合起点晚于终点；该窗口无效";
    case "fit-start-unavailable":
      return "拟合起点不属于当前预设对齐样本；请重新选择";
    case "fit-end-unavailable":
      return "拟合终点不属于当前预设对齐样本；请重新选择";
    case null:
    case undefined:
      return "缺少可用的配对交易参数";
    default:
      return `不可用（${reason}）`;
  }
}
