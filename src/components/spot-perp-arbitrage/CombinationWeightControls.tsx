"use client";

import { useCallback, useEffect, useState } from "react";
import {
  validCombinationWeights,
  type CombinationViewMode,
  type CombinationWeightMode,
  type CombinationWeights,
} from "@/lib/combo-weighting";

interface Props {
  firstLabel: string;
  secondLabel: string;
  view: CombinationViewMode;
  mode: CombinationWeightMode;
  weights: CombinationWeights;
  error: string | null;
  customOpen: boolean;
  firstDraft: string;
  secondDraft: string;
  onSetView: (view: CombinationViewMode) => void;
  onToggleCustom: () => void;
  onFirstDraftChange: (value: string) => void;
  onSecondDraftChange: (value: string) => void;
  onApplyCustom: () => void;
}

function compactWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function viewButtonClass(active: boolean): string {
  return `rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? "bg-violet-500/35 text-violet-100 ring-1 ring-inset ring-violet-400/60" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`;
}

/**
 * Compact model controls shared by every two-leg regression chart.
 *
 * The view switch picks the visualisation (classic spread/ratio candles versus
 * the log-price regression residual/Z chart) without touching the applied A:B
 * weighting; both views read the same weights. Rendered inline so it drops into
 * the chart toolbar as one additional button group.
 */
export function CombinationWeightControls({
  firstLabel,
  secondLabel,
  view,
  mode,
  weights,
  error,
  customOpen,
  firstDraft,
  secondDraft,
  onSetView,
  onToggleCustom,
  onFirstDraftChange,
  onSecondDraftChange,
  onApplyCustom,
}: Props) {
  const isCustom = mode === "custom";
  const weightPair = `A:B ${compactWeight(weights.first)}:${compactWeight(weights.second)}`;
  const viewTitle = view === "plain"
    ? isCustom
      ? `普通价差图 · 当前 ${weightPair}`
      : "普通价差图 · 未启用配比时按 1:1"
    : isCustom
      ? "OLS 回归 · β = B/A，内部归一为 1:β"
      : "OLS 回归 · ln(腿1)=α+β·ln(腿2)+ε";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="组合视图与配比控制">
        <span className="mr-0.5 text-xs text-gray-500">视图</span>
        <button
          type="button"
          aria-pressed={view === "plain"}
          onClick={() => onSetView("plain")}
          title={view === "plain" ? viewTitle : "切换到普通价差图"}
          className={viewButtonClass(view === "plain")}
        >
          普通价差图
        </button>
        <button
          type="button"
          aria-pressed={view === "ols"}
          onClick={() => onSetView("ols")}
          title={view === "ols" ? viewTitle : "切换到 OLS 回归"}
          className={viewButtonClass(view === "ols")}
        >
          OLS 回归
        </button>
        <span aria-hidden="true" className="px-0.5 text-gray-600">·</span>
        <button
          type="button"
          aria-pressed={isCustom}
          aria-expanded={customOpen}
          aria-controls="combination-weight-editor"
          onClick={onToggleCustom}
          title={isCustom ? `已启用 ${weightPair}；点击停用并回到 1:1` : "启用自定义 A:B 配比"}
          className={viewButtonClass(isCustom)}
        >
          自定义 A:B
        </button>
        {isCustom && <span className="text-xs text-violet-300" title="自定义配比 A:B">{weightPair}</span>}
        {error && <p className="text-xs text-amber-300" role="alert" aria-live="assertive">{error}</p>}
      </div>

      {customOpen && (
        <div id="combination-weight-editor" className="flex basis-full flex-wrap items-end gap-2 rounded bg-gray-900/60 px-2 py-1.5">
          <label className="flex min-w-[100px] flex-1 flex-col gap-1 text-xs text-gray-400">
            <span>A · {firstLabel}</span>
            <input aria-label={`A 权重，${firstLabel}`} inputMode="decimal" type="number" min="0" step="any" value={firstDraft} onChange={(event) => onFirstDraftChange(event.target.value)} className="h-7 w-full rounded border border-gray-600 bg-gray-800 px-2 text-xs text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" />
          </label>
          <label className="flex min-w-[100px] flex-1 flex-col gap-1 text-xs text-gray-400">
            <span>B · {secondLabel}</span>
            <input aria-label={`B 权重，${secondLabel}`} inputMode="decimal" type="number" min="0" step="any" value={secondDraft} onChange={(event) => onSecondDraftChange(event.target.value)} className="h-7 w-full rounded border border-gray-600 bg-gray-800 px-2 text-xs text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" />
          </label>
          <button type="button" onClick={onApplyCustom} className="h-7 rounded border border-violet-400/70 bg-violet-600/25 px-3 text-xs font-medium text-violet-100 hover:bg-violet-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">应用</button>
          <p className="basis-full text-[11px] text-gray-500">普通视图按 A:B 加权蜡烛；OLS 视图仅取 β = B/A。</p>
        </div>
      )}
    </>
  );
}

