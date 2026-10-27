import { describe, expect, test } from "bun:test";
import type { ComboCandleResult, ComboFundingLegObservation, ComboFundingRatePoint } from "../combo";
import type { SignedFundingObservation, SpotContainingCombinationResult } from "./combine";
import {
  PAIR_FUNDING_PANE_NAME,
  PAIR_PNL_PANE_NAME,
  PAIR_WEIGHTED_FUNDING_PANE_NAME,
  alignedPairFundingLane,
  alignedPairWeightedFundingLane,
  pairFundingAvailable,
  pairFundingBeta,
  pairFundingTooltipLines,
  pairPaneLayout,
  pairWeightedFundingAvailable,
  pairWeightedFundingTooltipLines,
} from "./pair-funding-lane";

function perpResult(fundingRates: ComboFundingRatePoint[]): ComboCandleResult {
  return { candles: [], fundingRates, leg1Points: [], leg2Points: [] } as unknown as ComboCandleResult;
}

function observation(rate: number, annualizedRate: number, extra: Partial<ComboFundingLegObservation> = {}): ComboFundingLegObservation {
  return { rate, annualizedRate, ...extra };
}

/**
 * A self-consistent perp/perp bucket: the stored difference really equals
 * `leg1 - leg2`, exactly as `alignComboData` produces it. Weighted-lane tests use
 * this so an identity check can never pass by accident on inconsistent fixture
 * numbers.
 */
function perpBucket(
  time: number,
  first: { rate: number; annualizedRate: number } | null,
  second: { rate: number; annualizedRate: number } | null,
  extra: Partial<ComboFundingRatePoint> = {},
): ComboFundingRatePoint {
  const firstRate = first?.rate ?? 0;
  const secondRate = second?.rate ?? 0;
  const firstAnnualized = first?.annualizedRate ?? 0;
  const secondAnnualized = second?.annualizedRate ?? 0;
  return {
    time,
    rate: firstRate - secondRate,
    annualizedRate: firstAnnualized - secondAnnualized,
    ...(first ? { firstFunding: observation(first.rate, first.annualizedRate) } : { firstFunding: null }),
    ...(second ? { secondFunding: observation(second.rate, second.annualizedRate) } : { secondFunding: null }),
    ...extra,
  };
}

/** Perp on the given leg; `funding` is expected to be pre-signed by the combiner. */
function mixedResult(
  funding: SignedFundingObservation[],
  perpLeg: 1 | 2 = 2,
): SpotContainingCombinationResult {
  const perp = { kind: "perp" as const, source: { exchange: "Binance", symbol: "BTCUSDT" } };
  const spot = { kind: "spot" as const, source: { exchange: "Binance", symbol: "BTCUSDT" } };
  return {
    kind: "spot-containing",
    mode: "spread",
    interval: "1d",
    points: [],
    funding,
    composition: "mixed",
    leg1: perpLeg === 1 ? perp : spot,
    leg2: perpLeg === 1 ? spot : perp,
    legProvenance: [],
  } as unknown as SpotContainingCombinationResult;
}

