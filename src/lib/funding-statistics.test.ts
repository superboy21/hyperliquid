import { describe, expect, test } from "bun:test";
import { calculateHistoricalFundingStatistics, YEAR_MS } from "./funding-statistics";
import { computeAvgFundingRates } from "./search";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;

describe("historical funding statistics", () => {
  test("uses the exact half-open window and keeps a real zero", () => {
    const result = calculateHistoricalFundingStatistics([
      { time: NOW - 2 * DAY, rate: 0.01 },
      { time: NOW - DAY, rate: 0 },
      { time: NOW, rate: 0.5 },
      { time: NOW - 3 * DAY, rate: 0.5 },
    ], NOW - 2 * DAY, NOW, HOUR);

    expect(result).toEqual({
      settledReturn: 0.01,
      annualizedRate: 0.01 * YEAR_MS / (2 * DAY),
      sampleCount: 2,
      referenceIntervalRate: 0.01 * HOUR / (2 * DAY),
    });
  });

  test("sorts, deduplicates timestamps, and rejects non-finite samples", () => {
    const result = calculateHistoricalFundingStatistics([
      { time: NOW - HOUR, rate: 0.02 },
      { time: NOW - 2 * HOUR, rate: Number.NaN },
      { time: NOW - 3 * HOUR, rate: 0.01 },
      { time: NOW - HOUR, rate: 0.99 },
      { time: Number.POSITIVE_INFINITY, rate: 0.1 },
      { time: NOW - 4 * HOUR, rate: Number.NaN },
    ], NOW - 3 * HOUR, NOW, HOUR);

    expect(result?.settledReturn).toBe(0.03);
    expect(result?.sampleCount).toBe(2);
  });

  test("rejects missing and blank rates but retains numeric and string zero", () => {
    const result = calculateHistoricalFundingStatistics([
      { time: NOW - 4 * HOUR },
      { time: NOW - 3 * HOUR, rate: "" },
      { time: NOW - 2 * HOUR, rate: "   " },
      { time: NOW - HOUR, rate: 0 },
      { time: NOW - 30 * 60 * 1000, rate: "0" },
    ], NOW - 4 * HOUR, NOW, HOUR);

    expect(result).toMatchObject({ settledReturn: 0, sampleCount: 2 });
  });

  test("same settled return has the same annualization regardless of settlement period", () => {
    const eightHour = calculateHistoricalFundingStatistics(
      [{ time: NOW - HOUR, rate: 0.08 }], NOW - DAY, NOW, 8 * HOUR,
    );
    const oneHour = calculateHistoricalFundingStatistics(
      Array.from({ length: 8 }, (_, index) => ({ time: NOW - (index + 1) * HOUR, rate: 0.01 })),
      NOW - DAY,
      NOW,
      HOUR,
    );

    expect(eightHour?.settledReturn).toBe(oneHour?.settledReturn);
    expect(eightHour?.annualizedRate).toBe(oneHour?.annualizedRate);
  });

  test("legacy reference-period rates cancel the current interval during annualization", () => {
    const eightHourHistory = Array.from({ length: 3 }, (_, index) => ({
      time: NOW - (index + 1) * 8 * HOUR,
      fundingRate: 0.01,
    }));
    const oneHourHistory = Array.from({ length: 24 }, (_, index) => ({
      time: NOW - (index + 1) * HOUR,
      fundingRate: 0.00125,
    }));
    const eightHour = computeAvgFundingRates(eightHourHistory, 8 * 3600, NOW).avg2d!;
    const oneHour = computeAvgFundingRates(oneHourHistory, 3600, NOW).avg2d!;

    expect(eightHour).toBeCloseTo(0.03 * 8 * HOUR / (2 * DAY), 12);
    expect(oneHour).toBeCloseTo(0.03 * HOUR / (2 * DAY), 12);
    expect(eightHour * YEAR_MS / (8 * HOUR)).toBeCloseTo(oneHour * YEAR_MS / HOUR, 12);
  });

  test("search coverage accepts an earlier proof and counts the exact cutoff", () => {
    const start = NOW - 2 * DAY;
    const result = computeAvgFundingRates([
      { time: start - 1, fundingRate: "0.02" },
      { time: start, fundingRate: "0.01" },
      { time: NOW - HOUR, fundingRate: "" },
      { time: NOW - 30 * 60 * 1000, fundingRate: "0" },
    ], 3600, NOW, { requireWindowCoverage: true });

    expect(result.avg2d).toBeCloseTo(0.01 * HOUR / (2 * DAY), 12);
  });

  test("returns null when a window has no valid samples", () => {
    expect(calculateHistoricalFundingStatistics([
      { time: NOW - DAY, rate: Number.NaN },
    ], NOW - DAY, NOW, HOUR)).toBeNull();
  });
});
