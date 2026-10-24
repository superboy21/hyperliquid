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

function render(bookState: BookSessionState, wsMode = false, panelTarget = target, nowMs?: number) {
  return renderToStaticMarkup(createElement(LiveOrderBookPanel, {
    target: panelTarget,
    state: bookState,
    wsMode,
    onWsModeChange: () => {},
    nowMs,
  }));
}

/** Reads one rendered reading through its stable data hook. */
function metricValue(markup: string, key: string): string {
  const match = new RegExp(`data-combination-metric="${key}"[^>]*>([^<]*)<`).exec(markup);
  return (match?.[1] ?? "").trim();
}

function metricNumber(markup: string, key: string): number {
  return Number(metricValue(markup, key).replace(/[,\s+%]/g, ""));
}

function metricAttribute(markup: string, key: string, attribute: string): string {
  return new RegExp(`data-combination-metric="${key}"[^>]*?${attribute}="([^"]*)"`).exec(markup)?.[1] ?? "";
}

/** The summary row only, so assertions cannot leak into the leg tables. */
function summaryBlock(markup: string): string {
  const label = markup.indexOf('aria-label="本市场点差摘要"');
  if (label < 0) return "";
  const start = markup.lastIndexOf("<div", label);
  const table = markup.indexOf("<table", label);
  return markup.slice(start, table === -1 ? undefined : table);
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** A book deep enough for a 1,000 budget on both sides but shallower than 5,000. */
function midDepthBook() {
  return {
    bids: [{ price: 100, quantity: 5 }, { price: 95, quantity: 10 }],
    asks: [{ price: 101, quantity: 5 }, { price: 105, quantity: 10 }],
  };
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

describe("LiveOrderBookPanel spread summary", () => {
  test("places one compact summary row between the status lines and the table", () => {
    const markup = render(state());
    const source = markup.indexOf("实际来源：");
    const summary = markup.indexOf('aria-label="本市场点差摘要"');
    const table = markup.indexOf("<table");
    expect(source).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(source);
    expect(table).toBeGreaterThan(summary);
    // One row, no card grid, and it precedes the seven-column book.
    expect(summaryBlock(markup)).toContain("flex min-w-max items-baseline");
    expect(summaryBlock(markup)).not.toContain("flex-col");
    expect(tableContent(markup).rows).toHaveLength(5);
    expect(tableContent(markup).rows.map((row) => row[3])).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("quotes the known ask−bid gap and percentage for a single market", () => {
    // Ask 101, bid 100: difference +1 over a midpoint of 100.5 → +0.99502%.
    const markup = render(state());
    expect(metricValue(markup, "market-best-difference")).toBe("+1");
    expect(metricNumber(markup, "market-best-percent")).toBeCloseTo((1 / 100.5) * 100, 4);
    expect(metricAttribute(markup, "market-best-percent", "title")).toContain("百分比 = 该市场点差 ÷ |买卖中间价| × 100");
    // The default 5,000 budget cannot be filled by this book: the best reading
    // survives and only the VWAP reading is withheld.
    expect(metricValue(markup, "market-vwap-difference")).toBe("—");
    expect(metricValue(markup, "market-vwap-percent")).toBe("");
    expect(plain(summaryBlock(markup))).toContain("深度不足");
  });

  test("uses the default 5,000 budget and fills the VWAP when depth allows", () => {
    const deep = {
      bids: [{ price: 100, quantity: 100 }],
      asks: [{ price: 101, quantity: 100 }],
    };
    const markup = render(state({ frame: { ...frame, book: deep } }));
    expect(markup).toContain('<option value="5000" selected="">5,000</option>');
    expect(metricValue(markup, "market-best-difference")).toBe("+1");
    // 5,000 at 101 and 5,000 at 100, so the VWAP gap equals the best gap here.
    expect(metricValue(markup, "market-vwap-difference")).toBe("+1");
    expect(metricNumber(markup, "market-vwap-percent")).toBeCloseTo((1 / 100.5) * 100, 4);
    expect(markup).toContain("5,000 USDT");
  });

  test("labels the budget with the real quote asset, including a non-USD one", () => {
    const usdc = { ...target, id: "spot:Binance:ETHUSDC", rawSymbol: "ETHUSDC", baseAsset: "ETH", quoteAsset: "USDC" };
    const deep = { bids: [{ price: 2_000, quantity: 100 }], asks: [{ price: 2_001, quantity: 100 }] };
    const markup = render(state({ frame: { ...frame, targetId: usdc.id, baseAsset: "ETH", book: deep } }), false, usdc);
    expect(markup).toContain("5,000 USDC");
    expect(markup).not.toContain("5,000 USDT");
    // A non-USD quote is still a single market: no pair-level USD restriction.
    expect(metricValue(markup, "market-best-difference")).toBe("+1");
    expect(metricValue(markup, "market-vwap-difference")).toBe("+1");

    const eur = { ...target, id: "spot:Gate.io:ETH_EUR", rawSymbol: "ETH_EUR", baseAsset: "ETH", quoteAsset: "EUR" };
    const eurMarkup = render(state({ frame: { ...frame, targetId: eur.id, baseAsset: "ETH", book: deep } }), false, eur);
    expect(eurMarkup).toContain("5,000 EUR");
    expect(summaryBlock(eurMarkup)).not.toContain("USDT");
  });

  test("a shallow book withholds only the VWAP at the selected budget", () => {
    // 1,010 notional per side at 100/101 fills 1,000 but not the default 5,000.
    const shallow = { bids: [{ price: 100, quantity: 10 }], asks: [{ price: 101, quantity: 10 }] };
    const markup = render(state({ frame: { ...frame, book: shallow } }));
    expect(metricValue(markup, "market-best-difference")).toBe("+1");
    expect(metricValue(markup, "market-vwap-difference")).toBe("—");
    expect(metricAttribute(markup, "market-vwap-difference", "title")).toBe("当前没有可发布的点差");
    expect(plain(summaryBlock(markup))).toContain("深度不足");
    // No A/B leg wording inside a single-market row.
    expect(summaryBlock(markup)).not.toContain("A 腿");
  });

  test("a stale frame publishes no fabricated readings", () => {
    const markup = render(state({ status: "stale" }));
    expect(metricValue(markup, "market-best-difference")).toBe("—");
    expect(metricValue(markup, "market-vwap-difference")).toBe("—");
    expect(markup).toContain("数据已过期 · 显示上次更新");
    expect(markup).toContain("不是实时行情");
    // The last accepted depth stays visible in the table.
    expect(tableContent(markup).rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
  });

  test("an errored or frameless session states why without numbers", () => {
    const errored = render(state({ status: "error", error: { code: "network", message: "Binance 请求失败" } }));
    expect(metricValue(errored, "market-best-difference")).toBe("—");
    expect(plain(summaryBlock(errored))).toContain("不是实时行情");
    expect(errored).toContain("盘口暂不可用：Binance 请求失败");

    const cold = render(state({ status: "connecting", frame: null, attempt: null }));
    expect(metricValue(cold, "market-best-difference")).toBe("—");
    expect(plain(summaryBlock(cold))).toContain("不是实时行情");
    expect(summaryBlock(cold)).not.toMatch(/data-combination-metric="[^"]+"[^>]*>[-+0-9]/);
  });

  test("a foreign frame identity is rejected instead of quoted", () => {
    const markup = render(state({ frame: { ...frame, targetId: "spot:Binance:ETHUSDT" } }));
    expect(metricValue(markup, "market-best-difference")).toBe("—");
    expect(plain(summaryBlock(markup))).toContain("与所选市场不一致");
    expect(plain(summaryBlock(markup))).not.toContain("A 腿");
  });

  test("labels, values and percentages all share the 10px size", () => {
    const deep = { bids: [{ price: 100, quantity: 100 }], asks: [{ price: 101, quantity: 100 }] };
    const markup = render(state({ frame: { ...frame, book: deep } }));
    const hookClass = (key: string) => {
      const tag = new RegExp(`<span[^>]*data-combination-metric="${key}"[^>]*>`).exec(markup)?.[0] ?? "";
      return /class="([^"]*)"/.exec(tag)?.[1] ?? "";
    };
    for (const key of ["market-best", "market-vwap"]) {
      expect(hookClass(`${key}-difference`)).toContain("text-[10px]");
      expect(hookClass(`${key}-percent`)).toContain("text-[10px]");
    }
    const labels = [...summaryBlock(markup).matchAll(/class="text-\[10px\] font-semibold text-(?:sky|violet)-200" title="[^"]*">([^<]+)</g)]
      .map((match) => match[1]);
    expect(labels).toEqual(["最佳点差", "VWAP 点差"]);
    expect(summaryBlock(markup)).not.toContain("text-[11px]");
    expect(summaryBlock(markup)).not.toContain("text-[13px]");
  });

  test("the fixed clock expires a quiet book and keeps last-known depth", () => {
    const receivedAt = frame.receivedAtMs;
    // 19.999s: still inside the 20s budget, readings present.
    const fresh = render(state(), false, target, receivedAt + 19_999);
    expect(metricValue(fresh, "market-best-difference")).toBe("+1");
    expect(fresh).not.toContain("不是实时行情");

    // 20.001s: no new frame, so the readings must degrade even though the state
    // object still says "live" and the depth is still drawn.
    const expired = render(state(), false, target, receivedAt + 20_001);
    expect(metricValue(expired, "market-best-difference")).toBe("—");
    expect(metricValue(expired, "market-vwap-difference")).toBe("—");
    expect(plain(summaryBlock(expired))).toContain("已过期");
    expect(tableContent(expired).rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    // The panel's own source line still shows the stale badge.
    expect(expired).toContain("数据已过期 · 显示上次更新");
  });

  test("an explicit clock still rejects a future frame", () => {
    const markup = render(state(), false, target, frame.receivedAtMs - 1);
    expect(metricValue(markup, "market-best-difference")).toBe("—");
    expect(plain(summaryBlock(markup))).toContain("晚于当前时间");
  });

  test("offers the shared budget presets ahead of the WS checkbox", () => {
    const markup = render(state());
    const options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)]
      .map((match) => `${match[1]}:${match[2]}`);
    expect(options).toEqual(["1000:1,000", "3000:3,000", "5000:5,000", "10000:10,000", "custom:自定义"]);
    const label = markup.indexOf("VWAP 预算");
    const select = markup.indexOf("<select");
    const ws = markup.indexOf("WS模式");
    expect(select).toBeGreaterThan(label);
    expect(ws).toBeGreaterThan(select);
    // The picker is a labelled control, and it did not swallow the WS props.
    expect(markup).toMatch(/<label for="[^"]+" class="[^"]*">VWAP 预算<\/label><select id="[^"]+"/);
    expect((markup.match(/type="checkbox"/g) ?? []).length).toBe(1);
  });

  test("keeps the seven columns' cumulative values and rank order unchanged", () => {
    const { headers, rows } = tableContent(render(state()));
    expect(headers).toEqual([
      "累计数量（USDT）", "累计数量（BTC）", "买盘价格", "档位", "卖盘价格", "累计数量（BTC）", "累计数量（USDT）",
    ]);
    expect(rows[0]).toEqual(["100", "1", "100", "1", "101", "1", "101"]);
    expect(rows[1]).toEqual(["298", "3", "99", "2", "102", "3", "305"]);
    expect(rows[4]).toEqual(["1,460", "15", "96", "5", "105", "15", "1,555"]);
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
