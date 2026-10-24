import { describe, expect, test } from "bun:test";
import {
  COMBINATION_MAX_FRAME_AGE_MS,
  COMBINATION_MAX_SKEW_MS,
  COMBINATION_VWAP_NOTIONAL_USDT,
  buildCombinationOrderBook,
  buildLegOrderBookMetrics,
  type CombinationBookMode,
  type CombinationBookResult,
  type CombinationBookSpreadMetric,
} from "./combination";
import type { BookFrame, BookSessionState, BookSessionStatus, BookTarget, NormalizedOrderBook } from "./types";

const NOW = 1_000_000;

const TARGET_A: BookTarget = {
  id: "spot:Binance:BTCUSDT", exchange: "Binance", kind: "spot", rawSymbol: "BTCUSDT",
  baseAsset: "BTC", quoteAsset: "USDT",
};
const TARGET_B: BookTarget = {
  id: "spot:Gate.io:BTC_USDT", exchange: "Gate.io", kind: "spot", rawSymbol: "BTC_USDT",
  baseAsset: "BTC", quoteAsset: "USDT",
};

interface FrameOptions {
  targetId?: string;
  baseAsset?: string;
  quantityUnit?: string;
  receivedAtMs?: number;
}

function frame(book: NormalizedOrderBook, target: BookTarget, options: FrameOptions = {}): BookFrame {
  return {
    targetId: options.targetId ?? target.id,
    book,
    quantityUnit: (options.quantityUnit ?? "base") as "base",
    baseAsset: options.baseAsset ?? target.baseAsset,
    source: { transport: "ws", bookMode: "normal", route: "public" },
    exchangeTimeMs: null,
    receivedAtMs: options.receivedAtMs ?? NOW,
    sequence: null,
  };
}

function state(
  book: NormalizedOrderBook,
  target: BookTarget,
  options: FrameOptions & { status?: BookSessionStatus } = {},
): BookSessionState {
  return {
    requested: { transport: "ws", bookMode: "normal" },
    attempt: { transport: "ws", bookMode: "normal" },
    frame: frame(book, target, options),
    status: options.status ?? "live",
    notices: [],
    error: null,
    updated: options.receivedAtMs ?? NOW,
  };
}

function build(
  asksA: NormalizedOrderBook["asks"],
  bidsB: NormalizedOrderBook["bids"],
  extra: {
    mode?: CombinationBookMode;
    bidsA?: NormalizedOrderBook["bids"];
    asksB?: NormalizedOrderBook["asks"];
    stateA?: BookSessionState;
    stateB?: BookSessionState;
    vwapNotionalUsdt?: number;
  } = {},
): CombinationBookResult {
  return buildCombinationOrderBook({
    targetA: TARGET_A,
    targetB: TARGET_B,
    stateA: extra.stateA ?? state({ asks: asksA, bids: extra.bidsA ?? asksA }, TARGET_A),
    stateB: extra.stateB ?? state({ asks: extra.asksB ?? bidsB, bids: bidsB }, TARGET_B),
    mode: extra.mode ?? "spread",
    nowMs: NOW,
    vwapNotionalUsdt: extra.vwapNotionalUsdt,
  });
}

describe("buildCombinationOrderBook matching", () => {
  test("five matched segments reproduce the reference oracle", () => {
    const result = build(
      [{ price: 100, quantity: 1 }, { price: 110, quantity: 2 }, { price: 120, quantity: 1 }],
      [{ price: 50, quantity: 1 }, { price: 40, quantity: 5 }, { price: 30, quantity: 10 }],
    );
    expect(result.status).toBe("ready");
    expect(result.reason).toBeNull();
    expect(result.buy.error).toBeNull();
    expect(result.buy.levels.map((level) => level.notionalUsdt)).toEqual([50, 50, 150, 70, 120]);
    expect(result.buy.levels.map((level) => level.cumulativeNotionalUsdt)).toEqual([50, 100, 250, 320, 440]);
    expect(result.buy.levels.map((level) => level.priceA)).toEqual([100, 100, 110, 110, 120]);
    expect(result.buy.levels.map((level) => level.priceB)).toEqual([50, 40, 40, 30, 30]);
    expect(result.buy.levels.map((level) => level.value)).toEqual([50, 60, 70, 80, 90]);
  });

  test("buy consumes ascending A asks against descending B bids and sell mirrors it", () => {
    const result = build(
      [{ price: 101, quantity: 10 }],
      [{ price: 49, quantity: 10 }],
      { bidsA: [{ price: 99, quantity: 10 }], asksB: [{ price: 51, quantity: 10 }] },
    );
    // Notional is price x quantity, so A asks carry 1010 USDT and B bids 490.
    expect(result.buy.levels).toHaveLength(1);
    expect(result.buy.levels[0]).toMatchObject({ value: 52, priceA: 101, priceB: 49, notionalUsdt: 490 });
    expect(result.sell.levels).toHaveLength(1);
    expect(result.sell.levels[0]).toMatchObject({ value: 48, priceA: 99, priceB: 51 });
  });

  test("sorts unsorted depth so buy values ascend and sell values descend", () => {
    const result = build(
      [{ price: 120, quantity: 1 }, { price: 100, quantity: 1 }, { price: 110, quantity: 1 }],
      [{ price: 30, quantity: 1 }, { price: 50, quantity: 1 }, { price: 40, quantity: 1 }],
      {
        bidsA: [{ price: 79, quantity: 1 }, { price: 99, quantity: 1 }, { price: 89, quantity: 1 }],
        asksB: [{ price: 71, quantity: 1 }, { price: 51, quantity: 1 }, { price: 61, quantity: 1 }],
      },
    );
    const buyValues = result.buy.levels.map((level) => level.value);
    const sellValues = result.sell.levels.map((level) => level.value);
    // Buy starts at the cheapest A ask against the richest B bid.
    expect(result.buy.levels[0]).toMatchObject({ priceA: 100, priceB: 50, value: 50 });
    expect(result.sell.levels[0]).toMatchObject({ priceA: 99, priceB: 51, value: 48 });
    expect(buyValues.length).toBeGreaterThan(1);
    expect(sellValues.length).toBeGreaterThan(1);
    expect([...buyValues].sort((a, b) => a - b)).toEqual(buyValues);
    expect([...sellValues].sort((a, b) => b - a)).toEqual(sellValues);
    expect(new Set(buyValues).size).toBe(buyValues.length);
    expect(buyValues.at(-1)).toBeGreaterThan(buyValues[0]);
    expect(sellValues.at(-1)).toBeLessThan(sellValues[0]);
  });

  test("min remaining notional governs each segment and carries the leftover balance", () => {
    const result = build(
      [{ price: 100, quantity: 1 }],
      [{ price: 60, quantity: 1 }, { price: 40, quantity: 1 }],
    );
    // A depth is 100 USDT: 60 consumes the first B level, the last 40 the next.
    expect(result.buy.levels.map((level) => level.notionalUsdt)).toEqual([60, 40]);
    expect(result.buy.levels.map((level) => level.priceB)).toEqual([60, 40]);
    expect(result.buy.levels.map((level) => level.value)).toEqual([40, 60]);
    expect(result.buy.levels[1].cumulativeNotionalUsdt).toBe(100);
  });

  test("equal balances advance both pointers in one segment", () => {
    const result = build(
      [{ price: 100, quantity: 1 }, { price: 110, quantity: 1 }],
      [{ price: 50, quantity: 2 }, { price: 40, quantity: 2.5 }],
    );
    // 50x2 = 100 USDT and 100x1 = 100 USDT exhaust together.
    expect(result.buy.levels).toHaveLength(2);
    expect(result.buy.levels[0]).toMatchObject({ notionalUsdt: 100, priceA: 100, priceB: 50, value: 50 });
    expect(result.buy.levels[1]).toMatchObject({ notionalUsdt: 100, priceA: 110, priceB: 40, cumulativeNotionalUsdt: 200 });
  });

  test("aggregates real duplicate prices across the whole depth instead of taking five rows", () => {
    const result = build(
      [{ price: 90, quantity: 1 }, { price: 90, quantity: 2 }, { price: 100, quantity: 1 }],
      [{ price: 40, quantity: 10 }],
    );
    expect(result.buy.levels).toHaveLength(2);
    expect(result.buy.levels[0]).toMatchObject({ value: 50, priceA: 90, notionalUsdt: 270 });
    expect(result.buy.levels.map((level) => level.priceA)).toEqual([90, 100]);
    expect(result.buy.levels[1].cumulativeNotionalUsdt).toBe(370);
  });

  test("stops at five segments per direction and never fakes the remaining total", () => {
    const asksA = Array.from({ length: 8 }, (_, index) => ({ price: 100 + index, quantity: 1 }));
    const bidsB = Array.from({ length: 8 }, (_, index) => ({ price: 50 + index, quantity: 100 }));
    const result = build(asksA, bidsB);
    expect(result.buy.levels).toHaveLength(5);
    // Real A depth is 100+101+...+107 = 828 USDT; the view stops at 510 and must
    // not present that as the full total.
    expect(result.buy.levels.at(-1)?.cumulativeNotionalUsdt).toBe(510);
    expect(result.buy.levels.at(-1)?.cumulativeNotionalUsdt).toBeLessThan(828);
  });

  test("zero spread stays positive zero rather than negative zero", () => {
    const result = build([{ price: 100, quantity: 1 }], [{ price: 100, quantity: 1 }]);
    const value = result.buy.levels[0].value;
    expect(value).toBe(0);
    expect(Object.is(value, -0)).toBe(false);
  });

  test("ratio mode divides A by B across carried depth", () => {
    const result = build([{ price: 100, quantity: 2 }], [{ price: 60, quantity: 3 }, { price: 40, quantity: 5 }], { mode: "ratio" });
    expect(result.buy.levels.map((level) => level.value)).toEqual([100 / 60, 100 / 40]);
    expect(result.buy.levels.map((level) => level.notionalUsdt)).toEqual([180, 20]);
    expect(result.buy.levels.map((level) => level.cumulativeNotionalUsdt)).toEqual([180, 200]);
  });

  test("an empty direction is ready with an empty array rather than fabricated levels", () => {
    const result = build([{ price: 100, quantity: 1 }], [], { bidsA: [], asksB: [] });
    expect(result.status).toBe("ready");
    expect(result.buy.levels).toEqual([]);
    expect(result.buy.error).toBeNull();
    expect(result.sell.levels).toEqual([]);
    expect(result.sell.error).toBeNull();
  });

  test("one usable direction survives while the other fails closed with its own error", () => {
    const result = build(
      [{ price: 100, quantity: Number.MAX_VALUE }],
      [{ price: 50, quantity: 1 }],
      { bidsA: [{ price: 90, quantity: 1 }], asksB: [{ price: 60, quantity: 1 }] },
    );
    expect(result.status).toBe("ready");
    expect(result.buy.levels).toEqual([]);
    expect(result.buy.error).toContain("买方向");
    expect(result.sell.levels).toHaveLength(1);
    expect(result.sell.error).toBeNull();
  });

  test("does not mutate frozen inputs", () => {
    const bookA: NormalizedOrderBook = {
      asks: [{ price: 100, quantity: 1 }, { price: 110, quantity: 2 }],
      bids: [{ price: 99, quantity: 1 }],
    };
    const bookB: NormalizedOrderBook = {
      bids: [{ price: 40, quantity: 5 }],
      asks: [{ price: 51, quantity: 1 }],
    };
    const copy = structuredClone({ bookA, bookB });
    for (const book of [bookA, bookB]) {
      Object.freeze(book.bids); Object.freeze(book.asks);
      for (const level of [...book.bids, ...book.asks]) Object.freeze(level);
      Object.freeze(book);
    }
    const result = build(bookA.asks, bookB.bids, {
      bidsA: bookA.bids, asksB: bookB.asks,
      stateA: state(bookA, TARGET_A), stateB: state(bookB, TARGET_B),
    });
    expect(result.status).toBe("ready");
    result.buy.levels[0].value = 1_234;
    expect({ bookA, bookB }).toEqual(copy);
  });
});

