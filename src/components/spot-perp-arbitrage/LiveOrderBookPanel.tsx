"use client";

import { projectOrderBook, toBookTarget } from "@/lib/order-book/project";
import type { BookFrame, BookSessionState, BookTarget } from "@/lib/order-book/types";
import { marketId, type ArbitrageMarket } from "@/lib/spot-perp-arbitrage/model";

export interface LiveBookPreference {
  targetId: string | null;
  open: boolean;
  wsMode: boolean;
}

/** Reset controls whenever the active market identity changes, including close/reopen. */
export function preferenceForTargetChange(current: LiveBookPreference, targetId: string | null): LiveBookPreference {
  return current.targetId === targetId ? current : { targetId, open: false, wsMode: false };
}

/** Use the refreshed market row, not the stale selection snapshot held by a chart plan. */
export function resolveLiveBookTarget(
  plannedMarket: ArbitrageMarket | undefined,
  currentMarkets: readonly ArbitrageMarket[],
): BookTarget | null {
  if (!plannedMarket) return null;
  const selectedId = marketId(plannedMarket);
  const currentMarket = currentMarkets.find((market) => marketId(market) === selectedId);
  return currentMarket ? toBookTarget(currentMarket) : null;
}

export function shouldShowLiveBookToggle(options: {
  open: boolean;
  targetId: string | null;
  chartPayloadTargetId: string | null;
  hasValidCandles: boolean;
}): boolean {
  return options.open || Boolean(
    options.targetId
    && options.targetId === options.chartPayloadTargetId
    && options.hasValidCandles,
  );
}

interface LiveOrderBookPanelProps {
  target: BookTarget;
  state: BookSessionState;
  wsMode: boolean;
  onWsModeChange: (enabled: boolean) => void;
}

function quantity(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", { maximumSignificantDigits: 8 });
}

/** Calculate both displayed units only after real levels are projected. */
export function cumulativeQuantities(
  levels: readonly { price: number; quantity: number; cumulativeQuantity: number }[],
): { base: Array<number | undefined>; quote: Array<number | undefined> } {
  const base = levels.map((level) => Number.isFinite(level.cumulativeQuantity) && level.cumulativeQuantity > 0
    ? level.cumulativeQuantity
    : undefined);
  let total = 0;
  let valid = true;
  const quote = levels.map((level) => {
    if (!valid || !Number.isFinite(level.price) || level.price <= 0 || !Number.isFinite(level.quantity) || level.quantity <= 0) {
      valid = false;
      return undefined;
    }
    const next = total + level.price * level.quantity;
    if (!Number.isFinite(next)) {
      valid = false;
      return undefined;
    }
    total = next;
    return total;
  });
  return { base, quote };
}

function clock(value: number): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Actual transport/book mode of an accepted frame, shared with the combined book. */
export function bookSourceLabel(frame: BookFrame): string {
  const book = frame.source.bookMode === "rpi" ? "普通 + RPI" : "普通盘口";
  const transport = frame.source.transport === "ws" ? "WS" : "REST · 每5秒刷新";
  return `${book} · ${transport}`;
}

export default function LiveOrderBookPanel({ target, state, wsMode, onWsModeChange }: LiveOrderBookPanelProps) {
  const projected = state.frame ? projectOrderBook(state.frame.book) : null;
  const loading = state.status === "idle" || state.status === "connecting";
  const stale = state.status === "stale";
  const empty = !state.frame && !loading && state.status !== "error";
  const bids = projected?.bids ?? [];
  const asks = projected?.asks ?? [];
  const bidTotals = cumulativeQuantities(bids);
  const askTotals = cumulativeQuantities(asks);

  return (
    <section className="mb-2 rounded-md border border-gray-700 bg-gray-900/70 p-3" aria-label={`${target.exchange} ${target.rawSymbol} 实时盘口`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-xs font-semibold text-gray-200">{target.exchange} {target.rawSymbol} · 实时盘口</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="盘口显示选项">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-gray-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-cyan-300">
            <input type="checkbox" checked={wsMode} onChange={(event) => onWsModeChange(event.currentTarget.checked)} className="h-4 w-4 accent-cyan-400" />
            WS模式
          </label>
        </div>
      </div>

      {state.frame && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
          <span>实际来源：{bookSourceLabel(state.frame)}</span>
          <span>收取时间：{clock(state.frame.receivedAtMs)}</span>
          {stale && <span className="rounded border border-amber-500/40 bg-amber-950/40 px-1.5 py-0.5 font-medium text-amber-200">数据已过期 · 显示上次更新</span>}
        </div>
      )}

      {state.notices.map((notice) => (
        <p key={notice.id} className="mb-2 text-xs text-amber-300" role="status">{notice.message}</p>
      ))}
      {state.error && <p className="mb-2 text-xs text-rose-300" role="alert">盘口暂不可用：{state.error.message}</p>}
      {loading && !state.frame && <p className="py-3 text-center text-xs text-gray-400" role="status">正在连接并获取盘口…</p>}
      {loading && state.frame && <p className="mb-1 text-[11px] text-gray-500" role="status">正在更新盘口…</p>}
      {empty && <p className="py-3 text-center text-xs text-gray-400">暂无盘口数据</p>}

      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[54rem] table-fixed border-collapse text-[11px] tabular-nums">
          <caption className="sr-only">{target.exchange} {target.rawSymbol} 买卖双方各五档实时盘口</caption>
          <colgroup>
            <col className="w-[8.5rem]" /><col className="w-[8rem]" /><col className="w-[7rem]" />
            <col className="w-[4rem]" /><col className="w-[7rem]" /><col className="w-[8rem]" /><col className="w-[8.5rem]" />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-700 text-[10px] text-gray-400">
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium text-emerald-300">累计数量（{target.quoteAsset}）</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium text-emerald-300">累计数量（{target.baseAsset}）</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right font-medium text-emerald-300">买盘价格</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-center font-medium text-gray-400">档位</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-left font-medium text-rose-300">卖盘价格</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-left font-medium text-rose-300">累计数量（{target.baseAsset}）</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-left font-medium text-rose-300">累计数量（{target.quoteAsset}）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/70">
            {Array.from({ length: 5 }, (_, index) => {
              const bid = bids[index];
              const ask = asks[index];
              return <tr key={index + 1}>
                <td className="whitespace-nowrap px-2 py-2 text-right text-emerald-200">{quantity(bid ? bidTotals.quote[index] : undefined)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-emerald-200">{quantity(bid ? bidTotals.base[index] : undefined)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-emerald-300">{quantity(bid?.price)}</td>
                <th scope="row" className="px-2 py-2 text-center font-medium text-gray-500">{index + 1}</th>
                <td className="whitespace-nowrap px-2 py-2 text-left text-rose-300">{quantity(ask?.price)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-left text-rose-200">{quantity(ask ? askTotals.base[index] : undefined)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-left text-rose-200">{quantity(ask ? askTotals.quote[index] : undefined)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
