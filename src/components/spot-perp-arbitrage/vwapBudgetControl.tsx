"use client";

import { useCallback, useId, useRef, useState } from "react";
import { formatUsdt } from "./orderBookReadout";

/** Preset quote-currency VWAP budgets offered beside the WS toggle. */
export const VWAP_BUDGET_PRESETS = [1_000, 3_000, 5_000, 10_000] as const;
export const DEFAULT_VWAP_BUDGET = 5_000;

export type VwapBudgetSelection = { kind: "preset"; value: number } | { kind: "custom" };

/**
 * Parse a typed budget. Only a strictly positive, finite number counts as valid
 * (decimals and grouping commas are allowed); empty, zero, negative, partial and
 * non-numeric input is rejected so the panel can keep the last valid budget
 * instead of sending NaN or 0 into the core.
 */
export function parseVwapBudget(raw: string): number | null {
  const text = raw.replace(/[,\s]/g, "");
  if (text.length === 0) return null;
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * What the dropdown should show for a budget that is already in effect. A value
 * that matches a preset is that preset; any other valid number is the custom
 * entry. Keeping this pure makes the select/input wiring testable without a DOM.
 */
export function vwapBudgetSelection(budget: number): VwapBudgetSelection {
  if (!Number.isFinite(budget) || budget <= 0) return { kind: "preset", value: DEFAULT_VWAP_BUDGET };
  if ((VWAP_BUDGET_PRESETS as readonly number[]).includes(budget)) {
    return { kind: "preset", value: budget };
  }
  return { kind: "custom" };
}

/** Short, user-facing reason for a rejected custom budget. */
export function vwapBudgetError(raw: string): string | null {
  return parseVwapBudget(raw) === null ? "请输入大于 0 的报价币数量" : null;
}

/**
 * Budget state for the picker. One hook per panel keeps the value local to the
 * mount: it survives a mode/timeframe re-render of the same panel and simply
 * resets to the default when the panel closes and unmounts. No storage, no
 * controller, no shared global.
 *
 * A rejected draft never reaches the core: the last valid budget stays applied
 * until the field holds a strictly positive finite number again.
 */
export function useVwapBudget() {
  const [budget, setBudget] = useState(DEFAULT_VWAP_BUDGET);
  const [custom, setCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const applyPreset = useCallback((value: number) => {
    setBudget(value);
    setCustom(false);
    setCustomDraft("");
    setCustomError(null);
  }, []);

  const openCustom = useCallback(() => {
    setCustom(true);
    setCustomDraft(String(budget));
    setCustomError(null);
  }, [budget]);

  // Parse the draft from the closure and set each piece of state separately.
  // Doing this inside a functional updater would run side effects during React's
  // render phase, and StrictMode may replay an updater — the extra `setCustom`/
  // `setBudget` calls must not live there. The callback is rebuilt when the draft
  // changes, which is exactly when its input changes.
  const commitCustom = useCallback(() => {
    const parsed = parseVwapBudget(customDraft);
    if (parsed === null) {
      setCustomError(vwapBudgetError(customDraft) ?? "请输入大于 0 的报价币数量");
      return;
    }
    setBudget(parsed);
    setCustom(false);
    setCustomDraft("");
    setCustomError(null);
  }, [customDraft]);

  const cancelCustom = useCallback(() => {
    setCustom(false);
    setCustomDraft("");
    setCustomError(null);
  }, []);

  const updateDraft = useCallback((value: string) => {
    setCustomDraft(value);
    setCustomError(vwapBudgetError(value));
  }, []);

  return {
    budget,
    custom,
    customDraft,
    customError,
    applyPreset,
    openCustom,
    commitCustom,
    cancelCustom,
    updateDraft,
  };
}

/**
 * Budget picker that sits immediately left of the WS checkbox. Presets apply on
 * change; the custom entry opens a small field, where Enter or leaving the
 * picker applies a valid number and 取消 / Escape discards it. Focus moving to
 * another control **inside** the picker never commits, so the discard controls
 * keep their meaning (mousedown fires before click otherwise).
 */
export function VwapBudgetPicker(props: {
  budget: number;
  custom: boolean;
  customDraft: string;
  error: string | null;
  idleLabel: string;
  onPreset: (value: number) => void;
  onCustomSelect: () => void;
  onCustomDraft: (value: string) => void;
  onCustomCommit: () => void;
  onCustomCancel: () => void;
}) {
  const {
    budget, custom, customDraft, error, idleLabel,
    onPreset, onCustomSelect, onCustomDraft, onCustomCommit, onCustomCancel,
  } = props;
  const selectId = useId();
  const customId = useId();
  const errorId = `${customId}-error`;
  // Focus stays inside the picker when moving to the select, the cancel button
  // or the 编辑 button. Those transitions must not commit the draft.
  const rootRef = useRef<HTMLDivElement>(null);
  // A custom number that is already applied must stay visible in the closed
  // select; otherwise the browser falls back to the first preset and claims a
  // 1,000 budget while 1,234.5 is in force.
  const customApplied = vwapBudgetSelection(budget).kind === "custom";
  const selectValue = custom || customApplied ? "custom" : String(budget);

  return (
    <div
      ref={rootRef}
      // Focus leaving the whole picker commits a valid draft, which covers
      // tabbing past 取消. Staying inside never commits.
      onBlur={(event) => {
        if (!custom) return;
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        onCustomCommit();
      }}
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
    >
      <label htmlFor={selectId} className="whitespace-nowrap text-[10px] text-gray-400">{idleLabel}</label>
      <select
        id={selectId}
        value={selectValue}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          if (raw === "custom") onCustomSelect();
          else onPreset(Number(raw));
        }}
        aria-describedby={error !== null ? errorId : undefined}
        className="h-7 rounded border border-gray-600 bg-gray-900 px-1.5 font-sans text-[11px] tabular-nums text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        {VWAP_BUDGET_PRESETS.map((value) => (
          <option key={value} value={value}>{formatUsdt(value)}</option>
        ))}
        <option value="custom">{customApplied ? `自定义 ${formatUsdt(budget)}` : "自定义"}</option>
      </select>
      {customApplied && !custom && (
        <button
          type="button"
          onClick={onCustomSelect}
          className="h-7 rounded border border-gray-600 px-1.5 text-[10px] text-gray-300 hover:border-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          编辑
        </button>
      )}
      {custom && (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
          <label htmlFor={customId} className="sr-only">自定义 VWAP 每侧报价币数量</label>
          <input
            id={customId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={customDraft}
            onChange={(event) => onCustomDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCustomCommit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCustomCancel();
              }
            }}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? errorId : undefined}
            placeholder="如 1234.5"
            className={`h-7 w-24 rounded border bg-gray-900 px-1.5 font-sans text-[11px] tabular-nums text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${error ? "border-rose-500/70" : "border-gray-600"}`}
          />
          <span className="text-[10px] text-gray-500">报价币</span>
          <button
            type="button"
            // Keep focus in the field for a mouse click, so the click cannot be
            // preceded by a blur-commit. Keyboard activation is unaffected.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCustomCancel}
            className="h-7 rounded border border-gray-600 px-1.5 text-[10px] text-gray-300 hover:border-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            取消
          </button>
          {error !== null && (
            <span id={errorId} role="status" className="text-[10px] text-rose-300">{error}</span>
          )}
        </span>
      )}
      <span className="sr-only" role="status">
        {`当前 VWAP 每侧预算 ${formatUsdt(budget)} 报价币`}
      </span>
    </div>
  );
}
