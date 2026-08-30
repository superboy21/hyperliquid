"use client";

import { useCallback, useEffect, useState } from "react";
import {
  calculateVolatilityParity,
  validCombinationWeights,
  type CombinationWeightMode,
  type CombinationWeights,
  type VolatilityParityResult,
} from "@/lib/combo-weighting";
import type { VolatilityCandleLike } from "@/lib/spot-perp-arbitrage/single-market-analytics";

interface Props {
  firstLabel: string;
  secondLabel: string;
  mode: CombinationWeightMode;
  weights: CombinationWeights;
  parity: VolatilityParityResult | null;
  error: string | null;
  customOpen: boolean;
  firstDraft: string;
  secondDraft: string;
  onToggleParity: () => void;
  onToggleCustom: () => void;
  onFirstDraftChange: (value: string) => void;
  onSecondDraftChange: (value: string) => void;
  onApplyCustom: () => void;
}

function compactWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function ratioLabel(weights: CombinationWeights): string {
  return `${compactWeight(weights.first)} : ${compactWeight(weights.second)}`;
}

/** Compact, shared controls used by every two-leg combination chart. */
export function CombinationWeightControls({
  firstLabel,
  secondLabel,
  mode,
  weights,
  parity,
  error,
  customOpen,
  firstDraft,
  secondDraft,
  onToggleParity,
  onToggleCustom,
  onFirstDraftChange,
  onSecondDraftChange,
  onApplyCustom,
}: Props) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-700/80 bg-gray-900/45 px-2.5 py-2 text-xs" role="group" aria-label="组合配比控制">
      <span className="text-gray-500">组合配比</span>
      <button
        type="button"
        aria-pressed={mode === "parity"}
        onClick={onToggleParity}
        className={`rounded border px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${mode === "parity" ? "border-violet-300 bg-violet-500/35 text-violet-100" : "border-gray-600 bg-gray-800 text-gray-300 hover:border-violet-400/70 hover:text-white"}`}
      >
        波动率平价
      </button>
      <button
        type="button"
        aria-pressed={mode === "custom"}
        aria-expanded={customOpen}
        onClick={onToggleCustom}
        className={`rounded border px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${mode === "custom" ? "border-violet-300 bg-violet-500/35 text-violet-100" : "border-gray-600 bg-gray-800 text-gray-300 hover:border-violet-400/70 hover:text-white"}`}
      >
        自定义配比
      </button>

      {customOpen && (
        <div className="flex min-w-[240px] flex-1 flex-wrap items-end gap-2">
          <label className="flex min-w-[92px] flex-1 flex-col gap-1 text-gray-400">
            <span>A 权重 · {firstLabel}</span>
            <input aria-label={`A 权重，${firstLabel}`} inputMode="decimal" type="number" step="any" value={firstDraft} onChange={(event) => onFirstDraftChange(event.target.value)} className="h-7 w-full rounded border border-gray-600 bg-gray-800 px-2 text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" />
          </label>
          <label className="flex min-w-[92px] flex-1 flex-col gap-1 text-gray-400">
            <span>B 权重 · {secondLabel}</span>
            <input aria-label={`B 权重，${secondLabel}`} inputMode="decimal" type="number" step="any" value={secondDraft} onChange={(event) => onSecondDraftChange(event.target.value)} className="h-7 w-full rounded border border-gray-600 bg-gray-800 px-2 text-gray-100 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" />
          </label>
          <button type="button" onClick={onApplyCustom} className="h-7 rounded border border-violet-400/70 bg-violet-600/25 px-2.5 font-medium text-violet-100 hover:bg-violet-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">应用</button>
        </div>
      )}

      {mode === "parity" && parity?.ok && parity.weights && (
        <span className="basis-full text-violet-100 sm:basis-auto" aria-live="polite">
          年化波动率 A {parity.first.percent?.toFixed(2)}% · B {parity.second.percent?.toFixed(2)}% · 当前 A:B {ratioLabel(weights)}
        </span>
      )}
      {mode === "custom" && <span className="basis-full text-violet-100 sm:basis-auto" aria-live="polite">当前 A:B {ratioLabel(weights)}</span>}
      {customOpen && mode !== "custom" && <span className="basis-full text-gray-400" aria-live="polite">待应用：图表当前仍为 1:1</span>}
      {error && <span className="basis-full text-amber-300" role="alert" aria-live="assertive">{error}</span>}
    </div>
  );
}

