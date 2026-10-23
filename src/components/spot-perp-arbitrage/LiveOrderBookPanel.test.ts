import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectOrderBook } from "@/lib/order-book/project";
import type { BookFrame, BookSessionState, BookTarget } from "@/lib/order-book/types";
import { asSpotMarket } from "@/lib/spot-perp-arbitrage/model";
import LiveOrderBookPanel, { cumulativeQuantities, preferenceForTargetChange, resolveLiveBookTarget, shouldShowLiveBookToggle } from "./LiveOrderBookPanel";

const target: BookTarget = {
  id: "binance:spot:BTCUSDT",
  exchange: "Binance",
  kind: "spot",
  rawSymbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
};

const frame: BookFrame = {
  targetId: target.id,
  book: {
    bids: [100, 99, 98, 97, 96].map((price, index) => ({ price, quantity: index + 1 })),
    asks: [101, 102, 103, 104, 105].map((price, index) => ({ price, quantity: index + 1 })),
  },
  quantityUnit: "base",
  baseAsset: "BTC",
  source: { transport: "rest", bookMode: "normal", route: "test" },
  exchangeTimeMs: null,
  receivedAtMs: Date.UTC(2026, 0, 1, 12, 34, 56),
  sequence: null,
};

function state(overrides: Partial<BookSessionState> = {}): BookSessionState {
  return {
    requested: { transport: "rest", bookMode: "rpi" },
    attempt: { transport: "rest", bookMode: "normal" },
    frame,
    status: "live",
    notices: [],
    error: null,
    updated: frame.receivedAtMs,
    ...overrides,
  };
}

function render(bookState: BookSessionState, wsMode = false, panelTarget = target) {
  return renderToStaticMarkup(createElement(LiveOrderBookPanel, {
    target: panelTarget,
    state: bookState,
    wsMode,
    onWsModeChange: () => {},
  }));
}

function tableContent(markup: string) {
  const table = markup.match(/<table\b[^>]*>([\s\S]*?)<\/table>/)?.[1] ?? "";
  const plainText = (html: string) => html.replace(/<[^>]+>/g, "").trim();
  const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/)?.[1] ?? "";
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const headers = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => plainText(match[1]));
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/g)].map((cell) => plainText(cell[1])),
  );
  return { headers, rows };
}

