import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookFrame, BookSessionState, BookTarget, NormalizedOrderBook } from "@/lib/order-book/types";
import { BookError } from "@/lib/order-book/types";
import LiveOrderBookPanel from "./LiveOrderBookPanel";
import CombinationOrderBookPanel, {
  EMPTY_COMBINATION_PREFERENCE,
  combinationPreferenceKey,
  displayLevels,
  formatCombinationValue,
  formatUsdt,
  isFallbackNotice,
  legBookRows,
  legsSkewMs,
  legTiming,
  levelQuoteAmount,
  modeLabel,
  preferenceForCombinationChange,
  resolveLiveClock,
  shouldShowCombinationToggle,
} from "./CombinationOrderBookPanel";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

const TARGET_A: BookTarget = {
  id: "spot:Binance:BTCUSDT",
  exchange: "Binance",
  kind: "spot",
  rawSymbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
};
const TARGET_B: BookTarget = {
  id: "spot:Gate.io:BTC_USDT",
  exchange: "Gate.io",
  kind: "spot",
  rawSymbol: "BTC_USDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
};

const BOOK_A: NormalizedOrderBook = {
  asks: [{ price: 101, quantity: 1 }, { price: 102, quantity: 2 }, { price: 103, quantity: 1 }],
  bids: [{ price: 100, quantity: 1 }, { price: 99, quantity: 2 }, { price: 98, quantity: 1 }],
};
const BOOK_B: NormalizedOrderBook = {
  bids: [{ price: 100, quantity: 1 }, { price: 99, quantity: 3 }],
  asks: [{ price: 101, quantity: 2 }, { price: 102, quantity: 1 }],
};

function frame(book: NormalizedOrderBook, target: BookTarget, receivedAtMs = NOW): BookFrame {
  return {
    targetId: target.id,
    book,
    quantityUnit: "base",
    baseAsset: target.baseAsset,
    source: { transport: "rest", bookMode: "normal", route: "test" },
    exchangeTimeMs: null,
    receivedAtMs,
    sequence: null,
  };
}

function state(
  book: NormalizedOrderBook | null,
  target: BookTarget,
  overrides: Partial<BookSessionState> = {},
  receivedAtMs = NOW,
): BookSessionState {
  return {
    requested: { transport: "rest", bookMode: "normal" },
    attempt: { transport: "rest", bookMode: "normal" },
    frame: book === null ? null : frame(book, target, receivedAtMs),
    status: book === null ? "connecting" : "live",
    notices: [],
    error: null,
    updated: book === null ? null : receivedAtMs,
    ...overrides,
  };
}

function panel(options: {
  mode?: "spread" | "ratio";
  stateA?: BookSessionState;
  stateB?: BookSessionState;
  targetA?: BookTarget | null;
  targetB?: BookTarget | null;
  wsMode?: boolean;
  nowMs?: number;
} = {}) {
  return renderToStaticMarkup(createElement(CombinationOrderBookPanel, {
    mode: options.mode ?? "spread",
    labelA: "Binance BTC/USDT",
    labelB: "Gate.io BTC/USDT",
    targetA: options.targetA === undefined ? TARGET_A : options.targetA,
    targetB: options.targetB === undefined ? TARGET_B : options.targetB,
    stateA: options.stateA ?? state(BOOK_A, TARGET_A),
    stateB: options.stateB ?? state(BOOK_B, TARGET_B),
    wsMode: options.wsMode ?? false,
    onWsModeChange: () => {},
    nowMs: options.nowMs ?? NOW,
  }));
}

interface ParsedTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

