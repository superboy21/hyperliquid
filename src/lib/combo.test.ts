import { describe, test, expect } from "bun:test";
import { alignComboData } from "./combo";
import type { SearchCandleResult } from "./search-candles";
import { createCandleSourceProvenance } from "./candle-provenance";

function makeCandleResult(overrides: Partial<SearchCandleResult> = {}): SearchCandleResult {
  return {
    candles: [],
    fundingRates: [],
    interval: "1h",
    exchange: "Binance",
    symbol: "BTC",
    provenance: createCandleSourceProvenance("Binance", "1h", "1h", false),
    ...overrides,
  };
}

describe("alignComboData", () => {
  test("spread calculation correctness", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "100", high: "110", low: "90", close: "105", volume: "10", quoteVolume: "1000" },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "50", high: "55", low: "45", close: "52", volume: "20", quoteVolume: "500" },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].open).toBe("50"); // 100 - 50
    expect(result.candles[0].close).toBe("53"); // 105 - 52
    expect(result.candles[0].high).toBe("");
    expect(result.candles[0].low).toBe("");
    expect(result.candles[0].volume).toBe("10");
    expect(result.legProvenance).toHaveLength(2);
    expect(result.legProvenance[0].sourceKind).toBe("official native interval");
  });

  test("ratio calculation correctness", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "100", high: "110", low: "90", close: "105", volume: "10", quoteVolume: "1000" },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "50", high: "55", low: "45", close: "25", volume: "20", quoteVolume: "500" },
      ],
    });

    const result = alignComboData(first, second, "ratio");

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].open).toBe("2"); // 100 / 50
    expect(result.candles[0].close).toBe("4.2"); // 105 / 25
    expect(result.candles[0].high).toBe("");
    expect(result.candles[0].low).toBe("");
    expect(result.candles[0].volume).toBe("10");
  });

  test("min turnover (quoteVolume)", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "10", high: "12", low: "8", close: "11", volume: "5", quoteVolume: "100" },
      ],
    });
    const second = makeCandleResult({
      exchange: "Gate.io",
      symbol: "SOL",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "5", high: "6", low: "4", close: "5.5", volume: "8", quoteVolume: "80" },
      ],
    });

    const spreadResult = alignComboData(first, second, "spread");
    expect(spreadResult.candles[0].quoteVolume).toBe("80"); // min(100, 80)
    expect(spreadResult.firstQuoteTurnover).toEqual([{ time: 1000, value: 100 }]);
    expect(spreadResult.secondQuoteTurnover).toEqual([{ time: 1000, value: 80 }]);

    const ratioResult = alignComboData(first, second, "ratio");
    expect(ratioResult.candles[0].quoteVolume).toBe("80"); // min(100, 80)
    expect(ratioResult.firstQuoteTurnover).toEqual([{ time: 1000, value: 100 }]);
    expect(ratioResult.secondQuoteTurnover).toEqual([{ time: 1000, value: 80 }]);
  });

  test("timestamp intersection", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "10", high: "12", low: "8", close: "11", volume: "5", quoteVolume: "100" },
        { openTime: 2000, closeTime: 3000, open: "11", high: "13", low: "9", close: "12", volume: "6", quoteVolume: "110" },
        { openTime: 4000, closeTime: 5000, open: "12", high: "14", low: "10", close: "13", volume: "7", quoteVolume: "120" },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "5", high: "6", low: "4", close: "5.5", volume: "8", quoteVolume: "80" },
        { openTime: 3000, closeTime: 4000, open: "6", high: "7", low: "5", close: "6.5", volume: "9", quoteVolume: "90" },
        { openTime: 4000, closeTime: 5000, open: "7", high: "8", low: "6", close: "7.5", volume: "10", quoteVolume: "100" },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.candles).toHaveLength(2);
    expect(result.candles[0].openTime).toBe(1000);
    expect(result.candles[1].openTime).toBe(4000);
  });

  test("empty intersection", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "10", high: "12", low: "8", close: "11", volume: "5", quoteVolume: "100" },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 3000, closeTime: 4000, open: "5", high: "6", low: "4", close: "5.5", volume: "8", quoteVolume: "80" },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.candles).toHaveLength(0);
    expect(result.fundingRates).toHaveLength(0);
  });

  test("division by zero in ratio", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "100", high: "110", low: "90", close: "105", volume: "10", quoteVolume: "1000" },
        { openTime: 2000, closeTime: 3000, open: "100", high: "110", low: "90", close: "105", volume: "10", quoteVolume: "1000" },
        { openTime: 3000, closeTime: 4000, open: "100", high: "110", low: "90", close: "105", volume: "10", quoteVolume: "1000" },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "0", high: "5", low: "0", close: "5", volume: "20", quoteVolume: "500" },
        { openTime: 2000, closeTime: 3000, open: "5", high: "6", low: "4", close: "0", volume: "20", quoteVolume: "500" },
        { openTime: 3000, closeTime: 4000, open: "5", high: "6", low: "4", close: "5", volume: "20", quoteVolume: "500" },
      ],
    });

    const result = alignComboData(first, second, "ratio");

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].openTime).toBe(3000);
    expect(result.candles[0].open).toBe("20"); // 100 / 5
    expect(result.candles[0].close).toBe("21"); // 105 / 5
  });

  test("funding rate subtraction", () => {
    const first = makeCandleResult({
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6 },
        { time: 2000, rate: 0.02, annualizedRate: 175.2 },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8 },
        { time: 2000, rate: 0.015, annualizedRate: 131.4 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates).toHaveLength(2);
    expect(result.fundingRates[0].time).toBe(1000);
    expect(result.fundingRates[0].rate).toBe(0.005); // 0.01 - 0.005
    expect(result.fundingRates[0].annualizedRate).toBe(43.8); // 87.6 - 43.8
    expect(result.fundingRates[1].time).toBe(2000);
    expect(result.fundingRates[1].rate).toBeCloseTo(0.005, 10); // 0.02 - 0.015
    expect(result.fundingRates[1].annualizedRate).toBeCloseTo(43.8, 10); // 175.2 - 131.4
  });

  test("missing funding rate at timestamp", () => {
    const first = makeCandleResult({
      candles: [
        { openTime: 1000, closeTime: 2000, open: "10", high: "12", low: "8", close: "11", volume: "5", quoteVolume: "100" },
        { openTime: 2000, closeTime: 3000, open: "11", high: "13", low: "9", close: "12", volume: "6", quoteVolume: "110" },
      ],
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6 },
        { time: 2000, rate: 0.02, annualizedRate: 175.2 },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      candles: [
        { openTime: 1000, closeTime: 2000, open: "5", high: "6", low: "4", close: "5.5", volume: "8", quoteVolume: "80" },
        { openTime: 2000, closeTime: 3000, open: "6", high: "7", low: "5", close: "6.5", volume: "9", quoteVolume: "90" },
      ],
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8 },
        // missing funding rate at time 2000
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.candles).toHaveLength(2);
    expect(result.fundingRates).toHaveLength(1);
    expect(result.fundingRates[0].time).toBe(1000);
    expect(result.fundingRates[0].rate).toBe(0.005);
  });

  test("UTC-Monday weekly candles overlap exactly across canonical series", () => {
    const monday = Date.UTC(2026, 6, 13);
    const week = 7 * 86_400_000;
    const result = alignComboData(
      makeCandleResult({ interval: "1w", candles: [{ openTime: monday, closeTime: monday + week - 1, open: "10", high: "12", low: "9", close: "11", volume: "1", quoteVolume: "10" }] }),
      makeCandleResult({ interval: "1w", exchange: "Hyperliquid", candles: [{ openTime: monday, closeTime: monday + week - 1, open: "5", high: "6", low: "4", close: "5.5", volume: "2", quoteVolume: "11" }] }),
      "spread",
    );
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].openTime).toBe(monday);
  });

  test("dashboard funding uses leg1 minus leg2 only when both buckets are actual", () => {
    const first = makeCandleResult({
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
        { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 1 },
        { time: 3000, rate: 0.03, annualizedRate: 0.3, sampleCount: 0 },
        { time: 4000, rate: 0.04, annualizedRate: 0.4 },
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.004, annualizedRate: 0.04, sampleCount: 2 },
        { time: 2000, rate: 0.002, annualizedRate: 0.02, sampleCount: 1 },
        { time: 3000, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
        { time: 4000, rate: 0.01, annualizedRate: 0.1 },
      ],
    });

const forward = alignComboData(first, second, "ratio");
    const reverse = alignComboData(second, first, "spread");

    // At 1h the chart-only zero renders 0 - leg2 at time 3000 (leg1 bucket
    // missing, leg2 actual)...
    expect(forward.fundingRates[2]).toEqual({
      time: 3000,
      rate: -0.01,
      annualizedRate: -0.1,
      firstFunding: null,
      secondFunding: { rate: 0.01, annualizedRate: 0.1 },
    });
    // ...and leg1 - 0 in the reverse direction.
    expect(reverse.fundingRates[2]).toEqual({
      time: 3000,
      rate: 0.01,
      annualizedRate: 0.1,
      firstFunding: { rate: 0.01, annualizedRate: 0.1 },
      secondFunding: null,
    });
    // ...but the dashboard still excludes the one-sided temporary-zero point.
    expect(forward.dashboardFundingRates?.map((point) => [point.time, point.annualizedRate])).toEqual([
      [1000, 0.060000000000000005],
      [2000, -0.02],
      [4000, 0.30000000000000004],
    ]);
    expect(reverse.dashboardFundingRates?.map((point) => point.annualizedRate)).toEqual([
      -0.060000000000000005,
      0.02,
      -0.30000000000000004,
    ]);
    expect(forward.fundingRates).toHaveLength(4);
  });

  test("derived funding is marked unavailable when either leg has sampleCount 0 (strict 1d interval)", () => {
    const first = makeCandleResult({
      interval: "1d",
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
        { time: 2000, rate: 0.02, annualizedRate: 175.2, sampleCount: 1 },
      ],
    });
    const second = makeCandleResult({
      interval: "1d",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
        // Missing bucket (sampleCount 0), NOT an observed zero.
        { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 0 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates).toHaveLength(2);
    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0.005,
      annualizedRate: 43.8,
      firstFunding: { rate: 0.01, annualizedRate: 87.6 },
      secondFunding: { rate: 0.005, annualizedRate: 43.8 },
    });
    // Never computed as 0.02 - 0: the difference is unavailable, not a real spread.
    // Metadata still reflects actuality: leg1 observed, leg2 missing -> null.
    expect(result.fundingRates[1]).toEqual({
      time: 2000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.02, annualizedRate: 175.2 },
      secondFunding: null,
    });
    // Dashboard keeps only the actually-sampled point, as plain FundingRatePoint.
    expect(result.dashboardFundingRates).toEqual([{ time: 1000, rate: 0.005, annualizedRate: 43.8 }]);
    expect(result.dashboardFundingRates?.[0]).not.toHaveProperty("firstFunding");
  });

  test("either leg's missing sample marks the derived funding unavailable (strict 1d interval)", () => {
    const first = makeCandleResult({
      interval: "1d",
      fundingRates: [
        { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }, // leg 1 missing
        { time: 2000, rate: 0.03, annualizedRate: 0.3, sampleCount: 1 },
      ],
    });
    const second = makeCandleResult({
      interval: "1d",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.004, annualizedRate: 0.04, sampleCount: 1 },
        { time: 2000, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: null,
      secondFunding: { rate: 0.004, annualizedRate: 0.04 },
    });
    expect(result.fundingRates[1].time).toBe(2000);
    expect(result.fundingRates[1].rate).toBeCloseTo(0.02, 12);
    expect(result.fundingRates[1].annualizedRate).toBeCloseTo(0.2, 12);
    expect(result.dashboardFundingRates?.map((point) => point.time)).toEqual([2000]);
  });

  test("an observed zero with a real sample still computes the spread", () => {
    const first = makeCandleResult({
      fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 1 }],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [{ time: 1000, rate: 0.002, annualizedRate: 0.02, sampleCount: 1 }],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: -0.002,
      annualizedRate: -0.02,
      // Observed real zero is a real observation, not null metadata.
      firstFunding: { rate: 0, annualizedRate: 0 },
      secondFunding: { rate: 0.002, annualizedRate: 0.02 },
    });
    expect(result.dashboardFundingRates).toHaveLength(1);
  });

  test("4h/1h/5m: leg1 actual with leg2 sampleCount 0 renders leg1 - 0", () => {
    for (const interval of ["4h", "1h", "5m"] as const) {
      const first = makeCandleResult({
        interval,
        fundingRates: [
          { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
          { time: 2000, rate: 0.02, annualizedRate: 175.2, sampleCount: 1 },
        ],
      });
      const second = makeCandleResult({
        interval,
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [
          { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
          // Explicit missing bucket (sampleCount 0), NOT an observed zero.
          { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        ],
      });

      const result = alignComboData(first, second, "spread");

      expect(result.fundingRates).toHaveLength(2);
      expect(result.fundingRates[0]).toEqual({
        time: 1000,
        rate: 0.005,
        annualizedRate: 43.8,
        firstFunding: { rate: 0.01, annualizedRate: 87.6 },
        secondFunding: { rate: 0.005, annualizedRate: 43.8 },
      });
      // leg1 - 0: renderable actual point, NOT sampleCount 0. The temporary
      // zero is not a real leg observation: secondFunding is null.
      expect(result.fundingRates[1]).toEqual({
        time: 2000,
        rate: 0.02,
        annualizedRate: 175.2,
        firstFunding: { rate: 0.02, annualizedRate: 175.2 },
        secondFunding: null,
      });
      // Dashboard stays both-actual-only: the chart-only zero never enters it.
      expect(result.dashboardFundingRates).toEqual([{ time: 1000, rate: 0.005, annualizedRate: 43.8 }]);
    }
  });

  test("4h/1h/5m: leg1 sampleCount 0 with leg2 actual renders 0 - leg2", () => {
    for (const interval of ["4h", "1h", "5m"] as const) {
      const first = makeCandleResult({
        interval,
        fundingRates: [
          { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }, // leg 1 missing
          { time: 2000, rate: 0.03, annualizedRate: 0.3, sampleCount: 1 },
        ],
      });
      const second = makeCandleResult({
        interval,
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [
          { time: 1000, rate: 0.004, annualizedRate: 0.04, sampleCount: 1 },
          { time: 2000, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
        ],
      });

      const result = alignComboData(first, second, "spread");

      expect(result.fundingRates).toHaveLength(2);
      // 0 - leg2: renderable actual point, NOT sampleCount 0. The temporary
      // zero is not a real leg observation: firstFunding is null.
      expect(result.fundingRates[0]).toEqual({
        time: 1000,
        rate: -0.004,
        annualizedRate: -0.04,
        firstFunding: null,
        secondFunding: { rate: 0.004, annualizedRate: 0.04 },
      });
      expect(result.fundingRates[1].rate).toBeCloseTo(0.02, 12);
      expect(result.fundingRates[1].annualizedRate).toBeCloseTo(0.2, 12);
      expect(result.dashboardFundingRates?.map((point) => point.time)).toEqual([2000]);
    }
  });

  test("4h: both legs sampleCount 0 keeps the derived point unavailable", () => {
    const first = makeCandleResult({
      interval: "4h",
      fundingRates: [
        { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        { time: 2000, rate: 0.03, annualizedRate: 0.3, sampleCount: 1 },
      ],
    });
    const second = makeCandleResult({
      interval: "4h",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        { time: 2000, rate: 0.01, annualizedRate: 0.1, sampleCount: 1 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: null,
      secondFunding: null,
    });
    expect(result.fundingRates[1].rate).toBeCloseTo(0.02, 12);
    expect(result.dashboardFundingRates?.map((point) => point.time)).toEqual([2000]);
  });

  test("1d and 1w stay strict: either leg sampleCount 0 keeps the derived point unavailable", () => {
    for (const interval of ["1d", "1w"] as const) {
      const first = makeCandleResult({
        interval,
        fundingRates: [
          { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
          { time: 2000, rate: 0.02, annualizedRate: 175.2, sampleCount: 1 },
        ],
      });
      const second = makeCandleResult({
        interval,
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [
          { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
          { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        ],
      });

      const result = alignComboData(first, second, "spread");

      expect(result.fundingRates[1]).toEqual({
        time: 2000,
        rate: 0,
        annualizedRate: 0,
        sampleCount: 0,
        firstFunding: { rate: 0.02, annualizedRate: 175.2 },
        secondFunding: null,
      });
      expect(result.dashboardFundingRates).toEqual([{ time: 1000, rate: 0.005, annualizedRate: 43.8 }]);
    }
  });

  test("1m stays strict too (not in the chart-zero set)", () => {
    const first = makeCandleResult({
      interval: "1m",
      fundingRates: [{ time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 }],
    });
    const second = makeCandleResult({
      interval: "1m",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.01, annualizedRate: 87.6 },
      secondFunding: null,
    });
    expect(result.dashboardFundingRates).toEqual([]);
  });

  test("absent funding point from either leg stays absent — no zero inferred from total absence", () => {
    const first = makeCandleResult({
      interval: "4h",
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
        { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 0 },
      ],
    });
    const second = makeCandleResult({
      interval: "4h",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
        // No point at time 2000 at all — total transport/history absence,
        // not an explicit zero bucket. Must stay absent via intersection.
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates).toHaveLength(1);
    expect(result.fundingRates[0].time).toBe(1000);
    expect(result.fundingRates[0].rate).toBe(0.005);
  });

  test("4h: chart-only zero requires explicit sampleCount 0 — malformed/non-finite leg2 stays unavailable", () => {
    const first = makeCandleResult({
      interval: "4h",
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
        { time: 2000, rate: 0.02, annualizedRate: 175.2, sampleCount: 1 },
        { time: 3000, rate: 0.03, annualizedRate: 262.8, sampleCount: 1 },
        { time: 4000, rate: 0.04, annualizedRate: 350.4, sampleCount: 1 },
      ],
    });
    const second = makeCandleResult({
      interval: "4h",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        // Explicit no-settlement bucket -> chart-only zero, leg1 - 0.
        { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        // Non-finite rates without the explicit flag -> NOT a zero.
        { time: 2000, rate: Number.NaN, annualizedRate: Number.NaN },
        // Non-finite rates with a bogus positive sampleCount -> NOT a zero.
        { time: 3000, rate: Number.POSITIVE_INFINITY, annualizedRate: Number.NaN, sampleCount: 1 },
        // Invalid negative sampleCount with finite rates -> NOT a zero.
        { time: 4000, rate: 0.01, annualizedRate: 87.6, sampleCount: -1 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates).toHaveLength(4);
    // Explicit sampleCount 0 bucket -> chart-only zero renders leg1 - 0.
    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0.01,
      annualizedRate: 87.6,
      firstFunding: { rate: 0.01, annualizedRate: 87.6 },
      secondFunding: null,
    });
    // Malformed / invalid non-actual data stays unavailable (gap), never a
    // zero, and its metadata is null (no actual settlement).
    expect(result.fundingRates[1]).toEqual({
      time: 2000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.02, annualizedRate: 175.2 },
      secondFunding: null,
    });
    expect(result.fundingRates[2]).toEqual({
      time: 3000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.03, annualizedRate: 262.8 },
      secondFunding: null,
    });
    expect(result.fundingRates[3]).toEqual({
      time: 4000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.04, annualizedRate: 350.4 },
      secondFunding: null,
    });
    // Dashboard keeps only both-actual points — none here.
    expect(result.dashboardFundingRates).toEqual([]);
  });

  test("4h: malformed leg1 without the explicit flag stays unavailable; explicit sampleCount 0 still renders 0 - leg2", () => {
    const first = makeCandleResult({
      interval: "4h",
      fundingRates: [
        // Explicit no-settlement bucket -> chart-only zero, 0 - leg2.
        { time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 },
        // Malformed non-actual data without the explicit flag -> NOT a zero.
        { time: 2000, rate: Number.NaN, annualizedRate: Number.NaN },
      ],
    });
    const second = makeCandleResult({
      interval: "4h",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.004, annualizedRate: 0.04, sampleCount: 1 },
        { time: 2000, rate: 0.005, annualizedRate: 0.05, sampleCount: 1 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates).toHaveLength(2);
    // Explicit sampleCount 0 bucket -> chart-only zero renders 0 - leg2.
    expect(result.fundingRates[0]).toEqual({
      time: 1000,
      rate: -0.004,
      annualizedRate: -0.04,
      firstFunding: null,
      secondFunding: { rate: 0.004, annualizedRate: 0.04 },
    });
    // Malformed leg1 stays unavailable (gap), never a zero; metadata is null.
    expect(result.fundingRates[1]).toEqual({
      time: 2000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: null,
      secondFunding: { rate: 0.005, annualizedRate: 0.05 },
    });
    expect(result.dashboardFundingRates).toEqual([]);
  });

  test("both actual legs carry their raw funding observations as metadata", () => {
    const first = makeCandleResult({
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
        { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 1 }, // observed real zero
      ],
    });
    const second = makeCandleResult({
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
        { time: 2000, rate: 0.002, annualizedRate: 0.02, sampleCount: 1 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    expect(result.fundingRates[0].firstFunding).toEqual({ rate: 0.01, annualizedRate: 87.6 });
    expect(result.fundingRates[0].secondFunding).toEqual({ rate: 0.005, annualizedRate: 43.8 });
    // Observed real zero is a real observation, not null metadata.
    expect(result.fundingRates[1].firstFunding).toEqual({ rate: 0, annualizedRate: 0 });
    expect(result.fundingRates[1].secondFunding).toEqual({ rate: 0.002, annualizedRate: 0.02 });
    // Dashboard stays plain FundingRatePoint values — no metadata fields.
    expect(result.dashboardFundingRates).toEqual([
      { time: 1000, rate: 0.005, annualizedRate: 43.8 },
      { time: 2000, rate: -0.002, annualizedRate: -0.02 },
    ]);
    expect(result.dashboardFundingRates?.[0]).not.toHaveProperty("firstFunding");
  });

  test("temporary-zero directions carry one leg observation and null for the missing leg", () => {
    // leg1 actual, leg2 explicit sampleCount 0 -> firstFunding set, secondFunding null.
    const forward = alignComboData(
      makeCandleResult({
        interval: "5m",
        fundingRates: [{ time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 }],
      }),
      makeCandleResult({
        interval: "5m",
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
      }),
      "spread",
    );
    expect(forward.fundingRates[0].firstFunding).toEqual({ rate: 0.01, annualizedRate: 87.6 });
    expect(forward.fundingRates[0].secondFunding).toBeNull();

    // leg1 explicit sampleCount 0, leg2 actual -> firstFunding null, secondFunding set.
    const reverse = alignComboData(
      makeCandleResult({
        interval: "5m",
        fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
      }),
      makeCandleResult({
        interval: "5m",
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [{ time: 1000, rate: 0.004, annualizedRate: 0.04, sampleCount: 1 }],
      }),
      "spread",
    );
    expect(reverse.fundingRates[0].firstFunding).toBeNull();
    expect(reverse.fundingRates[0].secondFunding).toEqual({ rate: 0.004, annualizedRate: 0.04 });
  });

  test("both-missing and strict-interval unavailable points carry null leg metadata", () => {
    // 4h: both legs explicit sampleCount 0 -> both metadata null.
    const bothMissing = alignComboData(
      makeCandleResult({
        interval: "4h",
        fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
      }),
      makeCandleResult({
        interval: "4h",
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
      }),
      "spread",
    );
    expect(bothMissing.fundingRates[0].firstFunding).toBeNull();
    expect(bothMissing.fundingRates[0].secondFunding).toBeNull();

    // 1d strict: derived unavailable, but metadata still reflects actuality.
    const strict = alignComboData(
      makeCandleResult({
        interval: "1d",
        fundingRates: [{ time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 }],
      }),
      makeCandleResult({
        interval: "1d",
        exchange: "OKX",
        symbol: "ETH",
        fundingRates: [{ time: 1000, rate: 0, annualizedRate: 0, sampleCount: 0 }],
      }),
      "spread",
    );
    expect(strict.fundingRates[0]).toEqual({
      time: 1000,
      rate: 0,
      annualizedRate: 0,
      sampleCount: 0,
      firstFunding: { rate: 0.01, annualizedRate: 87.6 },
      secondFunding: null,
    });
  });

  test("metadata survives data-end filtering and spreads via object identity/copy", () => {
    const first = makeCandleResult({
      interval: "4h",
      fundingRates: [
        { time: 1000, rate: 0.01, annualizedRate: 87.6, sampleCount: 1 },
        { time: 2000, rate: 0.02, annualizedRate: 175.2, sampleCount: 1 },
      ],
    });
    const second = makeCandleResult({
      interval: "4h",
      exchange: "OKX",
      symbol: "ETH",
      fundingRates: [
        { time: 1000, rate: 0.005, annualizedRate: 43.8, sampleCount: 1 },
        { time: 2000, rate: 0, annualizedRate: 0, sampleCount: 0 },
      ],
    });

    const result = alignComboData(first, second, "spread");

    // Shallow array copy (as in filterLegacyComboRange) keeps the same point objects.
    const copied = [...result.fundingRates];
    expect(copied[1]).toBe(result.fundingRates[1]);
    // Object spread carries metadata along.
    const spread = { ...result.fundingRates[1] };
    expect(spread.firstFunding).toEqual({ rate: 0.02, annualizedRate: 175.2 });
    expect(spread.secondFunding).toBeNull();
    // Filtering keeps metadata on the retained points.
    const filtered = result.fundingRates.filter((point) => point.time === 2000);
    expect(filtered[0].firstFunding).toEqual({ rate: 0.02, annualizedRate: 175.2 });
    expect(filtered[0].secondFunding).toBeNull();
  });
});