describe("LiveOrderBookPanel SSR", () => {
  test("renders seven semantic columns in order and five shared ranks", () => {
    const markup = render(state());
    const { headers, rows } = tableContent(markup);
    expect(headers).toEqual([
      "累计数量（USDT）", "累计数量（BTC）", "买盘价格", "档位", "卖盘价格", "累计数量（BTC）", "累计数量（USDT）",
    ]);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    expect(rows.map((row) => row[3])).toEqual(["1", "2", "3", "4", "5"]);
    expect(rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    expect(rows[1]).toEqual(["298", "3", "99", "2", "102", "3", "305"]);
    expect(rows[4]).toEqual(["1,460", "15", "96", "5", "105", "15", "1,555"]);
    expect(markup).not.toContain("买1");
    expect(markup).not.toContain("卖1");
    expect(markup).toContain("text-emerald-300");
    expect(markup).toContain("text-rose-300");
    expect(markup).toContain("普通盘口 · REST · 每5秒刷新");
    expect(markup).toContain("收取时间：");
  });

  test("discloses actual normal source when RPI was requested but unavailable", () => {
    const markup = render(state({
      notices: [{ id: 1, code: "fallback", reason: "network", message: "RPI 不可用，已回退普通盘口。", from: { transport: "rest", bookMode: "rpi" }, to: { transport: "rest", bookMode: "normal" } }],
    }));
    expect(markup).toContain("实际来源：普通盘口 · REST · 每5秒刷新");
    expect(markup).toContain("RPI 不可用，已回退普通盘口。");
  });

  test("exposes only the WS checkbox and preserves accessible loading state", () => {
    const markup = render(state({ status: "connecting", frame: null, attempt: null }));
    expect(markup).toContain("WS模式");
    expect(markup).toContain('type="checkbox"');
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(1);
    expect(markup).toContain("正在连接并获取盘口");
    expect(markup).toContain('role="status"');
    expect(tableContent(markup).rows).toHaveLength(5);
    expect(markup).toContain("—");
  });

  test("keeps old frame visible with explicit stale disclosure", () => {
    const markup = render(state({ status: "stale" }));
    expect(markup).toContain("数据已过期 · 显示上次更新");
    expect(tableContent(markup).rows[4]).toEqual(["1,460", "15", "96", "5", "105", "15", "1,555"]);
  });

  test("keeps five rows with both quantity cells dashed for empty books", () => {
    const markup = render(state({ frame: { ...frame, book: { bids: [], asks: [] } } }));
    const { rows } = tableContent(markup);
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(Array.from({ length: 5 }, (_, index) => ["—", "—", "—", String(index + 1), "—", "—", "—"]));
  });

  test("shows the selected quote asset at both book edges", () => {
    const usdcMarkup = render(state(), false, { ...target, quoteAsset: "USDC" });
    expect(tableContent(usdcMarkup).headers).toEqual([
      "累计数量（USDC）", "累计数量（BTC）", "买盘价格", "档位", "卖盘价格", "累计数量（BTC）", "累计数量（USDC）",
    ]);
    expect((usdcMarkup.match(/type="checkbox"/g) ?? []).length).toBe(1);
  });

  test("does not drop one side when book depths are uneven", () => {
    const uneven = { ...frame, book: {
      bids: [{ price: 100, quantity: 2 }, { price: 99, quantity: 1 }],
      asks: [{ price: 101, quantity: 1 }, { price: 102, quantity: 1 }, { price: 103, quantity: 1 }, { price: 104, quantity: 1 }],
    } };
    const { rows } = tableContent(render(state({ frame: uneven })));
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(["299", "3", "99", "2", "102", "2", "203"]);
    expect(rows[3]).toEqual(["—", "—", "—", "4", "104", "4", "410"]);
    expect(rows[4]).toEqual(["—", "—", "—", "5", "—", "—", "—"]);
  });

  test("calculates quote cumulative amount per actual level and independently by side", () => {
    const twoLevels = [
      { price: 100, quantity: 1, cumulativeQuantity: 1 },
      { price: 99, quantity: 2, cumulativeQuantity: 3 },
    ];
    expect(cumulativeQuantities(twoLevels)).toEqual({ base: [1, 3], quote: [100, 298] });
    const aggregated = projectOrderBook({ bids: [{ price: 100, quantity: 1 }, { price: 100, quantity: 2 }], asks: [] });
    expect(aggregated.bids).toEqual([{ price: 100, quantity: 3, cumulativeQuantity: 3, rank: 1 }]);
    expect(cumulativeQuantities(aggregated.bids)).toEqual({ base: [3], quote: [300] });
    expect(cumulativeQuantities([{ price: Number.NaN, quantity: 1, cumulativeQuantity: 1 }])).toEqual({ base: [1], quote: [undefined] });
  });
});

describe("live book target preference", () => {
  test("resets open and WS preferences on target changes and chart close", () => {
    const openWs = { targetId: "A", open: true, wsMode: true };
    expect(preferenceForTargetChange(openWs, "B")).toEqual({ targetId: "B", open: false, wsMode: false });
    expect(preferenceForTargetChange(openWs, null)).toEqual({ targetId: null, open: false, wsMode: false });
  });

  test("preserves preferences for the same target, including timeframe changes", () => {
    const openWs = { targetId: "A", open: true, wsMode: true };
    expect(preferenceForTargetChange(openWs, "A")).toBe(openWs);
  });
});

describe("live book target resolution and toggle visibility", () => {
  const oldMarket = asSpotMarket({
    exchange: "Bitget", exchangeColor: "#00a", pair: "XYZ/USDT", baseAsset: "XYZ", quoteAsset: "USDT",
    rawSymbol: "XYZUSDT", marketKey: "XYZ_USDT", midPrice: 1, change24h: 0, quoteVolume: 0, baseVolume: 0,
    fetchedAt: 1, isRealityToken: false,
  });
  const refreshedMarket = asSpotMarket({
    ...oldMarket.source, rawSymbol: "RAAPLUSDT", baseAsset: "RAAPLUS", isRealityToken: true,
  });

  test("resolves the latest row for a stable selected ID and returns null when removed", () => {
    const resolved = resolveLiveBookTarget(oldMarket, [refreshedMarket]);
    expect(resolved?.id).toBe("spot:Bitget:XYZ_USDT");
    expect(resolved?.rawSymbol).toBe("RAAPLUSDT");
    expect(resolved?.baseAsset).toBe("RAAPLUS");
    expect(resolved?.isRealityToken).toBe(true);
    expect(resolveLiveBookTarget(oldMarket, [])).toBeNull();
  });

  test("keeps an open book closable while candles reload or fail", () => {
    expect(shouldShowLiveBookToggle({ open: true, targetId: "A", chartPayloadTargetId: null, hasValidCandles: false })).toBe(true);
    expect(shouldShowLiveBookToggle({ open: false, targetId: "A", chartPayloadTargetId: "A", hasValidCandles: false })).toBe(false);
    expect(shouldShowLiveBookToggle({ open: false, targetId: "A", chartPayloadTargetId: "A", hasValidCandles: true })).toBe(true);
  });
});