describe("pair funding lane: 1:1 raw annualized difference", () => {
  test("replays the plain-view difference unchanged (no beta, no price scaling)", () => {
    // Self-consistent bucket: the stored difference really is leg1 - leg2.
    const result = perpResult([
      perpBucket(10, { rate: 0.0001, annualizedRate: 0.0125 }, { rate: 0.00005, annualizedRate: 0.005 }),
    ]);
    const lane = alignedPairFundingLane(result, [10], "1d");
    expect(lane.points[0].value).toBeCloseTo((0.0125 - 0.005) * 100, 12);
    expect(lane.points[0].value).toBeCloseTo(0.75, 12);
    expect(lane.points[0].rate).toBeCloseTo(0.00005, 12);
    expect(lane.hasActual).toBe(true);
  });

  test("aligns by time, not by array index, when pair times and funding are reordered", () => {
    const result = perpResult([
      { time: 30, rate: 0, annualizedRate: 3, firstFunding: null, secondFunding: null },
      { time: 10, rate: 0, annualizedRate: 1, firstFunding: null, secondFunding: null },
      { time: 20, rate: 0, annualizedRate: 2, firstFunding: null, secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [20, 10, 30, 40], "1d");
    expect(lane.points.map((point) => [point.time, point.value])).toEqual([
      [20, 200],
      [10, 100],
      [30, 300],
      [40, null],
    ]);
  });

  test("keeps true zero as 0 and missing buckets as null gaps", () => {
    const result = perpResult([
      { time: 10, rate: 0, annualizedRate: 0, firstFunding: observation(0, 0), secondFunding: observation(0, 0) },
      { time: 11, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [10, 11, 12], "1d");
    expect(lane.points.map((point) => point.value)).toEqual([0, null, null]);
    expect(lane.points[0].temporaryZero).toBe(false);
    expect(lane.temporaryZero).toEqual([null, null, null]);
    expect(lane.hasTemporaryZero).toBe(false);
  });

  test("never treats an explicit sampleCount 0 bucket as a real settlement", () => {
    const result = perpResult([
      { time: 10, rate: 0.001, annualizedRate: 5, sampleCount: 0, firstFunding: null, secondFunding: null },
      { time: 11, rate: 0.001, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [10, 11], "1d");
    expect(lane.points.map((point) => point.value)).toEqual([null, null]);
    expect(lane.hasActual).toBe(false);
  });

  test("drops non-finite and non-numeric rates to gaps instead of plotting garbage", () => {
    const result = perpResult([
      { time: 10, rate: 0, annualizedRate: Number.NaN, firstFunding: null, secondFunding: null },
      { time: 11, rate: 0, annualizedRate: Number.POSITIVE_INFINITY, firstFunding: null, secondFunding: null },
      { time: 12, rate: Number.NaN, annualizedRate: 2, firstFunding: null, secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [10, 11, 12], "1d");
    expect(lane.points.map((point) => point.value)).toEqual([null, null, 200]);
    expect(lane.points[2].rate).toBeNull();
  });

  test("discloses the chart-only temporary zero and its one-sided leg source", () => {
    const result = perpResult([
      { time: 10, rate: 0.0002, annualizedRate: 0.02, firstFunding: observation(0.0002, 0.02), secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [10], "4h");
    expect(lane.points[0]).toMatchObject({ value: 2, temporaryZero: true, first: { annualizedRate: 0.02 }, second: null });
    expect(lane.temporaryZero).toEqual([2]);
    expect(lane.hasTemporaryZero).toBe(true);
    const lines = pairFundingTooltipLines(lane.points[0], "Binance BTCUSDT", "Bybit BTCUSDT");
    expect(lines[0]).toContain("年化资金费率差（1:1）：+2.00%");
    expect(lines).toContain("资金费率差：含临时0，仅图表显示");
    expect(lines).toContain("Bybit BTCUSDT: 无结算费率");
  });

  test("does not mutate the source funding points", () => {
    const result = perpResult([
      { time: 10, rate: 0.0001, annualizedRate: 0.01, firstFunding: observation(0.0001, 0.01, { settlements: [{ time: 10, rate: 0.0001 }] }), secondFunding: observation(0.0001, 0.01) },
    ]);
    const before = structuredClone(result);
    const lane = alignedPairFundingLane(result, [10], "1d");
    expect(lane.points[0].value).toBe(1);
    expect(result).toEqual(before);
  });
});

describe("pair funding lane: mixed composition sign passthrough", () => {
  test("replays a perp-on-leg-2 rate that was already signed once (no second negation)", () => {
    // combine.ts already applies sign = -1 for a perp on leg 2.
    const lane = alignedPairFundingLane(
      mixedResult([{ time: 10, rate: -0.0002, annualizedRate: -0.02, sampleCount: 1, perpLeg: 2 }], 2),
      [10],
      "1d",
    );
    expect(lane.points[0].value).toBeCloseTo(-2, 12);
    expect(lane.points[0].first).toBeNull();
    expect(lane.points[0].second).toMatchObject({ rate: 0.0002, annualizedRate: 0.02 });
    expect(pairFundingTooltipLines(lane.points[0], null, "Perp")).toEqual([
      "年化资金费率差（1:1）：-2.00%（区间累计费率 -0.0200%）",
      "Perp: +2.00%（区间累计费率 +0.0200%）",
    ]);
  });

  test("replays a perp-on-leg-1 rate unchanged", () => {
    const lane = alignedPairFundingLane(
      mixedResult([{ time: 10, rate: 0.0003, annualizedRate: 0.03, sampleCount: 1, perpLeg: 1 }], 1),
      [10],
      "1d",
    );
    expect(lane.points[0].value).toBeCloseTo(3, 12);
    expect(lane.points[0].first).toMatchObject({ annualizedRate: 0.03 });
    expect(lane.points[0].second).toBeNull();
  });

  test("keeps a missing mixed funding key as a gap and never flips its sign", () => {
    const lane = alignedPairFundingLane(
      mixedResult([{ time: 20, rate: 0.0002, annualizedRate: 0.02, sampleCount: 1, perpLeg: 2 }], 2),
      [10, 20],
      "1d",
    );
    expect(lane.points.map((point) => point.value)).toEqual([null, 2]);
    expect(lane.points[1].value).toBeGreaterThan(0);
  });

  test("a missing sampleCount-0 mixed bucket stays a gap while a true zero renders 0", () => {
    const lane = alignedPairFundingLane(
      mixedResult([
        { time: 10, rate: 0, annualizedRate: 0, sampleCount: null, perpLeg: 2 },
        { time: 11, rate: 0, annualizedRate: 0, sampleCount: 0, perpLeg: 2 },
      ], 2),
      [10, 11],
      "1d",
    );
    expect(lane.points.map((point) => point.value)).toEqual([0, null]);
  });

  test("spot-spot combinations expose no funding lane data", () => {
    const lane = alignedPairFundingLane(
      { ...mixedResult([]), composition: "spot-spot", leg2: { kind: "spot", source: { exchange: "OKX", symbol: "BTCUSDT" } } } as unknown as SpotContainingCombinationResult,
      [10, 20],
      "1d",
    );
    expect(lane.points.map((point) => point.value)).toEqual([null, null]);
    expect(lane.hasActual).toBe(false);
    expect(lane.hasTemporaryZero).toBe(false);
  });

  test("mixed tooltip omits the spot leg instead of claiming a settlement", () => {
    const lane = alignedPairFundingLane(
      mixedResult([{ time: 10, rate: 0.0002, annualizedRate: 0.02, sampleCount: 1, perpLeg: 2 }], 2),
      [10],
      "1d",
    );
    const lines = pairFundingTooltipLines(lane.points[0], null, "Binance BTCUSDT Perp");
    expect(lines.some((line) => line.startsWith("null"))).toBe(false);
    expect(lines).toEqual([
      "年化资金费率差（1:1）：+2.00%（区间累计费率 +0.0200%）",
      "Binance BTCUSDT Perp: -2.00%（区间累计费率 -0.0200%）",
    ]);
  });

  test("perp-on-leg-1 mixed rows label the perp on the first leg only", () => {
    const lane = alignedPairFundingLane(
      mixedResult([{ time: 10, rate: 0.0003, annualizedRate: 0.03, sampleCount: 1, perpLeg: 1 }], 1),
      [10],
      "1d",
    );
    const lines = pairFundingTooltipLines(lane.points[0], "Bybit BTC Perp", null);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Bybit BTC Perp: +3.00%（区间累计费率 +0.0300%）");
  });

  test("perp/perp keeps both leg rows, using 无结算费率 for the leg without a settlement", () => {
    const result = perpResult([
      { time: 10, rate: 0.0002, annualizedRate: 0.02, firstFunding: observation(0.0002, 0.02), secondFunding: null },
    ]);
    const lane = alignedPairFundingLane(result, [10], "1d");
    const lines = pairFundingTooltipLines(lane.points[0], "Binance BTCUSDT", "Bybit BTCUSDT");
    // This bucket is a one-sided temporary zero, so its disclosure line comes first.
    expect(lines[1]).toBe("资金费率差：含临时0，仅图表显示");
    expect(lines[2]).toBe("Binance BTCUSDT: +2.00%（区间累计费率 +0.0200%）");
    expect(lines[3]).toBe("Bybit BTCUSDT: 无结算费率");
  });

  test("a gap bucket reports 无 without inventing leg rows", () => {
    const lane = alignedPairFundingLane(perpResult([]), [10], "1d");
    expect(pairFundingTooltipLines(lane.points[0], "A", "B")).toEqual(["年化资金费率差（1:1）：无"]);
    expect(pairFundingTooltipLines(undefined, "A", "B")).toEqual(["年化资金费率差（1:1）：无"]);
  });
});

describe("pair funding lane: sparse settlement points", () => {
  test("marks intraday data sparse only when actual samples and gaps coexist", () => {
    const funding = [
      { time: 10, rate: 0.001, annualizedRate: 1, firstFunding: null, secondFunding: null },
      { time: 11, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ];
    expect(alignedPairFundingLane(perpResult(funding), [10, 11], "4h").sparse).toBe(true);
    expect(alignedPairFundingLane(perpResult(funding), [10, 11], "1d").sparse).toBe(false);
    expect(alignedPairFundingLane(perpResult(funding.slice(0, 1)), [10], "4h").sparse).toBe(false);
  });
});

describe("pair funding availability", () => {
  test("offers the lane whenever the plain view would show it", () => {
    const result = perpResult([
      { time: 10, rate: 0.001, annualizedRate: 1, firstFunding: null, secondFunding: null },
      { time: 11, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ]);
    expect(pairFundingAvailable(result, "4h")).toBe(true);
    expect(pairFundingAvailable(result, "1d")).toBe(true);
  });

  test("never offers the lane on 1m, matching the plain view", () => {
    const result = perpResult([{ time: 10, rate: 0.001, annualizedRate: 1, firstFunding: null, secondFunding: null }]);
    expect(pairFundingAvailable(result, "1m")).toBe(false);
  });

  test("keeps the lane for an all-gap result, exactly like the plain view's empty lane", () => {
    const result = perpResult([
      { time: 10, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ]);
    expect(pairFundingAvailable(result, "4h")).toBe(true);
    expect(alignedPairFundingLane(result, [10], "4h").hasActual).toBe(false);
  });

  test("does not offer the lane when a perp/perp result carries no funding buckets", () => {
    expect(pairFundingAvailable(perpResult([]), "1d")).toBe(false);
  });

  test("still offers the lane for a mixed result with signed perp funding, and never on 1m", () => {
    expect(pairFundingAvailable(mixedResult([{ time: 10, rate: 0.001, annualizedRate: 1, sampleCount: 1, perpLeg: 2 }]), "1d")).toBe(true);
    expect(pairFundingAvailable(mixedResult([{ time: 10, rate: 0.001, annualizedRate: 1, sampleCount: 1, perpLeg: 2 }]), "1m")).toBe(false);
    expect(pairFundingAvailable(mixedResult([]), "1d")).toBe(false);
  });

  test("does not offer the lane for spot-spot combinations", () => {
    const result = { ...mixedResult([]), composition: "spot-spot" } as unknown as SpotContainingCombinationResult;
    expect(pairFundingAvailable(result, "1d")).toBe(false);
  });

  test("reports which leg can carry funding", () => {
    const perpFirst = alignedPairFundingLane(mixedResult([], 1), [10], "1d");
    const perpSecond = alignedPairFundingLane(mixedResult([], 2), [10], "1d");
    const perpPerp = alignedPairFundingLane(perpResult([]), [10], "1d");
    expect([perpFirst.firstHasFunding, perpFirst.secondHasFunding]).toEqual([true, false]);
    expect([perpSecond.firstHasFunding, perpSecond.secondHasFunding]).toEqual([false, true]);
    expect([perpPerp.firstHasFunding, perpPerp.secondHasFunding]).toEqual([true, true]);
  });
});

describe("pair pane layout", () => {
  const derived = "原始比值（腿1/腿2）";

  test("defaults to PnL + derived subplot only", () => {
    const layout = pairPaneLayout({ derived });
    expect(layout.names).toEqual([PAIR_PNL_PANE_NAME, derived]);
    expect(layout.weightedFunding).toBeNull();
    expect(layout.funding).toBeNull();
  });

  test("appends each funding pane after the panes already shown", () => {
    const base = pairPaneLayout({ derived, firstRaw: "原始 A" });
    const oneLane = pairPaneLayout({ derived, firstRaw: "原始 A", funding: PAIR_FUNDING_PANE_NAME });
    const bothLanes = pairPaneLayout({
      derived,
      firstRaw: "原始 A",
      funding: PAIR_FUNDING_PANE_NAME,
      weightedFunding: PAIR_WEIGHTED_FUNDING_PANE_NAME,
    });
    expect(base.firstRaw).toBe(2);
    expect(oneLane.firstRaw).toBe(2);
    expect(oneLane.funding).toBe(3);
    expect(bothLanes.firstRaw).toBe(2);
    expect(bothLanes.funding).toBe(3);
    expect(bothLanes.weightedFunding).toBe(4);
    expect(bothLanes.names[4]).toBe("年化资金费率差（1:β）");
  });

  test("never renumbers raw panes when only the weighted lane is on", () => {
    const withRaw = pairPaneLayout({ derived, firstRaw: "A", secondRaw: "B" });
    const plusWeighted = pairPaneLayout({ derived, firstRaw: "A", secondRaw: "B", weightedFunding: PAIR_WEIGHTED_FUNDING_PANE_NAME });
    expect(withRaw.names).toEqual(plusWeighted.names.slice(0, 4));
    expect(plusWeighted.weightedFunding).toBe(4);
  });

  test("keeps every index distinct for all raw/funding combinations", () => {
    const combos = [
      { firstRaw: undefined, secondRaw: undefined, funding: undefined, weightedFunding: undefined },
      { firstRaw: "A", secondRaw: undefined, funding: undefined, weightedFunding: undefined },
      { firstRaw: undefined, secondRaw: "B", funding: undefined, weightedFunding: undefined },
      { firstRaw: "A", secondRaw: "B", funding: undefined, weightedFunding: undefined },
      { firstRaw: undefined, secondRaw: undefined, funding: "F", weightedFunding: undefined },
      { firstRaw: "A", secondRaw: undefined, funding: "F", weightedFunding: undefined },
      { firstRaw: undefined, secondRaw: "B", funding: "F", weightedFunding: undefined },
      { firstRaw: "A", secondRaw: "B", funding: "F", weightedFunding: undefined },
      { firstRaw: undefined, secondRaw: undefined, funding: undefined, weightedFunding: "W" },
      { firstRaw: "A", secondRaw: undefined, funding: undefined, weightedFunding: "W" },
      { firstRaw: undefined, secondRaw: "B", funding: undefined, weightedFunding: "W" },
      { firstRaw: "A", secondRaw: "B", funding: undefined, weightedFunding: "W" },
      { firstRaw: undefined, secondRaw: undefined, funding: "F", weightedFunding: "W" },
      { firstRaw: "A", secondRaw: undefined, funding: "F", weightedFunding: "W" },
      { firstRaw: undefined, secondRaw: "B", funding: "F", weightedFunding: "W" },
      { firstRaw: "A", secondRaw: "B", funding: "F", weightedFunding: "W" },
    ];
    for (const combo of combos) {
      const layout = pairPaneLayout({ derived, ...combo });
      const visible = [layout.pnl, layout.derived, layout.firstRaw, layout.secondRaw, layout.funding, layout.weightedFunding]
        .filter((index) => index !== null);
      expect(new Set(visible).size).toBe(visible.length);
      expect(visible).toEqual(visible.slice().sort((a, b) => a - b));
      expect(layout.names.length).toBe(visible.length);
      // Appended last: the highest visible index belongs to the last enabled pane.
      expect(layout.weightedFunding).toBe(combo.weightedFunding ? layout.names.length - 1 : null);
      if (!combo.weightedFunding && combo.funding) expect(layout.funding).toBe(layout.names.length - 1);
    }
  });
});

describe("pair weighted funding lane: effective beta", () => {
  test("accepts only a finite positive beta", () => {
    expect(pairFundingBeta(1.5)).toBe(1.5);
    expect(pairFundingBeta(0.0001)).toBe(0.0001);
    expect(pairFundingBeta(0)).toBeNull();
    expect(pairFundingBeta(-2)).toBeNull();
    expect(pairFundingBeta(Number.NaN)).toBeNull();
    expect(pairFundingBeta(Number.POSITIVE_INFINITY)).toBeNull();
    expect(pairFundingBeta(null)).toBeNull();
    expect(pairFundingBeta(undefined)).toBeNull();
  });

  test("requires both funding data and a usable beta", () => {
    const result = perpResult([perpBucket(10, { rate: 0.0001, annualizedRate: 0.01 }, { rate: 0.00005, annualizedRate: 0.005 })]);
    expect(pairWeightedFundingAvailable(result, "1d", 2)).toBe(true);
    expect(pairWeightedFundingAvailable(result, "1m", 2)).toBe(false);
    expect(pairWeightedFundingAvailable(result, "1d", 0)).toBe(false);
    expect(pairWeightedFundingAvailable(result, "1d", Number.NaN)).toBe(false);
    expect(pairWeightedFundingAvailable(result, "1d", null)).toBe(false);
    const spotSpot = { ...mixedResult([]), composition: "spot-spot" } as unknown as SpotContainingCombinationResult;
    expect(pairWeightedFundingAvailable(spotSpot, "1d", 2)).toBe(false);
  });

  test("beta 1 reproduces the 1:1 lane exactly on self-consistent data", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
      perpBucket(20, { rate: 0.00007, annualizedRate: 0.0077 }, { rate: 0.00009, annualizedRate: 0.0099 }),
    ]);
    const oneToOne = alignedPairFundingLane(result, [10, 20], "1d");
    const weighted = alignedPairWeightedFundingLane(result, [10, 20], "1d", 1);
    expect(weighted.points.map((point) => point.value)).toEqual(oneToOne.points.map((point) => point.value));
    expect(weighted.points.map((point) => point.rate)).toEqual(oneToOne.points.map((point) => point.rate));
  });

  test("beta 2 is leg1 - 2*leg2, not the 1:1 difference times 2", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
    ]);
    const oneToOne = alignedPairFundingLane(result, [10], "1d");
    const weighted = alignedPairWeightedFundingLane(result, [10], "1d", 2);
    expect(oneToOne.points[0].value).toBeCloseTo(0.88, 9);       // 1.32% - 0.44%
    expect(weighted.points[0].value).toBeCloseTo(0.44, 9);       // 1.32% - 2*0.44%
    expect(weighted.points[0].value).not.toBeCloseTo(oneToOne.points[0].value! * 2, 6);
    expect(weighted.points[0].rate).toBeCloseTo(0.00012 - 2 * 0.00004, 12);
  });

  test("beta changes recompute the same buckets", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
    ]);
    const atOne = alignedPairWeightedFundingLane(result, [10], "1d", 1);
    const atThree = alignedPairWeightedFundingLane(result, [10], "1d", 3);
    const atFour = alignedPairWeightedFundingLane(result, [10], "1d", 4);
    expect(atOne.points[0].value).toBeCloseTo(0.88, 9);
    expect(atThree.points[0].value).toBeCloseTo(1.32 - 3 * 0.44, 9);
    // A larger β×leg2 can carry the weighted difference below zero.
    expect(atFour.points[0].value).toBeCloseTo(1.32 - 4 * 0.44, 9);
    expect(atFour.points[0].value).toBeLessThan(0);
  });

  test("an unusable beta yields gaps, never a substituted 1:1 line", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
    ]);
    for (const beta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const lane = alignedPairWeightedFundingLane(result, [10, 20], "1d", beta);
      expect(lane.points.map((point) => point.value)).toEqual([null, null]);
      expect(lane.hasActual).toBe(false);
    }
  });

  test("skips a bucket with no per-leg detail instead of guessing a weighted value", () => {
    // Only the legacy derived 1:1 rate is present: β-weighting is not derivable.
    const result = perpResult([
      { time: 10, rate: 0.00008, annualizedRate: 0.0088 },
    ]);
    expect(alignedPairFundingLane(result, [10], "1d").points[0].value).toBeCloseTo(0.88, 9);
    const weighted = alignedPairWeightedFundingLane(result, [10], "1d", 2);
    expect(weighted.points[0].value).toBeNull();
    expect(weighted.points[0].first).toBeNull();
    expect(weighted.points[0].second).toBeNull();
  });

  test("keeps gaps for sampleCount 0 and missing times, and a real zero stays 0", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0, annualizedRate: 0 }, { rate: 0, annualizedRate: 0 }),
      { time: 11, rate: 0, annualizedRate: 0, sampleCount: 0, firstFunding: null, secondFunding: null },
    ]);
    const lane = alignedPairWeightedFundingLane(result, [10, 11, 12], "1d", 2);
    expect(lane.points.map((point) => point.value)).toEqual([0, null, null]);
  });

  test("collapses a non-finite weighted result to a gap", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0, annualizedRate: 1e307 }, { rate: 0, annualizedRate: 1e307 }),
    ]);
    expect(alignedPairWeightedFundingLane(result, [10], "1d", 1e10).points[0].value).toBeNull();
  });

  test("reuses the chart-only temporary zero with the yellow diamond disclosure", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.0002, annualizedRate: 0.02 }, null),
    ]);
    const lane = alignedPairWeightedFundingLane(result, [10], "4h", 2);
    expect(lane.points[0]).toMatchObject({ value: 2, temporaryZero: true, first: { annualizedRate: 0.02 }, second: null });
    expect(lane.temporaryZero).toEqual([2]);
    expect(lane.hasTemporaryZero).toBe(true);
    const lines = pairWeightedFundingTooltipLines(lane.points[0], "Binance BTCUSDT", "Bybit BTCUSDT", 2);
    expect(lines[0]).toContain("年化资金费率差（1:β，β=2.0000）：+2.00%");
    expect(lines).toContain("资金费率差：含临时0，仅图表显示");
  });

  test("aligns weighted values by time, not by array index", () => {
    const result = perpResult([
      perpBucket(30, { rate: 0.0003, annualizedRate: 0.03 }, { rate: 0.0001, annualizedRate: 0.01 }),
      perpBucket(10, { rate: 0.0001, annualizedRate: 0.01 }, { rate: 0.0001, annualizedRate: 0.01 }),
    ]);
    const lane = alignedPairWeightedFundingLane(result, [10, 30, 20], "1d", 2);
    expect(lane.points.map((point) => point.time)).toEqual([10, 30, 20]);
    // 1% - 2*1% and 3% - 2*1%, in requested order (not array order).
    expect(lane.points[0].value).toBeCloseTo(-1, 9);
    expect(lane.points[1].value).toBeCloseTo(1, 9);
    expect(lane.points[1].value).toBeGreaterThan(0);
    expect(lane.points[2].value).toBeNull();
  });

  test("weights the surviving leg2 when leg1 uses the chart-only temporary zero", () => {
    const result = perpResult([perpBucket(10, null, { rate: 0.0002, annualizedRate: 0.02 })]);
    const lane = alignedPairWeightedFundingLane(result, [10], "4h", 2);
    expect(lane.points[0]).toMatchObject({ value: -4, rate: -0.0004, temporaryZero: true, first: null });
    expect(lane.temporaryZero).toEqual([-4]);
    expect(alignedPairFundingLane(result, [10], "4h").points[0].value).toBe(-2);
  });

  test("does not mutate the source funding points", () => {
    const result = perpResult([
      perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
    ]);
    const before = structuredClone(result);
    alignedPairWeightedFundingLane(result, [10], "1d", 2.5);
    expect(result).toEqual(before);
  });
});

