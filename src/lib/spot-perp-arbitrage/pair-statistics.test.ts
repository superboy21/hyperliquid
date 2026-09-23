import { describe, expect, test } from "bun:test";
import {
  adf0, analyzePair, analyzePairViewport, ar1HalfLife, btcResidualBeta, estimatePairModel, normalizeAlignedPairCloses,
  residualPoints, rollingBetaStability, type AlignedPairClose,
} from "./pair-statistics";

const interval = 60_000;
const pair = (count: number, fn: (index: number) => { first: number; second: number }): AlignedPairClose[] => (
  Array.from({ length: count }, (_, index) => ({
    closeTime: index * interval, firstClose: fn(index).first, secondClose: fn(index).second,
  }))
);

describe("pair statistics", () => {
  test("cleans, de-duplicates, sorts, and estimates known log OLS", () => {
    const input = pair(25, (i) => ({ first: Math.exp(1 + 2 * i / 10), second: Math.exp(i / 10) }));
    const cleaned = normalizeAlignedPairCloses([{ closeTime: 2, firstClose: 2, secondClose: 2 }, { closeTime: 1, firstClose: 1, secondClose: 1 }, { closeTime: 2, firstClose: 3, secondClose: 3 }, { closeTime: 3, firstClose: -1, secondClose: 2 }]);
    expect(cleaned).toEqual([{ closeTime: 1, firstClose: 1, secondClose: 1 }, { closeTime: 2, firstClose: 3, secondClose: 3 }]);
    const model = estimatePairModel(input, { mode: "ols" });
    expect(model.value?.alpha).toBeCloseTo(1);
    expect(model.value?.beta).toBeCloseTo(2);
    expect(estimatePairModel(input.slice(0, 19), { mode: "ols" }).reason).toBe("insufficient-points");
  });

  test("custom beta is used directly and rolling z warms up and resets at gaps", () => {
    const input = pair(25, (i) => ({ first: Math.exp(3 + 1.5 * i / 10), second: Math.exp(i / 10) }));
    const model = estimatePairModel(input, { mode: "custom", beta: 1.5 });
    expect(model.value?.beta).toBe(1.5);
    expect(model.value?.alpha).toBeCloseTo(3);
    expect(estimatePairModel(input, { mode: "custom", beta: 0 }).reason).toBe("invalid-custom-beta");
    expect(estimatePairModel(input, { mode: "custom", beta: Number.NaN }).reason).toBe("invalid-custom-beta");
    expect(estimatePairModel(input, { mode: "custom", beta: -2 }).reason).toBe("invalid-custom-beta");
    const residuals = residualPoints([...input.slice(0, 20), { ...input[20], closeTime: input[20].closeTime + interval }], model.value!, interval);
    expect(residuals[18].zScore).toBeNull();
    expect(residuals[19].zScore).not.toBeNull();
    expect(residuals[20].zScore).toBeNull();
  });

  test("ADF distinguishes stationary residuals from a random walk and enforces regularity", () => {
    const stationary = pair(130, (i) => {
      const x = i / 100;
      const r = Math.sin(i * 1.7) * 0.03;
      return { first: Math.exp(x + r), second: Math.exp(x) };
    });
    let walk = 0;
    let seed = 7;
    const randomWalk = pair(130, (i) => {
      const x = i / 100;
      seed = (seed * 16_807) % 2_147_483_647;
      walk += (seed / 2_147_483_647 - 0.5) * 0.04;
      return { first: Math.exp(x + walk), second: Math.exp(x) };
    });
    const a = analyzePair(stationary, { mode: "ols" }, { intervalMs: interval });
    const b = analyzePair(randomWalk, { mode: "ols" }, { intervalMs: interval });
    expect(a.adf.value?.stationary).toBe(true);
    expect(b.adf.value?.stationary).toBe(false);
    const irregular = a.residuals.map((point, i) => i % 2 ? { ...point, closeTime: point.closeTime + interval / 2 } : point);
    expect(adf0(irregular, "ols", interval).reason).toBe("irregular-series");
  });

  test("calculates AR(1) half-life, rolling beta stability, and exact BTC beta", () => {
    let residual = 0;
    let btcLog = 0;
    const btc = pair(90, (i) => {
      btcLog += 0.01 * Math.sin(i * 0.7);
      return { first: Math.exp(btcLog), second: Math.exp(btcLog) };
    });
    const series = pair(90, (i) => {
      const btcReturn = i === 0 ? 0 : Math.log(btc[i].firstClose / btc[i - 1].firstClose);
      residual = 0.7 * residual + 2 * btcReturn;
      return { first: Math.exp(i / 100 + residual), second: Math.exp(i / 100) };
    });
    const analysis = analyzePair(series, { mode: "custom", beta: 1 }, {
      intervalMs: interval, btcCloses: btc.map(({ closeTime, firstClose }) => ({ closeTime, close: firstClose })), btcSource: "test-btc",
    });
    let arResidual = 0;
    let arSeed = 19;
    const arSeries = pair(90, () => {
      arSeed = (arSeed * 16_807) % 2_147_483_647;
      arResidual = 0.7 * arResidual + (arSeed / 2_147_483_647 - 0.5) * 0.08;
      return { first: Math.exp(arResidual), second: 1 };
    });
    const arModel = estimatePairModel(arSeries, { mode: "custom", beta: 1 });
    expect(ar1HalfLife(residualPoints(arSeries, arModel.value!, interval), interval).value?.phi).toBeGreaterThan(0);
    expect(analysis.rollingBeta.value?.estimateCount).toBeGreaterThanOrEqual(20);
    expect(analysis.btcBeta.value?.returnCount).toBe(89);
    expect(analysis.btcBeta.value?.source).toBe("test-btc");
    expect(btcResidualBeta(analysis.residuals).reason).toBe("btc-unavailable");
    expect(ar1HalfLife(analysis.residuals.slice(0, 20), interval).reason).toBe("insufficient-transitions");
    expect(rollingBetaStability(series.slice(0, 70), interval).reason).toBe("insufficient-rolling-estimates");
  });
});

