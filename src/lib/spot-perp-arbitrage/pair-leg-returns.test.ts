import { describe, expect, test } from "bun:test";
import type { ComboCandleResult, ComboFundingRatePoint } from "../combo";
import type { SpotContainingCombinationResult } from "./combine";
import type { PerpMarket, SpotMarket } from "./model";
import { alignedPairCloses } from "./pair-adapter";
import { calculatePairTradeSeries } from "./pair-trade";
import { calculatePairLegReturns } from "./pair-leg-returns";

const HOUR = 3_600_000;
const YEAR = 365 * 24 * HOUR;
const NEVER = Number.MAX_SAFE_INTEGER;

interface Settlement {
  time: number;
  rate: number;
  markPrice?: number;
}

interface Row {
  t: number;
  first: number;
  second: number;
}

function rows(from: number, to: number, price: (index: number) => [number, number]): Row[] {
  const list: Row[] = [];
  for (let index = from; index <= to; index += 1) {
    const [first, second] = price(index);
    list.push({ t: index * HOUR, first, second });
  }
  return list;
}

interface Bucket {
  t: number;
  r1: number;
  r2: number;
  first?: Settlement[];
  second?: Settlement[];
}

function perpCombo(list: readonly Row[], funding: readonly Bucket[] = []): ComboCandleResult {
  return {
    candles: list.map((row) => ({
      openTime: row.t, closeTime: row.t + HOUR, open: "0", high: "0", low: "0", close: "0", volume: "1",
    })),
    fundingRates: funding.map((bucket): ComboFundingRatePoint => ({
      time: bucket.t,
      rate: bucket.r1 - bucket.r2,
      annualizedRate: 0,
      sampleCount: 1,
      firstFunding: { rate: bucket.r1, annualizedRate: 0, ...(bucket.first ? { settlements: bucket.first } : {}) },
      secondFunding: { rate: bucket.r2, annualizedRate: 0, ...(bucket.second ? { settlements: bucket.second } : {}) },
    }) as ComboFundingRatePoint),
    interval: "1h",
    exchange: "Binance",
    symbol: "AAA-BBB",
    mode: "spread",
    firstSymbol: "AAA",
    firstExchange: "Binance",
    secondSymbol: "BBB",
    secondExchange: "Bybit",
    legProvenance: [] as never,
    leg1Points: list.map((row) => ({
      openTime: row.t, closeTime: row.t + HOUR, open: row.first, high: row.first, low: row.first, close: row.first,
    })),
    leg2Points: list.map((row) => ({
      openTime: row.t, closeTime: row.t + HOUR, open: row.second, high: row.second, low: row.second, close: row.second,
    })),
  } as ComboCandleResult;
}

const perpMarket = { kind: "perp" } as unknown as PerpMarket;
const spotMarket = { kind: "spot" } as unknown as SpotMarket;

function mixedCombo(options: {
  list: readonly Row[];
  perpLeg: 1 | 2;
  /** Venue rates in the "long pays a positive rate" convention. */
  funding: ReadonlyArray<{ t: number; rate: number; settlements?: Settlement[]; sampleCount?: number }>;
}): SpotContainingCombinationResult {
  const sign = options.perpLeg === 1 ? 1 : -1;
  return {
    kind: "spot-containing",
    composition: "mixed",
    mode: "spread",
    interval: "1h",
    leg1: options.perpLeg === 1 ? perpMarket : spotMarket,
    leg2: options.perpLeg === 1 ? spotMarket : perpMarket,
    points: options.list.map((row) => ({
      openTime: row.t,
      closeTime: row.t + HOUR,
      open: row.first - row.second,
      close: row.first - row.second,
      leg1Turnover: null,
      leg2Turnover: null,
      minimumTurnover: null,
      leg1Point: {
        openTime: row.t, closeTime: row.t + HOUR, open: row.first, high: row.first, low: row.first,
        close: row.first, baseVolume: 1, turnover: null,
      },
      leg2Point: {
        openTime: row.t, closeTime: row.t + HOUR, open: row.second, high: row.second, low: row.second,
        close: row.second, baseVolume: 1, turnover: null,
      },
    })),
    funding: options.funding.map((point) => ({
      // The legacy bucket rate keeps the old mixed sign; settlement rates never do.
      time: point.t,
      rate: point.rate * sign,
      annualizedRate: 0,
      sampleCount: point.sampleCount ?? 1,
      perpLeg: options.perpLeg,
      ...(point.settlements ? { settlements: point.settlements } : {}),
    })),
    legProvenance: [] as never,
  } as unknown as SpotContainingCombinationResult;
}

