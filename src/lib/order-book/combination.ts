import { isUsdQuote } from "./quote";
import type { BookSessionState, BookTarget, NormalizedOrderBook } from "./types";

export type CombinationBookMode = "spread" | "ratio";

export interface CombinationBookLevel {
  value: number;
  notionalUsdt: number;
  cumulativeNotionalUsdt: number;
  priceA: number;
  priceB: number;
}

export interface CombinationBookSide {
  levels: CombinationBookLevel[];
  error: string | null;
}

/**
 * One signed buy/sell spread reading. `difference` is `buyValue - sellValue`
 * and keeps its sign: a negative reading is a legitimate outcome, not an error.
 * A single leg's `percent` uses its absolute midpoint; a combination's percent
 * adds the two corresponding leg percentages. Missing or non-finite inputs
 * withhold only the percentage, not an otherwise finite difference.
 */
export interface CombinationBookSpreadMetric {
  buyValue: number;
  sellValue: number;
  difference: number;
  percent: number | null;
}

export interface CombinationBookMetrics {
  best: CombinationBookSpreadMetric | null;
  vwap: CombinationBookSpreadMetric | null;
  vwapNotionalUsdt: number;
  bestReason: string | null;
  vwapReason: string | null;
}

export interface CombinationBookResult {
  status: "ready" | "unavailable" | "unsupported";
  reason: string | null;
  buy: CombinationBookSide;
  sell: CombinationBookSide;
  metrics: CombinationBookMetrics;
}

/** Freshness budget for each leg's frame; a UI may quote this in its caption. */
export const COMBINATION_MAX_FRAME_AGE_MS = 20_000;
/** Maximum allowed difference between the two legs' local receipt times. */
export const COMBINATION_MAX_SKEW_MS = 10_000;
/** Per-leg quote-currency budget behind the published VWAP readings. */
export const COMBINATION_VWAP_NOTIONAL_USDT = 5000;
/** Matching segments per direction. The UI pads short sides itself. */
const MAX_SEGMENTS = 5;

type SideLevels = NormalizedOrderBook["bids"];

interface PreparedLevel {
  price: number;
  notional: number;
}

function emptyMetrics(reason: string, budget: number): CombinationBookMetrics {
  return {
    best: null,
    vwap: null,
    vwapNotionalUsdt: budget,
    bestReason: reason,
    vwapReason: reason,
  };
}

function emptyResult(
  status: CombinationBookResult["status"],
  reason: string | null,
  budget: number,
): CombinationBookResult {
  return {
    status,
    reason,
    buy: { levels: [], error: null },
    sell: { levels: [], error: null },
    // An unusable result publishes no numbers at all; both readings carry the
    // same explanation so the UI never shows a stale or guessed metric. The
    // budget is still echoed so the caption does not fall back to 5000.
    metrics: emptyMetrics(reason ?? "组合盘口不可用", budget),
  };
}

/**
 * Resolve the per-leg quote-currency VWAP budget. An absent value means the
 * documented default; any explicit value must be a positive finite number and is
 * otherwise reported as invalid. An invalid budget only starves the VWAP reading
 * — the best spread and the raw matched levels are unaffected.
 */