describe("buildCombinationOrderBook rejection", () => {
  test("exports the freshness budget constants used by the UI copy", () => {
    expect(COMBINATION_MAX_FRAME_AGE_MS).toBe(20_000);
    expect(COMBINATION_MAX_SKEW_MS).toBe(10_000);
  });

  test("non-USD quotes are unsupported and win over freshness problems", () => {
    const btcQuoteTarget: BookTarget = { ...TARGET_B, id: "spot:Gate.io:BTC_BTC", rawSymbol: "BTC_BTC", quoteAsset: "BTC" };
    const cases: Array<[BookTarget, BookTarget]> = [
      [TARGET_A, btcQuoteTarget],
      [{ ...TARGET_A, id: "spot:Binance:BTCETH", rawSymbol: "BTCETH", quoteAsset: "ETH" }, btcQuoteTarget],
    ];
    for (const [targetA, targetB] of cases) {
      const result = buildCombinationOrderBook({
        targetA,
        targetB,
        // Deliberately stale legs: the quote-currency boundary is still the answer.
        stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, { status: "stale", receivedAtMs: NOW - 60_000 }),
        stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B, { status: "stale", receivedAtMs: NOW - 60_000 }),
        mode: "spread",
        nowMs: NOW,
      });
      expect(result.status).toBe("unsupported");
      expect(result.reason).toContain("USD");
      expect(result.buy.levels).toEqual([]);
      expect(result.sell.levels).toEqual([]);
    }
  });

  test("every USD-pegged quote is accepted 1:1, including suffixed names", () => {
    // Substring membership on the quote name, case-insensitive: no startsWith.
    for (const quoteAsset of ["USD", "usdt", "USDC", "FDUSD", "BUSD", "TUSD", "USD1", "USDE", "usdd", "IBUSD"]) {
      const targetA: BookTarget = { ...TARGET_A, id: `spot:Binance:BTC${quoteAsset}`, rawSymbol: `BTC${quoteAsset}`, quoteAsset };
      const targetB: BookTarget = { ...TARGET_B, id: `spot:Gate.io:BTC_${quoteAsset}`, rawSymbol: `BTC_${quoteAsset}`, quoteAsset };
      const result = buildCombinationOrderBook({
        targetA,
        targetB,
        stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [{ price: 99, quantity: 1 }] }, targetA),
        stateB: state({ asks: [{ price: 51, quantity: 1 }], bids: [{ price: 50, quantity: 1 }] }, targetB),
        mode: "spread",
        nowMs: NOW,
      });
      expect(result.status).toBe("ready");
      expect(result.reason).toBeNull();
      // The matched notional is the shared USD amount, never sum of both legs.
      expect(result.buy.levels[0]).toMatchObject({ notionalUsdt: 50, cumulativeNotionalUsdt: 50 });
      expect(result.sell.levels[0]).toMatchObject({ notionalUsdt: 51, cumulativeNotionalUsdt: 51 });
    }
  });

  test("mixed USD quote pairs match the USDT baseline exactly in both modes", () => {
    // Depth chosen to exercise segment carry-over and a remainder on both sides.
    const asksA = [{ price: 100, quantity: 1 }, { price: 110, quantity: 2 }, { price: 120, quantity: 1 }];
    const bidsA = [{ price: 99, quantity: 1.5 }, { price: 95, quantity: 1 }];
    const bidsB = [{ price: 50, quantity: 1 }, { price: 40, quantity: 5 }, { price: 30, quantity: 10 }];
    const asksB = [{ price: 51, quantity: 2 }, { price: 55, quantity: 1 }];

    const run = (quoteA: string, quoteB: string, mode: CombinationBookMode): CombinationBookResult => {
      const targetA: BookTarget = { ...TARGET_A, id: `spot:Binance:BTC${quoteA}`, rawSymbol: `BTC${quoteA}`, quoteAsset: quoteA };
      const targetB: BookTarget = { ...TARGET_B, id: `spot:Gate.io:BTC_${quoteB}`, rawSymbol: `BTC_${quoteB}`, quoteAsset: quoteB };
      return buildCombinationOrderBook({
        targetA,
        targetB,
        stateA: state({ asks: asksA, bids: bidsA }, targetA),
        stateB: state({ asks: asksB, bids: bidsB }, targetB),
        mode,
        nowMs: NOW,
      });
    };

    for (const mode of ["spread", "ratio"] as const) {
      // USDT/USDT is the reference: 1:1 equivalence must not shift any number.
      const baseline = run("USDT", "USDT", mode);
      expect(baseline.status).toBe("ready");
      expect(baseline.buy.levels.length).toBeGreaterThan(1);
      expect(baseline.sell.levels.length).toBeGreaterThan(1);

      for (const [quoteA, quoteB] of [["USDC", "USDT"], ["USD1", "FDUSD"], ["BUSD", "USDE"]] as const) {
        const mixed = run(quoteA, quoteB, mode);
        expect(mixed.status).toBe("ready");
        expect(mixed.reason).toBeNull();
        // A distinct quote per leg must not be converted, re-scaled or rejected:
        // value, per-segment notional and cumulative all equal the USDT reference.
        expect(mixed.buy.levels).toEqual(baseline.buy.levels);
        expect(mixed.sell.levels).toEqual(baseline.sell.levels);
      }
    }
  });

  test("a base asset containing USD never makes a non-USD quote eligible", () => {
    const result = buildCombinationOrderBook({
      targetA: { ...TARGET_A, id: "spot:Binance:USDTBTC", rawSymbol: "USDTBTC", baseAsset: "USDT", quoteAsset: "BTC" },
      targetB: { ...TARGET_B, id: "spot:Gate.io:USD_EUR", rawSymbol: "USD_EUR", baseAsset: "USD", quoteAsset: "EUR" },
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A),
      stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B),
      mode: "spread",
      nowMs: NOW,
    });
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("A=BTC");
    expect(result.reason).toContain("B=EUR");
  });

  for (const status of ["stale", "connecting", "error"] as const) {
    test(`a ${status} leg is unavailable with a labelled reason`, () => {
      const result = build([{ price: 100, quantity: 1 }], [{ price: 50, quantity: 1 }], {
        stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B, { status }),
      });
      expect(result.status).toBe("unavailable");
      expect(result.reason).toContain("B");
      expect(result.buy.levels).toEqual([]);
    });
  }

  test("a missing leg target is unavailable and names the leg", () => {
    const result = buildCombinationOrderBook({
      targetA: null, targetB: TARGET_B,
      stateA: state({ asks: [], bids: [] }, TARGET_A),
      stateB: state({ asks: [], bids: [] }, TARGET_B),
      mode: "spread", nowMs: NOW,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("A");
  });

  test("frame identity must match its target on every tuple member", () => {
    const cases: FrameOptions[] = [
      { targetId: "spot:Gate.io:BTC_USDT" },
      { baseAsset: "ETH" },
      { quantityUnit: "quote" },
    ];
    for (const options of cases) {
      const result = build([{ price: 100, quantity: 1 }], [{ price: 50, quantity: 1 }], {
        stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, options),
      });
      expect(result.status).toBe("unavailable");
      expect(result.reason).toContain("A");
    }
  });

  test("rejects frames older than the freshness budget", () => {
    const result = build([{ price: 100, quantity: 1 }], [{ price: 50, quantity: 1 }], {
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, {
        receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS - 1,
      }),
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("A");
    expect(result.reason).toContain("过期");
  });

  test("accepts a frame exactly at the freshness boundary", () => {
    const result = build([{ price: 100, quantity: 1 }], [{ price: 50, quantity: 1 }], {
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, {
        receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS,
      }),
      stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B, {
        receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS,
      }),
    });
    expect(result.status).toBe("ready");
    expect(result.buy.levels).toHaveLength(1);
  });

  test("rejects frames received in the future", () => {
    const result = build([{ price: 100, quantity: 1 }], [{ price: 50, quantity: 1 }], {
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, { receivedAtMs: NOW + 1 }),
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("A");
  });

  test("rejects legs whose receipt times drift past the skew budget", () => {
    const result = buildCombinationOrderBook({
      targetA: TARGET_A, targetB: TARGET_B,
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A, { receivedAtMs: NOW }),
      stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B, {
        receivedAtMs: NOW - COMBINATION_MAX_SKEW_MS - 1,
      }),
      mode: "spread", nowMs: NOW,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("时间差");
    expect(result.buy.levels).toEqual([]);
  });

  for (const [label, prices] of [
    ["price", [{ price: Number.MAX_VALUE, quantity: Number.MAX_VALUE }]],
    ["overflow", [{ price: 1e200, quantity: 1e200 }, { price: 1e200, quantity: 1e200 }]],
    ["zero", [{ price: Number.MIN_VALUE, quantity: Number.MIN_VALUE }]],
  ] as const) {
    test(`rejects ${label} produced by a non-finite or collapsed notional`, () => {
      const result = build([...prices], [{ price: 50, quantity: 1 }], {
        bidsA: [], asksB: [],
      });
      expect(result.status).toBe("ready");
      expect(result.buy.levels).toEqual([]);
      expect(result.buy.error).toContain("买方向");
    });
  }

  test("rejects non-positive or non-finite source prices and quantities", () => {
    const bad: NormalizedOrderBook["asks"] = [
      { price: 0, quantity: 1 },
      { price: -1, quantity: 1 },
      { price: 10, quantity: 0 },
      { price: 10, quantity: Number.NaN },
    ];
    for (const level of bad) {
      const result = build([level], [{ price: 50, quantity: 1 }], { bidsA: [], asksB: [] });
      expect(result.buy.levels).toEqual([]);
      expect(result.buy.error).not.toBeNull();
    }
  });

  test("accepts negative spread values without rejecting the direction", () => {
    const result = build([{ price: 100, quantity: 1 }], [{ price: 150, quantity: 1 }]);
    expect(result.status).toBe("ready");
    expect(result.buy.levels[0].value).toBe(-50);
    expect(result.buy.error).toBeNull();
  });

  test("keeps a tiny remainder instead of discarding it with an epsilon", () => {
    // A's second level is 2^-30 USDT (~9.3e-10). The first segment consumes the
    // whole 1 USDT level, leaving that tiny balance to match on its own. An
    // epsilon-based cutoff would silently drop it and report a single segment.
    const tiny = 2 ** -30;
    const result = build(
      [{ price: 1, quantity: 1 }, { price: 2, quantity: tiny / 2 }],
      [{ price: 1, quantity: 1e308 }],
    );
    expect(result.buy.levels).toHaveLength(2);
    expect(result.buy.levels[0].notionalUsdt).toBe(1);
    expect(result.buy.levels[1].notionalUsdt).toBe(tiny);
    // 1 + 2^-30 is exactly representable, so the carry-over is not rounded away.
    expect(result.buy.levels[1].cumulativeNotionalUsdt).toBe(1 + tiny);
  });

  test("invalid mode and clock fail closed", () => {
    const badMode = buildCombinationOrderBook({
      targetA: TARGET_A, targetB: TARGET_B,
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A),
      stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B),
      mode: "mid" as CombinationBookMode, nowMs: NOW,
    });
    expect(badMode.status).toBe("unavailable");
    expect(badMode.buy.levels).toEqual([]);

    const badClock = buildCombinationOrderBook({
      targetA: TARGET_A, targetB: TARGET_B,
      stateA: state({ asks: [{ price: 100, quantity: 1 }], bids: [] }, TARGET_A),
      stateB: state({ asks: [], bids: [{ price: 50, quantity: 1 }] }, TARGET_B),
      mode: "spread", nowMs: Number.NaN,
    });
    expect(badClock.status).toBe("unavailable");
    expect(badClock.reason).toContain("时间");
  });
});