function tradeFor(
  result: ComboCandleResult | SpotContainingCombinationResult,
  beta = 1,
  entryTime?: number,
) {
  const trade = calculatePairTradeSeries(alignedPairCloses(result), beta, 10_000, entryTime);
  if (!trade.available || !trade.value) throw new Error(`fixture trade unavailable: ${trade.reason}`);
  return trade.value as NonNullable<typeof trade.value>;
}

describe("per-settlement funding formula", () => {
  test("two settlements inside one bucket are priced individually, not with the bucket close", () => {
    const list = rows(0, 40, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0002,
      r2: 0,
      first: [
        { time: 8 * HOUR, rate: 0.0001, markPrice: 100 },
        { time: 12 * HOUR, rate: 0.0001, markPrice: 120 },
      ],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 40 * HOUR, HOUR, NEVER);
    // (0.0001 × 100/100) + (0.0001 × 120/100) = 0.00022 → -0.022% for the long leg.
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.022);
    // A bucket-level Σrate × bucket close would have produced -0.02.
    expect(cards.first.fundingReturnPercent).not.toBeCloseTo(-0.02, 5);
    expect(cards.first.fundingSampleBuckets).toBe(2);
    expect(cards.first.fundingSampleCount).toBe(2);
    expect(cards.first.fundingPriceBasis).toBe("settlement-mark");
    expect(cards.first.priceMissing).toBeFalse();
  });

  test("positive rates cost the long leg and pay the short leg, with their own entry notionals", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0.0002,
      first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }],
      second: [{ time: 8 * HOUR, rate: 0.0002, markPrice: 50 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 2, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.second.fundingReturnPercent).toBeCloseTo(0.02);
    // β = 2 must not scale either leg's own percentage.
    const oneToOne = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(oneToOne.first.fundingReturnPercent!);
    expect(cards.second.fundingReturnPercent).toBeCloseTo(oneToOne.second.fundingReturnPercent!);
  });

  test("negative rates pay the long leg and cost the short leg", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: -0.0003,
      r2: -0.0001,
      first: [{ time: 8 * HOUR, rate: -0.0003, markPrice: 100 }],
      second: [{ time: 8 * HOUR, rate: -0.0001, markPrice: 50 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(0.03);
    expect(cards.second.fundingReturnPercent).toBeCloseTo(-0.01);
  });

  test("settlement-free buckets never fabricate samples, and real settlements in such a bucket still count", () => {
    const list = rows(0, 24, () => [100, 50]);
    const result = perpCombo(list, []);
    // Hourly grid with 8h funding: unsettled hours are explicit sampleCount 0.
    result.fundingRates = Array.from({ length: 25 }, (_, index) => {
      const settled = index === 8;
      return {
        time: index * HOUR,
        rate: 0,
        annualizedRate: 0,
        sampleCount: settled ? 1 : 0,
        firstFunding: settled
          ? { rate: 0.0001, annualizedRate: 0, settlements: [{ time: index * HOUR + 1_000, rate: 0.0001, markPrice: 100 }] }
          : null,
        secondFunding: settled ? { rate: 0, annualizedRate: 0 } : null,
      } satisfies ComboFundingRatePoint;
    });
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 24 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingSampleBuckets).toBe(1);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.first.fundingPriceBasis).toBe("settlement-mark");
    // Leg2 only had a bucket-level row (no per-settlement data) with a zero rate:
    // it is still priced from its bucket candle, and contributes exactly 0.
    expect(cards.second.fundingSampleBuckets).toBe(1);
    expect(cards.second.fundingPriceBasis).toBe("bucket-candle");
    expect(cards.second.fundingReturnPercent).toBe(0);
  });

  test("a genuine zero rate is a real observation, not missing data", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 0, markPrice: 100 }],
      second: [{ time: 8 * HOUR, rate: 0, markPrice: 50 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBe(0);
    expect(cards.first.fundingAnnualizedPercent).toBe(0);
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.fundingPriceBasis).toBe("settlement-mark");
  });

  test("a bucket with an explicitly empty settlement list contributes nothing, not its bucket rate", () => {
    const list = rows(0, 24, () => [100, 50]);
    const result = perpCombo(list, [
      { t: 8 * HOUR, r1: 0.0001, r2: 0, first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }] },
      // Same leg, later bucket: real sample exists upstream (rate > 0) but the
      // per-settlement list is empty, so there is no settlement to price.
      { t: 16 * HOUR, r1: 0.0005, r2: 0, first: [] },
    ]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 24 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingSampleBuckets).toBe(1);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.first.fundingIncomplete).toBeFalse();
  });

  test("a bucket without a per-settlement payload keeps its bucket rate, labelled bucket-candle", () => {
    const list = rows(0, 30, (index) => [100 + index, 50]);
    const result = perpCombo(list, [
      { t: 8 * HOUR, r1: 0.0001, r2: 0, first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }] },
      { t: 16 * HOUR, r1: 0.0002, r2: 0 },
    ]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 30 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingSampleBuckets).toBe(2);
    // -0.01% from the mark-priced settlement, plus -0.0002 × 116/100 × 100 = -0.0232%
    // from the bucket-level row priced at its own bucket candle close (116).
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.0332, 6);
    expect(cards.first.fundingPriceBasis).toBe("mixed");
  });

  test("funding is scaled by the settlement price against the entry price", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.001,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 0.001, markPrice: 150 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    // -0.001 × 150/100 × 100 = -0.15%.
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.15);
  });
});