function resolveBudget(value: number | undefined): { budget: number; reason: string | null } {
  if (value === undefined) return { budget: COMBINATION_VWAP_NOTIONAL_USDT, reason: null };
  if (!Number.isFinite(value) || value <= 0) {
    return {
      // Keep the echoed budget finite and usable for UI copy; the invalid
      // selection itself is reported through the VWAP reason instead.
      budget: COMBINATION_VWAP_NOTIONAL_USDT,
      reason: `VWAP 预算 ${String(value)} 无效（需为正的有限数值），已跳过 VWAP`,
    };
  }
  return { budget: value, reason: null };
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function legProblem(
  label: "A" | "B",
  target: BookTarget | null,
  state: BookSessionState,
  nowMs: number,
  maxFrameAgeMs: number,
): string | null {
  if (target === null) return `${label} 腿未选择市场，无法合成`;
  if (state.status !== "live") return `${label} 腿盘口状态为 ${state.status}，不是实时行情`;
  const frame = state.frame;
  if (frame === null) return `${label} 腿尚未收到有效的盘口快照`;
  // The whole identity tuple must match the selected target: a frame for the
  // same asset but another venue/market is not interchangeable.
  if (
    frame.targetId !== target.id
    || frame.baseAsset !== target.baseAsset
    || frame.quantityUnit !== "base"
  ) {
    return `${label} 腿盘口与所选市场不一致（市场标识、标的资产或数量单位不匹配）`;
  }
  if (!Number.isFinite(frame.receivedAtMs)) return `${label} 腿盘口收取时间无效`;
  if (frame.receivedAtMs > nowMs) return `${label} 腿盘口收取时间晚于当前时间`;
  const age = nowMs - frame.receivedAtMs;
  if (age > maxFrameAgeMs) {
    return `${label} 腿盘口已过期（${Math.round(age)}ms 前收到，上限 ${maxFrameAgeMs}ms）`;
  }
  return null;
}

/**
 * Validate and aggregate the full depth of one source side, then order it for
 * consumption. Invalid or overflowing input rejects the whole direction: a
 * half-prefix would look immediately tradable when it is not.
 */
function prepareSide(
  levels: SideLevels,
  descending: boolean,
  label: string,
): { levels: PreparedLevel[] } | { error: string } {
  if (!Array.isArray(levels)) return { error: `${label} 盘口档位缺失，已拒绝该方向` };
  const byPrice = new Map<number, number>();
  for (const level of levels) {
    if (
      !level
      || !Number.isFinite(level.price) || level.price <= 0
      || !Number.isFinite(level.quantity) || level.quantity <= 0
    ) {
      return { error: `${label} 存在非有限或非正的价格/数量，已拒绝该方向` };
    }
    const total = (byPrice.get(level.price) ?? 0) + level.quantity;
    if (!Number.isFinite(total) || total <= 0) {
      return { error: `${label} 同价数量累加溢出，已拒绝该方向` };
    }
    byPrice.set(level.price, total);
  }
  const prepared: PreparedLevel[] = [];
  for (const [price, quantity] of [...byPrice].sort(([a], [b]) => (descending ? b - a : a - b))) {
    const notional = price * quantity;
    // A product that collapses to zero is a lost level, not a free one.
    if (!Number.isFinite(notional) || notional <= 0) {
      return { error: `${label} 名义金额溢出或下溢为零，已拒绝该方向` };
    }
    prepared.push({ price, notional });
  }
  return { levels: prepared };
}

function combinationValue(
  mode: CombinationBookMode,
  priceA: number,
  priceB: number,
): number | null {
  const value = mode === "ratio" ? priceA / priceB : priceA - priceB;
  if (!Number.isFinite(value)) return null;
  // Spread legitimately reaches zero or turns negative; a ratio of two positive
  // prices may not.
  if (mode === "ratio" && value <= 0) return null;
  return value;
}

function failedSide(error: string): CombinationBookSide {
  return { levels: [], error };
}

/**
 * Percentage of the spread over the absolute midpoint. Withholding it (rather
 * than inventing a number) covers a zero or overflowing midpoint; `difference`
 * itself is validated separately by the caller.
 */
function percentOf(buyValue: number, sellValue: number): number | null {
  if (!Number.isFinite(buyValue) || !Number.isFinite(sellValue)) return null;
  const midpoint = Math.abs((buyValue + sellValue) / 2);
  if (!Number.isFinite(midpoint) || midpoint <= 0) return null;
  const raw = ((buyValue - sellValue) / midpoint) * 100;
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Additive percentage composition for a two-leg combination: the composite
 * percent is each leg's own percent added together. A missing or overflowing
 * operand only drops the percentage, never the finite absolute readings.
 */
function sumPercent(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const total = a + b;
  return Number.isFinite(total) ? total : null;
}

/** Build a metric with an externally supplied percent. */
function metricWithPercent(
  buyValue: number,
  sellValue: number,
  percent: number | null,
): CombinationBookSpreadMetric | null {
  if (!Number.isFinite(buyValue) || !Number.isFinite(sellValue)) return null;
  const difference = buyValue - sellValue;
  if (!Number.isFinite(difference)) return null;
  return {
    buyValue,
    sellValue,
    difference,
    percent: percent !== null && Number.isFinite(percent) ? percent : null,
  };
}

/**
 * Signed buy/sell spread reading. `difference` keeps its sign on purpose: a
 * negative reading means the sell side is richer and is a real observation.
 * Only a non-finite buy/sell pair or difference rejects the metric; a broken
 * percent denominator merely leaves `percent` null.
 */
function spreadMetric(
  buyValue: number,
  sellValue: number,
): CombinationBookSpreadMetric | null {
  return metricWithPercent(buyValue, sellValue, percentOf(buyValue, sellValue));
}

/**
 * Quote-currency budgeted VWAP for one leg over its *full* prepared depth, so
 * the reading is independent of the five-segment display window. The last level
 * is consumed partially for exactly the remaining budget; the leg VWAP divides
 * the quote currency actually spent by the base quantity it bought. Partial
 * budgets are never published: if the leg cannot absorb the whole budget the
 * caller gets a reason instead of a number.
 */
function legVwap(
  levels: PreparedLevel[],
  label: string,
  budget: number,
): { value: number } | { reason: string } {
  if (!Number.isFinite(budget) || budget <= 0) {
    return { reason: `${label}预算无效，无法计算 VWAP` };
  }
  // Decide sufficiency from the whole-depth total first, so a floating-point
  // residue in the consumption loop can never masquerade as missing liquidity
  // (or the reverse).
  let depth = 0;
  for (const level of levels) {
    const next = depth + level.notional;
    if (!Number.isFinite(next)) {
      return { reason: `${label}总深度名义金额溢出，无法计算 VWAP` };
    }
    depth = next;
  }
  // Summing level notionals and subtracting them one by one is not bit-identical,
  // so a budget that is really fully spent can leave a few ULPs behind. The
  // tolerance covers only that rounding-level residue, never real shortfall.
  const tolerance = budget * Number.EPSILON * 8 * Math.max(1, levels.length);
  if (depth < budget - tolerance) {
    return { reason: `${label}深度不足 ${budget} 报价币，不发布部分预算 VWAP` };
  }

  let remaining = budget;
  let baseQuantity = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const spend = Math.min(remaining, level.notional);
    if (!Number.isFinite(spend) || spend <= 0) {
      return { reason: `${label}预算消耗无效，无法计算 VWAP` };
    }
    const quantity = spend / level.price;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { reason: `${label}base 数量溢出或为零，无法计算 VWAP` };
    }
    const nextQuantity = baseQuantity + quantity;
    if (!Number.isFinite(nextQuantity) || nextQuantity <= baseQuantity) {
      return { reason: `${label}base 数量累加溢出，无法计算 VWAP` };
    }
    baseQuantity = nextQuantity;
    // Exact partial fill on the final level: spend === remaining leaves 0, and
    // spend is capped by remaining so this can never go negative.
    remaining -= spend;
  }
  // The precheck only proves the depth exists; it does not prove the loop
  // actually spent the budget. Summing level notionals and subtracting them one
  // by one is not bit-identical, so a "5000" total can hide a shortfall of a few
  // ULPs. Residue inside the tolerance is rounding-level and harmless; anything
  // larger means the base quantity is short and dividing would publish a VWAP
  // for a partial budget.
  if (remaining > tolerance) {
    return { reason: `${label}预算未足额成交，不发布部分预算 VWAP` };
  }
  // Divide by what was actually spent, never the nominal budget: baseQuantity is
  // the base bought by `spent`, so this keeps the numerator and denominator
  // consistent even when the residue is nonzero.
  const spent = budget - remaining;
  const value = spent / baseQuantity;
  if (!Number.isFinite(value) || value <= 0) {
    return { reason: `${label}VWAP 溢出或无效` };
  }
  return { value };
}

