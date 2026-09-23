"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CombinationViewMode } from "@/lib/combo-weighting";
import type { PairModelSpec } from "@/lib/spot-perp-arbitrage/pair-statistics";
import type { PairFitWindowMode, PairFitWindowSpec } from "@/lib/spot-perp-arbitrage/pair-fit-window";
import { chartSelectionIndices, chartTimeSelectionFromIndices, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";

export const DEFAULT_PAIR_FIT_WINDOW_SPEC: PairFitWindowSpec = { mode: "all" };

interface Props {
  firstLabel: string;
  secondLabel: string;
  view: CombinationViewMode;
  /** Applied custom hedge ratio, or null while the automatic OLS fit is used. */
  customBeta: number | null;
  /** The currently effective β (custom when applied, otherwise the OLS fit). */
  effectiveBeta: number | null;
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
  onSetView: (view: CombinationViewMode) => void;
  onBetaDraftChange: (value: string) => void;
  onApplyBeta: () => void;
  onUseAutoBeta: () => void;
  onSetEntry: () => void;
  onResetEntry: () => void;
  onSetFitMode: (mode: PairFitWindowMode) => void;
  onSetFitStart: () => void;
  onSetFitEnd: () => void;
}

function compactBeta(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return Math.abs(value) >= 100 ? value.toFixed(3) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function viewButtonClass(active: boolean): string {
  return `rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`;
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
 * switching to OLS restores the automatic fit.
 */
export function CombinationWeightControls({
  firstLabel,
  secondLabel,
  view,
  customBeta,
  effectiveBeta,
  betaDraft,
  betaError,
  entryCandidateLabel,
  entryCandidateIsRange,
  appliedEntryLabel,
  entryIsCustom,
  fitWindow, fitStartLabel, fitEndLabel, fitFirstLabel, fitLastLabel, fitPointCount, fitUnavailableReason, lookahead,
  onSetView,
  onBetaDraftChange,
  onApplyBeta,
  onUseAutoBeta,
  onSetEntry,
  onResetEntry,
  onSetFitStart, onSetFitEnd,
}: Props) {
  const isPairTrade = view === "pair-trade";

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
              aria-label="自定义 β（腿1 对腿2 的对数回归斜率）"
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
          {customBeta !== null && (
            <button
              type="button"
              onClick={onUseAutoBeta}
              className="h-7 rounded border border-gray-600 px-2.5 text-xs text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              恢复自动 β
            </button>
          )}
          <span className="text-xs text-violet-300" title="配对交易使用的 β">
            {effectiveBeta === null
              ? "β 不可用（自动拟合所需样本不足）"
              : `β = ${compactBeta(effectiveBeta)}（${customBeta !== null ? "自定义" : "自动 OLS 拟合"}）`}
          </span>
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
                <span className="text-gray-500">应用于当前候选</span>
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
  betaDraft: string;
  betaError: string | null;
  setView: (view: CombinationViewMode) => void;
  setBetaDraft: (value: string) => void;
  applyCustomBeta: () => void;
  useAutoBeta: () => void;
}

/** The view-and-β fields shared by every transition seam. */
export interface CombinationViewSnapshot {
  view: CombinationViewMode;
  customBeta: number | null;
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
 * Switching the view is intentionally a no-op for the applied custom β: the view
 * change never refits or rebases anything, and the controller only consumes the
 * custom β while the pair-trade view is active.
 */
export function setViewTransition(
  snapshot: CombinationViewSnapshot,
  view: CombinationViewMode,
): CombinationViewSnapshot {
  return { ...snapshot, view };
}

/** Fresh chart state: classic view, automatic OLS β, no custom input. */
export function resetCombinationTransition(): CombinationViewSnapshot {
  return { view: "plain", customBeta: null };
}

/** Applies data/preset β resets independently from market/view identity resets. */
export function combinationResetTransition(
  snapshot: CombinationViewSnapshot,
  resetKeyChanged: boolean,
  viewResetKeyChanged: boolean,
): CombinationViewSnapshot {
  return {
    view: viewResetKeyChanged ? "plain" : snapshot.view,
    customBeta: resetKeyChanged ? null : snapshot.customBeta,
  };
}

/** UI state only. Regression fitting is intentionally owned by pair-statistics. */
export function useCombinationWeighting(resetKey?: unknown, viewResetKey: unknown = resetKey): CombinationWeightingState {
  const [view, setViewState] = useState<CombinationViewMode>("plain");
  const [customBeta, setCustomBeta] = useState<number | null>(null);
  const [betaDraft, setBetaDraftState] = useState("");
  const [betaError, setBetaError] = useState<string | null>(null);
  const previousResetKey = useRef(resetKey);
  const previousViewResetKey = useRef(viewResetKey);

  const setView = useCallback((next: CombinationViewMode) => {
    // View only: the applied custom β (if any) stays untouched.
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
    setBetaError(null);
  }, [betaDraft]);
  const useAutoBeta = useCallback(() => {
    setCustomBeta(null);
    setBetaDraftState("");
    setBetaError(null);
  }, []);

  useEffect(() => {
    const resetKeyChanged = !Object.is(previousResetKey.current, resetKey);
    const viewResetKeyChanged = !Object.is(previousViewResetKey.current, viewResetKey);
    previousResetKey.current = resetKey;
    previousViewResetKey.current = viewResetKey;
    if (!resetKeyChanged && !viewResetKeyChanged) return;

    const next = combinationResetTransition({ view, customBeta }, resetKeyChanged, viewResetKeyChanged);
    // Data/preset identity resets β draft/error; only market/view identity
    // resets the selected view. The one-key API keeps its historical behavior.
    if (next.view !== view) setViewState(next.view);
    if (next.customBeta !== customBeta) setCustomBeta(next.customBeta);
    if (resetKeyChanged) {
      setBetaDraftState("");
      setBetaError(null);
    }
  }, [customBeta, resetKey, view, viewResetKey]);

  return { view, customBeta, betaDraft, betaError, setView, setBetaDraft, applyCustomBeta, useAutoBeta };
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
