import { describe, expect, test } from "bun:test";
import {
  COMBINATION_MAX_FRAME_AGE_MS,
  COMBINATION_MAX_SKEW_MS,
  buildCombinationOrderBook,
  type CombinationBookMode,
  type CombinationBookResult,
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
  } = {},
): CombinationBookResult {
  return buildCombinationOrderBook({
    targetA: TARGET_A,
    targetB: TARGET_B,
    stateA: extra.stateA ?? state({ asks: asksA, bids: extra.bidsA ?? asksA }, TARGET_A),
    stateB: extra.stateB ?? state({ asks: extra.asksB ?? bidsB, bids: bidsB }, TARGET_B),
    mode: extra.mode ?? "spread",
    nowMs: NOW,
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
