import { describe, test, expect } from "bun:test";
import { alignComboData } from "./combo";
import type { SearchCandleResult } from "./search-candles";

function makeCandleResult(overrides: Partial<SearchCandleResult> = {}): SearchCandleResult {
  return {
    candles: [],
    fundingRates: [],
    interval: "1h",
    exchange: "Binance",
    symbol: "BTC",
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

    const ratioResult = alignComboData(first, second, "ratio");
    expect(ratioResult.candles[0].quoteVolume).toBe("80"); // min(100, 80)
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
});