const plainText = (html: string) => html
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-zA-Z#0-9]+;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function tables(markup: string): ParsedTable[] {
  return [...markup.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((match) => {
    const body = match[1];
    const caption = plainText(body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/)?.[1] ?? "");
    const head = body.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
    const rowsHtml = body.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    return {
      caption,
      headers: [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((cell) => plainText(cell[1])),
      rows: [...rowsHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
        [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map((cell) => plainText(cell[1])),
      ),
    };
  });
}

describe("CombinationOrderBookPanel structure", () => {
  test("lays out A leg, the wider combined book, then B leg in that DOM order", () => {
    const markup = panel();
    const a = markup.indexOf('aria-label="A 腿实时盘口"');
    const middle = markup.indexOf('aria-label="中间合成盘口"');
    const b = markup.indexOf('aria-label="B 腿实时盘口"');
    expect(a).toBeGreaterThan(-1);
    expect(middle).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(middle);
    // A before B is preserved on narrow screens by scrollable, not reordered, tables.
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.85fr)]");
  });

  test("side books use seven columns in quote/base/price/rank/price/base/quote order", () => {
    const parsed = tables(panel());
    // DOM order is A leg, the combined block (buy then sell), then B leg.
    const legTables = [parsed[0], parsed[3]];
    for (const leg of legTables) {
      expect(leg.rows).toHaveLength(5);
      expect(leg.rows.every((row) => row.length === 7)).toBe(true);
      // Rank stays the fourth column, always ascending 1..5 on the side books.
      expect(leg.rows.map((row) => row[3])).toEqual(["1", "2", "3", "4", "5"]);
    }
    expect(legTables[0].headers).toEqual([
      "量（USDT）", "量（BTC）", "买价", "档", "卖价", "量（BTC）", "量（USDT）",
    ]);
    expect(legTables[0].caption).toContain("数量为基础币 BTC");
    expect(legTables[0].caption).toContain("USDT（该档价格 × 数量，非累计）");
  });

  test("per-level quote amount is price × quantity, not a running cumulative", () => {
    const parsed = tables(panel());
    // BOOK_A bids: 100×1, 99×2, 98×1 — each row quotes only its own level, so
    // the quote column descends (100, 198, 98) and never accumulates.
    expect(parsed[0].rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    expect(parsed[0].rows[1]).toEqual(["198", "2", "99", "2", "102", "2", "204"]);
    expect(parsed[0].rows[2]).toEqual(["98", "1", "98", "3", "103", "1", "103"]);
    // Only the three real levels are numeric; ranks 4-5 are blank rows.
    const quoteCells = parsed[0].rows.slice(0, 3).map((row) => Number(row[0]));
    expect(quoteCells).toEqual([100, 198, 98]);
    // A cumulative column would be monotonically increasing; this deliberately is not.
    expect(quoteCells[1]).toBeGreaterThan(quoteCells[2]);
  });

  test("both quantity units come from each leg's own market, including a different quote", () => {
    const ethA = { ...TARGET_A, id: "spot:Binance:ETHUSDC", rawSymbol: "ETHUSDC", baseAsset: "ETH", quoteAsset: "USDC" };
    const ethBook: NormalizedOrderBook = {
      bids: [{ price: 2_000, quantity: 0.5 }, { price: 1_999, quantity: 1.5 }],
      asks: [{ price: 2_001, quantity: 2 }],
    };
    const markup = panel({ targetA: ethA, stateA: state(ethBook, ethA) });
    const parsed = tables(markup);
    expect(parsed[0].headers).toEqual([
      "量（USDC）", "量（ETH）", "买价", "档", "卖价", "量（ETH）", "量（USDC）",
    ]);
    // USDC leg: quote amount is 2000×0.5 = 1000, and 1999×1.5 = 2998.5.
    expect(parsed[0].rows[0]).toEqual(["1,000", "0.5", "2,000", "1", "2,001", "2", "4,002"]);
    expect(parsed[0].rows[1]).toEqual(["2,998.5", "1.5", "1,999", "2", "—", "—", "—"]);
    // The other leg keeps its own USDT/BTC identity in the same render.
    expect(parsed[3].headers).toEqual([
      "量（USDT）", "量（BTC）", "买价", "档", "卖价", "量（BTC）", "量（USDT）",
    ]);
  });

  test("missing ranks and overflowed products render dashes, not zeros or Infinity", () => {
    const uneven = state({
      bids: [{ price: 100, quantity: 1 }, { price: Number.MAX_VALUE, quantity: Number.MAX_VALUE }],
      asks: [{ price: 101, quantity: 1 }],
    }, TARGET_A);
    const parsed = tables(panel({ stateA: uneven }));
    // Bids sort descending, so the overflow level is rank 1 and 100×1 is rank 2.
    const overflowRow = parsed[0].rows[0];
    expect(overflowRow[0]).toBe("—");
    expect(overflowRow[0]).not.toContain("Infinity");
    expect(parsed[0].rows[1]).toEqual(["100", "1", "100", "2", "—", "—", "—"]);
    // Ranks 3-5 have no depth at all: price and both quantities stay dashed.
    for (const row of parsed[0].rows.slice(2)) {
      expect(row).toEqual(["—", "—", "—", row[3], "—", "—", "—"]);
    }
    expect(parsed[0].rows.map((row) => row[3])).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("legBookRows keeps rank while exposing both per-level units", () => {
    const rows = legBookRows(
      [{ price: 100, quantity: 2 }, { price: 99, quantity: 3 }],
      [{ price: 101, quantity: 1 }],
    );
    expect(rows).toEqual([
      { rank: 1, bidPrice: 100, bidQuantity: 2, bidQuote: 200, askPrice: 101, askQuantity: 1, askQuote: 101 },
      { rank: 2, bidPrice: 99, bidQuantity: 3, bidQuote: 297 },
      { rank: 3 },
      { rank: 4 },
      { rank: 5 },
    ]);
    expect(levelQuoteAmount(100, 0.5)).toBe(50);
    expect(levelQuoteAmount(Number.MAX_VALUE, Number.MAX_VALUE)).toBeUndefined();
    expect(levelQuoteAmount(Number.NaN, 1)).toBeUndefined();
    expect(levelQuoteAmount(100, 0)).toBeUndefined();
    expect(levelQuoteAmount(undefined, 1)).toBeUndefined();
  });

  test("exposes the full market name on hover when the title truncates", () => {
    const longLabel = "Binance BTC/USDT 永续 永续合约 超长市场名称";
    const markup = renderToStaticMarkup(createElement(CombinationOrderBookPanel, {
      mode: "spread",
      labelA: longLabel,
      labelB: "Gate.io BTC/USDT",
      targetA: TARGET_A,
      targetB: TARGET_B,
      stateA: state(BOOK_A, TARGET_A),
      stateB: state(BOOK_B, TARGET_B),
      wsMode: false,
      onWsModeChange: () => {},
      nowMs: NOW,
    }));
    expect(markup).toContain(`title="${longLabel}"`);
    expect(markup).toContain("truncate");
  });

  test("only the market name truncates, so the A/B marker and kind stay readable", () => {
    const markup = panel();
    // The side marker must not shrink, and the kind badge stays outside the h4.
    expect(markup).toContain("shrink-0 text-indigo-300");
    expect(markup).toContain("truncate text-gray-400");
    expect(markup).not.toMatch(/<h4 class="min-w-0 truncate/);
  });

  test("labels every direction with its explicit execution legs", () => {
    const markup = panel();
    expect(markup).toContain("买入组合");
    expect(markup).toContain("卖出组合");
    expect(markup).toContain("买 A 卖盘（ask）· 卖 B 买盘（bid）");
    expect(markup).toContain("卖 A 买盘（bid）· 买 B 卖盘（ask）");
    expect(markup).toContain("价差 = Aask − Bbid");
    expect(markup).toContain("价差 = Abid − Bask");
    // The board must not silently re-invert into a traditional bid/ask ladder.
    expect(markup).not.toContain("买1");
    expect(markup).not.toContain("卖1");
  });

  test("explains the raw A/B semantics in plain user wording", () => {
    const markup = panel();
    expect(markup).toContain("买入组合＝买 A、卖 B；卖出组合＝卖 A、买 B");
    expect(markup).toContain("显示原始价差/比值，不应用 β 权重");
    // No implementation jargon about ladder inversion or beta weighting internals.
    expect(markup).not.toContain("倒置");
    expect(markup).not.toContain("配对交易权重");
    expect(markup).not.toContain("原始 A/B 合成");
  });

  test("keeps the USD 1:1 note visible while the book is ready", () => {
    const markup = panel();
    expect(tables(markup)[1].rows.length).toBeGreaterThan(0);
    expect(markup).toContain("USD 计价按 1:1 折算");
    expect(markup).not.toContain("暂不支持合成盘口");
  });
});

describe("CombinationOrderBookPanel values", () => {
  test("buy lists deepest-to-best 5→4→3→2→1 while keeping each row's own rank and totals", () => {
    const parsed = tables(panel());
    const buy = parsed[1];
    expect(buy.caption).toContain("买入组合合成盘口");
    expect(buy.headers).toEqual([
      "档", "价差 A−B", "A 卖价", "B 买价", "本段 USDT", "累计 USDT",
    ]);
    // Four real segments, displayed 4→3→2→1. Each row keeps its original rank
    // and its own segment/cumulative values — only the display order reverses.
    expect(buy.rows).toEqual([
      ["4", "4", "103", "99", "92", "397"],
      ["3", "3", "102", "99", "204", "305"],
      ["2", "2", "101", "99", "1", "101"],
      ["1", "1", "101", "100", "100", "100"],
    ]);
    // The summary total is unchanged and still belongs to the full direction.
    const markup = panel();
    expect(markup).toContain("可成交 4 段 · 累计");
    expect(markup).toContain("397");
  });

  test("buy and sell differ only in display order, not in level data", () => {
    const parsed = tables(panel());
    const buy = parsed[1];
    const sell = parsed[2];
    // Buy is descending by rank; sell stays ascending.
    expect(buy.rows.map((row) => Number(row[0]))).toEqual([4, 3, 2, 1]);
    expect(sell.rows.map((row) => Number(row[0]))).toEqual([1, 2, 3, 4]);
    // Buy's best level is last and carries the smallest cumulative amount.
    expect(Number(buy.rows.at(-1)![5])).toBe(100);
    expect(Number(buy.rows[0][5])).toBe(397);
    // Sell remains cumulative-increasing top to bottom.
    expect(sell.rows.map((row) => Number(row[5]))).toEqual([100, 202, 298, 304]);
  });

  test("a shorter buy side reverses without padding or renumbering", () => {
    const shorter = panel({
      stateA: state({ asks: [{ price: 101, quantity: 1 }, { price: 102, quantity: 1 }], bids: [{ price: 100, quantity: 1 }] }, TARGET_A),
      stateB: state({ bids: [{ price: 100, quantity: 1 }], asks: [{ price: 101, quantity: 1 }] }, TARGET_B),
    });
    const buy = tables(shorter)[1];
    // B depth only matches 100 USDT, so exactly one segment exists.
    expect(buy.rows).toHaveLength(1);
    expect(buy.rows[0][0]).toBe("1");
  });

  test("sell keeps ascending order and its own cumulative total", () => {
    const sell = tables(panel())[2];
    expect(sell.caption).toContain("卖出组合合成盘口");
    expect(sell.headers).toEqual([
      "档", "价差 A−B", "A 买价", "B 卖价", "本段 USDT", "累计 USDT",
    ]);
    expect(sell.rows).toEqual([
      ["1", "-1", "100", "101", "100", "100"],
      ["2", "-2", "99", "101", "102", "202"],
      ["3", "-3", "99", "102", "96", "298"],
      ["4", "-4", "98", "102", "6", "304"],
    ]);
  });

  test("displayLevels reverses a copy and preserves original ranks", () => {
    const levels = [
      { value: 10, notionalUsdt: 100, cumulativeNotionalUsdt: 100 },
      { value: 20, notionalUsdt: 50, cumulativeNotionalUsdt: 150 },
      { value: 30, notionalUsdt: 25, cumulativeNotionalUsdt: 175 },
    ];
    const buy = displayLevels(levels, "best-last");
    expect(buy.map((row) => row.rank)).toEqual([3, 2, 1]);
    expect(buy.map((row) => row.level.value)).toEqual([30, 20, 10]);
    expect(buy.map((row) => row.level.cumulativeNotionalUsdt)).toEqual([175, 150, 100]);
    // The source array is never reversed in place.
    expect(levels.map((level) => level.value)).toEqual([10, 20, 30]);

    const sell = displayLevels(levels, "best-first");
    expect(sell.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(sell[0].level).toBe(levels[0]);
  });

  test("ratio mode divides A by B and never reuses a spread label", () => {
    const ratio = panel({
      mode: "ratio",
      stateA: state({ asks: [{ price: 110, quantity: 1 }], bids: [{ price: 100, quantity: 1 }] }, TARGET_A),
      stateB: state({ bids: [{ price: 100, quantity: 1 }], asks: [{ price: 105, quantity: 1 }] }, TARGET_B),
    });
    const parsed = tables(ratio);
    expect(parsed[1].headers).toEqual([
      "档", "比值 A/B", "A 卖价", "B 买价", "本段 USDT", "累计 USDT",
    ]);
    expect(parsed[1].rows[0]).toEqual(["1", "1.1000", "110", "100", "100", "100"]);
    expect(parsed[2].rows[0]).toEqual(["1", "0.952381", "100", "105", "100", "100"]);    expect(ratio).toContain("比值 A / B");
    expect(ratio).toContain("比值 = Aask / Bbid");
    expect(ratio).not.toContain("价差 A−B");
  });

  test("formats spread and ratio values distinctly and safely", () => {
    expect(formatCombinationValue("spread", 12.5)).toBe("12.5");
    expect(formatCombinationValue("spread", -3)).toBe("-3");
    expect(formatCombinationValue("ratio", 1.1)).toBe("1.1000");
    expect(formatCombinationValue("ratio", 0.952381)).toBe("0.952381");
    expect(formatCombinationValue("ratio", Number.NaN)).toBe("—");
    expect(formatCombinationValue("spread", undefined)).toBe("—");
    expect(modeLabel("ratio")).toBe("比值 A / B");
    expect(modeLabel("spread")).toBe("价差 A − B");
  });

  test("a tiny positive ratio or spread is never rendered as zero", () => {
    // Small-coin / large-coin pairs produce ratios far below the 4-decimal band.
    expect(formatCombinationValue("ratio", 1e-9)).toBe("1.0000e-9");
    expect(formatCombinationValue("ratio", 0.0000001234)).toBe("1.2340e-7");
    expect(formatCombinationValue("ratio", 0.0005)).toBe("0.0005");
    expect(formatCombinationValue("ratio", 0.05)).toBe("0.0500");
    expect(formatCombinationValue("spread", 1e-9)).toBe("0.000000001");
    expect(formatCombinationValue("spread", -1e-9)).toBe("-0.000000001");
    for (const value of [1e-9, 0.0000001234, 0.0005, 0.05, 1.1]) {
      expect(formatCombinationValue("ratio", value)).not.toBe("0.0000");
      expect(formatCombinationValue("ratio", value)).not.toBe("0.00");
    }
  });

  test("large magnitudes keep readable significant digits instead of exponent spam", () => {
    expect(formatCombinationValue("ratio", 12_345.678)).toBe("12,345.7");
    expect(formatCombinationValue("ratio", 1_000)).toBe("1,000");
    expect(formatCombinationValue("spread", 123_456_789)).toBe("123,456,789");
    expect(formatCombinationValue("spread", 12.5)).toBe("12.5");
  });

  test("USDT notionals keep small positives visible but stay readable", () => {
    expect(formatUsdt(100)).toBe("100");
    expect(formatUsdt(1_234.567)).toBe("1,234.57");
    expect(formatUsdt(0.0001234)).toBe("0.0001234");
    expect(formatUsdt(0.005)).toBe("0.005");
    for (const value of [0.0001234, 0.005, 0.009]) {
      expect(formatUsdt(value)).not.toBe("0.00");
      expect(formatUsdt(value)).not.toBe("0");
    }
    expect(formatUsdt(Number.NaN)).toBe("—");
    expect(formatUsdt(undefined)).toBe("—");
  });

  test("only fallback and unsupported notices count as a source downgrade", () => {
    expect(isFallbackNotice("fallback")).toBe(true);
    expect(isFallbackNotice("unsupported")).toBe(true);
    expect(isFallbackNotice("policy")).toBe(false);
  });
});

describe("CombinationOrderBookPanel fallback disclosure", () => {
  const fallbackNotice = {
    id: 1,
    code: "fallback" as const,
    reason: "network" as const,
    message: "RPI REST 不可用：连接失败；改用 普通 REST。",
    from: { transport: "rest" as const, bookMode: "rpi" as const },
    to: { transport: "rest" as const, bookMode: "normal" as const },
  };
  const policyNotice = {
    id: 3,
    code: "policy" as const,
    reason: "reality-token" as const,
    message: "rToken 使用真实普通 REST 盘口；不使用合成 BBO 数量或 RPI/WS。",
    from: { transport: "rest" as const, bookMode: "rpi" as const },
    to: { transport: "rest" as const, bookMode: "normal" as const },
  };

  test("names the A market, its reason and the actual accepted source", () => {
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A, { notices: [fallbackNotice] }),
      stateB: state(BOOK_B, TARGET_B),
    });
    expect(markup).toContain("回退提示");
    expect(markup).not.toContain("两腿均已回退");
    expect(markup).toContain("A 腿");
    expect(markup).toContain("Binance BTC/USDT");
    expect(markup).toContain(fallbackNotice.message);
    expect(markup).toContain("实际来源：普通盘口 · REST · 每5秒刷新");
  });

  test("names the B market independently when only that leg fell back", () => {
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A),
      stateB: state(BOOK_B, TARGET_B, { notices: [{ ...fallbackNotice, id: 7, message: "Gate.io WS 首帧超时；改用 REST。" }] }),
    });
    expect(markup).toContain("回退提示");
    expect(markup).toContain("B 腿");
    expect(markup).toContain("Gate.io BTC/USDT");
    expect(markup).toContain("Gate.io WS 首帧超时；改用 REST。");
  });

  test("discloses both legs at once with per-leg identity", () => {
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A, { notices: [fallbackNotice] }),
      stateB: state(BOOK_B, TARGET_B, { notices: [{ ...fallbackNotice, id: 2, message: "B 腿回退普通盘口。" }] }),
    });
    expect(markup).toContain("两腿均已回退");
    expect(markup).toContain("Binance BTC/USDT");
    expect(markup).toContain("Gate.io BTC/USDT");
  });

  test("an A policy notice plus a B fallback must not claim both legs fell back", () => {
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A, { notices: [policyNotice] }),
      stateB: state(BOOK_B, TARGET_B, { notices: [{ ...fallbackNotice, id: 4 }] }),
    });
    expect(markup).not.toContain("两腿均已回退");
    expect(markup).toContain("回退提示");
    expect(markup).toContain("数据源说明");
    // The policy leg is disclosed as a rule, and only B is called a fallback.
    expect(markup).toContain(policyNotice.message);
    expect(markup).toContain("不属于回退");
  });

  test("two policy notices are a data-source note, never a fallback", () => {
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A, { notices: [policyNotice] }),
      stateB: state(BOOK_B, TARGET_B, { notices: [{ ...policyNotice, id: 9 }] }),
    });
    expect(markup).not.toContain("回退提示");
    expect(markup).not.toContain("两腿均已回退");
    expect(markup).toContain("数据源说明");
    expect((markup.match(/不属于回退/g) ?? []).length).toBeGreaterThan(0);
  });

  test("one policy notice alone is a note, not a fallback banner", () => {
    const markup = panel({ stateA: state(BOOK_A, TARGET_A, { notices: [policyNotice] }) });
    expect(markup).not.toContain("回退提示");
    expect(markup).not.toContain("两腿均已回退");
    expect(markup).toContain("数据源说明");
  });

  test("a notice is rendered once, aggregated, instead of repeating in the leg", () => {
    const markup = panel({ stateA: state(BOOK_A, TARGET_A, { notices: [policyNotice] }) });
    expect((markup.match(/rToken 使用真实普通 REST 盘口/g) ?? []).length).toBe(1);
  });

  test("shows no fallback banner when both legs use their requested source", () => {
    const markup = panel();
    expect(markup).not.toContain("回退提示");
    expect(markup).not.toContain("两腿均已回退");
    expect(markup).not.toContain("数据源说明");
  });
});

