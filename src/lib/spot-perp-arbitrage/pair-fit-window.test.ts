import { describe, expect, test } from "bun:test";
import { estimatePairModel, type AlignedPairClose } from "./pair-statistics";
import { fitWindowFromViewport, selectPairFitWindow } from "./pair-fit-window";

const DAY_MS = 24 * 60 * 60 * 1000;
const close = (closeTime: number): AlignedPairClose => ({ closeTime, firstClose: 100, secondClose: 50 });

describe("pair fit window", () => {
  test("normalizes duplicate timestamps and selects inclusive preset bounds from its end", () => {
    const input = [close(0), close(2 * DAY_MS), { ...close(2 * DAY_MS), firstClose: 200 }, close(DAY_MS)];
    const result = selectPairFitWindow(input, { mode: "7d", endTime: 2 * DAY_MS });
    expect(result.available).toBe(true);
    expect(result.value?.points.map((point) => point.closeTime)).toEqual([0, DAY_MS, 2 * DAY_MS]);
    expect(result.value?.points[2].firstClose).toBe(200);
    expect(result.value?.startTime).toBe(-5 * DAY_MS);
    expect(result.value?.endTime).toBe(2 * DAY_MS);
    expect(result.value?.firstPointTime).toBe(0);
    expect(result.value?.lastPointTime).toBe(2 * DAY_MS);
  });

  test("uses full supplied visible data for all and reports nominal preset bounds with early truncation", () => {
    const input = [close(10 * DAY_MS), close(12 * DAY_MS)];
    const all = selectPairFitWindow(input, { mode: "all" });
    expect(all.value?.points).toHaveLength(2);
    expect(all.value?.startTime).toBe(10 * DAY_MS);
    expect(all.value?.endTime).toBe(12 * DAY_MS);

    const preset = selectPairFitWindow(input, { mode: "30d" });
    expect(preset.value?.startTime).toBe(-18 * DAY_MS);
    expect(preset.value?.firstPointTime).toBe(10 * DAY_MS);
    expect(preset.value?.lastPointTime).toBe(12 * DAY_MS);
  });

  test("custom start and end are independently exact-aligned and inclusive", () => {
    const result = selectPairFitWindow([close(3), close(1), close(2)], { mode: "custom", startTime: 1, endTime: 2 });
    expect(result.value?.points.map((point) => point.closeTime)).toEqual([1, 2]);
    expect(selectPairFitWindow([close(1), close(2)], { mode: "custom", startTime: 1 }).value?.endTime).toBe(2);
  });

  test("fails closed for unavailable, missing, and reversed custom endpoints", () => {
    const input = [close(1), close(2), close(3)];
    expect(selectPairFitWindow(input, { mode: "custom" }).reason).toBe("fit-start-unavailable");
    expect(selectPairFitWindow(input, { mode: "custom", startTime: 0 }).reason).toBe("fit-start-unavailable");
    expect(selectPairFitWindow(input, { mode: "custom", startTime: 1, endTime: 4 }).reason).toBe("fit-end-unavailable");
    expect(selectPairFitWindow(input, { mode: "custom", startTime: 3, endTime: 1 }).reason).toBe("invalid-fit-range");
    expect(selectPairFitWindow(input, { mode: "7d", endTime: 4 }).reason).toBe("fit-end-unavailable");
    expect(selectPairFitWindow([], { mode: "all" }).reason).toBe("insufficient-fit-points");
  });

  test("keeps fewer than 20 points selectable while OLS independently reports unavailable", () => {
    const input = Array.from({ length: 5 }, (_, index) => close(index));
    const selected = selectPairFitWindow(input, { mode: "custom", startTime: 0, endTime: 4 });
    expect(selected.available).toBe(true);
    expect(selected.value?.points).toHaveLength(5);
    expect(estimatePairModel(selected.value!.points, { mode: "ols" }).reason).toBe("insufficient-points");
  });
});

describe("fit window from viewport", () => {
  test("a null viewport copies the full preset first/last aligned candle", () => {
    const input = [close(2), close(0), close(1)];
    expect(fitWindowFromViewport(input, null)).toEqual({ mode: "custom", startTime: 0, endTime: 2 });
  });

  test("a zoomed viewport snaps to the first/last included aligned candle across gaps", () => {
    // Aligned closes at 0, DAY, 5*DAY, 6*DAY; the requested 2*DAY..5*DAY window
    // includes no point before 5*DAY, so the start snaps forward to 5*DAY.
    const input = [close(0), close(DAY_MS), close(5 * DAY_MS), close(6 * DAY_MS)];
    expect(fitWindowFromViewport(input, { startTime: 2 * DAY_MS, endTime: 6 * DAY_MS }))
      .toEqual({ mode: "custom", startTime: 5 * DAY_MS, endTime: 6 * DAY_MS });
    // A window that lands between two candles expands inward to the included pair.
    expect(fitWindowFromViewport(input, { startTime: -DAY_MS, endTime: 2 * DAY_MS }))
      .toEqual({ mode: "custom", startTime: 0, endTime: DAY_MS });
  });

  test("a one-candle viewport returns a single-point spec without widening", () => {
    const input = [close(0), close(DAY_MS), close(2 * DAY_MS)];
    expect(fitWindowFromViewport(input, { startTime: DAY_MS, endTime: DAY_MS }))
      .toEqual({ mode: "custom", startTime: DAY_MS, endTime: DAY_MS });
  });

  test("rejects empty input, invalid viewports, and empty zooms instead of falling back to all", () => {
    const input = [close(0), close(DAY_MS), close(2 * DAY_MS)];
    expect(fitWindowFromViewport([], null)).toBeNull();
    expect(fitWindowFromViewport(input, { startTime: Number.NaN, endTime: DAY_MS })).toBeNull();
    expect(fitWindowFromViewport(input, { startTime: 0, endTime: Number.POSITIVE_INFINITY })).toBeNull();
    expect(fitWindowFromViewport(input, { startTime: 2 * DAY_MS, endTime: DAY_MS })).toBeNull();
    expect(fitWindowFromViewport(input, { startTime: 10 * DAY_MS, endTime: 20 * DAY_MS })).toBeNull();
    // Non-positive prices are dropped by normalization, leaving nothing.
    expect(fitWindowFromViewport([{ closeTime: 0, firstClose: 0, secondClose: 50 }], null)).toBeNull();
  });
});