describe("settlement price sources", () => {
  test("a settlement without a mark uses that leg's candle close for the containing interval", () => {
    const list = rows(0, 20, (index) => [100 + index * 5, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      // No mark price: the 9h candle (open 8h, close 9h) carries close 145.
      first: [{ time: 8 * HOUR + 30 * 60_000, rate: 0.0001 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    // Entry 100, proxy 145 → -0.0001 × 1.45 × 100 = -0.0145%.
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.0145);
    expect(cards.first.fundingPriceBasis).toBe("candle-proxy");
    expect(cards.first.priceMissing).toBeFalse();
    expect(cards.first.fundingIncomplete).toBeFalse();
  });

  test("a candle proxy accepts either closeTime convention (end-1 and exclusive end)", () => {
    const endMinusOne = rows(0, 10, () => [100, 50]);
    const result = perpCombo(endMinusOne, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 8 * HOUR + 1_000, rate: 0.0001 }],
    }]);
    // Binance-style inclusive close (open + interval − 1).
    result.leg1Points = (result.leg1Points ?? []).map((point) => ({ ...point, closeTime: point.closeTime - 1 }));
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 10 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingPriceBasis).toBe("candle-proxy");
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);

    // Exclusive close (open + interval) normalizes to the same interval.
    const exclusive = perpCombo(endMinusOne, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 8 * HOUR + 1_000, rate: 0.0001 }],
    }]);
    exclusive.leg1Points = (exclusive.leg1Points ?? []).map((point) => ({ ...point, closeTime: point.closeTime + 1 }));
    const exclusiveCards = calculatePairLegReturns(exclusive, tradeFor(exclusive, 1, 0), 10 * HOUR, HOUR, NEVER);
    expect(exclusiveCards.first.fundingPriceBasis).toBe("candle-proxy");
    expect(exclusiveCards.first.fundingReturnPercent).toBeCloseTo(-0.01);
  });

  test("a settlement exactly at the interval end belongs to the next candle, not the previous one", () => {
    const list = rows(0, 20, (index) => [100 + index * 5, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      // Exactly at 9h: the 8h candle's exclusive end, so the 9h candle prices it.
      first: [{ time: 9 * HOUR, rate: 0.0001 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    // 9h candle close is 145, not the 8h candle's 140.
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.0145);
    expect(cards.first.fundingPriceBasis).toBe("candle-proxy");
  });

  test("a middle candle hole never lends the previous candle's close to the gap", () => {
    const list = rows(0, 20, (index) => [100 + index * 5, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      // 10:30 falls in the 10h candle, which is missing from this leg entirely.
      first: [{ time: 10 * HOUR + 30 * 60_000, rate: 0.0001 }],
    }]);
    const trade = tradeFor(result, 1, 0);
    result.leg1Points = (result.leg1Points ?? []).filter((point) => point.openTime !== 10 * HOUR);
    const cards = calculatePairLegReturns(result, trade, 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.priceMissing).toBeTrue();
    expect(cards.first.fundingNote).toBe("settlement-price-missing");
    expect(cards.first.fundingSampleBuckets).toBe(1);
  });

  test("a candle whose own close is unusable is not replaced by a neighbouring close", () => {
    const list = rows(0, 20, (index) => [100 + index * 5, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 10 * HOUR + 30 * 60_000, rate: 0.0001 }],
    }]);
    const trade = tradeFor(result, 1, 0);
    result.leg1Points = (result.leg1Points ?? []).map((point) => (
      point.openTime === 10 * HOUR ? { ...point, close: Number.NaN } : point
    ));
    const cards = calculatePairLegReturns(result, trade, 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.priceMissing).toBeTrue();
    expect(cards.first.fundingNote).toBe("settlement-price-missing");
  });

  test("an overflowed annualization is withheld instead of reaching the UI as Infinity", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 1e300,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 1e300, markPrice: 100 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).not.toBeNull();
    expect(Number.isFinite(cards.first.fundingReturnPercent!)).toBeTrue();
    expect(cards.first.fundingAnnualizedPercent).toBeNull();
  });

  test("a settlement with no usable price is reported, never dropped, substituted with 1 or the entry price", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0002,
      r2: 0,
      first: [
        { time: 8 * HOUR, rate: 0.0001 },
        { time: 12 * HOUR, rate: 0.0001 },
      ],
    }]);
    const trade = tradeFor(result, 1, 0);
    // Remove this leg's usable closes after the entry: the entry price is known
    // from the trade, but no candle can proxy a post-entry settlement price.
    result.leg1Points = (result.leg1Points ?? []).map((point) => (
      point.openTime >= 8 * HOUR ? { ...point, close: Number.NaN } : point
    ));
    const cards = calculatePairLegReturns(result, trade, 20 * HOUR, HOUR, NEVER);
    expect(cards.first.priceReturnPercent).toBeNull();
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.fundingAnnualizedPercent).toBeNull();
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.priceMissing).toBeTrue();
    expect(cards.first.fundingNote).toBe("settlement-price-missing");
    // Both settlements were counted; neither was silently skipped.
    expect(cards.first.fundingSampleBuckets).toBe(2);
  });

  test("a legacy result without settlements uses the bucket-candle basis, never a price-free rate sum", () => {
    const list = rows(0, 20, (index) => [100 + index * 5, 50]);
    const result = perpCombo(list, [{ t: 8 * HOUR, r1: 0.0001, r2: 0 }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    // Bucket at 8h → candle close 140, entry 100 → -0.0001 × 1.4 × 100.
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.014);
    expect(cards.first.fundingPriceBasis).toBe("bucket-candle");
    expect(cards.first.fundingIncomplete).toBeFalse();
  });

  test("part mark and part proxy is reported as a mixed basis", () => {
    const list = rows(0, 30, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0002,
      r2: 0,
      first: [
        { time: 8 * HOUR, rate: 0.0001, markPrice: 100 },
        { time: 20 * HOUR, rate: 0.0001 },
      ],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 30 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingPriceBasis).toBe("mixed");
    expect(cards.first.priceMissing).toBeFalse();
  });
});