describe("CombinationOrderBookPanel states", () => {
  test("shows a loading status while either leg is still connecting", () => {
    const markup = panel({ stateA: state(null, TARGET_A, { status: "connecting" }) });
    expect(markup).toContain("正在获取两腿盘口…");
    expect(markup).toContain("正在获取盘口…");
    expect(markup).toContain('role="status"');
  });

  test("shows the leg error without fabricating depth", () => {
    const markup = panel({
      stateB: state(null, TARGET_B, { status: "error", error: new BookError("network", "Gate.io 请求失败") }),
    });
    expect(markup).toContain("盘口暂不可用：Gate.io 请求失败");
    expect(markup).toContain("合成盘口暂不可用");
    expect(markup).toContain("B 腿盘口状态为 error，不是实时行情");
    // Leg tables stay five ranks with dashes instead of dropping rows.
    const parsed = tables(markup);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].rows).toHaveLength(5);
  });

  test("flags quotes that are not USD-pegged as unsupported with a real reason", () => {
    const markup = panel({ targetB: { ...TARGET_B, id: "spot:Gate.io:BTC_EUR", quoteAsset: "EUR" } });
    expect(markup).toContain("暂不支持合成盘口");
    expect(markup).toContain("合成盘口仅支持两腿均为 USD 计价");
    expect(markup).toContain("B=EUR");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("单腿盘口仍可分别查看");
  });

  test("a USDC leg is supported because USD-pegged quotes are 1:1", () => {
    const markup = panel({
      targetB: { ...TARGET_B, id: "spot:Gate.io:BTC_USDC", quoteAsset: "USDC" },
      stateB: state(BOOK_B, { ...TARGET_B, id: "spot:Gate.io:BTC_USDC", quoteAsset: "USDC" }),
    });
    expect(markup).not.toContain("暂不支持合成盘口");
    expect(tables(markup)[1].rows).toHaveLength(4);
  });

  test("an empty but valid book shows dashes rather than invented levels", () => {
    const empty = state({ bids: [], asks: [] }, TARGET_A);
    const markup = panel({ stateA: empty, stateB: state({ bids: [], asks: [] }, TARGET_B) });
    expect(markup).toContain("暂无可撮合深度");
    expect(tables(markup)[0].rows).toEqual(
      Array.from({ length: 5 }, (_, index) => ["—", "—", "—", String(index + 1), "—", "—", "—"]),
    );
  });

  test("a leg with a fresh frame but a stale session says so on the leg itself", () => {
    // The stream reported a problem, but the last frame is only 1s old, so the
    // side table would otherwise look live while the middle reports a status.
    const markup = panel({
      stateA: state(BOOK_A, TARGET_A, { status: "stale", error: new BookError("timeout", "A 腿超时") }),
      stateB: state(BOOK_B, TARGET_B),
    });
    expect(tables(markup)[0].rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    // Both the stale fact and the underlying reason stay visible on the leg.
    expect(markup).toContain("盘口已过期：A 腿超时");
    expect(markup).toContain("已过期");
  });

  test("a stale leg without a stored error still explains that it shows last update", () => {
    const markup = panel({ stateA: state(BOOK_A, TARGET_A, { status: "stale" }) });
    expect(markup).toContain("盘口已过期，仍显示上次更新");
  });

  test("a leg whose session errored still names the error beside its depth", () => {
    const markup = panel({
      stateB: state(BOOK_B, TARGET_B, { status: "error", error: new BookError("sequence-gap", "B 腿序号缺口") }),
    });
    expect(markup).toContain("盘口已断开：B 腿序号缺口");
    expect(markup).toContain("合成盘口暂不可用");
    // The last accepted depth stays readable rather than disappearing.
    expect(tables(markup)[1].rows[0]).toEqual(["100", "1", "100", "1", "101", "2", "202"]);
  });

  test("a clock-aged leg is flagged per leg even when both frames are recent", () => {
    const markup = panel({ nowMs: NOW + 20_001 });
    expect((markup.match(/盘口已过期，仍显示上次更新/g) ?? []).length).toBe(2);
  });

  test("expires a quiet book from the clock alone, without waiting for a new frame", () => {
    const justFresh = panel({ nowMs: NOW + 19_999 });
    expect(justFresh).not.toContain("数据已过期");
    expect(tables(justFresh)[1].rows).toHaveLength(4);

    const expired = panel({ nowMs: NOW + 20_001 });
    expect(expired).toContain("数据已过期 · 显示上次更新");
    expect(expired).toContain("合成盘口暂不可用");
    expect(expired).toContain("腿盘口已过期");
    // Last known depth stays visible instead of blanking out.
    expect(tables(expired)[0].rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
  });

  test("a frame arriving after the last tick stays ready instead of looking futuristic", () => {
    // The real bug: the tick snapshot is at the previous whole second while the
    // frame's local receipt time is inside the current one. Without a frame floor
    // the core would reject nowMs < receivedAtMs as a future frame.
    const tick = NOW + 100;
    for (const offset of [100, 900]) {
      const receivedAtMs = NOW + offset;
      const stateA = state(BOOK_A, TARGET_A, {}, receivedAtMs);
      const stateB = state(BOOK_B, TARGET_B, {}, receivedAtMs);
      const clock = resolveLiveClock({ ticking: tick, frameReference: receivedAtMs });
      expect(clock).toBe(receivedAtMs);
      expect(clock).toBeGreaterThanOrEqual(receivedAtMs);

      const markup = renderToStaticMarkup(createElement(CombinationOrderBookPanel, {
        mode: "spread",
        labelA: "Binance BTC/USDT",
        labelB: "Gate.io BTC/USDT",
        targetA: TARGET_A,
        targetB: TARGET_B,
        stateA,
        stateB,
        wsMode: true,
        onWsModeChange: () => {},
        nowMs: clock,
      }));
      expect(markup).not.toContain("合成盘口暂不可用");
      expect(markup).not.toContain("晚于当前时间");
      expect(tables(markup)[1].rows).toHaveLength(4);
      expect(tables(markup)[2].rows).toHaveLength(4);
    }
  });

  test("a throttled background tick cannot make a new frame look futuristic", () => {
    // Background tabs throttle timers to ~1/min. The tick is therefore 90s old
    // when a fresh frame arrives; the frame floor must still win.
    const throttledTick = NOW;
    const receivedAtMs = NOW + 90_000;
    const clock = resolveLiveClock({ ticking: throttledTick, frameReference: receivedAtMs });
    expect(clock).toBe(receivedAtMs);
    const markup = panel({
      nowMs: clock,
      stateA: state(BOOK_A, TARGET_A, {}, receivedAtMs),
      stateB: state(BOOK_B, TARGET_B, {}, receivedAtMs),
    });
    expect(markup).not.toContain("合成盘口暂不可用");
    expect(markup).not.toContain("晚于当前时间");
    expect(tables(markup)[1].rows).toHaveLength(4);
  });

  test("the frame floor never hides real staleness once no new frame arrives", () => {
    const receivedAtMs = NOW;
    const frameReference = receivedAtMs;
    // Next tick, 1s later: still within the 20s budget.
    const tick = NOW + 1_000;
    const readyClock = resolveLiveClock({ ticking: tick, frameReference });
    expect(readyClock).toBe(tick);
    const fresh = panel({ nowMs: readyClock, stateA: state(BOOK_A, TARGET_A, {}, receivedAtMs), stateB: state(BOOK_B, TARGET_B, {}, receivedAtMs) });
    expect(fresh).not.toContain("数据已过期");

    // After 20s with no new frame the tick wins and the book must degrade.
    const staleClock = resolveLiveClock({ ticking: NOW + 20_001, frameReference });
    expect(staleClock).toBe(NOW + 20_001);
    const stale = panel({ nowMs: staleClock, stateA: state(BOOK_A, TARGET_A, {}, receivedAtMs), stateB: state(BOOK_B, TARGET_B, {}, receivedAtMs) });
    expect(stale).toContain("数据已过期 · 显示上次更新");
    expect(stale).toContain("合成盘口暂不可用");
  });

  test("an explicit clock still rejects future frames so the guard remains testable", () => {
    // nowMs is authoritative: no floor is applied to it.
    expect(resolveLiveClock({ nowMs: NOW, ticking: NOW + 5_000, frameReference: NOW + 5_000 })).toBe(NOW);
    const markup = panel({
      nowMs: NOW - 1,
      stateA: state(BOOK_A, TARGET_A, {}, NOW),
      stateB: state(BOOK_B, TARGET_B, {}, NOW),
    });
    expect(markup).toContain("合成盘口暂不可用");
    expect(markup).toContain("晚于当前时间");
  });

  test("the live clock degrades to the frame floor before any tick exists", () => {
    // SSR and hydration run with no tick snapshot at all.
    expect(resolveLiveClock({ ticking: null, frameReference: NOW })).toBe(NOW);
    expect(resolveLiveClock({ ticking: null, frameReference: 0 })).toBe(0);
    // A tick that already leads the frame simply stands.
    expect(resolveLiveClock({ ticking: NOW + 30, frameReference: NOW })).toBe(NOW + 30);
  });

  test("the floor can never exceed the real present, so guard rejection stays coherent", () => {
    // Receipt times are stamped by this page, so the floor is always a past
    // instant; the live clock therefore never claims the future.
    const receivedAtMs = NOW + 900;
    expect(resolveLiveClock({ ticking: NOW, frameReference: receivedAtMs })).toBeLessThanOrEqual(receivedAtMs);
  });

  test("rejects legs whose local receipt times drift apart", () => {
    const skewed = panel({ stateB: state(BOOK_B, TARGET_B, {}, NOW - 10_001) });
    expect(skewed).toContain("超过上限");
    expect(skewed).toContain("合成盘口暂不可用");
    expect(skewed).toContain("与另一腿时间差 10 秒超过上限");
  });

  test("exposes exactly one WS checkbox and no network side effects on its own", () => {
    const markup = panel({ wsMode: true });
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(1);
    expect(markup).toContain("WS模式");
    expect(markup).toContain("checked");
    // The panel only renders state handed to it; there is no fetch/WebSocket here.
    expect(markup).not.toContain("WebSocket");
  });
});