function bestUnavailableReason(
  buy: CombinationBookSide,
  sell: CombinationBookSide,
): string | null {
  const missingBuy = buy.levels[0] === undefined;
  const missingSell = sell.levels[0] === undefined;
  if (!missingBuy && !missingSell) {
    return "最佳点差的买卖值非有限，已拒绝该指标";
  }
  const problems: string[] = [];
  if (missingBuy) problems.push(buy.error ?? "买方向没有可用的合成档位");
  if (missingSell) problems.push(sell.error ?? "卖方向没有可用的合成档位");
  return `最佳点差不可用：${problems.join("；")}`;
}

/**
 * Equal-notional double-pointer matching. Both legs consume the same USD
 * notional per segment, so the emitted notional is the matched amount rather
 * than the sum of both legs.
 */
function matchDirection(
  mode: CombinationBookMode,
  a: PreparedLevel[],
  b: PreparedLevel[],
  prefix: string,
): CombinationBookSide {
  const levels: CombinationBookLevel[] = [];
  let i = 0;
  let j = 0;
  let remainingA = a.length > 0 ? a[0].notional : 0;
  let remainingB = b.length > 0 ? b[0].notional : 0;
  let cumulative = 0;

  while (i < a.length && j < b.length && levels.length < MAX_SEGMENTS) {
    if (!Number.isFinite(remainingA) || remainingA <= 0 || !Number.isFinite(remainingB) || remainingB <= 0) {
      return failedSide(`${prefix}名义余额无效或未推进，已拒绝该方向`);
    }
    const aLevel = a[i];
    const bLevel = b[j];
    // Decide exhaustion from the pre-subtraction comparison; no epsilon is used
    // and no quantity is discarded.
    const consumeA = remainingA <= remainingB;
    const matched = consumeA ? remainingA : remainingB;
    const value = combinationValue(mode, aLevel.price, bLevel.price);
    if (value === null) return failedSide(`${prefix}合成值溢出或下溢，已拒绝该方向`);
    const nextCumulative = cumulative + matched;
    if (!Number.isFinite(nextCumulative) || nextCumulative <= cumulative) {
      return failedSide(`${prefix}累计名义金额溢出或未推进，已拒绝该方向`);
    }
    levels.push({
      value,
      notionalUsdt: matched,
      cumulativeNotionalUsdt: nextCumulative,
      priceA: aLevel.price,
      priceB: bLevel.price,
    });
    cumulative = nextCumulative;

    const afterA = consumeA ? 0 : remainingA - matched;
    const afterB = consumeA ? remainingB - matched : 0;
    if (!Number.isFinite(afterA) || afterA < 0 || !Number.isFinite(afterB) || afterB < 0) {
      return failedSide(`${prefix}余额扣减出现无效结果，已拒绝该方向`);
    }
    // At least one balance must strictly shrink; otherwise the same levels would
    // repeat forever and the matched quantity would be silently lost.
    if (afterA >= remainingA && afterB >= remainingB) {
      return failedSide(`${prefix}余额扣减未推进，已拒绝该方向`);
    }
    if (afterA === 0) {
      i += 1;
      remainingA = i < a.length ? a[i].notional : 0;
    } else {
      remainingA = afterA;
    }
    if (afterB === 0) {
      j += 1;
      remainingB = j < b.length ? b[j].notional : 0;
    } else {
      remainingB = afterB;
    }
  }
  return { levels, error: null };
}