describe("mixed legs and spot", () => {
  test("perp on leg1 pays with venue-signed settlements", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = mixedCombo({
      list,
      perpLeg: 1,
      funding: [{ t: 8 * HOUR, rate: 0.0001, settlements: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }] }],
    });
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.isSpot).toBeFalse();
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.first.fundingPriceBasis).toBe("settlement-mark");
    expect(cards.second.isSpot).toBeTrue();
    expect(cards.second.fundingReturnPercent).toBe(0);
    expect(cards.second.fundingPriceBasis).toBeNull();
    expect(cards.second.fundingIncomplete).toBeFalse();
    expect(cards.second.fundingNote).toBe("spot");
  });

  test("perp on leg2 is not double-signed even though the bucket rate is stored negated", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = mixedCombo({
      list,
      perpLeg: 2,
      funding: [{ t: 8 * HOUR, rate: 0.0001, settlements: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 50 }] }],
    });
    // combine.ts stores −rate on the bucket, but settlement rates stay unsigned.
    expect(result.funding[0].rate).toBeCloseTo(-0.0001);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.isSpot).toBeTrue();
    expect(cards.first.fundingReturnPercent).toBe(0);
    expect(cards.second.fundingReturnPercent).toBeCloseTo(0.01);
    expect(cards.second.fundingPriceBasis).toBe("settlement-mark");
  });

  test("mixed legacy buckets still invert the pre-signed rate exactly once", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = mixedCombo({
      list,
      perpLeg: 2,
      funding: [{ t: 8 * HOUR, rate: 0.0001 }],
    });
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.second.fundingReturnPercent).toBeCloseTo(0.01);
    expect(cards.second.fundingPriceBasis).toBe("bucket-candle");
  });

  test("spot-spot has no funding, no basis and no warning", () => {
    const list = rows(0, 10, (index) => [100 + index, 50]);
    const result = mixedCombo({ list, perpLeg: 1, funding: [] });
    result.composition = "spot-spot";
    result.leg1 = spotMarket;
    result.funding = [];
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 10 * HOUR, HOUR, NEVER);
    expect(cards.first.isSpot).toBeTrue();
    expect(cards.second.isSpot).toBeTrue();
    expect(cards.first.fundingReturnPercent).toBe(0);
    expect(cards.first.fundingAnnualizedPercent).toBe(0);
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.totalReturnPercent).toBeCloseTo(cards.first.priceReturnPercent!);
  });
});

