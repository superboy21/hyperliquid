import { describe, expect, test } from "bun:test";
import {
  chartSelectionIndices, chartTimeSelectionFromIndices, filterInChartTimeSelection, filterTimedInChartTimeSelection,
  moveChartTimeSelection,
} from "./chart-time-selection";

const times = [10, 20, 30, 40];

describe("chart time selection", () => {
  test("normalizes endpoints while retaining anchor-to-cursor orientation", () => {
    const selection = chartTimeSelectionFromIndices(times, 3, 1)!;
    expect(selection).toEqual({ startTime: 20, endTime: 40, startIndex: 1, endIndex: 3, anchorIndex: 3, cursorIndex: 1 });
    expect(chartSelectionIndices(times, selection)).toEqual({ startIndex: 1, endIndex: 3, anchorIndex: 3, cursorIndex: 1 });
  });

  test("shift arrows repeatedly extend, contract, and cross the anchor", () => {
    let selection = chartTimeSelectionFromIndices(times, 2, 2)!;
    selection = moveChartTimeSelection(times, selection, "ArrowLeft", true)!;
    selection = moveChartTimeSelection(times, selection, "ArrowLeft", true)!;
    expect(chartSelectionIndices(times, selection)).toEqual({ startIndex: 0, endIndex: 2, anchorIndex: 2, cursorIndex: 0 });
    selection = moveChartTimeSelection(times, selection, "ArrowRight", true)!;
    expect(chartSelectionIndices(times, selection)).toEqual({ startIndex: 1, endIndex: 2, anchorIndex: 2, cursorIndex: 1 });
    selection = moveChartTimeSelection(times, selection, "ArrowRight", true)!;
    selection = moveChartTimeSelection(times, selection, "ArrowRight", true)!;
    expect(chartSelectionIndices(times, selection)).toEqual({ startIndex: 2, endIndex: 3, anchorIndex: 2, cursorIndex: 3 });
  });

  test("plain arrows move from the cursor and collapse to one candle with clamped bounds", () => {
    const extended = chartTimeSelectionFromIndices(times, 3, 1)!;
    expect(chartSelectionIndices(times, moveChartTimeSelection(times, extended, "ArrowRight", false))).toEqual(
      { startIndex: 2, endIndex: 2, anchorIndex: 2, cursorIndex: 2 },
    );
    expect(chartSelectionIndices(times, moveChartTimeSelection(times, null, "ArrowLeft", false))).toEqual(
      { startIndex: 2, endIndex: 2, anchorIndex: 2, cursorIndex: 2 },
    );
    const first = chartTimeSelectionFromIndices(times, 0, 0)!;
    expect(chartSelectionIndices(times, moveChartTimeSelection(times, first, "ArrowLeft", true))).toEqual(
      { startIndex: 0, endIndex: 0, anchorIndex: 0, cursorIndex: 0 },
    );
  });

  test("restores stored orientation only for current endpoint indices, otherwise derives a safe orientation", () => {
    const stale = { startTime: 20, endTime: 30, startIndex: 1, endIndex: 2, anchorIndex: 3, cursorIndex: 1 };
    expect(chartSelectionIndices(times, stale)).toEqual({ startIndex: 1, endIndex: 2, anchorIndex: 1, cursorIndex: 2 });
    expect(chartSelectionIndices(times, { startTime: 20, endTime: 30 })).toEqual({ startIndex: 1, endIndex: 2, anchorIndex: 1, cursorIndex: 2 });
  });

  test("handles invalid, empty, and out-of-range inputs", () => {
    expect(chartTimeSelectionFromIndices([], 0, 0)).toBeNull();
    expect(chartTimeSelectionFromIndices(times, Number.NaN, 1)).toBeNull();
    expect(chartTimeSelectionFromIndices(times, -9, 99)).toMatchObject({ startIndex: 0, endIndex: 3, anchorIndex: 0, cursorIndex: 3 });
    expect(chartSelectionIndices(times, { startTime: 99, endTime: 100 })).toBeNull();
    expect(moveChartTimeSelection([], null, "ArrowLeft", false)).toBeNull();
  });

  test("filters inclusive ranges without mutating source arrays", () => {
    const selection = chartTimeSelectionFromIndices([10, 20, 30], 1, 2)!;
    const candles = [{ openTime: 10 }, { openTime: 20 }, { openTime: 30 }];
    const funding = [{ time: 10 }, { time: 20 }, { time: 30 }];
    expect(filterInChartTimeSelection(candles, selection)).toEqual([{ openTime: 20 }, { openTime: 30 }]);
    expect(filterTimedInChartTimeSelection(funding, selection)).toEqual([{ time: 20 }, { time: 30 }]);
    expect(filterInChartTimeSelection(candles, null)).not.toBe(candles);
    expect(filterInChartTimeSelection(candles, { startTime: 30, endTime: 20 })).toEqual([]);
  });
});
