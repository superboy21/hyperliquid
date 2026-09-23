import { describe, expect, test } from "bun:test";
import { calculatePairTradeSeries, DEFAULT_FIRST_NOTIONAL_USD, type PairTradeSeries } from "./pair-trade";
import type { AlignedPairClose } from "./pair-statistics";

const aligned = (rows: Array<[number, number, number]>): AlignedPairClose[] => (
  rows.map(([closeTime, firstClose, secondClose]) => ({ closeTime, firstClose, secondClose }))
);

const value = (result: ReturnType<typeof calculatePairTradeSeries>): PairTradeSeries => {
  expect(result.available).toBe(true);
  expect(result.value).not.toBeNull();
  return result.value!;
};

describe("pair trade series", () => {
  test("opens at the first aligned close with fixed quantities and a flat first point", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [0, 100, 100],
      [60_000, 110, 95],
    ]), 1));
    expect(series.beta).toBe(1);
    expect(series.firstNotionalUsd).toBe(DEFAULT_FIRST_NOTIONAL_USD);
    expect(series.secondNotionalUsd).toBe(10_000);
    expect(series.entryTime).toBe(0);
    expect(series.entryIndex).toBe(0);
    expect(series.entryFirstClose).toBe(100);
    expect(series.entrySecondClose).toBe(100);
    expect(series.points.map((point) => point.time)).toEqual([0, 60_000]);
    expect(series.points[0]).toEqual({ time: 0, pnlUsd: 0, returnPercent: 0 });
    expect(series.points[1].pnlUsd).toBeCloseTo(1500);
    expect(series.points[1].returnPercent).toBeCloseTo(15);
  });

  test("produces symmetric negative gains when leg1 falls and leg2 rises", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [0, 100, 100],
      [60_000, 90, 105],
    ]), 1));
    expect(series.points[1].pnlUsd).toBeCloseTo(-1500);
    expect(series.points[1].returnPercent).toBeCloseTo(-15);
  });

  test("sizes leg2 at beta times the leg1 notional", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [0, 100, 100],
      [60_000, 110, 95],
    ]), 2));
    expect(series.beta).toBe(2);
    expect(series.secondNotionalUsd).toBe(20_000);
    // 10000 * (+10%) - 20000 * (-5%) = 1000 + 1000
    expect(series.points[1].pnlUsd).toBeCloseTo(2000);
    expect(series.points[1].returnPercent).toBeCloseTo(20);
  });

  test("keeps returnPercent invariant across notional scaling while USD scales linearly", () => {
    const input = aligned([
      [0, 100, 100],
      [60_000, 120, 90],
    ]);
    const base = value(calculatePairTradeSeries(input, 1));
    const doubled = value(calculatePairTradeSeries(input, 1, 20_000));
    expect(doubled.secondNotionalUsd).toBe(20_000);
    expect(doubled.points[1].pnlUsd).toBeCloseTo(base.points[1].pnlUsd * 2);
    expect(doubled.points[1].returnPercent).toBeCloseTo(base.points[1].returnPercent);
    expect(base.points[1].returnPercent).toBeCloseTo((base.points[1].pnlUsd / 10_000) * 100);
  });

  test("measures PnL from the entry bar across irregular timestamps without rebalancing", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [5_000, 100, 100],
      [5_500, 105, 100],
      [40_000, 110, 100],
    ]), 1));
    expect(series.entryTime).toBe(5_000);
    expect(series.points.map((point) => point.time)).toEqual([5_000, 5_500, 40_000]);
    // Each point is relative to the 100 entry, never the previous bar.
    expect(series.points[1].pnlUsd).toBeCloseTo(500);
    expect(series.points[2].pnlUsd).toBeCloseTo(1000);
  });

  test("keeps all timestamps and returns null before an explicit middle entry", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [0, 80, 120],
      [10_000, 100, 100],
      [30_000, 110, 90],
    ]), 1, undefined, 10_000));
    expect(series.entryIndex).toBe(1);
    expect(series.entryTime).toBe(10_000);
    expect(series.entryFirstClose).toBe(100);
    expect(series.entrySecondClose).toBe(100);
    expect(series.points.map((point) => point.time)).toEqual([0, 10_000, 30_000]);
    expect(series.points[0]).toEqual({ time: 0, pnlUsd: null, returnPercent: null });
    expect(series.points[1]).toEqual({ time: 10_000, pnlUsd: 0, returnPercent: 0 });
    expect(series.points[2].pnlUsd).toBeCloseTo(2_000);
    expect(series.points[2].returnPercent).toBe((series.points[2].pnlUsd! / 10_000) * 100);
  });

  test("allows the last aligned close as entry with one zero-valued point", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [0, 100, 100],
      [10_000, 110, 90],
    ]), 1, undefined, 10_000));
    expect(series.entryIndex).toBe(1);
    expect(series.points).toEqual([
      { time: 0, pnlUsd: null, returnPercent: null },
      { time: 10_000, pnlUsd: 0, returnPercent: 0 },
    ]);
  });

  test("requires an explicit entry time to exactly match a finite normalized timestamp", () => {
    const input = aligned([[0, 100, 100], [10_000, 110, 90]]);
    for (const entryTime of [1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = calculatePairTradeSeries(input, 1, undefined, entryTime);
      expect(result.available).toBe(false);
      expect(result.value).toBeNull();
      expect(result.reason).toBe("entry-not-found");
    }
  });

  test("selects entry after normalization, sorting and keeping the last valid duplicate", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [2_000, 110, 95],
      [1_000, 100, 100],
      [2_000, 105, 100],
      [3_000, 120, 80],
    ]), 1, undefined, 2_000));
    expect(series.entryIndex).toBe(1);
    expect(series.entryTime).toBe(2_000);
    expect(series.entryFirstClose).toBe(105);
    expect(series.entrySecondClose).toBe(100);
    expect(series.points.map(({ time }) => time)).toEqual([1_000, 2_000, 3_000]);
    expect(series.points[0].pnlUsd).toBeNull();
    expect(series.points[1].pnlUsd).toBe(0);
  });

  test("rejects non-finite or non-positive beta", () => {
    const input = aligned([[0, 100, 100], [1, 101, 99]]);
    for (const beta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = calculatePairTradeSeries(input, beta);
      expect(result.available).toBe(false);
      expect(result.value).toBeNull();
      expect(result.reason).toBe("invalid-beta");
    }
  });

  test("rejects invalid notionals", () => {
    const input = aligned([[0, 100, 100], [1, 101, 99]]);
    expect(calculatePairTradeSeries(input, 1, 0).reason).toBe("invalid-notional");
    expect(calculatePairTradeSeries(input, 1, -5).reason).toBe("invalid-notional");
    expect(calculatePairTradeSeries(input, 1, Number.NaN).reason).toBe("invalid-notional");
  });

  test("drops non-positive prices, de-duplicates by timestamp, and sorts ascending", () => {
    const series = value(calculatePairTradeSeries(aligned([
      [2_000, 110, 95],
      [1_000, 100, 100],
      [2_000, 105, 100],
      [3_000, -1, 100],
      [3_000, 100, 0],
    ]), 1));
    expect(series.entryTime).toBe(1_000);
    // 2000 is de-duplicated to its last valid observation (105, 100).
    expect(series.points.map((point) => point.time)).toEqual([1_000, 2_000]);
    expect(series.points[1].pnlUsd).toBeCloseTo(500);
  });

  test("fails closed when fewer than two valid aligned points remain", () => {
    expect(calculatePairTradeSeries([], 1).reason).toBe("insufficient-points");
    expect(calculatePairTradeSeries(aligned([[0, 100, 100]]), 1).reason).toBe("insufficient-points");
    // A zero price at the only other timestamp leaves nothing usable.
    expect(calculatePairTradeSeries(aligned([[0, 100, 100], [1, 0, 100]]), 1).reason).toBe("insufficient-points");
  });
});