describe("completeness, annualization and window", () => {
  test("readable history with no settlement in the window is zero funding, not a warning", () => {
    const list = rows(0, 20, (index) => [100 + index, 50]);
    const result = perpCombo(list, [{
      t: 0,
      r1: 0.0005,
      r2: 0.0005,
      first: [{ time: 0, rate: 0.0005, markPrice: 100 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBe(0);
    expect(cards.first.fundingAnnualizedPercent).toBe(0);
    expect(cards.first.totalReturnPercent).toBeCloseTo(cards.first.priceReturnPercent!);
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.fundingPriceBasis).toBeNull();
    expect(cards.first.fundingNote).toBe("no-post-entry-settlements");
  });

  test("a visible gap in the history still counts as complete", () => {
    const list = rows(0, 40, () => [100, 50]);
    const result = perpCombo(list, [
      { t: 8 * HOUR, r1: 0.0001, r2: 0, first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }] },
      { t: 32 * HOUR, r1: 0.0001, r2: 0, first: [{ time: 32 * HOUR, rate: 0.0001, markPrice: 100 }] },
    ]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 40 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingSampleBuckets).toBe(2);
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.fundingNote).toBeNull();
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.02);
  });

  test("annualization divides by the real holding window, so one settlement still annualizes", () => {
    const list = rows(0, 25, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 25 * HOUR, HOUR, NEVER);
    // Window is [1h, 26h) → 25 hours, independent of how many settlements exist.
    expect(cards.fundingWindowStartTime).toBe(HOUR);
    expect(cards.fundingWindowEndTime).toBe(26 * HOUR);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.first.fundingAnnualizedPercent).toBeCloseTo(-0.01 * YEAR / (25 * HOUR));
  });

  test("null viewport and the entry boundary behave as before", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [
      { t: 0, r1: 0.5, r2: 0, first: [{ time: 0, rate: 0.5, markPrice: 100 }] },
      { t: HOUR, r1: 0.0001, r2: 0, first: [{ time: HOUR, rate: 0.0001, markPrice: 100 }] },
      { t: 9 * HOUR, r1: 0.0001, r2: 0, first: [{ time: 9 * HOUR, rate: 0.0001, markPrice: 100 }] },
    ]);
    const trade = tradeFor(result, 1, 0);

    const cards = calculatePairLegReturns(result, trade, 20 * HOUR, HOUR, NEVER);
    // The entry-candle settlement (time 0) is excluded, the one at 1h is kept.
    expect(cards.first.fundingSampleBuckets).toBe(2);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.02);

    const noViewport = calculatePairLegReturns(result, trade, null, HOUR, NEVER);
    expect(noViewport.latestTime).toBeNull();
    expect(noViewport.first.priceReturnPercent).toBeNull();
    expect(noViewport.first.fundingReturnPercent).toBeNull();
    expect(noViewport.fundingWindowStartTime).toBeNull();
    expect(noViewport.fundingWindowEndTime).toBeNull();
    expect(noViewport.first.fundingIncomplete).toBeFalse();
    expect(noViewport.first.fundingNote).toBe("no-post-entry-window");

    const entryCandleOnly = calculatePairLegReturns(result, trade, 0, HOUR, NEVER);
    expect(entryCandleOnly.latestTime).toBeNull();
    expect(entryCandleOnly.first.priceReturnPercent).toBeNull();
  });

  test("a missing entry close keeps prices but reports an unknown holding window", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, null, NEVER);
    expect(cards.first.priceReturnPercent).toBe(0);
    expect(cards.fundingWindowStartTime).toBeNull();
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.fundingNote).toBe("missing-entry-time");
  });

  test("funding beyond the clock is clamped out of the window", () => {
    const list = rows(0, 8, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0001,
      r2: 0,
      first: [{ time: 8 * HOUR, rate: 0.0001, markPrice: 100 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 8 * HOUR, HOUR, 6 * HOUR);
    expect(cards.fundingWindowEndTime).toBe(6 * HOUR);
    // History is readable, so nothing settled inside the clamped window is 0, not missing.
    expect(cards.first.fundingReturnPercent).toBe(0);
    expect(cards.first.fundingIncomplete).toBeFalse();
    expect(cards.first.fundingNote).toBe("no-post-entry-settlements");
  });
});

