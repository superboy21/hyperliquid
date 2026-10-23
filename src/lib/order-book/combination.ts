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

export interface CombinationBookResult {
  status: "ready" | "unavailable" | "unsupported";
  reason: string | null;
  buy: CombinationBookSide;
  sell: CombinationBookSide;
}

/** Freshness budget for each leg's frame; a UI may quote this in its caption. */
export const COMBINATION_MAX_FRAME_AGE_MS = 20_000;
/** Maximum allowed difference between the two legs' local receipt times. */
export const COMBINATION_MAX_SKEW_MS = 10_000;
/** Matching segments per direction. The UI pads short sides itself. */
const MAX_SEGMENTS = 5;

type SideLevels = NormalizedOrderBook["bids"];

interface PreparedLevel {
  price: number;
  notional: number;
}

function emptyResult(
  status: CombinationBookResult["status"],
  reason: string | null,
): CombinationBookResult {
  return {
    status,
    reason,
    buy: { levels: [], error: null },
    sell: { levels: [], error: null },
  };
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
}): CombinationBookResult {
  const { targetA, targetB, stateA, stateB, mode, nowMs } = input;
  const maxFrameAgeMs = boundedLimit(input.maxFrameAgeMs, COMBINATION_MAX_FRAME_AGE_MS);
  const maxSkewMs = boundedLimit(input.maxSkewMs, COMBINATION_MAX_SKEW_MS);

  if (mode !== "spread" && mode !== "ratio") {
    return emptyResult("unavailable", `不支持的合成模式：${String(mode)}`);
  }
  if (!Number.isFinite(nowMs)) {
    return emptyResult("unavailable", "当前时间无效，无法校验盘口新鲜度");
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
    );
  }

  const problemA = legProblem("A", targetA, stateA, nowMs, maxFrameAgeMs);
  if (problemA !== null) return emptyResult("unavailable", problemA);
  const problemB = legProblem("B", targetB, stateB, nowMs, maxFrameAgeMs);
  if (problemB !== null) return emptyResult("unavailable", problemB);

  const frameA = stateA.frame;
  const frameB = stateB.frame;
  if (frameA === null || frameB === null) {
    return emptyResult("unavailable", "两腿盘口快照缺失，无法合成");
  }
  const skew = Math.abs(frameA.receivedAtMs - frameB.receivedAtMs);
  if (skew > maxSkewMs) {
    return emptyResult(
      "unavailable",
      `A 与 B 腿盘口收取时间差 ${Math.round(skew)}ms 超过上限 ${maxSkewMs}ms`,
    );
  }

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

  return { status: "ready", reason: null, buy, sell };
}