export function buildCombinationOrderBook(input: {
  targetA: BookTarget | null;
  targetB: BookTarget | null;
  stateA: BookSessionState;
  stateB: BookSessionState;
  mode: CombinationBookMode;
  nowMs: number;
  maxFrameAgeMs?: number;
  maxSkewMs?: number;
  /** Per-leg quote-currency VWAP budget; defaults to the exported constant. */
  vwapNotionalUsdt?: number;
}): CombinationBookResult {
  const { targetA, targetB, stateA, stateB, mode, nowMs } = input;
  const maxFrameAgeMs = boundedLimit(input.maxFrameAgeMs, COMBINATION_MAX_FRAME_AGE_MS);
  const maxSkewMs = boundedLimit(input.maxSkewMs, COMBINATION_MAX_SKEW_MS);
  const resolved = resolveBudget(input.vwapNotionalUsdt);

  if (mode !== "spread" && mode !== "ratio") {
    return emptyResult("unavailable", `不支持的合成模式：${String(mode)}`, resolved.budget);
  }
  if (!Number.isFinite(nowMs)) {
    return emptyResult("unavailable", "当前时间无效，无法校验盘口新鲜度", resolved.budget);
  }

  // Both legs must settle in a USD-pegged quote, treated as 1:1. Membership is a
  // case-insensitive substring test on the *quote* name only: FDUSD, BUSD, TUSD,
  // USD1, USDC and USDE all qualify, while a base asset containing "USD" never
  // makes a non-USD pair eligible. This hard capability boundary is checked
  // before any freshness problem so the UI explains the real blocker.
  const nonUsd: string[] = [];
  if (targetA !== null && !isUsdQuote(targetA.quoteAsset)) {
    nonUsd.push(`A=${targetA.quoteAsset}`);
  }
  if (targetB !== null && !isUsdQuote(targetB.quoteAsset)) {
    nonUsd.push(`B=${targetB.quoteAsset}`);
  }
  if (nonUsd.length > 0) {
    return emptyResult(
      "unsupported",
      `合成盘口仅支持两腿均为 USD 计价（USD/USDT/USDC/FDUSD/BUSD/TUSD/USD1/USDE 视为 1:1 等价），当前 ${nonUsd.join("，")} 不是 USD 计价`,
      resolved.budget,
    );
  }

  const problemA = legProblem("A", targetA, stateA, nowMs, maxFrameAgeMs);
  if (problemA !== null) return emptyResult("unavailable", problemA, resolved.budget);
  const problemB = legProblem("B", targetB, stateB, nowMs, maxFrameAgeMs);
  if (problemB !== null) return emptyResult("unavailable", problemB, resolved.budget);

  const frameA = stateA.frame;
  const frameB = stateB.frame;
  if (frameA === null || frameB === null) {
    return emptyResult("unavailable", "两腿盘口快照缺失，无法合成", resolved.budget);
  }
  const skew = Math.abs(frameA.receivedAtMs - frameB.receivedAtMs);
  if (skew > maxSkewMs) {
    return emptyResult(
      "unavailable",
      `A 与 B 腿盘口收取时间差 ${Math.round(skew)}ms 超过上限 ${maxSkewMs}ms`,
      resolved.budget,
    );
  }

  const budget = resolved.budget;

  // Every error carries its direction so a buy-side rejection can never be
  // mistaken for a sell-side one (and vice versa) in the panel copy.
  const buyA = prepareSide(frameA.book.asks, false, "买方向：A 卖盘（asks）");
  const buyB = prepareSide(frameB.book.bids, true, "买方向：B 买盘（bids）");
  const buy: CombinationBookSide = "error" in buyA
    ? failedSide(buyA.error)
    : "error" in buyB
      ? failedSide(buyB.error)
      : matchDirection(mode, buyA.levels, buyB.levels, "买方向：");

  const sellA = prepareSide(frameA.book.bids, true, "卖方向：A 买盘（bids）");
  const sellB = prepareSide(frameB.book.asks, false, "卖方向：B 卖盘（asks）");
  const sell: CombinationBookSide = "error" in sellA
    ? failedSide(sellA.error)
    : "error" in sellB
      ? failedSide(sellB.error)
      : matchDirection(mode, sellA.levels, sellB.levels, "卖方向：");

  const buyALevels = "error" in buyA ? null : buyA.levels;
  const buyBLevels = "error" in buyB ? null : buyB.levels;
  const sellALevels = "error" in sellA ? null : sellA.levels;
  const sellBLevels = "error" in sellB ? null : sellB.levels;

  // The composite percent is *additive* across legs: each leg contributes its
  // own ask-vs-bid percent, so the number stays true to what a single-leg view
  // shows and no longer depends on the synthetic midpoint of the combination.
  const bestBuy = buy.levels[0];
  const bestSell = sell.levels[0];
  let best: CombinationBookSpreadMetric | null = null;
  let bestReason: string | null = null;
  if (bestBuy === undefined || bestSell === undefined) {
    bestReason = bestUnavailableReason(buy, sell);
  } else {
    const legPercent = sumPercent(
      buyALevels?.[0] !== undefined && sellALevels?.[0] !== undefined
        ? percentOf(buyALevels[0].price, sellALevels[0].price)
        : null,
      sellBLevels?.[0] !== undefined && buyBLevels?.[0] !== undefined
        ? percentOf(sellBLevels[0].price, buyBLevels[0].price)
        : null,
    );
    best = metricWithPercent(bestBuy.value, bestSell.value, legPercent);
    if (best === null) bestReason = "最佳点差的买卖值非有限，已拒绝该指标";
  }

  // The VWAP readings deliberately reuse the *full* prepared depth rather than
  // the five-segment display window, so the published number reflects all
  // received liquidity and never averaged synthetic level notionals. Each of the
  // four prepared sides feeds exactly one direction, so each is priced once.
  let vwap: CombinationBookSpreadMetric | null = null;
  let vwapReason: string | null = null;
  if (resolved.reason !== null) {
    vwapReason = resolved.reason;
  } else if (buy.error !== null) {
    vwapReason = buy.error;
  } else if (sell.error !== null) {
    vwapReason = sell.error;
  } else if (
    buyALevels === null || buyBLevels === null
    || sellALevels === null || sellBLevels === null
  ) {
    vwapReason = "深度预处理失败，无法计算 VWAP";
  } else {
    const buyAskA = legVwap(buyALevels, "买方向A 腿", budget);
    const buyBidB = legVwap(buyBLevels, "买方向B 腿", budget);
    const sellBidA = legVwap(sellALevels, "卖方向A 腿", budget);
    const sellAskB = legVwap(sellBLevels, "卖方向B 腿", budget);
    if ("reason" in buyAskA) {
      vwapReason = buyAskA.reason;
    } else if ("reason" in buyBidB) {
      vwapReason = buyBidB.reason;
    } else if ("reason" in sellBidA) {
      vwapReason = sellBidA.reason;
    } else if ("reason" in sellAskB) {
      vwapReason = sellAskB.reason;
    } else {
      const buyValue = combinationValue(mode, buyAskA.value, buyBidB.value);
      const sellValue = combinationValue(mode, sellBidA.value, sellAskB.value);
      if (buyValue === null || sellValue === null) {
        vwapReason = "VWAP 点差的买卖值非有限，已拒绝该指标";
      } else {
        // Additive just like best: leg A's own ask-VWAP-vs-bid-VWAP percent plus
        // leg B's, so the composite matches the single-leg readings exactly.
        const legPercent = sumPercent(
          percentOf(buyAskA.value, sellBidA.value),
          percentOf(sellAskB.value, buyBidB.value),
        );
        vwap = metricWithPercent(buyValue, sellValue, legPercent);
        if (vwap === null) vwapReason = "VWAP 点差的买卖值非有限，已拒绝该指标";
      }
    }
  }

  return {
    status: "ready",
    reason: null,
    buy,
    sell,
    metrics: {
      best,
      vwap,
      vwapNotionalUsdt: budget,
      bestReason,
      vwapReason,
    },
  };
}

