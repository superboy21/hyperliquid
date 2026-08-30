import { describe, expect, test } from "bun:test";
import { invalidParityTransition, toggleCustomEditor } from "./CombinationWeightControls";

describe("custom combination editor state", () => {
  test("opening only reveals the editor and keeps the chart at 1:1 until apply", () => {
    expect(toggleCustomEditor("none", false, { first: 3, second: 2 })).toEqual({
      mode: "none",
      customOpen: true,
      weights: { first: 3, second: 2 },
    });
  });

  test("closing an open editor always restores inactive 1:1", () => {
    expect(toggleCustomEditor("custom", true, { first: 3, second: 2 })).toEqual({
      mode: "none",
      customOpen: false,
      weights: { first: 1, second: 1 },
    });
  });

  test("invalid current-window parity has no stale applied state", () => {
    expect(invalidParityTransition()).toEqual({
      mode: "none",
      customOpen: false,
      weights: { first: 1, second: 1 },
    });
  });
});