export interface CombinationWeightingState {
  mode: CombinationWeightMode;
  weights: CombinationWeights;
  parity: VolatilityParityResult | null;
  error: string | null;
  customOpen: boolean;
  firstDraft: string;
  secondDraft: string;
  toggleParity: (startTime?: number, endTime?: number) => void;
  toggleCustom: () => void;
  setFirstDraft: (value: string) => void;
  setSecondDraft: (value: string) => void;
  applyCustom: () => void;
  recomputeParity: (startTime: number, endTime: number) => void;
}

export interface CustomEditorTransition {
  mode: CombinationWeightMode;
  customOpen: boolean;
  weights: CombinationWeights;
}

/** Pure seam for the editor-only versus applied-custom distinction. */
export function toggleCustomEditor(
  mode: CombinationWeightMode,
  customOpen: boolean,
  lastValidWeights: CombinationWeights,
): CustomEditorTransition {
  if (customOpen) return { mode: "none", customOpen: false, weights: { first: 1, second: 1 } };
  return { mode: "none", customOpen: true, weights: lastValidWeights };
}

export function invalidParityTransition(): CustomEditorTransition {
  return { mode: "none", customOpen: false, weights: { first: 1, second: 1 } };
}

/** State machine shared by legacy Perp/Perp and Spot-containing charts. */
export function useCombinationWeighting(
  firstPoints: readonly VolatilityCandleLike[] | undefined,
  secondPoints: readonly VolatilityCandleLike[] | undefined,
): CombinationWeightingState {
  const [mode, setMode] = useState<CombinationWeightMode>("none");
  const [weights, setWeights] = useState<CombinationWeights>({ first: 1, second: 1 });
  const [customWeights, setCustomWeights] = useState<CombinationWeights>({ first: 1, second: 1 });
  const [customOpen, setCustomOpen] = useState(false);
  const [parity, setParity] = useState<VolatilityParityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstDraft, setFirstDraft] = useState("1");
  const [secondDraft, setSecondDraft] = useState("1");

  const calculate = useCallback((startTime?: number, endTime?: number) => {
    if (!firstPoints || !secondPoints) {
      return { ok: false, error: "缺少两条腿的原始价格数据，无法计算波动率平价。" } as const;
    }
    return calculateVolatilityParity(firstPoints, secondPoints, startTime, endTime);
  }, [firstPoints, secondPoints]);

  const applyParity = useCallback((startTime?: number, endTime?: number) => {
    const result = calculate(startTime, endTime);
    if (!result.ok || !result.weights) {
      setError(result.error ?? "当前可见区间无法计算波动率平价。");
      const reset = invalidParityTransition();
      setCustomOpen(reset.customOpen);
      setMode(reset.mode);
      setWeights(reset.weights);
      setParity(null);
      return;
    }
    setMode("parity");
    setCustomOpen(false);
    setWeights(result.weights);
    setParity(result);
    setError(null);
  }, [calculate]);

  const toggleParity = useCallback((startTime?: number, endTime?: number) => {
    if (mode === "parity") {
      setMode("none");
      setCustomOpen(false);
      setWeights({ first: 1, second: 1 });
      setParity(null);
      setError(null);
      return;
    }
    applyParity(startTime, endTime);
  }, [applyParity, mode]);

  const toggleCustom = useCallback(() => {
    const next = toggleCustomEditor(mode, customOpen, customWeights);
    setMode(next.mode);
    setCustomOpen(next.customOpen);
    setWeights(next.weights);
    setParity(null);
    setError(null);
    if (next.customOpen) {
      setFirstDraft(String(customWeights.first));
      setSecondDraft(String(customWeights.second));
    }
  }, [customOpen, customWeights, mode]);

  const applyCustom = useCallback(() => {
    const next = validCombinationWeights(firstDraft.trim(), secondDraft.trim());
    if (!next) {
      setError("A、B 权重必须是大于 0 的有限数字，不能留空。");
      return;
    }
    setWeights(next);
    setCustomWeights(next);
    setMode("custom");
    setCustomOpen(true);
    setParity(null);
    setError(null);
  }, [firstDraft, secondDraft]);

  // The raw aligned leg identity changes when the chart/preset changes. Reset
  // the local interaction state then, while keeping slider updates local to
  // the ECharts instance so they do not reset the viewport.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("none");
    setWeights({ first: 1, second: 1 });
    setCustomWeights({ first: 1, second: 1 });
    setCustomOpen(false);
    setFirstDraft("1");
    setSecondDraft("1");
    setParity(null);
    setError(null);
  }, [firstPoints, secondPoints]);

  return {
    mode,
    weights,
    customOpen,
    parity,
    error,
    firstDraft,
    secondDraft,
    toggleParity,
    toggleCustom,
    setFirstDraft,
    setSecondDraft,
    applyCustom,
    recomputeParity: (startTime, endTime) => applyParity(startTime, endTime),
  };
}
