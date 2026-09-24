/**
 * Pure resolution of the pair-trade β source mode into a concrete applied β.
 *
 * Each mode draws from exactly one source and never silently falls back to
 * another: the min-variance mode fails closed when its own fit-window slope is
 * missing or non-positive, and a stale manually applied β never leaks into
 * another mode. This is deliberately free of React so the fail-closed states
 * can be unit-tested without the controller.
 */

/** Which β source the pair-trade scenario applies. */
export type PairBetaSourceMode = "auto" | "min-variance" | "one" | "custom";

export interface PairBetaResolutionInputs {
  mode: PairBetaSourceMode;
  /** Fit-window automatic log-price OLS slope, or null when unavailable. */
  autoBeta: number | null;
  /** Fit-window raw simple-return slope; may be zero or negative. */
  minVarianceBeta: number | null;
  /** Manually applied β from the controls, or null. */
  customBeta: number | null;
}

export interface PairBetaResolution {
  mode: PairBetaSourceMode;
  /** Applied β only when positive and finite; otherwise null. */
  beta: number | null;
  /** True only when this mode produced an applyable β. */
  available: boolean;
  /**
   * Fail-closed reason when unavailable. The automatic mode leaves this null so
   * the caller can supply the richer fit-window reason.
   */
  reason: string | null;
}

function positiveFinite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function resolution(mode: PairBetaSourceMode, beta: number | null, reason: string | null): PairBetaResolution {
  return beta === null
    ? { mode, beta: null, available: false, reason }
    : { mode, beta, available: true, reason: null };
}

/**
 * Resolves the applied pair-trade β for a single source mode.
 *
 * - `one` is always the constant 1, independent of the fitted values.
 * - `custom` applies only a positive finite manual β.
 * - `min-variance` applies only a positive finite fit-window simple-return
 *   slope and otherwise fails closed with `min-variance-unavailable`; it never
 *   falls back to the OLS fit or a stale manual β.
 * - `auto` applies the fit-window OLS slope, or reports unavailable with a null
 *   reason so the controller can explain the fit.
 */
export function resolvePairBeta(input: PairBetaResolutionInputs): PairBetaResolution {
  if (input.mode === "one") return resolution("one", 1, null);
  if (input.mode === "custom") {
    return resolution("custom", positiveFinite(input.customBeta), "invalid-beta");
  }
  if (input.mode === "min-variance") {
    return resolution("min-variance", positiveFinite(input.minVarianceBeta), "min-variance-unavailable");
  }
  return resolution("auto", positiveFinite(input.autoBeta), null);
}