describe("pair statistics viewport", () => {
  const input = pair(180, (index) => {
    const x = index / 100;
    const residual = 0.04 * Math.sin(index * 1.7) + 0.01 * Math.cos(index * 0.31);
    return { first: Math.exp(1 + 1.7 * x + residual), second: Math.exp(x) };
  });

  test("keeps the preset fit fixed and carries full-history residual/Z values into the viewport", () => {
    const fitted = analyzePair(input, { mode: "ols" }, { intervalMs: interval });
    const start = 100 * interval;
    const end = 130 * interval;
    const viewport = analyzePairViewport(input, fitted, { startTime: start, endTime: end }, { intervalMs: interval });
    expect(viewport).not.toBeNull();
    expect(viewport!.model).toBe(fitted.model);
    expect(viewport!.model.value?.alpha).toBe(fitted.model.value?.alpha);
    expect(viewport!.model.value?.beta).toBe(fitted.model.value?.beta);
    expect(viewport!.model.value?.count).toBe(input.length);
    expect(viewport!.aligned[0].closeTime).toBe(start);
    expect(viewport!.aligned.at(-1)?.closeTime).toBe(end);
    expect(viewport!.points.at(-1)?.closeTime).toBe(end);
    expect(viewport!.points.at(-1)?.residual).toBe(fitted.points[end / interval]?.residual);
    expect(viewport!.points[0].zScore).toBe(fitted.points[start / interval]?.zScore);
    expect(viewport!.points[0].zScore).not.toBeNull();
  });

  test("short viewports recompute diagnostics and report local sample insufficiency", () => {
    const fitted = analyzePair(input, { mode: "ols" }, { intervalMs: interval });
    const viewport = analyzePairViewport(input, fitted, { startTime: 90 * interval, endTime: 105 * interval }, { intervalMs: interval });
    expect(viewport?.adf.reason).toBe("insufficient-level-points");
    expect(viewport?.rollingBeta.reason).toBe("insufficient-rolling-estimates");
    expect(viewport?.halfLife.reason).toBe("insufficient-transitions");
    expect(viewport?.diagnostics.alignedPointCount).toBe(16);
  });

  test("full viewport matches ordinary analysis and empty/invalid windows fail closed", () => {
    const fitted = analyzePair(input, { mode: "ols" }, { intervalMs: interval });
    expect(analyzePairViewport(input, fitted, null, { intervalMs: interval })).toEqual(fitted);
    expect(analyzePairViewport(input, fitted, { startTime: 500 * interval, endTime: 600 * interval })).toBeNull();
    expect(analyzePairViewport(input, fitted, { startTime: 10, endTime: 0 })).toBeNull();
    const unavailable = analyzePair(input.slice(0, 10), { mode: "ols" });
    expect(analyzePairViewport(input, unavailable, null)).toBeNull();
  });
});
