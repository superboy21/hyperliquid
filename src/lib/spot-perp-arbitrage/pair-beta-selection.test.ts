import { describe, expect, test } from "bun:test";
import { resolvePairBeta, type PairBetaSourceMode } from "./pair-beta-selection";

const base = {
  autoBeta: 2.5,
  minVarianceBeta: 1.5,
  customBeta: 0.75,
} as const;

function resolve(mode: PairBetaSourceMode, overrides: Partial<typeof base> = {}) {
  return resolvePairBeta({ mode, ...base, ...overrides });
}

describe("resolvePairBeta", () => {
  test("one is always the constant 1 regardless of every other source", () => {
    expect(resolve("one")).toEqual({ mode: "one", beta: 1, available: true, reason: null });
    expect(resolve("one", { autoBeta: null, minVarianceBeta: -3, customBeta: null })).toEqual({ mode: "one", beta: 1, available: true, reason: null });
  });

  test("auto applies only a positive finite fit-window OLS beta", () => {
    expect(resolve("auto")).toEqual({ mode: "auto", beta: 2.5, available: true, reason: null });
    for (const autoBeta of [null, 0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolve("auto", { autoBeta })).toEqual({ mode: "auto", beta: null, available: false, reason: null });
    }
  });

  test("custom applies only a positive finite manual beta", () => {
    expect(resolve("custom")).toEqual({ mode: "custom", beta: 0.75, available: true, reason: null });
    for (const customBeta of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolve("custom", { customBeta })).toEqual({ mode: "custom", beta: null, available: false, reason: "invalid-beta" });
    }
  });

  test("min-variance applies only a positive finite fit-window simple-return slope", () => {
    expect(resolve("min-variance")).toEqual({ mode: "min-variance", beta: 1.5, available: true, reason: null });
    for (const minVarianceBeta of [null, 0, -1.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolve("min-variance", { minVarianceBeta })).toEqual({ mode: "min-variance", beta: null, available: false, reason: "min-variance-unavailable" });
    }
  });

  test("min-variance fails closed and never falls back to the OLS beta", () => {
    expect(resolve("min-variance", { minVarianceBeta: -2, autoBeta: 3.5 })).toEqual({ mode: "min-variance", beta: null, available: false, reason: "min-variance-unavailable" });
    expect(resolve("min-variance", { minVarianceBeta: null, autoBeta: 3.5 })).toEqual({ mode: "min-variance", beta: null, available: false, reason: "min-variance-unavailable" });
  });

  test("a stale manual beta never leaks into another mode", () => {
    expect(resolve("min-variance", { customBeta: 9 }).beta).toBe(1.5);
    expect(resolve("auto", { customBeta: 9 }).beta).toBe(2.5);
    expect(resolve("one", { customBeta: 9 }).beta).toBe(1);
  });
});