/** Independent restatement of the expected leg VWAP, for cross-checking. */
function expectedLegVwap(prices: Array<[price: number, quantity: number]>, budget: number): number {
  let remaining = budget;
  let base = 0;
  for (const [price, quantity] of prices) {
    if (remaining <= 0) break;
    const spend = Math.min(remaining, price * quantity);
    base += spend / price;
    remaining -= spend;
  }
  return budget / base;
}

function finiteMetric(metric: CombinationBookSpreadMetric) {
  return {
    buyValue: metric.buyValue,
    sellValue: metric.sellValue,
    difference: metric.difference,
    percent: metric.percent,
  };
}

describe("buildCombinationOrderBook spread metrics", () => {
  test("exports the fixed VWAP budget", () => {
    expect(COMBINATION_VWAP_NOTIONAL_USDT).toBe(5000);
  });

  test("best metric uses levels[0] on both sides and keeps the signed difference", () => {
    const result = build(
      [{ price: 100, quantity: 1 }],
      [{ price: 50, quantity: 1 }],
      { bidsA: [{ price: 99, quantity: 1 }], asksB: [{ price: 51, quantity: 1 }] },
    );
    expect(result.buy.levels[0].value).toBe(50);
    expect(result.sell.levels[0].value).toBe(48);
    expect(result.metrics.bestReason).toBeNull();
    // Absolute readings are the synthetic values, unchanged.
    expect(result.metrics.best?.buyValue).toBe(50);
    expect(result.metrics.best?.sellValue).toBe(48);
    expect(result.metrics.best?.difference).toBe(2);
    // The percent is each leg's own ask-vs-bid percent added together:
    // A = (100 - 99) / |(100 + 99) / 2| * 100, B = (51 - 50) / |(51 + 50) / 2| * 100.
    const percentA = ((100 - 99) / Math.abs((100 + 99) / 2)) * 100;
    const percentB = ((51 - 50) / Math.abs((51 + 50) / 2)) * 100;
    expect(result.metrics.best?.percent).toBeCloseTo(percentA + percentB, 12);
    expect(result.metrics.best?.percent).not.toBeCloseTo((2 / 49) * 100, 6);
    expect(result.metrics.vwapNotionalUsdt).toBe(5000);
  });

  test("a negative best difference is published as-is, never abs()ed", () => {
    const result = build(
      [{ price: 100, quantity: 1 }],
      [{ price: 150, quantity: 1 }],
      { bidsA: [{ price: 99, quantity: 1 }], asksB: [{ price: 51, quantity: 1 }] },
    );
    expect(result.buy.levels[0].value).toBe(-50);
    expect(result.metrics.best).not.toBeNull();
    // Absolute readings keep the signed synthetic spread.
    expect(result.metrics.best?.buyValue).toBe(-50);
    expect(result.metrics.best?.difference).toBe(-98);
    expect(result.metrics.best?.difference).toBeLessThan(0);
    // Percent comes from the legs: A is tight and positive, B is crossed and
    // strongly negative, so the sum is negative but nowhere near -98.
    const percentA = ((100 - 99) / Math.abs((100 + 99) / 2)) * 100;
    const percentB = ((51 - 150) / Math.abs((51 + 150) / 2)) * 100;
    expect(result.metrics.best?.percent).toBeCloseTo(percentA + percentB, 12);
    expect(result.metrics.best?.percent).toBeLessThan(0);
  });

  test("ratio mode divides the two leg values for best and vwap", () => {
    const asksA = [{ price: 100, quantity: 100 }];
    const bidsB = [{ price: 50, quantity: 200 }];
    const result = build(asksA, bidsB, {
      mode: "ratio",
      bidsA: [{ price: 90, quantity: 100 }],
      asksB: [{ price: 45, quantity: 200 }],
    });
    expect(result.metrics.best?.buyValue).toBeCloseTo(2, 12);
    expect(result.metrics.best?.sellValue).toBeCloseTo(2, 12);
    expect(result.metrics.best?.difference).toBeCloseTo(0, 12);
    // Leg A is 100/90 (+10.526%) and leg B is 45/50 (-10.526%), so the additive
    // percent cancels to zero even though each leg alone is non-zero.
    expect(result.metrics.best?.percent).toBeCloseTo(
      ((100 - 90) / Math.abs((100 + 90) / 2)) * 100 + ((45 - 50) / Math.abs((45 + 50) / 2)) * 100,
      10,
    );
    expect(result.metrics.best?.percent).toBeCloseTo(0, 10);
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(2, 12);
    expect(result.metrics.vwap?.sellValue).toBeCloseTo(2, 12);
    expect(result.metrics.vwap?.difference).toBeCloseTo(0, 12);
  });

  test("a zero combination midpoint now has a valid percent, because the denominator is per leg", () => {
    // buy = 100 - 50 = 50, sell = 100 - 150 = -50, so the synthetic midpoint is
    // exactly 0. The percent no longer divides by it: it is A's percent plus B's.
    const result = build(
      [{ price: 100, quantity: 100 }],
      [{ price: 50, quantity: 200 }],
      { bidsA: [{ price: 100, quantity: 100 }], asksB: [{ price: 150, quantity: 100 }] },
    );
    expect(result.metrics.best).not.toBeNull();
    // Absolute readings untouched.
    expect(result.metrics.best?.buyValue).toBe(50);
    expect(result.metrics.best?.sellValue).toBe(-50);
    expect(result.metrics.best?.difference).toBe(100);
    expect(result.metrics.bestReason).toBeNull();
    // A: (100 - 100) / 100 * 100 = 0; B: (150 - 50) / 100 * 100 = 100.
    expect(result.metrics.best?.percent).toBeCloseTo(0 + 100, 12);
    expect(result.metrics.best?.percent).not.toBeNull();
  });

  test("vwap is base-quantity weighted over full depth, not a notional average of levels", () => {
    // A asks: 4000 USDT at 100 then 20000 at 200. A 5000 budget buys 40 + 5 base
    // for 5000 quote, so A VWAP = 5000/45 and not (100 + 200)/2 nor a
    // notional-weighted 4000/5000*100 + 1000/5000*200 of the two levels. The B
    // leg fills entirely at its single 50 bid, so the combined buy value is
    // A VWAP - 50.
    const result = build(
      [{ price: 100, quantity: 40 }, { price: 200, quantity: 100 }],
      [{ price: 50, quantity: 100 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    const notionalAverage = (4000 / 5000) * 100 + (1000 / 5000) * 200;
    expect(result.metrics.vwap).not.toBeNull();
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(5000 / 45 - 50, 10);
    expect(result.metrics.vwap?.buyValue).not.toBeCloseTo(notionalAverage - 50, 3);
    expect(result.metrics.vwap?.buyValue).not.toBeCloseTo(100, 3);
    // 5000 quote at 100 buys 50 base, so the naive ratio 5000/50 = 100 is wrong
    // too: the last level genuinely absorbs 1000 quote at 200.
    expect(result.metrics.vwap?.buyValue).toBeGreaterThan(50);
    expect(result.metrics.vwap?.sellValue).toBeCloseTo(99 - 51, 10);
    expect(result.metrics.vwap?.difference).toBeCloseTo(5000 / 45 - 50 - 48, 10);
  });

  test("the last level is consumed partially for exactly the remaining budget", () => {
    const result = build(
      [{ price: 100, quantity: 40 }, { price: 200, quantity: 100 }],
      [{ price: 50, quantity: 100 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    const expected = expectedLegVwap([[100, 40], [200, 100]], 5000);
    expect(expected).toBeCloseTo(5000 / 45, 10);
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(expected - 50, 10);
  });

  test("a budget landing exactly on a level boundary does not over-consume depth", () => {
    // Two levels of exactly 2500 USDT: 5000 hits the boundary with no partial.
    const result = build(
      [{ price: 100, quantity: 25 }, { price: 200, quantity: 12.5 }],
      [{ price: 50, quantity: 100 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(expectedLegVwap([[100, 25], [200, 12.5]], 5000) - 50, 10);
    // 25 + 12.5 = 37.5 base for 5000 quote.
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(5000 / 37.5 - 50, 10);
  });

  test("a floating-point depth that lands on exactly 5000 still publishes a vwap", () => {
    // A asks, ascending as prepareSide orders them: 0.1 * 49142 = 4914.2 plus
    // 0.2 * 429 = 85.8. The left-fold sum of those two notionals is exactly the
    // 5000 budget, yet subtracting them one by one leaves a ~1.7e-13 residue
    // (summation and sequential subtraction are not bit-identical). That
    // rounding-level residue must not be mistaken for an unfinished budget.
    const result = build(
      [{ price: 0.1, quantity: 49_142 }, { price: 0.2, quantity: 429 }],
      [{ price: 0.05, quantity: 100_000 }],
      {
        bidsA: [{ price: 0.09, quantity: 100_000 }],
        asksB: [{ price: 0.06, quantity: 100_000 }],
      },
    );
    expect(result.metrics.vwap).not.toBeNull();
    expect(result.metrics.vwapReason).toBeNull();
    // 49142 base on the first level plus 85.8/0.2 = 429 base on the second.
    const baseQuantity = 49_142 + 429;
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(5000 / baseQuantity - 0.05, 12);
    expect(Number.isFinite(result.metrics.vwap?.buyValue ?? Number.NaN)).toBe(true);
  });

  test("a depth just short of the budget stays rejected, so the tolerance stays narrow", () => {
    // 4999.999999 is short of 5000 by 1e-6 — far beyond rounding-level residue —
    // so the vwap must still be withheld rather than papered over by the epsilon.
    const result = build(
      [{ price: 1, quantity: 4999.999999 }],
      [{ price: 0.5, quantity: 100_000 }],
      {
        bidsA: [{ price: 0.9, quantity: 100_000 }],
        asksB: [{ price: 0.6, quantity: 100_000 }],
      },
    );
    expect(result.metrics.vwap).toBeNull();
    expect(result.metrics.vwapReason).toContain("深度不足");
  });

  test("ratio vwap divides two multi-level leg vwaps, not single levels", () => {
    // A asks (ascending): 3000 USDT at 100 then 200/base. B bids (descending):
    // 2000 USDT at 80 then 40/base. Both legs need two levels, so the ratio must
    // be the quotient of the two full-depth leg VWAPs.
    const asksA = [{ price: 100, quantity: 30 }, { price: 200, quantity: 100 }];
    const bidsB = [{ price: 80, quantity: 25 }, { price: 40, quantity: 100 }];
    const result = build(asksA, bidsB, {
      mode: "ratio",
      bidsA: [{ price: 90, quantity: 100 }],
      asksB: [{ price: 50, quantity: 200 }],
    });
    // A: 3000/100 + 2000/200 = 30 + 10 = 40 base, so leg VWAP = 5000/40 = 125.
    const vwapA = expectedLegVwap([[100, 30], [200, 100]], 5000);
    // B bids are consumed richest-first: 2000/80 + 3000/40 = 25 + 75 = 100 base,
    // so leg VWAP = 5000/100 = 50.
    const vwapB = expectedLegVwap([[80, 25], [40, 100]], 5000);
    expect(vwapA).toBeCloseTo(125, 12);
    expect(vwapB).toBeCloseTo(50, 12);
    expect(result.metrics.vwap).not.toBeNull();
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(vwapA / vwapB, 12);
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(2.5, 12);
    // The sell direction is single-level on both legs, so it divides those prices.
    expect(result.metrics.vwap?.sellValue).toBeCloseTo(90 / 50, 12);
    expect(result.metrics.vwap?.difference).toBeCloseTo(2.5 - 90 / 50, 12);
  });

  test("vwap reads depth beyond the five displayed segments", () => {
    // A asks carry 900, 909 ... USDT each; five segments only reach 4590 USDT, so
    // the 5000 budget must dip into the sixth level.
    const asksA = Array.from({ length: 8 }, (_, index) => ({ price: 100 + index, quantity: 9 }));
    const bidsB = [{ price: 50, quantity: 1000 }];
    const result = build(asksA, bidsB, {
      bidsA: [{ price: 99, quantity: 1000 }],
      asksB: [{ price: 51, quantity: 1000 }],
    });
    expect(result.buy.levels).toHaveLength(5);
    const fiveSegmentTotal = result.buy.levels.at(-1)?.cumulativeNotionalUsdt ?? 0;
    expect(fiveSegmentTotal).toBeLessThan(5000);
    const expectedA = expectedLegVwap(
      asksA.map((level) => [level.price, level.quantity] as [number, number]),
      5000,
    );
    // 9 base per level for five levels plus 410/105 base on the sixth.
    expect(expectedA).toBeCloseTo(5000 / (45 + 410 / 105), 10);
    expect(result.metrics.vwap?.buyValue).toBeCloseTo(expectedA - 50, 10);
    expect(result.metrics.vwap?.sellValue).toBeCloseTo(99 - 51, 10);
  });

  test("a leg short of the 5000 budget publishes no partial-budget vwap", () => {
    const result = build(
      [{ price: 100, quantity: 10 }],
      [{ price: 50, quantity: 100 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    expect(result.buy.error).toBeNull();
    expect(result.metrics.vwap).toBeNull();
    expect(result.metrics.vwapReason).toContain("深度不足");
    expect(result.metrics.vwapReason).toContain("买方向A 腿");
    // The display side still renders its short-but-real depth.
    expect(result.buy.levels).toHaveLength(1);
  });

  test("a short B leg also blocks the vwap with its own leg label", () => {
    const result = build(
      [{ price: 100, quantity: 100 }],
      [{ price: 50, quantity: 10 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    expect(result.metrics.vwap).toBeNull();
    expect(result.metrics.vwapReason).toContain("买方向B 腿");
    expect(result.metrics.vwapReason).toContain("5000");
  });

  test("one invalid direction fails its own metric but leaves the other intact", () => {
    const result = build(
      [{ price: 100, quantity: Number.MAX_VALUE }],
      [{ price: 50, quantity: 100 }],
      { bidsA: [{ price: 99, quantity: 100 }], asksB: [{ price: 51, quantity: 200 }] },
    );
    expect(result.status).toBe("ready");
    expect(result.buy.error).not.toBeNull();
    expect(result.metrics.best).toBeNull();
    expect(result.metrics.bestReason).toContain("买方向");
    expect(result.metrics.vwap).toBeNull();
    expect(result.metrics.vwapReason).toContain("买方向");
    expect(result.metrics.vwapNotionalUsdt).toBe(5000);
    // The sell side had usable depth, so its own raw levels stay published.
    expect(result.sell.levels).toHaveLength(1);
  });

  test("an empty direction leaves metrics null with an explanation instead of NaN", () => {
    const result = build([{ price: 100, quantity: 100 }], [], { bidsA: [], asksB: [] });
    expect(result.status).toBe("ready");
    expect(result.buy.levels).toEqual([]);
    expect(result.sell.levels).toEqual([]);
    // Nothing is tradable, so no metric is published — but each slot still
    // explains itself rather than emitting NaN or a zero.
    expect(result.metrics.best).toBeNull();
    expect(result.metrics.vwap).toBeNull();
    for (const reason of [result.metrics.bestReason, result.metrics.vwapReason]) {
      expect(typeof reason).toBe("string");
      expect(reason?.length).toBeGreaterThan(0);
      expect(reason).not.toContain("NaN");
      expect(reason).not.toContain("Infinity");
    }
    // The buy leg's B side has no depth at all, so its own label surfaces.
    expect(result.metrics.vwapReason).toContain("深度不足");
    expect(result.metrics.vwapReason).toContain("买方向");
  });

  test("every unusable result publishes null metrics, a reason and the fixed budget", () => {
    const cases: CombinationBookResult[] = [
      buildCombinationOrderBook({
        targetA: TARGET_A,
        targetB: { ...TARGET_B, quoteAsset: "BTC", id: "spot:Gate.io:BTC_BTC", rawSymbol: "BTC_BTC" },
        stateA: state({ asks: [{ price: 100, quantity: 100 }], bids: [{ price: 99, quantity: 100 }] }, TARGET_A),
        stateB: state({ asks: [{ price: 51, quantity: 100 }], bids: [{ price: 50, quantity: 100 }] }, TARGET_B),
        mode: "spread",
        nowMs: NOW,
      }),
      build([{ price: 100, quantity: 100 }], [{ price: 50, quantity: 100 }], {
        stateB: state({ asks: [{ price: 51, quantity: 100 }], bids: [{ price: 50, quantity: 100 }] }, TARGET_B, { status: "stale" }),
      }),
      build([{ price: 100, quantity: 100 }], [{ price: 50, quantity: 100 }], {
        stateA: state({ asks: [{ price: 100, quantity: 100 }], bids: [{ price: 99, quantity: 100 }] }, TARGET_A, {
          receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS - 1,
        }),
      }),
      buildCombinationOrderBook({
        targetA: TARGET_A,
        targetB: TARGET_B,
        stateA: state({ asks: [{ price: 100, quantity: 100 }], bids: [{ price: 99, quantity: 100 }] }, TARGET_A),
        stateB: state({ asks: [{ price: 51, quantity: 100 }], bids: [{ price: 50, quantity: 100 }] }, TARGET_B, {
          receivedAtMs: NOW - COMBINATION_MAX_SKEW_MS - 1,
        }),
        mode: "spread",
        nowMs: NOW,
      }),
    ];
    expect(cases.map((entry) => entry.status)).toEqual(["unsupported", "unavailable", "unavailable", "unavailable"]);
    for (const entry of cases) {
      expect(entry.metrics.best).toBeNull();
      expect(entry.metrics.vwap).toBeNull();
      expect(entry.metrics.vwapNotionalUsdt).toBe(5000);
      expect(typeof entry.metrics.bestReason).toBe("string");
      expect(typeof entry.metrics.vwapReason).toBe("string");
      expect(entry.metrics.bestReason?.length).toBeGreaterThan(0);
      expect(entry.metrics.vwapReason?.length).toBeGreaterThan(0);
    }
  });

  test("extreme-but-finite inputs never publish NaN or Infinity", () => {
    // buy = 1e308 - 1, sell = 1 - 1e308: each value is finite, the difference
    // overflows, so the metric is withheld rather than shown as Infinity.
    const result = build(
      [{ price: 1e308, quantity: 1 }],
      [{ price: 1, quantity: 1e4 }],
      { bidsA: [{ price: 1, quantity: 1e4 }], asksB: [{ price: 1e308, quantity: 1 }] },
    );
    expect(result.status).toBe("ready");
    expect(result.buy.levels[0].value).toBe(1e308);
    expect(result.sell.levels[0].value).toBe(-1e308);
    expect(result.metrics.best).toBeNull();
    expect(result.metrics.bestReason).toContain("非有限");
    expect(result.metrics.vwap).toBeNull();
    expect(result.metrics.vwapReason).toContain("非有限");

    const metric = result.metrics.vwap;
    expect(metric === null || (Number.isFinite(metric.difference) && Number.isFinite(metric.buyValue))).toBe(true);
    if (result.metrics.best !== null) {
      const flat = finiteMetric(result.metrics.best);
      for (const value of [flat.buyValue, flat.sellValue, flat.difference]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(flat.percent === null || Number.isFinite(flat.percent)).toBe(true);
    }
  });

  test("degenerate subnormal depth still yields finite, non-NaN metrics", () => {
    // Number.MIN_VALUE price is the smallest positive double; the level survives
    // the notional guard, so the published numbers must stay finite even though
    // the value rounds to -1.
    const result = build(
      [{ price: Number.MIN_VALUE, quantity: 1 }],
      [{ price: 1, quantity: 1e4 }],
      { bidsA: [{ price: 1, quantity: 1e4 }], asksB: [{ price: 1, quantity: 1e4 }] },
    );
    expect(result.status).toBe("ready");
    expect(result.metrics.best).not.toBeNull();
    expect(Number.isFinite(result.metrics.best?.difference ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(result.metrics.best?.buyValue ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(result.metrics.best?.sellValue ?? Number.NaN)).toBe(true);
    const percent = result.metrics.best?.percent ?? null;
    expect(percent === null || Number.isFinite(percent)).toBe(true);
    for (const reason of [result.metrics.bestReason, result.metrics.vwapReason]) {
      expect(reason === null || typeof reason === "string").toBe(true);
      expect(reason ?? "").not.toContain("NaN");
      expect(reason ?? "").not.toContain("Infinity");
    }
  });

  test("an overflowing midpoint keeps the finite difference and nulls percent only", () => {
    // 1e308 - 1e308 = 0 is finite, but (1e308 + 1e308) overflows to Infinity, so
    // the denominator is unusable and percent must be withheld.
    const result = build(
      [{ price: 1e308, quantity: 1 }],
      [{ price: 1, quantity: 1 }],
      { bidsA: [{ price: 1e308, quantity: 1 }], asksB: [{ price: 1, quantity: 1 }] },
    );
    expect(result.metrics.best).not.toBeNull();
    expect(result.metrics.best?.difference).toBe(0);
    expect(result.metrics.best?.percent).toBeNull();
    expect(result.metrics.bestReason).toBeNull();
    expect(Number.isFinite(result.metrics.best?.buyValue ?? Number.NaN)).toBe(true);
  });
});

/** One-leg fixture: a full book (both sides) for a chosen target. */
function legMetrics(
  book: NormalizedOrderBook,
  options: FrameOptions & {
    target?: BookTarget;
    label?: "A" | "B";
    state?: BookSessionState;
    nowMs?: number;
    status?: BookSessionStatus;
    vwapNotionalUsdt?: number;
  } = {},
) {
  const target = options.target ?? TARGET_A;
  return buildLegOrderBookMetrics({
    target,
    state: options.state ?? state(book, target, options),
    nowMs: options.nowMs ?? NOW,
    label: options.label,
    vwapNotionalUsdt: options.vwapNotionalUsdt,
  });
}

function legBook(bid: number, ask: number, quantity = 100_000): NormalizedOrderBook {
  return { bids: [{ price: bid, quantity }], asks: [{ price: ask, quantity }] };
}

describe("buildLegOrderBookMetrics", () => {
  test("best uses the top ask and bid with a signed ask-minus-bid difference", () => {
    const metrics = legMetrics({
      bids: [{ price: 99.5, quantity: 10 }, { price: 99, quantity: 10 }],
      asks: [{ price: 100.5, quantity: 10 }, { price: 101, quantity: 10 }],
    });
    expect(metrics.bestReason).toBeNull();
    expect(metrics.best).toEqual({
      buyValue: 100.5,
      sellValue: 99.5,
      difference: 1,
      // 1 / abs((100.5 + 99.5) / 2) * 100
      percent: (1 / 100) * 100,
    });
    expect(metrics.vwapNotionalUsdt).toBe(5000);
  });

  test("crossed book yields a negative best difference that is never abs()ed", () => {
    const metrics = legMetrics({ bids: [{ price: 101, quantity: 10_000 }], asks: [{ price: 100, quantity: 10_000 }] });
    expect(metrics.best).not.toBeNull();
    expect(metrics.best?.buyValue).toBe(100);
    expect(metrics.best?.sellValue).toBe(101);
    expect(metrics.best?.difference).toBe(-1);
    expect(metrics.best?.percent).toBeCloseTo((-1 / 100.5) * 100, 12);
    expect(metrics.best?.percent).toBeLessThan(0);
  });

  test("a zero midpoint is unreachable with positive prices, so percent only nulls on overflow", () => {
    // ask and bid must both be positive, so ask + bid is always > 0 and the only
    // way to lose the percent denominator is an overflowing midpoint.
    const normal = legMetrics(legBook(50, 150));
    expect(normal.best?.buyValue).toBe(150);
    expect(normal.best?.sellValue).toBe(50);
    expect(normal.best?.difference).toBe(100);
    // midpoint = |(150 + 50) / 2| = 100
    expect(normal.best?.percent).toBe(100);

    const flat = legMetrics(legBook(100, 100));
    expect(flat.best?.difference).toBe(0);
    expect(flat.best?.percent).toBe(0);
  });

  test("vwap reads full depth on each side and pairs ask vwap against bid vwap", () => {
    // Asks ascending: 3000 USDT at 100 then more at 200. Bids descending: 1000
    // USDT at 99 then more at 98. Both sides must consume two levels.
    const book: NormalizedOrderBook = {
      asks: [{ price: 100, quantity: 30 }, { price: 200, quantity: 100 }],
      bids: [{ price: 99, quantity: 10.101010101010102 }, { price: 98, quantity: 100 }],
    };
    const metrics = legMetrics(book);
    const askVwap = expectedLegVwap([[100, 30], [200, 100]], 5000);
    const bidVwap = expectedLegVwap([[99, 10.101010101010102], [98, 100]], 5000);
    expect(askVwap).toBeCloseTo(5000 / 40, 12);
    expect(bidVwap).toBeGreaterThan(98);
    expect(bidVwap).toBeLessThan(99);
    expect(metrics.vwap).not.toBeNull();
    expect(metrics.vwap?.buyValue).toBeCloseTo(askVwap, 12);
    expect(metrics.vwap?.sellValue).toBeCloseTo(bidVwap, 12);
    // difference = askVwap - bidVwap, exactly the leg's own two readings.
    expect(metrics.vwap?.difference).toBeCloseTo(askVwap - bidVwap, 12);
  });

  test("the final level fills partially on each side of a single leg", () => {
    const book: NormalizedOrderBook = {
      // asks ascending: 4000 then 200/base -> 40 + 5 base = 45
      asks: [{ price: 100, quantity: 40 }, { price: 200, quantity: 100 }],
      // bids descending: 4000 then 50/base -> 40 + 20 base = 60
      bids: [{ price: 100, quantity: 40 }, { price: 50, quantity: 100 }],
    };
    const metrics = legMetrics(book);
    expect(metrics.vwap?.buyValue).toBeCloseTo(5000 / 45, 12);
    expect(metrics.vwap?.sellValue).toBeCloseTo(5000 / 60, 12);
    expect(metrics.vwap?.difference).toBeCloseTo(5000 / 45 - 5000 / 60, 12);
  });

  test("vwap reads depth past the five-segment display window", () => {
    const asks = Array.from({ length: 8 }, (_, index) => ({ price: 100 + index, quantity: 9 }));
    const bids = Array.from({ length: 8 }, (_, index) => ({ price: 100 - index, quantity: 9 }));
    const metrics = legMetrics({ asks, bids });
    expect(metrics.vwap?.buyValue).toBeCloseTo(
      expectedLegVwap(asks.map((level) => [level.price, level.quantity] as [number, number]), 5000),
      12,
    );
    expect(metrics.vwap?.sellValue).toBeCloseTo(
      expectedLegVwap(bids.map((level) => [level.price, level.quantity] as [number, number]), 5000),
      12,
    );
  });

  test("a book too shallow for 5000 keeps best but withholds vwap with a leg-labelled reason", () => {
    const metrics = legMetrics(legBook(99, 100, 10), { label: "B" });
    expect(metrics.best).not.toBeNull();
    expect(metrics.best?.difference).toBe(1);
    expect(metrics.bestReason).toBeNull();
    expect(metrics.vwap).toBeNull();
    expect(metrics.vwapReason).toContain("B 腿");
    expect(metrics.vwapReason).toContain("深度不足");
    expect(metrics.vwapNotionalUsdt).toBe(5000);
  });

  test("only the ask side being shallow blocks vwap while best survives", () => {
    const metrics = legMetrics({
      asks: [{ price: 100, quantity: 1 }],
      bids: [{ price: 99, quantity: 100_000 }],
    });
    expect(metrics.best?.difference).toBe(1);
    expect(metrics.vwap).toBeNull();
    expect(metrics.vwapReason).toContain("卖盘");
    expect(metrics.vwapReason).toContain("深度不足");
  });

  test("only the bid side being shallow blocks vwap while best survives", () => {
    const metrics = legMetrics({
      asks: [{ price: 100, quantity: 100_000 }],
      bids: [{ price: 99, quantity: 1 }],
    });
    expect(metrics.best?.difference).toBe(1);
    expect(metrics.vwap).toBeNull();
    expect(metrics.vwapReason).toContain("买盘");
  });

  for (const status of ["stale", "connecting", "error", "idle", "closed"] as const) {
    test(`a ${status} leg publishes no metrics and names itself`, () => {
      for (const label of ["A", "B"] as const) {
        const metrics = legMetrics(legBook(99, 100), { status, label });
        expect(metrics.best).toBeNull();
        expect(metrics.vwap).toBeNull();
        expect(metrics.bestReason).toContain(`${label} 腿`);
        expect(metrics.vwapReason).toContain(`${label} 腿`);
        expect(metrics.vwapNotionalUsdt).toBe(5000);
      }
    });
  }

  test("label defaults to A and every rejection carries it", () => {
    const metrics = legMetrics(legBook(99, 100), { status: "stale" });
    expect(metrics.bestReason).toContain("A 腿");
    expect(metrics.vwapReason).toContain("A 腿");
  });

  test("each leg is independent: one stale leg leaves the other computable", () => {
    const staleState = state(legBook(99, 100), TARGET_B, { status: "stale" });
    const staleB = legMetrics(legBook(99, 100), { target: TARGET_B, label: "B", state: staleState });
    const liveA = legMetrics(legBook(49, 50), { label: "A" });
    expect(staleB.best).toBeNull();
    expect(staleB.vwap).toBeNull();
    expect(liveA.best).not.toBeNull();
    expect(liveA.vwap).not.toBeNull();
    // The stale leg's numbers are not borrowed from the live one.
    expect(liveA.best?.buyValue).toBe(50);
    expect(liveA.best?.sellValue).toBe(49);
  });

  test("frame identity and quantity unit are enforced per leg", () => {
    const cases: FrameOptions[] = [
      { targetId: "spot:Gate.io:BTC_USDT" },
      { baseAsset: "ETH" },
      { quantityUnit: "quote" },
    ];
    for (const options of cases) {
      const metrics = legMetrics(legBook(99, 100), options);
      expect(metrics.best).toBeNull();
      expect(metrics.bestReason).toContain("A 腿");
      expect(metrics.vwap).toBeNull();
    }
  });

  test("future, stale and invalid clocks fail closed", () => {
    const future = legMetrics(legBook(99, 100), { receivedAtMs: NOW + 1 });
    expect(future.best).toBeNull();
    expect(future.bestReason).toContain("晚于当前时间");

    const stale = legMetrics(legBook(99, 100), {
      receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS - 1,
    });
    expect(stale.best).toBeNull();
    expect(stale.bestReason).toContain("过期");

    const badClock = legMetrics(legBook(99, 100), { nowMs: Number.NaN });
    expect(badClock.best).toBeNull();
    expect(badClock.vwap).toBeNull();
    expect(badClock.bestReason).toContain("时间");

    // The same budget edge as the combination: exactly at the limit is usable.
    const boundary = legMetrics(legBook(99, 100), {
      receivedAtMs: NOW - COMBINATION_MAX_FRAME_AGE_MS,
    });
    expect(boundary.best).not.toBeNull();
  });

  test("a target-less leg is unavailable", () => {
    const metrics = buildLegOrderBookMetrics({
      target: null,
      state: state(legBook(99, 100), TARGET_A),
      nowMs: NOW,
      label: "B",
    });
    expect(metrics.best).toBeNull();
    expect(metrics.vwap).toBeNull();
    expect(metrics.bestReason).toContain("B 腿");
    expect(metrics.bestReason).toContain("未选择市场");
  });

  test("one empty side keeps best null with its own reason while vwap is also blocked", () => {
    const noBids: NormalizedOrderBook = { bids: [], asks: [{ price: 100, quantity: 100_000 }] };
    const metrics = legMetrics(noBids);
    expect(metrics.best).toBeNull();
    expect(metrics.bestReason).toContain("买盘没有可用档位");
    expect(metrics.vwap).toBeNull();
    expect(metrics.vwapReason).toContain("买盘");

    const empty = legMetrics({ bids: [], asks: [] });
    expect(empty.best).toBeNull();
    expect(empty.vwap).toBeNull();
    expect(empty.bestReason).toContain("卖盘没有可用档位");
    expect(empty.bestReason).toContain("买盘没有可用档位");
  });

  test("invalid source levels fail the side rather than publishing a partial metric", () => {
    const bad: NormalizedOrderBook["asks"] = [
      { price: 0, quantity: 1 },
      { price: -1, quantity: 1 },
      { price: 10, quantity: 0 },
      { price: 10, quantity: Number.NaN },
      { price: Number.MAX_VALUE, quantity: Number.MAX_VALUE },
    ];
    for (const level of bad) {
      const metrics = legMetrics({ bids: [{ price: 99, quantity: 100_000 }], asks: [level] });
      expect(metrics.best).toBeNull();
      expect(metrics.vwap).toBeNull();
      expect(metrics.bestReason).toContain("卖盘");
      expect(metrics.vwapReason).not.toBeNull();
    }
  });

  test("a non-USD leg is fully computable in its own quote currency", () => {
    const btcQuote: BookTarget = {
      ...TARGET_A,
      id: "spot:Binance:BTCBTC",
      rawSymbol: "BTCBTC",
      quoteAsset: "BTC",
    };
    const metrics = legMetrics(legBook(0.4, 0.41), { target: btcQuote, label: "B" });
    expect(metrics.best).not.toBeNull();
    expect(metrics.best?.buyValue).toBe(0.41);
    expect(metrics.best?.sellValue).toBe(0.4);
    expect(metrics.best?.difference).toBeCloseTo(0.01, 12);
    expect(metrics.vwap).not.toBeNull();
    expect(metrics.vwap?.buyValue).toBeCloseTo(0.41, 12);
    expect(metrics.vwap?.sellValue).toBeCloseTo(0.4, 12);
    expect(metrics.vwapNotionalUsdt).toBe(5000);

    // A non-USD quote never needs a conversion, so a quote like ETH works too.
    const ethQuote: BookTarget = { ...btcQuote, quoteAsset: "ETH", id: "spot:Binance:BTCETH", rawSymbol: "BTCETH" };
    expect(legMetrics(legBook(2, 2.1), { target: ethQuote }).best?.difference).toBeCloseTo(0.1, 12);
  });

  test("extreme but finite leg depth never publishes NaN or Infinity", () => {
    const huge = legMetrics({
      asks: [{ price: 1e308, quantity: 1 }],
      bids: [{ price: 1e308, quantity: 1 }],
    });
    expect(huge.best).not.toBeNull();
    expect(huge.best?.difference).toBe(0);
    expect(Number.isFinite(huge.best?.buyValue ?? Number.NaN)).toBe(true);
    // (1e308 + 1e308) overflows, so the midpoint denominator is unusable and the
    // percentage is withheld while the finite difference stays published.
    expect(huge.best?.percent).toBeNull();
    // One level at 1e308 is deep enough (1e308 quote) for the 5000 budget, and
    // the resulting vwap stays finite rather than overflowing to Infinity.
    expect(huge.vwap).not.toBeNull();
    expect(Number.isFinite(huge.vwap?.buyValue ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(huge.vwap?.difference ?? Number.NaN)).toBe(true);
    expect(huge.vwapReason).toBeNull();

    const tiny = legMetrics({
      asks: [{ price: Number.MIN_VALUE, quantity: 1 }],
      bids: [{ price: Number.MIN_VALUE, quantity: 1 }],
    });
    expect(tiny.best === null || Number.isFinite(tiny.best.difference)).toBe(true);
    expect(tiny.vwap === null || Number.isFinite(tiny.vwap.difference)).toBe(true);
    for (const reason of [tiny.bestReason, tiny.vwapReason]) {
      expect(reason ?? "").not.toContain("NaN");
      expect(reason ?? "").not.toContain("Infinity");
    }
  });
});

/** Independent restatement of the additive percent for a two-leg combination. */
function legPercent(asks: NormalizedOrderBook["asks"], bids: NormalizedOrderBook["bids"]): number {
  const ask = Math.min(...asks.map((level) => level.price));
  const bid = Math.max(...bids.map((level) => level.price));
  return ((ask - bid) / Math.abs((ask + bid) / 2)) * 100;
}

/** Same additive percent, but computed through the single-leg API. */
function legPercentFromApi(
  book: NormalizedOrderBook,
  target: BookTarget,
  budget: number | undefined,
  label: "A" | "B",
): number | null {
  return buildLegOrderBookMetrics({
    target,
    state: state(book, target),
    nowMs: NOW,
    label,
    vwapNotionalUsdt: budget,
  }).vwap?.percent ?? null;
}

function spreadDocs() {
  const asksA = [{ price: 100, quantity: 50 }, { price: 101, quantity: 100 }];
  const bidsA = [{ price: 98, quantity: 40 }, { price: 97, quantity: 100 }];
  const bidsB = [{ price: 100, quantity: 50 }, { price: 99, quantity: 100 }];
  const asksB = [{ price: 102, quantity: 40 }, { price: 103, quantity: 100 }];
  return { asksA, bidsA, bidsB, asksB };
}

describe("combination additive percent and configurable VWAP budget", () => {
  test("spread best percent is leg A best percent plus leg B best percent", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    const result = build(asksA, bidsB, { bidsA, asksB });
    const percentA = legPercent(asksA, bidsA);
    const percentB = legPercent(asksB, bidsB);
    expect(result.metrics.best).not.toBeNull();
    expect(result.metrics.best?.percent).toBeCloseTo(percentA + percentB, 10);
    // The composite agrees with the two real single-leg API calls.
    const apiPercentA = buildLegOrderBookMetrics({
      target: TARGET_A,
      state: state({ asks: asksA, bids: bidsA }, TARGET_A),
      nowMs: NOW,
      label: "A",
    }).best?.percent;
    const apiPercentB = buildLegOrderBookMetrics({
      target: TARGET_B,
      state: state({ asks: asksB, bids: bidsB }, TARGET_B),
      nowMs: NOW,
      label: "B",
    }).best?.percent;
    expect(apiPercentA).toBeCloseTo(percentA, 12);
    expect(apiPercentB).toBeCloseTo(percentB, 12);
    expect(result.metrics.best?.percent).toBeCloseTo((apiPercentA ?? 0) + (apiPercentB ?? 0), 10);
    // Absolute readings are exactly the synthetic levels, untouched by percent.
    expect(result.metrics.best?.buyValue).toBe(100 - 100);
    expect(result.metrics.best?.sellValue).toBe(98 - 102);
    expect(result.metrics.best?.difference).toBe(0 - -4);
  });

  test("ratio best percent adds the two leg percents while difference stays the ratio spread", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    const result = build(asksA, bidsB, { bidsA, asksB, mode: "ratio" });
    const percentA = legPercent(asksA, bidsA);
    const percentB = legPercent(asksB, bidsB);
    expect(result.metrics.best).not.toBeNull();
    expect(result.metrics.best?.percent).toBeCloseTo(percentA + percentB, 10);
    expect(result.metrics.best?.buyValue).toBeCloseTo(100 / 100, 12);
    expect(result.metrics.best?.sellValue).toBeCloseTo(98 / 102, 12);
    expect(result.metrics.best?.difference).toBeCloseTo(1 - 98 / 102, 12);
  });

  test("vwap percent equals the sum of both legs' own vwap percents", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    for (const mode of ["spread", "ratio"] as const) {
      const result = build(asksA, bidsB, { bidsA, asksB, mode });
      const percentA = legPercentFromApi(
        { asks: asksA, bids: bidsA }, TARGET_A, undefined, "A",
      );
      const percentB = legPercentFromApi(
        { asks: asksB, bids: bidsB }, TARGET_B, undefined, "B",
      );
      expect(percentA).not.toBeNull();
      expect(percentB).not.toBeNull();
      expect(result.metrics.vwap).not.toBeNull();
      expect(result.metrics.vwap?.percent).toBeCloseTo((percentA ?? 0) + (percentB ?? 0), 10);
    }
  });

  test("a negative and a zero leg percent compose additively without abs()", () => {
    // A is crossed (ask below bid -> negative percent), B is flat.
    const result = build(
      [{ price: 100, quantity: 100 }],
      [{ price: 100, quantity: 100 }],
      {
        bidsA: [{ price: 102, quantity: 100 }],
        asksB: [{ price: 100, quantity: 100 }],
      },
    );
    const percentA = ((100 - 102) / Math.abs((100 + 102) / 2)) * 100;
    expect(result.metrics.best).not.toBeNull();
    expect(result.metrics.best?.percent).toBeCloseTo(percentA + 0, 12);
    expect(result.metrics.best?.percent).toBeLessThan(0);
    // The absolute spread is still the plain synthetic difference:
    // buy = 100 - 100 = 0, sell = 102 - 100 = 2, difference = 0 - 2 = -2.
    expect(result.metrics.best?.difference).toBe(-2);
  });

  test("a null leg percent nulls only the composite percent, never the readings", () => {
    // Leg A is quoted at 1e308 on both sides, so A's own midpoint overflows and
    // its best percent is null. Leg B is ordinary. The composite percent must be
    // null while every absolute field stays finite and exactly as computed.
    const result = build(
      [{ price: 1e308, quantity: 1 }],
      [{ price: 1, quantity: 10_000 }],
      { bidsA: [{ price: 1e308, quantity: 1 }], asksB: [{ price: 1, quantity: 10_000 }] },
    );
    expect(result.metrics.best).not.toBeNull();
    // buy = 1e308 - 1, sell = 1e308 - 1: both finite, difference 0.
    expect(result.metrics.best?.buyValue).toBe(1e308);
    expect(result.metrics.best?.sellValue).toBe(1e308);
    expect(result.metrics.best?.difference).toBe(0);
    expect(result.metrics.best?.percent).toBeNull();
    expect(result.metrics.bestReason).toBeNull();
  });

  test("a non-finite difference still withholds the whole best metric", () => {
    const result = build(
      [{ price: 1e308, quantity: 1 }],
      [{ price: 1, quantity: 1e4 }],
      { bidsA: [{ price: 1, quantity: 1e4 }], asksB: [{ price: 1e308, quantity: 1 }] },
    );
    // 1e308 - -1e308 overflows, so no metric at all rather than an Infinity.
    expect(result.metrics.best).toBeNull();
    expect(result.metrics.bestReason).toContain("非有限");
  });

  test("shifting the budget re-prices all four VWAP sides but never the best or the levels", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    const baseline = build(asksA, bidsB, { bidsA, asksB });
    const budgets = [1000, 3000, 5000, 10_000, 1234.5678];
    const seen = new Set<number>();
    for (const budget of budgets) {
      const result = build(asksA, bidsB, { bidsA, asksB, vwapNotionalUsdt: budget });
      expect(result.metrics.vwapNotionalUsdt).toBe(budget);
      // best and the matched levels are budget-independent.
      expect(result.metrics.best).toEqual(baseline.metrics.best);
      expect(result.buy.levels).toEqual(baseline.buy.levels);
      expect(result.sell.levels).toEqual(baseline.sell.levels);
      if (result.metrics.vwap !== null) {
        seen.add(result.metrics.vwap.buyValue);
        expect(Number.isFinite(result.metrics.vwap.percent ?? Number.NaN)).toBe(true);
      }
    }
    // At least two distinct budgets must produce distinct VWAP prices, proving
    // the budget actually reaches all four leg valuations.
    expect(seen.size).toBeGreaterThan(1);
  });

  test("each budget produces the exact four-leg VWAP arithmetic", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    for (const budget of [1000, 3000, 5000, 10_000, 1234.5678]) {
      const result = build(asksA, bidsB, { bidsA, asksB, vwapNotionalUsdt: budget });
      const buyA = expectedLegVwap(asksA.map((l) => [l.price, l.quantity] as [number, number]), budget);
      const buyB = expectedLegVwap(bidsB.map((l) => [l.price, l.quantity] as [number, number]), budget);
      const sellA = expectedLegVwap(bidsA.map((l) => [l.price, l.quantity] as [number, number]), budget);
      const sellB = expectedLegVwap(asksB.map((l) => [l.price, l.quantity] as [number, number]), budget);
      expect(result.metrics.vwap).not.toBeNull();
      expect(result.metrics.vwap?.buyValue).toBeCloseTo(buyA - buyB, 10);
      expect(result.metrics.vwap?.sellValue).toBeCloseTo(sellA - sellB, 10);
      expect(result.metrics.vwap?.difference).toBeCloseTo((buyA - buyB) - (sellA - sellB), 10);
      // And the additive percent matches the two single-leg calls at that budget.
      const percentA = legPercentFromApi({ asks: asksA, bids: bidsA }, TARGET_A, budget, "A");
      const percentB = legPercentFromApi({ asks: asksB, bids: bidsB }, TARGET_B, budget, "B");
      expect(result.metrics.vwap?.percent).toBeCloseTo((percentA ?? 0) + (percentB ?? 0), 10);
    }
  });

  test("budget changes move the depth threshold for the VWAP only", () => {
    // A book with 2000 quote per side: enough for a 1000 budget, not for 3000.
    const book = { asks: [{ price: 100, quantity: 20 }], bids: [{ price: 99, quantity: 20 }] };
    const short = legMetrics(book, { vwapNotionalUsdt: 3000 });
    expect(short.best).not.toBeNull();
    expect(short.vwap).toBeNull();
    expect(short.vwapReason).toContain("深度不足");
    expect(short.vwapNotionalUsdt).toBe(3000);

    const enough = legMetrics(book, { vwapNotionalUsdt: 1000 });
    expect(enough.vwap).not.toBeNull();
    expect(enough.best).toEqual(short.best);
  });

  for (const [label, budget] of [
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ] as const) {
    test(`an invalid ${label} budget only withholds the VWAP`, () => {
      const { asksA, bidsA, bidsB, asksB } = spreadDocs();
      const result = build(asksA, bidsB, { bidsA, asksB, vwapNotionalUsdt: budget });
      expect(result.status).toBe("ready");
      expect(result.metrics.vwap).toBeNull();
      expect(result.metrics.vwapReason).toContain("预算");
      // best and the levels are untouched, and the additive best percent works.
      expect(result.metrics.best).not.toBeNull();
      expect(result.metrics.best?.percent).toBeCloseTo(
        legPercent(asksA, bidsA) + legPercent(asksB, bidsB),
        10,
      );
      expect(result.buy.levels.length).toBeGreaterThan(0);
      // The echoed budget stays a usable number so UI copy/formatters never see
      // NaN/Infinity/-1; the rejection itself is carried by the VWAP reason.
      expect(result.metrics.vwapNotionalUsdt).toBe(COMBINATION_VWAP_NOTIONAL_USDT);

      const leg = legMetrics(legBook(99, 100), { vwapNotionalUsdt: budget });
      expect(leg.best).not.toBeNull();
      expect(leg.vwap).toBeNull();
      expect(leg.vwapReason).toContain("预算");
    });
  }

  test("unavailable and unsupported results still echo the selected budget", () => {
    const stale = build([{ price: 100, quantity: 100 }], [{ price: 50, quantity: 100 }], {
      vwapNotionalUsdt: 2500,
      stateB: state(legBook(50, 51), TARGET_B, { status: "stale" }),
    });
    expect(stale.status).toBe("unavailable");
    expect(stale.metrics.vwapNotionalUsdt).toBe(2500);
    expect(stale.metrics.best).toBeNull();
    expect(stale.metrics.vwap).toBeNull();

    const unsupported = buildCombinationOrderBook({
      targetA: TARGET_A,
      targetB: { ...TARGET_B, quoteAsset: "BTC", id: "spot:Gate.io:BTC_BTC", rawSymbol: "BTC_BTC" },
      stateA: state(legBook(99, 100), TARGET_A),
      stateB: state(legBook(50, 51), TARGET_B),
      mode: "spread",
      nowMs: NOW,
      vwapNotionalUsdt: 777,
    });
    expect(unsupported.status).toBe("unsupported");
    expect(unsupported.metrics.vwapNotionalUsdt).toBe(777);

    // A stale single leg keeps its own budget too.
    const staleLeg = legMetrics(legBook(99, 100), { status: "stale", vwapNotionalUsdt: 4321 });
    expect(staleLeg.best).toBeNull();
    expect(staleLeg.vwapNotionalUsdt).toBe(4321);
  });

  test("an invalid budget on an unavailable result cannot echo an invalid number", () => {
    const result = build([{ price: 100, quantity: 100 }], [{ price: 50, quantity: 100 }], {
      vwapNotionalUsdt: -5,
      stateB: state(legBook(50, 51), TARGET_B, { status: "stale" }),
    });
    expect(result.status).toBe("unavailable");
    // The echoed budget stays the documented default so UI copy never shows -5.
    expect(result.metrics.vwapNotionalUsdt).toBe(COMBINATION_VWAP_NOTIONAL_USDT);
  });

  test("a custom maxFrameAgeMs is honoured and never re-clamped to 20s", () => {
    const { asksA, bidsA, bidsB, asksB } = spreadDocs();
    const receivedAtMs = NOW - 60_000;
    const result = buildCombinationOrderBook({
      targetA: TARGET_A,
      targetB: TARGET_B,
      stateA: state({ asks: asksA, bids: bidsA }, TARGET_A, { receivedAtMs }),
      stateB: state({ asks: asksB, bids: bidsB }, TARGET_B, { receivedAtMs }),
      mode: "spread",
      nowMs: NOW,
      maxFrameAgeMs: 120_000,
    });
    expect(result.status).toBe("ready");
    expect(result.metrics.best).not.toBeNull();
    expect(result.metrics.vwap).not.toBeNull();
  });
});
