import { describe, expect, test } from "bun:test";
import { hasSelectedBitgetPerp, normalizeChartRange } from "./SpotPerpArbitrageController";
import type { ArbitrageMarket } from "@/lib/spot-perp-arbitrage";
import { createChartRequestWindow } from "@/lib/chart-request-window";

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

test("normalizes before building the bounded chart request window", () => {
  const durations = { all: null, "1d": 86_400_000, "4h": 14_400_000 } as const;
  const range = normalizeChartRange("1h", "4h", false);
  expect(createChartRequestWindow(range, durations, 100_000_000)).toEqual({ startTime: 13_600_000, endTime: 100_000_000 });
});

test("only Bitget perpetual legs make range changes transport-relevant", () => {
  const bitgetSpot = { kind: "spot", source: { exchange: "Bitget" } } as ArbitrageMarket;
  const bitgetPerp = { kind: "perp", source: { exchange: "Bitget" } } as ArbitrageMarket;
  const binancePerp = { kind: "perp", source: { exchange: "Binance" } } as ArbitrageMarket;
  expect(hasSelectedBitgetPerp(bitgetSpot)).toBe(false);
  expect(hasSelectedBitgetPerp(bitgetSpot, binancePerp)).toBe(false);
  expect(hasSelectedBitgetPerp(bitgetPerp)).toBe(true);
});
