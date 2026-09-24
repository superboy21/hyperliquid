import { describe, expect, test } from "bun:test";
import { estimateDailyPairVaR, estimateSimpleReturnRegression, type DailyPairVaR, type SimpleReturnRegression } from "./pair-risk";
import { calculatePairTradeSeries } from "./pair-trade";
import type { AlignedPairClose } from "./pair-statistics";

const INTERVAL = 60_000;
const DAY_MS = 86_400_000;

/** Builds aligned closes from simple-return sequences, one point per period. */
function pairPoints(
  firstReturns: readonly number[],
  secondReturns: readonly number[],
  first0 = 100,
  second0 = 50,
  intervalMs = INTERVAL,
): AlignedPairClose[] {
  const points: AlignedPairClose[] = [{ closeTime: 0, firstClose: first0, secondClose: second0 }];
  for (let index = 0; index < firstReturns.length; index += 1) {
    const previous = points[index];
    points.push({
      closeTime: (index + 1) * intervalMs,
      firstClose: previous.firstClose * (1 + firstReturns[index]),
      secondClose: previous.secondClose * (1 + secondReturns[index]),
    });
  }
  return points;
}

/** A repeating, non-degenerate leg2 simple-return cycle with zero mean. */
function cycleSecondReturns(count: number): number[] {
  return Array.from({ length: count }, (_, index) => ((index % 5) - 2) * 0.001);
}

const regressionValue = (result: ReturnType<typeof estimateSimpleReturnRegression>): SimpleReturnRegression => {
  expect(result.available).toBe(true);
  expect(result.value).not.toBeNull();
  return result.value!;
};

describe("estimateSimpleReturnRegression", () => {
  test("recovers a known linear simple-return relationship", () => {
    const secondReturns = cycleSecondReturns(35);
    const firstReturns = secondReturns.map((value) => 0.001 + 2 * value);
    const result = regressionValue(estimateSimpleReturnRegression(pairPoints(firstReturns, secondReturns), INTERVAL));
    expect(result.returnCount).toBe(35);
    expect(result.beta).toBeCloseTo(2, 10);
    expect(result.intercept).toBeCloseTo(0.001, 10);
    expect(result.rSquared).toBeCloseTo(1, 10);
  });

  test("reports a negative slope as a valid numeric result", () => {
    const secondReturns = cycleSecondReturns(35);
    const firstReturns = secondReturns.map((value) => 0.002 - 1.5 * value);
    const result = regressionValue(estimateSimpleReturnRegression(pairPoints(firstReturns, secondReturns), INTERVAL));
    expect(result.beta).toBeCloseTo(-1.5, 10);
    expect(result.intercept).toBeCloseTo(0.002, 10);
    expect(result.rSquared).toBeCloseTo(1, 10);
  });

  test("keeps a zero slope and nulls R² when leg1 return variance is zero", () => {
    const secondReturns = cycleSecondReturns(35);
    const firstReturns = secondReturns.map(() => 0.004);
    const result = regressionValue(estimateSimpleReturnRegression(pairPoints(firstReturns, secondReturns), INTERVAL));
    expect(result.beta).toBeCloseTo(0, 12);
    expect(result.intercept).toBeCloseTo(0.004, 10);
    expect(result.rSquared).toBeNull();
    expect(result.returnCount).toBe(35);
  });

  test("only counts transitions whose spacing is exactly the interval", () => {
    const secondReturns = cycleSecondReturns(35);
    const firstReturns = secondReturns.map((value) => 0.001 + 2 * value);
    const points = pairPoints(firstReturns, secondReturns);
    // Stretch one interior spacing to two intervals without bridging it.
    const gapped = points.map((point, index) => index >= 18
      ? { ...point, closeTime: point.closeTime + INTERVAL }
      : point);
    const result = regressionValue(estimateSimpleReturnRegression(gapped, INTERVAL));
    expect(result.returnCount).toBe(34);
    expect(result.beta).toBeCloseTo(2, 10);
  });

  test("drops invalid prices and the transitions they break", () => {
    const secondReturns = cycleSecondReturns(35);
    const firstReturns = secondReturns.map((value) => 0.001 + 2 * value);
    const clean = pairPoints(firstReturns, secondReturns);
    const withInvalid = clean.map((point, index) => index === 17
      ? { closeTime: point.closeTime, firstClose: 0, secondClose: point.secondClose }
      : point);
    expect(estimateSimpleReturnRegression(clean, INTERVAL).value?.returnCount).toBe(35);
    const result = regressionValue(estimateSimpleReturnRegression(withInvalid, INTERVAL));
    // The invalid point is removed, so both of its transitions are lost while
    // the implied two-interval gap is excluded as well.
    expect(result.returnCount).toBe(33);
  });

  test("requires at least 30 valid returns", () => {
    const secondReturns = cycleSecondReturns(29);
    const firstReturns = secondReturns.map((value) => 0.001 + 2 * value);
    const result = estimateSimpleReturnRegression(pairPoints(firstReturns, secondReturns), INTERVAL);
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
    expect(result.reason).toBe("insufficient-returns");
  });

  test("fails closed on zero leg2 return variance", () => {
    const secondReturns = Array.from({ length: 30 }, () => 0.001);
    const firstReturns = cycleSecondReturns(30);
    const result = estimateSimpleReturnRegression(pairPoints(firstReturns, secondReturns), INTERVAL);
    expect(result.available).toBe(false);
    expect(result.reason).toBe("zero-variance-second-return");
  });

  test("validates the interval", () => {
    const secondReturns = cycleSecondReturns(30);
    const firstReturns = secondReturns.map((value) => 0.001 + 2 * value);
    const points = pairPoints(firstReturns, secondReturns);
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = estimateSimpleReturnRegression(points, interval);
      expect(result.available).toBe(false);
      expect(result.value).toBeNull();
      expect(result.reason).toBe("invalid-interval");
    }
  });
});