export interface CombinationWeightingState {
  view: CombinationViewMode;
  mode: CombinationWeightMode;
  weights: CombinationWeights;
  error: string | null;
  customOpen: boolean;
  firstDraft: string;
  secondDraft: string;
  setView: (view: CombinationViewMode) => void;
  toggleCustom: () => void;
  setFirstDraft: (value: string) => void;
  setSecondDraft: (value: string) => void;
  applyCustom: () => void;
}

/** The view-and-weighting fields shared by every transition seam. */
export interface CombinationViewSnapshot {
  view: CombinationViewMode;
  mode: CombinationWeightMode;
  weights: CombinationWeights;
  customOpen: boolean;
}

export type CustomEditorTransition = CombinationViewSnapshot;

/**
 * Switching the view is intentionally a no-op for the applied weighting: the
 * classic candles and the OLS residual chart both consume the same A:B state.
 */
export function setViewTransition(
  snapshot: CombinationViewSnapshot,
  view: CombinationViewMode,
): CombinationViewSnapshot {
  return { ...snapshot, view };
}

/**
 * Pure seam for the editor-only versus applied-custom distinction. Opening
 * only reveals the editor and restores the last valid custom ratio; closing
 * always falls back to the inactive 1:1 weighting, regardless of the view.
 */
export function toggleCustomEditor(
  view: CombinationViewMode,
  mode: CombinationWeightMode,
  customOpen: boolean,
  lastValidWeights: CombinationWeights,
): CustomEditorTransition {
  if (customOpen) return { view, mode: "none", customOpen: false, weights: { first: 1, second: 1 } };
  return { view, mode, customOpen: true, weights: lastValidWeights };
}

/** Fresh chart state: classic view, no custom weighting, drafts reset. */
export function resetToPlainTransition(): CustomEditorTransition {
  return { view: "plain", mode: "none", customOpen: false, weights: { first: 1, second: 1 } };
}

/** UI state only. Regression fitting is intentionally owned by pair-statistics. */
export function useCombinationWeighting(resetKey?: unknown): CombinationWeightingState {
  const [view, setViewState] = useState<CombinationViewMode>("plain");
  const [mode, setMode] = useState<CombinationWeightMode>("none");
  const [weights, setWeights] = useState<CombinationWeights>({ first: 1, second: 1 });
  const [customWeights, setCustomWeights] = useState<CombinationWeights>({ first: 1, second: 1 });
  const [customOpen, setCustomOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstDraft, setFirstDraft] = useState("1");
  const [secondDraft, setSecondDraft] = useState("1");

  const setView = useCallback((next: CombinationViewMode) => {
    // View only: the applied A:B weighting is shared by both views.
    setViewState(next);
    setError(null);
  }, []);
  const toggleCustom = useCallback(() => {
    const next = toggleCustomEditor(view, mode, customOpen, customWeights);
    setMode(next.mode);
    setWeights(next.weights);
    setCustomOpen(next.customOpen);
    setError(null);
    if (next.customOpen) {
      setFirstDraft(String(customWeights.first));
      setSecondDraft(String(customWeights.second));
    }
  }, [customOpen, customWeights, mode, view]);
  const applyCustom = useCallback(() => {
    const next = validCombinationWeights(firstDraft.trim(), secondDraft.trim());
    if (!next) {
      setError("A、B 必须为大于 0 的有限数字，不能留空。");
      return;
    }
    setWeights(next);
    setCustomWeights(next);
    setMode("custom");
    setCustomOpen(true);
    setError(null);
  }, [firstDraft, secondDraft]);

  useEffect(() => {
    const next = resetToPlainTransition();
    // Chart/preset identity changed: intentionally reset the local view and
    // weighting state to the classic default.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewState(next.view);
    setMode(next.mode);
    setWeights(next.weights);
    setCustomWeights({ first: 1, second: 1 });
    setCustomOpen(next.customOpen);
    setFirstDraft("1");
    setSecondDraft("1");
    setError(null);
  }, [resetKey]);

  return { view, mode, weights, error, customOpen, firstDraft, secondDraft, setView, toggleCustom, setFirstDraft, setSecondDraft, applyCustom };
}