describe("pair weighted funding lane: mixed composition", () => {
  test("perp on leg 2 is beta-scaled once, without re-applying the venue sign", () => {
    // combine.ts already stored the leg-2 perp rate as negative.
    const lane = alignedPairWeightedFundingLane(
      mixedResult([{ time: 10, rate: -0.0002, annualizedRate: -0.02, sampleCount: 1, perpLeg: 2 }], 2),
      [10],
      "1d",
      2,
    );
    expect(lane.points[0].value).toBeCloseTo(-4, 9);        // 2 * (-2%)
    expect(lane.points[0].rate).toBeCloseTo(-0.0004, 12);
    // The labelled perp row keeps the venue's own (positive) sign.
    expect(lane.points[0].second).toMatchObject({ rate: 0.0002, annualizedRate: 0.02 });
    expect(lane.points[0].first).toBeNull();
    expect(lane.secondHasFunding).toBe(true);
  });

  test("perp on leg 1 keeps its signed rate; the spot leg contributes 0", () => {
    const lane = alignedPairWeightedFundingLane(
      mixedResult([{ time: 10, rate: 0.0003, annualizedRate: 0.03, sampleCount: 1, perpLeg: 1 }], 1),
      [10],
      "1d",
      4,
    );
    expect(lane.points[0].value).toBeCloseTo(3, 9);          // weight on leg1 is 1
    expect(lane.points[0].first).toMatchObject({ annualizedRate: 0.03 });
    expect(lane.points[0].second).toBeNull();
  });

  test("beta 1 matches the 1:1 mixed lane for both perp positions", () => {
    for (const perpLeg of [1, 2] as const) {
      const funding: SignedFundingObservation[] = [{
        time: 10,
        rate: perpLeg === 1 ? 0.0003 : -0.0003,
        annualizedRate: perpLeg === 1 ? 0.03 : -0.03,
        sampleCount: 1,
        perpLeg,
      }];
      const plain = alignedPairFundingLane(mixedResult(funding, perpLeg), [10], "1d");
      const weighted = alignedPairWeightedFundingLane(mixedResult(funding, perpLeg), [10], "1d", 1);
      expect(weighted.points[0].value).toBeCloseTo(plain.points[0].value!, 12);
      expect(weighted.points[0].rate).toBeCloseTo(plain.points[0].rate!, 12);
    }
  });

  test("a missing or no-sample mixed key stays a gap", () => {
    const lane = alignedPairWeightedFundingLane(
      mixedResult([
        { time: 10, rate: -0.0002, annualizedRate: -0.02, sampleCount: 0, perpLeg: 2 },
      ], 2),
      [10, 20],
      "1d",
      3,
    );
    expect(lane.points.map((point) => point.value)).toEqual([null, null]);
  });

  test("spot-spot has no weighted lane data at all", () => {
    const lane = alignedPairWeightedFundingLane(
      { ...mixedResult([]), composition: "spot-spot" } as unknown as SpotContainingCombinationResult,
      [10],
      "1d",
      2,
    );
    expect(lane.points[0].value).toBeNull();
    expect(lane.firstHasFunding).toBe(false);
    expect(lane.secondHasFunding).toBe(false);
  });
});