describe("funding history warning", () => {
  test("no readable history is the only funding warning", () => {
    const list = rows(0, 20, () => [100, 50]);
    const cards = calculatePairLegReturns(perpCombo(list), tradeFor(perpCombo(list), 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.fundingIncomplete).toBeTrue();
    expect(cards.first.fundingNote).toBe("no-funding-data");
    expect(cards.first.fundingPriceBasis).toBeNull();
    expect(cards.first.priceReturnPercent).toBe(0);
  });

  test("an overflowing accumulation stays unavailable instead of printing inf", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 1e308,
      r2: 0,
      // rate and price are each finite, their product is not.
      first: [{ time: 8 * HOUR, rate: 1e308, markPrice: 1e10 }],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeNull();
    expect(cards.first.fundingAnnualizedPercent).toBeNull();
    expect(cards.first.fundingNote).toBe("non-finite-funding");
  });

  test("a non-finite rate is skipped rather than poisoning the sum", () => {
    const list = rows(0, 20, () => [100, 50]);
    const result = perpCombo(list, [{
      t: 8 * HOUR,
      r1: 0.0002,
      r2: 0,
      first: [
        { time: 8 * HOUR, rate: Number.NaN, markPrice: 100 },
        { time: 12 * HOUR, rate: 0.0001, markPrice: 100 },
      ],
    }]);
    const cards = calculatePairLegReturns(result, tradeFor(result, 1, 0), 20 * HOUR, HOUR, NEVER);
    expect(cards.first.fundingReturnPercent).toBeCloseTo(-0.01);
    expect(cards.first.fundingSampleBuckets).toBe(1);
  });
});