describe("combination freshness helpers", () => {
  test("computes age and staleness from the local receipt clock", () => {
    const live = state(BOOK_A, TARGET_A);
    expect(legTiming(NOW + 1_500, live)).toEqual({ ageMs: 1_500, stale: false, receivedAtMs: NOW });
    expect(legTiming(NOW + 20_000, live).stale).toBe(false);
    expect(legTiming(NOW + 20_001, live).stale).toBe(true);
    const noFrame = state(null, TARGET_A);
    expect(legTiming(NOW, noFrame)).toEqual({ ageMs: null, stale: false, receivedAtMs: null });
    expect(legTiming(Number.NaN, live).stale).toBe(false);
  });

  test("measures absolute skew and degrades to null without both receipt times", () => {
    expect(legsSkewMs(state(BOOK_A, TARGET_A), state(BOOK_B, TARGET_B, {}, NOW - 4_000))).toBe(4_000);
    expect(legsSkewMs(state(null, TARGET_A), state(BOOK_B, TARGET_B))).toBeNull();
  });
});

describe("combination book preference scope", () => {
  test("builds a pair key only when both legs are known", () => {
    expect(combinationPreferenceKey("A", "B")).toBe(combinationPreferenceKey("A", "B"));
    expect(combinationPreferenceKey("A", "B")).not.toBe(combinationPreferenceKey("B", "A"));
    expect(combinationPreferenceKey(null, "B")).toBeNull();
    expect(combinationPreferenceKey("A", null)).toBeNull();
  });

  test("resets open and WS on leg swap or reversal, and clears with the chart", () => {
    const open = preferenceForCombinationChange(EMPTY_COMBINATION_PREFERENCE, "A|B");
    const opened = { ...open, open: true, wsMode: true };
    expect(preferenceForCombinationChange(opened, "A|C")).toEqual({ key: "A|C", open: false, wsMode: false });
    expect(preferenceForCombinationChange(opened, "B|A")).toEqual({ key: "B|A", open: false, wsMode: false });
    expect(preferenceForCombinationChange(opened, null)).toEqual(EMPTY_COMBINATION_PREFERENCE);
  });

  test("keeps the session across timeframe and spread/ratio changes for the same pair", () => {
    const opened = { key: "A|B", open: true, wsMode: true };
    // The key is pair identity only: mode and interval never enter it.
    expect(preferenceForCombinationChange(opened, "A|B")).toBe(opened);
  });

  test("only offers the toggle for a payload loaded from the same plan identity", () => {
    expect(shouldShowCombinationToggle({ open: false, planKey: "A|B", payloadKey: "A|B", hasValidCandles: true })).toBe(true);
    expect(shouldShowCombinationToggle({ open: false, planKey: "A|B", payloadKey: "A|C", hasValidCandles: true })).toBe(false);
    expect(shouldShowCombinationToggle({ open: false, planKey: "A|B", payloadKey: null, hasValidCandles: true })).toBe(false);
    expect(shouldShowCombinationToggle({ open: false, planKey: "A|B", payloadKey: "A|B", hasValidCandles: false })).toBe(false);
    expect(shouldShowCombinationToggle({ open: false, planKey: null, payloadKey: null, hasValidCandles: true })).toBe(false);
    // An open panel stays closable while the chart reloads or fails.
    expect(shouldShowCombinationToggle({ open: true, planKey: "A|B", payloadKey: null, hasValidCandles: false })).toBe(true);
  });
});

describe("single-leg order book regression", () => {
  test("still renders its seven-column board after the shared source-label refactor", () => {
    const markup = renderToStaticMarkup(createElement(LiveOrderBookPanel, {
      target: TARGET_A,
      state: state(BOOK_A, TARGET_A),
      wsMode: false,
      onWsModeChange: () => {},
    }));
    const [table] = tables(markup);
    expect(table.headers).toEqual([
      "累计数量（USDT）", "累计数量（BTC）", "买盘价格", "档位", "卖盘价格", "累计数量（BTC）", "累计数量（USDT）",
    ]);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    expect(markup).toContain("实际来源：普通盘口 · REST · 每5秒刷新");
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(1);
  });
});
