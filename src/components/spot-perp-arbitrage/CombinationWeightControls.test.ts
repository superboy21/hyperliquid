import { describe, expect, test } from "bun:test";
import { validCombinationWeights } from "@/lib/combo-weighting";
import {
  resetToPlainTransition,
  setViewTransition,
  toggleCustomEditor,
  type CombinationViewSnapshot,
} from "./CombinationWeightControls";

const plainCustom: CombinationViewSnapshot = {
  view: "plain",
  mode: "custom",
  weights: { first: 3, second: 2 },
  customOpen: true,
};

describe("combination view switching", () => {
  test("switching view keeps the applied custom weighting untouched", () => {
    expect(setViewTransition(plainCustom, "ols")).toEqual({
      view: "ols",
      mode: "custom",
      weights: { first: 3, second: 2 },
      customOpen: true,
    });
  });

  test("switching back to plain also keeps the custom weighting", () => {
    const ols: CombinationViewSnapshot = { ...plainCustom, view: "ols", customOpen: false };
    expect(setViewTransition(ols, "plain")).toEqual({
      view: "plain",
      mode: "custom",
      weights: { first: 3, second: 2 },
      customOpen: false,
    });
  });

  test("switching view does not invent weighting for the default state", () => {
    const initial: CombinationViewSnapshot = { view: "plain", mode: "none", weights: { first: 1, second: 1 }, customOpen: false };
    expect(setViewTransition(initial, "ols")).toEqual({ ...initial, view: "ols" });
    expect(setViewTransition(initial, "plain")).toEqual(initial);
  });
});

describe("custom combination editor state", () => {
  test("opening only reveals the editor and keeps the current view and mode", () => {
    expect(toggleCustomEditor("plain", "none", false, { first: 3, second: 2 })).toEqual({
      view: "plain",
      mode: "none",
      customOpen: true,
      weights: { first: 3, second: 2 },
    });
  });

  test("opening from OLS also keeps the OLS view and mode", () => {
    expect(toggleCustomEditor("ols", "custom", false, { first: 3, second: 2 })).toEqual({
      view: "ols",
      mode: "custom",
      customOpen: true,
      weights: { first: 3, second: 2 },
    });
  });

  test("closing an open editor always restores inactive 1:1 without changing the view", () => {
    expect(toggleCustomEditor("plain", "custom", true, { first: 3, second: 2 })).toEqual({
      view: "plain",
      mode: "none",
      customOpen: false,
      weights: { first: 1, second: 1 },
    });
    expect(toggleCustomEditor("ols", "custom", true, { first: 3, second: 2 })).toEqual({
      view: "ols",
      mode: "none",
      customOpen: false,
      weights: { first: 1, second: 1 },
    });
  });
});

describe("reset transition", () => {
  test("reset returns to the plain default view with no custom state", () => {
    expect(resetToPlainTransition()).toEqual({
      view: "plain",
      mode: "none",
      customOpen: false,
      weights: { first: 1, second: 1 },
    });
  });
});

describe("custom ratio validation", () => {
  test("rejects empty, zero, negative and non-finite drafts", () => {
    expect(validCombinationWeights("", "1")).toBeNull();
    expect(validCombinationWeights("1", "")).toBeNull();
    expect(validCombinationWeights("0", "1")).toBeNull();
    expect(validCombinationWeights("-2", "1")).toBeNull();
    expect(validCombinationWeights("Infinity", "1")).toBeNull();
    expect(validCombinationWeights("NaN", "1")).toBeNull();
  });

  test("accepts positive finite drafts, including fractions and decimals", () => {
    expect(validCombinationWeights("3", "2")).toEqual({ first: 3, second: 2 });
    expect(validCombinationWeights("0.25", "2")).toEqual({ first: 0.25, second: 2 });
  });
});
