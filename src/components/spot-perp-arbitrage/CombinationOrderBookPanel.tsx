"use client";

import {
  COMBINATION_MAX_FRAME_AGE_MS,
  COMBINATION_MAX_SKEW_MS,
  buildCombinationOrderBook,
  buildLegOrderBookMetrics,
  type CombinationBookLevel,
  type CombinationBookMetrics,
  type CombinationBookMode,
  type CombinationBookSide,
  type CombinationBookSpreadMetric,
} from "@/lib/order-book/combination";
import { projectOrderBook } from "@/lib/order-book/project";
import type { BookSessionState, BookTarget } from "@/lib/order-book/types";
import { bookSourceLabel } from "./LiveOrderBookPanel";
import {
  SpreadMetricInline,
  SpreadSummaryStrip,
  formatClockTime,
  formatMetricDifference,
  formatMetricPercent,
  formatUsdt,
  sharedMetricReason,
  shortMetricReason,
} from "./orderBookReadout";
import { useOrderBookClock, resolveLiveClock } from "./orderBookClock";
import {
  DEFAULT_VWAP_BUDGET,
  VWAP_BUDGET_PRESETS,
  VwapBudgetPicker,
  parseVwapBudget,
  useVwapBudget,
  vwapBudgetError,
  vwapBudgetSelection,
  type VwapBudgetSelection,
} from "./vwapBudgetControl";

// Re-exported for the existing tests and any caller that imported these from
// this panel before they moved into the shared modules.
export {
  DEFAULT_VWAP_BUDGET,
  VWAP_BUDGET_PRESETS,
  VwapBudgetPicker,
  formatMetricDifference,
  formatMetricPercent,
  formatUsdt,
  parseVwapBudget,
  resolveLiveClock,
  sharedMetricReason,
  shortMetricReason,
  useVwapBudget,
  vwapBudgetError,
  vwapBudgetSelection,
};
export type { VwapBudgetSelection };

const ROWS = 5;

/**
 * Preference scope for the combined book. The pair identity (A + B) owns the
 * open/WS state, so a timeframe change keeps the live sessions but swapping
 * either leg closes and resets them. Mode is presentation only and is not part
 * of the key.
 */
export interface CombinationBookPreference {
  key: string | null;
  open: boolean;
  wsMode: boolean;
}

export const EMPTY_COMBINATION_PREFERENCE: CombinationBookPreference = { key: null, open: false, wsMode: false };

/** Both legs must be known; a half-selected pair has no combined book. */
export function combinationPreferenceKey(legAId: string | null, legBId: string | null): string | null {
  return legAId === null || legBId === null ? null : `${legAId}\u0000${legBId}`;
}

export function preferenceForCombinationChange(
  current: CombinationBookPreference,
  key: string | null,
): CombinationBookPreference {
  return current.key === key ? current : { key, open: false, wsMode: false };
}

/** Compare a chart plan against the loaded payload so a stale payload can never quote the wrong legs. */
export function shouldShowCombinationToggle(options: {
  open: boolean;
  planKey: string | null;
  payloadKey: string | null;
  hasValidCandles: boolean;
}): boolean {
  return options.open || Boolean(
    options.planKey
    && options.planKey === options.payloadKey
    && options.hasValidCandles,
  );
}

export interface CombinationOrderBookPanelProps {
  mode: CombinationBookMode;
  /** Human identity of the left (A) leg, e.g. "Binance BTC/USDT Spot". */
  labelA: string;
  labelB: string;
  targetA: BookTarget | null;
  targetB: BookTarget | null;
  stateA: BookSessionState;
  stateB: BookSessionState;
  wsMode: boolean;
  onWsModeChange: (enabled: boolean) => void;
  /** Fixed clock for server rendering and tests; live mode ticks every second. */
  nowMs?: number;
}

function number(value: number | undefined, digits = 8): string {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { maximumSignificantDigits: digits });
}

/**
 * Spreads keep their sign and may be negative. A ratio is positive, so it is
 * formatted by magnitude: common pairs read like 1.1000, while a tiny ratio
 * stays visible (e.g. 0.0000001234) instead of collapsing to 0.0000.
 */