describe("pair weighted funding tooltip", () => {
  const result = perpResult([
    perpBucket(10, { rate: 0.00012, annualizedRate: 0.0132 }, { rate: 0.00004, annualizedRate: 0.0044 }),
  ]);

  test("names the applied beta so the two lanes never read as one", () => {
    const point = alignedPairWeightedFundingLane(result, [10], "1d", 2).points[0];
    const lines = pairWeightedFundingTooltipLines(point, "Binance BTCUSDT", "Bybit BTCUSDT", 2);
    const oneToOne = pairFundingTooltipLines(alignedPairFundingLane(result, [10], "1d").points[0], "Binance BTCUSDT", "Bybit BTCUSDT");
    expect(lines[0]).toBe("年化资金费率差（1:β，β=2.0000）：+0.44%（区间累计费率 +0.0040%）");
    expect(oneToOne[0]).toBe("年化资金费率差（1:1）：+0.88%（区间累计费率 +0.0080%）");
    expect(lines[1]).toContain("腿1 − 2.0000 × 腿2");
    expect(lines[1]).toContain("不乘结算价或入场价");
    expect(lines[1]).toContain("不是合并资金收益年化");
  });

  test("keeps the per-leg rows venue-signed and unweighted", () => {
    const point = alignedPairWeightedFundingLane(result, [10], "1d", 2).points[0];
    const lines = pairWeightedFundingTooltipLines(point, "Binance BTCUSDT", "Bybit BTCUSDT", 2);
    expect(lines.slice(-2)).toEqual([
      "Binance BTCUSDT: +1.32%（区间累计费率 +0.0120%）",
      "Bybit BTCUSDT: +0.44%（区间累计费率 +0.0040%）",
    ]);
  });

  test("reports 无 for a gap and never implies a weighted value exists", () => {
    expect(pairWeightedFundingTooltipLines(undefined, "A", "B", 2)).toEqual(["年化资金费率差（1:β，β=2.0000）：无"]);
    const gapPoint = alignedPairWeightedFundingLane(perpResult([]), [10], "1d", 2).points[0];
    expect(pairWeightedFundingTooltipLines(gapPoint, "A", "B", 2)).toEqual(["年化资金费率差（1:β，β=2.0000）：无"]);
  });

  test("mixed weighted tooltip omits the spot leg but keeps the perp row", () => {
    const point = alignedPairWeightedFundingLane(
      mixedResult([{ time: 10, rate: -0.0002, annualizedRate: -0.02, sampleCount: 1, perpLeg: 2 }], 2),
      [10],
      "1d",
      2,
    ).points[0];
    const lines = pairWeightedFundingTooltipLines(point, null, "Bybit BTC Perp", 2);
    expect(lines[0]).toContain("年化资金费率差（1:β，β=2.0000）：-4.00%");
    expect(lines.some((line) => line.startsWith("null"))).toBe(false);
    expect(lines[lines.length - 1]).toBe("Bybit BTC Perp: +2.00%（区间累计费率 +0.0200%）");
  });
});
