import { describe, expect, test } from "bun:test";
import { normalizeChartRange } from "./SpotPerpArbitrageController";

describe("normalizeChartRange", () => {
  test("keeps 4h for 1m, then corrects it when leaving 1m", () => {
    expect(normalizeChartRange("1m", "4h", false)).toBe("4h");
    expect(normalizeChartRange("1h", "4h", false)).toBe("1d");
  });

  test("normalizes hidden ranges for each chart context", () => {
    expect(normalizeChartRange("1m", "1y", false)).toBe("1d");
    expect(normalizeChartRange("1d", "4h", false)).toBe("1d");
    expect(normalizeChartRange("1d", "3y", true)).toBe("1y");
  });

  test("preserves valid choices", () => {
    expect(normalizeChartRange("1m", "1d", true)).toBe("1d");
    expect(normalizeChartRange("1m", "4h", true)).toBe("4h");
    expect(normalizeChartRange("1h", "3y", false)).toBe("3y");
    expect(normalizeChartRange("1d", "6m", true)).toBe("6m");
  });
});