/** 300 daily closes with a flat leg2 and a controlled leg1 return distribution. */
function dailyPoints(firstReturns: readonly number[], first0 = 1000, second0 = 500): AlignedPairClose[] {
  return pairPoints(firstReturns, Array.from({ length: firstReturns.length }, () => 0), first0, second0, DAY_MS);
}

const distribution300 = [
  ...Array.from({ length: 10 }, () => -0.1),
  ...Array.from({ length: 10 }, () => -0.05),
  ...Array.from({ length: 280 }, () => 0.001),
];

describe("estimateDailyPairVaR", () => {
  test("matches a known lower-tail distribution with the gross beta denominator", () => {
    const points = dailyPoints(distribution300);
    const result = estimateDailyPairVaR(points, 1, DAY_MS);
    expect(result.sampleCount).toBe(300);
    // floor((300 - 1) * 0.05) -> index 14 -> -0.05 leg1 return
    // net = (-0.05 - 1 * 0) / (1 + 1) = -0.025 -> 2.5% loss
    expect(result.var95.available).toBe(true);
    expect(result.var95.value).toBeCloseTo(2.5, 10);
    // floor((300 - 1) * 0.01) -> index 2 -> -0.10 leg1 return -> 5% loss
    expect(result.var99.available).toBe(true);
    expect(result.var99.value).toBeCloseTo(5, 10);
  });

  test("scales the net return by 1 + beta", () => {
    const result = estimateDailyPairVaR(dailyPoints(distribution300), 3, DAY_MS);
    expect(result.sampleCount).toBe(300);
    expect(result.var95.value).toBeCloseTo(0.05 / 4 * 100, 10);
    expect(result.var99.value).toBeCloseTo(0.1 / 4 * 100, 10);
  });

  test("gates both percentiles at 100 observations while retaining the quantile rule", () => {
    // 100 complete samples: the single worst day sits at sorted index 0.
    // floor((100 - 1) * 0.01) = 0 selects it for VaR99, so the reading is the
    // worst observed sample (net -0.20 / 2 = -0.10 -> 10), while
    // floor((100 - 1) * 0.05) = 4 lands on a +0.001 day -> VaR95 is 0.
    const hundred = [-0.2, ...Array.from({ length: 99 }, () => 0.001)];
    const hundredResult = estimateDailyPairVaR(dailyPoints(hundred), 1, DAY_MS);
    expect(hundredResult.sampleCount).toBe(100);
    expect(hundredResult.var95.available).toBe(true);
    expect(hundredResult.var95.value).toBeCloseTo(0, 10);
    expect(hundredResult.var99.available).toBe(true);
    expect(hundredResult.var99.value).toBeCloseTo(10, 10);

    // 99 complete samples: both percentiles stay below the shared 100 gate.
    const ninetyNine = [-0.2, ...Array.from({ length: 98 }, () => 0.001)];
    const ninetyNineResult = estimateDailyPairVaR(dailyPoints(ninetyNine), 1, DAY_MS);
    expect(ninetyNineResult.sampleCount).toBe(99);
    expect(ninetyNineResult.var95.available).toBe(false);
    expect(ninetyNineResult.var95.reason).toBe("insufficient-daily-returns");
    expect(ninetyNineResult.var99.available).toBe(false);
    expect(ninetyNineResult.var99.value).toBeNull();
    expect(ninetyNineResult.var99.reason).toBe("insufficient-daily-returns");

    // 249 samples: VaR99 index floor(248 * 0.01) = 2 still selects a -0.20 day.
    const twoFortyNine = [...Array.from({ length: 3 }, () => -0.2), ...Array.from({ length: 246 }, () => 0.001)];
    const twoFortyNineResult = estimateDailyPairVaR(dailyPoints(twoFortyNine), 1, DAY_MS);
    expect(twoFortyNineResult.sampleCount).toBe(249);
    expect(twoFortyNineResult.var95.available).toBe(true);
    expect(twoFortyNineResult.var99.available).toBe(true);
    expect(twoFortyNineResult.var99.value).toBeCloseTo(10, 10);

    // 250 samples: the same gate and quantile rule keep VaR99 available.
    const twoFifty = [...Array.from({ length: 3 }, () => -0.2), ...Array.from({ length: 247 }, () => 0.001)];
    const twoFiftyResult = estimateDailyPairVaR(dailyPoints(twoFifty), 1, DAY_MS);
    expect(twoFiftyResult.sampleCount).toBe(250);
    expect(twoFiftyResult.var95.available).toBe(true);
    expect(twoFiftyResult.var99.available).toBe(true);
    expect(twoFiftyResult.var99.value).toBeCloseTo(10, 10);
  });

  test("rejects non-100 observation samples with the count reported", () => {
    const result = estimateDailyPairVaR(dailyPoints(Array.from({ length: 50 }, () => -0.05)), 1, DAY_MS);
    expect(result.sampleCount).toBe(50);
    expect(result.var95.available).toBe(false);
    expect(result.var95.reason).toBe("insufficient-daily-returns");
    expect(result.var99.reason).toBe("insufficient-daily-returns");
  });

  test("requires the exact UTC daily interval", () => {
    const points = dailyPoints(distribution300);
    for (const interval of [7 * DAY_MS, 3_600_000, 0, DAY_MS - 1, Number.NaN]) {
      const result = estimateDailyPairVaR(points, 1, interval);
      expect(result.sampleCount).toBe(0);
      expect(result.var95.available).toBe(false);
      expect(result.var95.reason).toBe("daily-interval-required");
      expect(result.var99.reason).toBe("daily-interval-required");
    }
  });

  test("fails closed on null, non-finite or non-positive beta", () => {
    const points = dailyPoints(distribution300);
    for (const beta of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY] as const) {
      const result: DailyPairVaR = estimateDailyPairVaR(points, beta, DAY_MS);
      expect(result.sampleCount).toBe(0);
      expect(result.var95.available).toBe(false);
      expect(result.var95.reason).toBe("invalid-beta");
      expect(result.var99.reason).toBe("invalid-beta");
    }
  });

  test("skips a missing day instead of bridging it", () => {
    const points = dailyPoints(Array.from({ length: 300 }, () => -0.01));
    const withGap = points.filter((_, index) => index !== 5);
    const result = estimateDailyPairVaR(withGap, 1, DAY_MS);
    // 301 points -> 300 transitions; dropping one point removes its two
    // adjacent transitions and the implied two-day gap is not bridged.
    expect(result.sampleCount).toBe(298);
    expect(result.var95.available).toBe(true);
    expect(result.var99.available).toBe(true);
  });

  test("skips transitions touching invalid closes", () => {
    const points = dailyPoints(Array.from({ length: 300 }, () => -0.01));
    const withInvalid = points.map((point, index) => index === 5
      ? { closeTime: point.closeTime, firstClose: 0, secondClose: point.secondClose }
      : point);
    const result = estimateDailyPairVaR(withInvalid, 1, DAY_MS);
    expect(result.sampleCount).toBe(298);
  });

  test("floors a positive quantile to zero loss", () => {
    const result = estimateDailyPairVaR(dailyPoints(Array.from({ length: 300 }, () => 0.001)), 1, DAY_MS);
    expect(result.var95.available).toBe(true);
    expect(result.var95.value).toBe(0);
    expect(result.var99.available).toBe(true);
    expect(result.var99.value).toBe(0);
  });

  test("the daily rebalanced ratio proxy differs from entry-fixed quantities after drift", () => {
    // Leg1 alternates +10%/-10%, leg2 the mirror -10%/+10% for 100 daily
    // transitions. With beta = 1 the odd transitions have simple returns
    // (r1 = -0.10, r2 = +0.10), so the documented daily ratio proxy is
    // (r1 - beta*r2)/(1+beta) = (-0.10 - 0.10)/2 = -0.10 on each of those 50
    // days (the other 50 are +0.10). floor((100 - 1) * 0.05) = index 4, which
    // is one of the -0.10 values, so var95 reports the hand-computed 10% day-2
    // proxy magnitude.
    const firstReturns = Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 0.1 : -0.1));
    const secondReturns = Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? -0.1 : 0.1));
    const points = pairPoints(firstReturns, secondReturns, 100, 100, DAY_MS);

    const proxy = estimateDailyPairVaR(points, 1, DAY_MS);
    expect(proxy.sampleCount).toBe(100);
    expect(proxy.var95.available).toBe(true);
    expect(proxy.var95.value).toBeCloseTo(10, 10);

    // Fixed-token pair trade from the first close: day 1 is +20%, day 2 back to
    // flat 0% (both legs return to 99), so the day-2 incremental change is -20%.
    const trade = calculatePairTradeSeries(points, 1, 10_000);
    expect(trade.available).toBe(true);
    const day1 = trade.value!.points[1].returnPercent!;
    const day2 = trade.value!.points[2].returnPercent!;
    expect(day1).toBeCloseTo(20, 8);
    expect(day2).toBeCloseTo(0, 8);
    const fixedDailyChange = day2 - day1; // -20%
    expect(fixedDailyChange).toBeCloseTo(-20, 8);

    // The two paths do not coincide once prices drift: the 10% rebalanced ratio
    // proxy is not the 20% fixed-quantity daily change.
    expect(Math.abs(fixedDailyChange)).not.toBeCloseTo(proxy.var95.value!, 8);
  });

  test("excludes the in-progress current daily bar from the VaR sample", () => {
    // 100 daily transitions -> 101 candles; the last candle opens at 100*DAY
    // and only closes at 101*DAY.
    const firstReturns = Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 0.1 : -0.1));
    const secondReturns = Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? -0.1 : 0.1));
    const points = pairPoints(firstReturns, secondReturns, 100, 100, DAY_MS);
    const exactLastClose = 101 * DAY_MS;

    // One ms before the final bar closes, that bar is still in progress and its
    // transition is dropped, leaving only the 99 completed days.
    const partial = estimateDailyPairVaR(points, 1, DAY_MS, exactLastClose - 1);
    expect(partial.sampleCount).toBe(99);
    expect(partial.var95.available).toBe(false);
    expect(partial.var95.value).toBeNull();
    expect(partial.var95.reason).toBe("insufficient-daily-returns");

    // A candle ending exactly at asOf is complete, restoring the 100th sample.
    const complete = estimateDailyPairVaR(points, 1, DAY_MS, exactLastClose);
    expect(complete.sampleCount).toBe(100);
    expect(complete.var95.available).toBe(true);
    expect(complete.var95.value).toBeCloseTo(10, 10);
  });

  test("rejects a non-finite as-of timestamp instead of risking lookahead", () => {
    const points = dailyPoints(Array.from({ length: 300 }, () => -0.01));
    for (const asOf of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = estimateDailyPairVaR(points, 1, DAY_MS, asOf);
      expect(result.sampleCount).toBe(0);
      expect(result.var95.available).toBe(false);
      expect(result.var95.reason).toBe("invalid-as-of");
      expect(result.var99.reason).toBe("invalid-as-of");
    }
  });

  test("still skips missing days under the as-of completion filter", () => {
    const points = dailyPoints(Array.from({ length: 300 }, () => -0.01));
    const withGap = points.filter((_, index) => index !== 5);
    const result = estimateDailyPairVaR(withGap, 1, DAY_MS, 320 * DAY_MS);
    expect(result.sampleCount).toBe(298);
    expect(result.var95.available).toBe(true);
    expect(result.var99.available).toBe(true);
  });
});