export function formatCombinationValue(mode: CombinationBookMode, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  if (mode === "spread") {
    // A small non-zero spread must not print as "0" or "-0".
    if (size > 0 && size < 1e-6) {
      return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
    }
    // Large spreads are money-like: cap the decimals so an 8-significant-digit
    // round trip cannot silently alter the integer part.
    if (size >= 1000) {
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    return value.toLocaleString("en-US", { maximumSignificantDigits: 8 });
  }
  if (size >= 0.01 && size < 1000) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  // Outside the common band keep significant digits, falling back to exponent
  // for extreme magnitudes, so a positive value never renders as zero.
  return size > 0 && size < 1e-4
    ? value.toExponential(4)
    : value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

export function modeLabel(mode: CombinationBookMode): string {
  return mode === "ratio" ? "比值 A / B" : "价差 A − B";
}

export interface LegTiming {
  ageMs: number | null;
  stale: boolean;
  receivedAtMs: number | null;
}

/** Freshness is recomputed from the local receipt time, not from the session label. */
export function legTiming(nowMs: number, state: BookSessionState): LegTiming {
  const receivedAtMs = state.frame?.receivedAtMs ?? null;
  if (receivedAtMs === null || !Number.isFinite(receivedAtMs) || !Number.isFinite(nowMs)) {
    return { ageMs: null, stale: false, receivedAtMs };
  }
  const ageMs = Math.max(0, nowMs - receivedAtMs);
  return { ageMs, stale: ageMs > COMBINATION_MAX_FRAME_AGE_MS, receivedAtMs };
}

export function legsSkewMs(stateA: BookSessionState, stateB: BookSessionState): number | null {
  const a = stateA.frame?.receivedAtMs;
  const b = stateB.frame?.receivedAtMs;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b);
}

function legLoading(state: BookSessionState): boolean {
  return !state.frame && (state.status === "idle" || state.status === "connecting");
}

/**
 * Quote-currency amount for one displayed level. The side book quotes actual
 * per-level depth, so this is `price × quantity` of that single level — never a
 * running total. A product that is not finite (overflow) yields undefined so the
 * cell can render a dash instead of `Infinity`.
 */
export function levelQuoteAmount(price: number | undefined, quantity: number | undefined): number | undefined {
  if (typeof price !== "number" || typeof quantity !== "number") return undefined;
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return undefined;
  if (price <= 0 || quantity <= 0) return undefined;
  const product = price * quantity;
  return Number.isFinite(product) && product > 0 ? product : undefined;
}

/** One compact side-book row; a missing rank keeps every price/quantity empty. */
export interface LegBookRow {
  rank: number;
  bidPrice?: number;
  bidQuantity?: number;
  bidQuote?: number;
  askPrice?: number;
  askQuantity?: number;
  askQuote?: number;
}

/**
 * Build the seven-column side rows from projected levels. Quantities stay
 * per-level in both units: base is the raw book quantity, quote is its price
 * product. Ranks come from the projection, so a missing depth level leaves a
 * blank row rather than shifting the remaining levels up.
 */
export function legBookRows(
  bids: readonly { price: number; quantity: number }[],
  asks: readonly { price: number; quantity: number }[],
  count = ROWS,
): LegBookRow[] {
  return Array.from({ length: count }, (_, index) => {
    const bid = bids[index];
    const ask = asks[index];
    return {
      rank: index + 1,
      ...(bid ? { bidPrice: bid.price, bidQuantity: bid.quantity, bidQuote: levelQuoteAmount(bid.price, bid.quantity) } : {}),
      ...(ask ? { askPrice: ask.price, askQuantity: ask.quantity, askQuote: levelQuoteAmount(ask.price, ask.quantity) } : {}),
    };
  });
}

/**
 * Display order for a combined-book direction. Buy walks deepest-to-best
 * (5→4→…→1) so the executable best level sits closest to the summary, while
 * sell keeps 1→5. Only the presentation order changes: each row keeps its
 * original rank and its already-computed segment/cumulative values, and the
 * source array is never reversed in place.
 */
export function displayLevels<T>(
  levels: readonly T[],
  order: "best-last" | "best-first",
): Array<{ level: T; rank: number }> {
  const rows = levels.map((level, index) => ({ level, rank: index + 1 }));
  return order === "best-last" ? rows.slice().reverse() : rows;
}

/**
 * A notice counts as a real source downgrade only when the session had to switch
 * transport or book mode (`fallback`) or the requested mode was not supported
 * (`unsupported`). A `policy` notice describes a deliberate product rule (e.g.
 * rToken always uses plain REST) and must not be counted as "this leg fell
 * back", otherwise one policy leg plus one fallback leg would claim both did.
 */
export function isFallbackNotice(code: "fallback" | "unsupported" | "policy"): boolean {
  return code === "fallback" || code === "unsupported";
}

function legProblem(target: BookTarget | null, state: BookSessionState, timing: LegTiming, skew: number | null): string | null {
  if (target === null) return "无法定位该腿盘口（缺少交易所市场标识）";
  if (!state.frame) {
    if (legLoading(state)) return "正在获取盘口…";
    return state.error ? `盘口暂不可用：${state.error.message}` : "暂无盘口数据";
  }
  // A frame can outlive its session: the stream may have errored or the last
  // accepted frame may have aged out. Either way the leg is showing last-known
  // depth, so it says so here instead of leaving only the middle status line.
  // When both apply, the reason is kept alongside the fact that it is stale.
  const reason = state.error ? `：${state.error.message}` : "";
  if (timing.stale || state.status === "stale") return `盘口已过期${reason || "，仍显示上次更新"}`;
  if (state.status === "error" || state.status === "closed") {
    return state.error ? `盘口已断开：${state.error.message}` : "盘口已断开，仍显示上次更新";
  }
  if (skew !== null && skew > COMBINATION_MAX_SKEW_MS) {
    return `与另一腿时间差 ${Math.round(skew / 1000)} 秒超过上限`;
  }
  return null;
}

function LegBook(props: {
  side: "A" | "B";
  target: BookTarget | null;
  label: string;
  state: BookSessionState;
  timing: LegTiming;
  skew: number | null;
  /** The same clock the combined book uses, so both summaries age together. */
  clockNow: number;
  /** Shared quote-currency VWAP budget, straight from the panel's picker. */
  vwapNotionalUsdt: number;
}) {
  const { side, target, label, state, timing, skew, clockNow, vwapNotionalUsdt } = props;
  const projected = state.frame ? projectOrderBook(state.frame.book) : null;
  const bids = projected?.bids ?? [];
  const asks = projected?.asks ?? [];
  const problem = legProblem(target, state, timing, skew);
  // Units come from the leg's own market identity; never hard-code USDT.
  const baseUnit = target?.baseAsset ?? null;
  const quoteUnit = target?.quoteAsset ?? null;
  const baseHeader = baseUnit ? `量（${baseUnit}）` : "数量";
  const quoteHeader = quoteUnit ? `量（${quoteUnit}）` : "数量";
  const rows = legBookRows(bids, asks);
  // Per-leg readings are independent of the partner: a stale or skewed B leg
  // cannot blank a healthy A leg (and vice versa), because nothing here reads
  // the other side's state.
  const legMetrics = buildLegOrderBookMetrics({ target, state, nowMs: clockNow, label: side, vwapNotionalUsdt });

  return (
    <section
      aria-label={`${side} 腿实时盘口`}
      className="min-w-0 rounded border border-gray-800 bg-gray-950/40 p-2"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h4 className="flex min-w-0 items-baseline gap-1 text-[11px] font-semibold text-gray-200">
          <span className={`shrink-0 ${side === "A" ? "text-indigo-300" : "text-fuchsia-300"}`}>{side} 腿</span>
          <span className="truncate text-gray-400" title={label}>{label}</span>
        </h4>
        <span className="shrink-0 text-[10px] text-gray-500">{target ? target.kind === "spot" ? "现货" : "永续" : "—"}</span>
      </div>

      <p className="mb-1 text-[10px] leading-4 text-gray-500">
        {side === "A" ? "买入组合用 A 卖盘 · 卖出组合用 A 买盘" : "买入组合用 B 买盘 · 卖出组合用 B 卖盘"}
      </p>

      {state.frame && (
        <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
          <span>{bookSourceLabel(state.frame)}</span>
          <span>{formatClockTime(state.frame.receivedAtMs)}</span>
          {(timing.stale || state.status === "stale") && <span className="font-medium text-amber-300">已过期</span>}
        </p>
      )}
      {problem && (
        <p
          className={`mb-1 text-[10px] ${timing.stale || state.status === "stale" ? "text-amber-300" : "text-gray-400"}`}
          role="status"
        >
          {problem}
        </p>
      )}

      <LegSpreadSummary side={side} quoteUnit={quoteUnit} metrics={legMetrics} showReasons={problem === null} />

      <div className="mt-1 min-w-0 overflow-x-auto">
        <table className="w-full min-w-[26rem] table-fixed border-collapse text-[11px] tabular-nums">
          <caption className="sr-only">
            {side} 腿 {label} 买卖双方各五档紧凑盘口；数量为基础币 {baseUnit ?? "基础资产"}，报价金额为
            {" "}{quoteUnit ?? "报价币"}（该档价格 × 数量，非累计）
          </caption>
          <colgroup>
            <col className="w-[4.6rem]" /><col className="w-[4.2rem]" /><col className="w-[5rem]" />
            <col className="w-[2rem]" />
            <col className="w-[5rem]" /><col className="w-[4.2rem]" /><col className="w-[4.6rem]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-800 text-[10px] text-gray-500">
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-right font-medium text-emerald-300/70">{quoteHeader}</th>
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-right font-medium text-emerald-300/70">{baseHeader}</th>
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-right font-medium text-emerald-300/90">买价</th>
              <th scope="col" className="px-1 py-1 text-center font-medium text-gray-500">档</th>
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-left font-medium text-rose-300/90">卖价</th>
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-left font-medium text-rose-300/70">{baseHeader}</th>
              <th scope="col" className="whitespace-nowrap px-1 py-1 text-left font-medium text-rose-300/70">{quoteHeader}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {rows.map((row) => (
              <tr key={row.rank}>
                <td className="whitespace-nowrap px-1 py-1 text-right text-emerald-200/80">{number(row.bidQuote)}</td>
                <td className="whitespace-nowrap px-1 py-1 text-right text-emerald-200/80">{number(row.bidQuantity)}</td>
                <td className="whitespace-nowrap px-1 py-1 text-right text-emerald-300">{number(row.bidPrice)}</td>
                <th scope="row" className="px-1 py-1 text-center font-medium text-gray-600">{row.rank}</th>
                <td className="whitespace-nowrap px-1 py-1 text-left text-rose-300">{number(row.askPrice)}</td>
                <td className="whitespace-nowrap px-1 py-1 text-left text-rose-200/80">{number(row.askQuantity)}</td>
                <td className="whitespace-nowrap px-1 py-1 text-left text-rose-200/80">{number(row.askQuote)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DirectionBlock(props: {
  direction: "buy" | "sell";
  mode: CombinationBookMode;
  side: CombinationBookSide;
  targetA: BookTarget | null;
  targetB: BookTarget | null;
}) {
  const { direction, mode, side, targetA, targetB } = props;
  const buy = direction === "buy";
  const title = buy ? "买入组合" : "卖出组合";
  // The two legs are quoted in that order on purpose: this is not a traditional
  // bid/ask ladder and must never be re-inverted for display.
  const execution = buy
    ? "买 A 卖盘（ask）· 卖 B 买盘（bid）"
    : "卖 A 买盘（bid）· 买 B 卖盘（ask）";
  const formula = mode === "ratio"
    ? buy ? "比值 = Aask / Bbid" : "比值 = Abid / Bask"
    : buy ? "价差 = Aask − Bbid" : "价差 = Abid − Bask";
  const tone = buy
    ? "border-emerald-500/25 bg-emerald-950/10"
    : "border-rose-500/25 bg-rose-950/10";
  const titleTone = buy ? "text-emerald-300" : "text-rose-300";
  const last = side.levels[side.levels.length - 1];
  // Buy reads deepest-to-best (5→…→1) so the executable level is nearest the
  // summary; sell keeps 1→5. Only display order changes — rank, segment USDT
  // and cumulative totals stay bound to their own level.
  const rows = displayLevels(side.levels, buy ? "best-last" : "best-first");

  return (
    <div className={`rounded border ${tone} p-2`}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className={`text-[11px] font-semibold ${titleTone}`}>{title}</h4>
        <span className="text-[10px] text-gray-400">{execution}</span>
      </div>
      <p className="mb-1 text-[10px] text-gray-500">{formula} · 两腿按 USDT 名义等额撮合</p>

      {side.error ? (
        <p className="py-2 text-[11px] text-rose-300" role="alert">{side.error}</p>
      ) : side.levels.length === 0 ? (
        <p className="py-2 text-[11px] text-gray-500">暂无可撮合深度</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[30rem] table-fixed border-collapse text-[11px] tabular-nums">
            <caption className="sr-only">
              {title}合成盘口：{execution}（A 计价 {targetA?.quoteAsset ?? "USDT"}，B 计价 {targetB?.quoteAsset ?? "USDT"}），累计名义金额单位为 USDT
            </caption>
            <colgroup>
              <col className="w-[2rem]" /><col className="w-[6.5rem]" /><col className="w-[5.5rem]" />
              <col className="w-[5.5rem]" /><col className="w-[6rem]" /><col className="w-[6.5rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-700/70 text-[10px] text-gray-400">
                <th scope="col" className="px-1.5 py-1 text-center font-medium">档</th>
                <th scope="col" className={`px-1.5 py-1 text-right font-medium ${titleTone}`}>{mode === "ratio" ? "比值 A/B" : "价差 A−B"}</th>
                <th scope="col" className="px-1.5 py-1 text-right font-medium">{buy ? "A 卖价" : "A 买价"}</th>
                <th scope="col" className="px-1.5 py-1 text-right font-medium">{buy ? "B 买价" : "B 卖价"}</th>
                <th scope="col" className="px-1.5 py-1 text-right font-medium">本段 USDT</th>
                <th scope="col" className="px-1.5 py-1 text-right font-medium">累计 USDT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {rows.map(({ level, rank }: { level: CombinationBookLevel; rank: number }) => (
                <tr key={rank}>
                  <th scope="row" className="px-1.5 py-1 text-center font-medium text-gray-600">{rank}</th>
                  <td className={`whitespace-nowrap px-1.5 py-1 text-right font-medium ${titleTone}`}>{formatCombinationValue(mode, level.value)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right text-gray-300">{number(level.priceA)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right text-gray-300">{number(level.priceB)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right text-gray-400">{formatUsdt(level.notionalUsdt)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right text-gray-200">{formatUsdt(level.cumulativeNotionalUsdt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {last && (
        <p className="mt-1 text-right text-[10px] text-gray-500">
          可成交 {side.levels.length} 段 · 累计 <span className="text-gray-300">{formatUsdt(last.cumulativeNotionalUsdt)}</span> USDT
        </p>
      )}
    </div>
  );
}

/**
 * One leg's own ask−bid gap and VWAP gap.
 *
 * Everything here derives from that leg alone: a stale or skewed partner can
 * make the combined book unavailable, but it must never blank a healthy leg's
 * readings. Copy uses the leg's real quote asset instead of assuming USDT, and
 * the budget comes from the core result rather than a literal.
 */
function LegSpreadSummary(props: {
  side: "A" | "B";
  quoteUnit: string | null;
  metrics: CombinationBookMetrics;
  /**
   * The leg block already prints why this leg is not live directly above, so the
   * summary skips its own copy of that sentence. The full text stays in each
   * reading's title either way.
   */
  showReasons?: boolean;
}) {
  const { side, quoteUnit, metrics, showReasons = true } = props;
  const { best, vwap, vwapNotionalUsdt, bestReason, vwapReason } = metrics;
  const quote = quoteUnit ?? "报价币";
  const budget = formatUsdt(vwapNotionalUsdt);
  const shared = showReasons ? sharedMetricReason(metrics) : null;
  const scopeLabel = `${side} 腿`;

  const bestTitle = best === null
    ? `最佳点差不可用：${bestReason ?? "暂无数据"}`
    : `最低卖价 ${number(best.buyValue)} − 最高买价 ${number(best.sellValue)} = ${formatMetricDifference(best.difference)}；百分比 = 该腿点差 ÷ |该腿买卖中间价| × 100。`;
  const vwapTitle = vwap === null
    ? `VWAP 点差不可用：${vwapReason ?? "暂无数据"}`
    : `卖盘侧与买盘侧各按 ${budget} ${quote} 成交后相减；每侧独立计算，不含手续费。百分比 = 该腿 VWAP 点差 ÷ |该腿两侧 VWAP 中间价| × 100。`;
  const legPercentNullTitle = "该腿中间价为 0 或无法计算，百分比不适用；点差数值仍然有效";

  return (
    <SpreadSummaryStrip label={`${scopeLabel}点差摘要`} sharedReason={shared}>
      <SpreadMetricInline
        kind="best"
        scope={{ hook: `leg-${side.toLowerCase()}`, label: `${scopeLabel}最佳点差` }}
        label="最佳点差"
        accent="sky"
        metric={best}
        reason={showReasons && shared === null ? bestReason : null}
        title={bestTitle}
        percentNullTitle={legPercentNullTitle}
      />
      <span aria-hidden="true" className="text-[10px] text-gray-700">·</span>
      <SpreadMetricInline
        kind="vwap"
        scope={{ hook: `leg-${side.toLowerCase()}`, label: `${scopeLabel} VWAP 点差` }}
        label="VWAP 点差"
        accent="violet"
        metric={vwap}
        reason={showReasons && shared === null ? vwapReason : null}
        title={vwapTitle}
        percentNullTitle={legPercentNullTitle}
      />
    </SpreadSummaryStrip>
  );
}

/**
 * The buy/sell reading that sits between the two direction blocks.
 *
 * 点差 = 买入组合值 − 卖出组合值, i.e. the buy side's ask-like combination minus
 * the sell side's bid-like combination. It is signed on purpose: a negative
 * reading means the buy combination is the cheaper one.
 *
 * The percentage is not computed here. The core publishes it as the sum of the
 * two legs' own percentages (A% + B%), so the panel only renders
 * `result.metrics` and never divides by a combined midpoint.
 */
function CombinationSpreadSummary(props: {
  mode: CombinationBookMode;
  metrics: CombinationBookMetrics;
}) {
  const { mode, metrics } = props;
  const { best, vwap, vwapNotionalUsdt, bestReason, vwapReason } = metrics;
  const ratioMode = mode === "ratio";
  const buyWord = ratioMode ? "买入组合比值" : "买入组合价";
  const sellWord = ratioMode ? "卖出组合比值" : "卖出组合价";
  const bestLabel = ratioMode ? "最佳比值差" : "最佳点差";
  const vwapLabel = ratioMode ? "VWAP 比值差" : "VWAP 点差";
  const budget = formatUsdt(vwapNotionalUsdt);
  const sharedReason = sharedMetricReason(metrics);

  const pairNote = (metric: CombinationBookSpreadMetric) =>
    `${buyWord} ${formatCombinationValue(mode, metric.buyValue)} − ${sellWord} ${formatCombinationValue(mode, metric.sellValue)}`;

  const bestTitle = best === null
    ? `最佳${ratioMode ? "比值差" : "点差"}不可用：${bestReason ?? "暂无数据"}`
    : `${pairNote(best)}。绝对点差 = ${buyWord} − ${sellWord}；百分比 = A 腿最佳点差% + B 腿最佳点差%，两腿各自按本腿买卖中间价计算后相加。`;
  const vwapTitle = vwap === null
    ? `VWAP ${ratioMode ? "比值差" : "点差"}不可用：${vwapReason ?? "暂无数据"}`
    : `${pairNote(vwap)}。VWAP 每个方向 A、B 两腿各按 ${budget} 报价币成交（USD 计价按 1:1），不含手续费；百分比 = A 腿 VWAP 点差% + B 腿 VWAP 点差%。`;
  const pairPercentNullTitle = "单腿中间价为 0 或无法计算，缺少可相加的百分比；绝对点差仍然有效";

  return (
    <SpreadSummaryStrip label="买卖点差摘要" sharedReason={sharedReason}>
      <SpreadMetricInline
        kind="best"
        label={bestLabel}
        accent="sky"
        metric={best}
        reason={sharedReason === null ? bestReason : null}
        title={bestTitle}
        percentNullTitle={pairPercentNullTitle}
      />
      <span aria-hidden="true" className="text-[10px] text-gray-700">·</span>
      <SpreadMetricInline
        kind="vwap"
        label={vwapLabel}
        accent="violet"
        metric={vwap}
        reason={sharedReason === null ? vwapReason : null}
        title={vwapTitle}
        percentNullTitle={pairPercentNullTitle}
      />
    </SpreadSummaryStrip>
  );
}

export default function CombinationOrderBookPanel(props: CombinationOrderBookPanelProps) {
  const { mode, labelA, labelB, targetA, targetB, stateA, stateB, wsMode, onWsModeChange, nowMs } = props;
  // Budget lives on the panel, so it survives a mode/timeframe re-render of the
  // same mount (the pair identity owns the sessions) and simply resets to the
  // default when the panel is closed and unmounted.
  const {
    budget, custom, customDraft, customError,
    applyPreset, openCustom, commitCustom, cancelCustom, updateDraft,
  } = useVwapBudget();
  // An explicit clock (tests, stories) wins and never starts a timer; the newest
  // frame sets a floor so a frame received during this second is never judged as
  // coming from the future, while the tick still ages it to stale.
  const frameReference = Math.max(stateA.frame?.receivedAtMs ?? 0, stateB.frame?.receivedAtMs ?? 0);
  const clockNow = useOrderBookClock(nowMs, frameReference);

  const timingA = legTiming(clockNow, stateA);
  const timingB = legTiming(clockNow, stateB);
  const skew = legsSkewMs(stateA, stateB);
  const loading = legLoading(stateA) || legLoading(stateB);
  const result = buildCombinationOrderBook({ targetA, targetB, stateA, stateB, mode, nowMs: clockNow, vwapNotionalUsdt: budget });

  const notices = [
    { side: "A" as const, label: labelA, state: stateA },
    { side: "B" as const, label: labelB, state: stateB },
  ].flatMap((leg) => leg.state.notices.map((notice) => ({ ...leg, notice })));
  const fallbacks = notices.filter(({ notice }) => isFallbackNotice(notice.code));
  const policies = notices.filter(({ notice }) => !isFallbackNotice(notice.code));
  const fallbackSides = new Set(fallbacks.map(({ side }) => side)).size;
  const stale = timingA.stale || timingB.stale || stateA.status === "stale" || stateB.status === "stale";
  const unsupported = result.status === "unsupported";

  return (
    <section className="mb-2 rounded-md border border-gray-700 bg-gray-900/70 p-3" aria-label="A/B 合成实时盘口">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-gray-200">
            A/B 合成实时盘口
            <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium ${mode === "ratio" ? "border-violet-400/40 bg-violet-500/15 text-violet-200" : "border-gray-500/40 bg-gray-700/40 text-gray-200"}`}>
              {modeLabel(mode)}
            </span>
          </h3>
          <p className="mt-0.5 text-[10px] leading-4 text-gray-500">
            买入组合＝买 A、卖 B；卖出组合＝卖 A、买 B。显示原始价差/比值，不应用 β 权重。
          </p>
          <p className="text-[10px] leading-4 text-gray-500">
            中间按买卖执行方向排列；USDT、USDC 等 USD 计价按 1:1 折算，累计以 USDT 计。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="盘口显示选项">
          <VwapBudgetPicker
            budget={budget}
            custom={custom}
            customDraft={customDraft}
            error={customError}
            idleLabel="VWAP 预算"
            onPreset={applyPreset}
            onCustomSelect={openCustom}
            onCustomDraft={updateDraft}
            onCustomCommit={commitCustom}
            onCustomCancel={cancelCustom}
          />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-gray-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-300">
            <input type="checkbox" checked={wsMode} onChange={(event) => onWsModeChange(event.currentTarget.checked)} className="h-4 w-4 accent-cyan-400" />
            WS模式
          </label>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
        <span>
          A {timingA.ageMs === null ? "—" : `${(timingA.ageMs / 1000).toFixed(1)} 秒前`}
          {" · "}
          B {timingB.ageMs === null ? "—" : `${(timingB.ageMs / 1000).toFixed(1)} 秒前`}
        </span>
        {skew !== null && <span>两腿时间差 {(skew / 1000).toFixed(1)} 秒（上限 {COMBINATION_MAX_SKEW_MS / 1000} 秒）</span>}
        <span>每腿上限 {COMBINATION_MAX_FRAME_AGE_MS / 1000} 秒</span>
        {stale && (
          <span className="rounded border border-amber-500/40 bg-amber-950/40 px-1.5 py-0.5 font-medium text-amber-200">
            数据已过期 · 显示上次更新
          </span>
        )}
      </div>

      {fallbacks.length > 0 && (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-950/25 px-2 py-1.5" role="status">
          <p className="mb-1 text-[11px] font-semibold text-amber-200">
            {fallbackSides > 1 ? "两腿均已回退" : "回退提示"}
            <span className="ml-1 font-normal text-amber-200/70">· 实际来源以下方各腿标注为准</span>
          </p>
          {fallbacks.map(({ side, label, state, notice }) => (
            <p key={`${side}-${notice.id}`} className="text-[11px] leading-5 text-amber-100/90">
              <span className={`mr-1 font-medium ${side === "A" ? "text-indigo-200" : "text-fuchsia-200"}`}>{side} 腿</span>
              <span className="text-amber-200/70" title={label}>{label}</span>：{notice.message}
              {state.frame && <span className="ml-1 text-amber-200/70">实际来源：{bookSourceLabel(state.frame)}</span>}
            </p>
          ))}
        </div>
      )}

      {policies.length > 0 && (
        <div className="mb-2 rounded border border-sky-500/30 bg-sky-950/20 px-2 py-1.5" role="status">
          <p className="mb-1 text-[11px] font-semibold text-sky-200">
            数据源说明
            <span className="ml-1 font-normal text-sky-200/70">· 该腿按既定规则取数，不属于回退</span>
          </p>
          {policies.map(({ side, label, notice }) => (
            <p key={`${side}-${notice.id}`} className="text-[11px] leading-5 text-sky-100/90">
              <span className={`mr-1 font-medium ${side === "A" ? "text-indigo-200" : "text-fuchsia-200"}`}>{side} 腿</span>
              <span className="text-sky-200/70" title={label}>{label}</span>：{notice.message}
            </p>
          ))}
        </div>
      )}

      {result.status !== "ready" && (
        <div
          role={unsupported ? "alert" : "status"}
          className={`mb-2 rounded border px-2 py-1.5 ${unsupported ? "border-rose-500/40 bg-rose-950/20" : "border-gray-700 bg-gray-950/40"}`}
        >
          <p className={`text-[11px] font-semibold ${unsupported ? "text-rose-200" : "text-gray-300"}`}>
            {unsupported
              ? "暂不支持合成盘口"
              : loading
                ? "正在获取两腿盘口…"
                : "合成盘口暂不可用"}
          </p>
          {result.reason && <p className={`mt-0.5 text-[11px] leading-4 ${unsupported ? "text-rose-200/90" : "text-gray-400"}`}>{result.reason}</p>}
          {unsupported && <p className="mt-0.5 text-[10px] text-gray-500">两条腿需为 USD 计价（USDT、USDC 等按 1:1 折算）；单腿盘口仍可分别查看。</p>}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.85fr)]">
        <LegBook side="A" target={targetA} label={labelA} state={stateA} timing={timingA} skew={skew} clockNow={clockNow} vwapNotionalUsdt={budget} />

        <div className="min-w-0 space-y-2 rounded border border-gray-700/80 bg-gray-900/60 p-2" aria-label="中间合成盘口">
          <DirectionBlock direction="buy" mode={mode} side={result.buy} targetA={targetA} targetB={targetB} />
          <CombinationSpreadSummary mode={mode} metrics={result.metrics} />
          <DirectionBlock direction="sell" mode={mode} side={result.sell} targetA={targetA} targetB={targetB} />
          <p className="text-[10px] leading-4 text-gray-500">
            每方向最多 5 段等名义撮合；累计 USDT 为两腿在该方向上共同成交的名义金额，不代表任一单腿的完整深度。
          </p>
        </div>

        <LegBook side="B" target={targetB} label={labelB} state={stateB} timing={timingB} skew={skew} clockNow={clockNow} vwapNotionalUsdt={budget} />
      </div>
    </section>
  );
}