/**
 * Best spread and quote-currency VWAP spread for a *single* leg. The leg is its
 * own market, so there is no cross-leg freshness/skew check and no USD-quote
 * restriction: both legs of a combination may be quoted in any currency and each
 * reading is denominated in that leg's own quote asset.
 *
 * `buyValue` is the best ask and `sellValue` the best bid, so `difference` is
 * `ask - bid` with its sign preserved. A shallow book still publishes `best`; it
 * only blocks `vwap`, which must never be a partial-budget number.
 */
export function buildLegOrderBookMetrics(input: {
  target: BookTarget | null;
  state: BookSessionState;
  nowMs: number;
  label?: "A" | "B";
  /** Quote-currency VWAP budget; defaults to the exported constant. */
  vwapNotionalUsdt?: number;
}): CombinationBookMetrics {
  const label = input.label ?? "A";
  const resolved = resolveBudget(input.vwapNotionalUsdt);
  if (!Number.isFinite(input.nowMs)) {
    return emptyMetrics(`${label} 腿当前时间无效，无法校验盘口新鲜度`, resolved.budget);
  }
  // Reuses the combination guard verbatim: live status, frame identity, quantity
  // unit and freshness all have to hold even though no second leg is involved.
  const problem = legProblem(
    label,
    input.target,
    input.state,
    input.nowMs,
    COMBINATION_MAX_FRAME_AGE_MS,
  );
  if (problem !== null) return emptyMetrics(problem, resolved.budget);
  const frame = input.state.frame;
  if (frame === null) return emptyMetrics(`${label} 腿尚未收到有效的盘口快照`, resolved.budget);

  const asks = prepareSide(frame.book.asks, false, `${label} 腿：卖盘（asks）`);
  const bids = prepareSide(frame.book.bids, true, `${label} 腿：买盘（bids）`);

  // Best uses only the top of each side, so it survives a book that cannot fill
  // the VWAP budget.
  let best: CombinationBookSpreadMetric | null = null;
  let bestReason: string | null = null;
  if ("error" in asks || "error" in bids) {
    const problems = [
      "error" in asks ? asks.error : null,
      "error" in bids ? bids.error : null,
    ].filter((entry): entry is string => entry !== null);
    bestReason = `最佳点差不可用：${problems.join("；")}`;
  } else {
    const askTop = asks.levels[0];
    const bidTop = bids.levels[0];
    if (askTop === undefined || bidTop === undefined) {
      const missing = [
        askTop === undefined ? `${label} 腿卖盘没有可用档位` : null,
        bidTop === undefined ? `${label} 腿买盘没有可用档位` : null,
      ].filter((entry): entry is string => entry !== null);
      bestReason = `最佳点差不可用：${missing.join("；")}`;
    } else {
      best = spreadMetric(askTop.price, bidTop.price);
      if (best === null) bestReason = "最佳点差的买卖值非有限，已拒绝该指标";
    }
  }

  let vwap: CombinationBookSpreadMetric | null = null;
  let vwapReason: string | null = null;
  if (resolved.reason !== null) {
    vwapReason = resolved.reason;
  } else if ("error" in asks) {
    vwapReason = asks.error;
  } else if ("error" in bids) {
    vwapReason = bids.error;
  } else {
    const askVwap = legVwap(asks.levels, `${label} 腿卖盘（asks）`, resolved.budget);
    if ("reason" in askVwap) {
      vwapReason = askVwap.reason;
    } else {
      const bidVwap = legVwap(bids.levels, `${label} 腿买盘（bids）`, resolved.budget);
      if ("reason" in bidVwap) {
        vwapReason = bidVwap.reason;
      } else {
        vwap = spreadMetric(askVwap.value, bidVwap.value);
        if (vwap === null) vwapReason = "VWAP 点差的买卖值非有限，已拒绝该指标";
      }
    }
  }

  return {
    best,
    vwap,
    vwapNotionalUsdt: resolved.budget,
    bestReason,
    vwapReason,
  };
}
