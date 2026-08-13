"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ImpactSpreadDetailResult } from "@/lib/impact-price";
import type { ImpactDepthMode } from "@/lib/order-book-impact";
import type { ArbitrageTableRow } from "@/lib/spot-perp-arbitrage";
import { formatAnnualizedRate, formatPrice, formatVolume } from "@/lib/types";

type SpreadMode = "top" | "impact";
type SortField =
  | "exchange"
  | "pair"
  | "midpoint"
  | "indexPrice"
  | "change24h"
  | "premium"
  | "predictedFundingRate"
  | "quoteTurnover24h"
  | "openInterestNotional"
  | "historicalVolatility"
  | "spread"
  | "latestSettlementRate"
  | "averageFundingRate2d"
  | "averageFundingRate7d"
  | "averageFundingRate30d";

interface Props {
  rows: ArbitrageTableRow[];
  selectedLeg1Id: string | null;
  selectedLeg2Id: string | null;
  comboMode: boolean;
  detailLoading: ReadonlySet<string>;
  detailErrors: ReadonlySet<string>;
  impactLoading: ReadonlySet<string>;
  impactErrors: ReadonlySet<string>;
  impactResults: ReadonlyMap<string, ImpactSpreadDetailResult>;
  spreadMode: SpreadMode;
  onSpreadModeChange: (mode: SpreadMode) => void;
  impactNotional: number;
  impactNotionalPresets: readonly number[];
  customNotional: string;
  editingCustomNotional: boolean;
  onPresetChange: (value: string) => void;
  onCustomNotionalChange: (value: string) => void;
  onApplyCustomNotional: () => void;
  impactDepthMode: ImpactDepthMode;
  onToggleImpactDepth: () => void;
  onSelect: (row: ArbitrageTableRow) => void;
}

const EXCHANGE_DOT_COLORS: Record<string, string> = {
  Hyperliquid: "bg-blue-400",
  "Gate.io": "bg-cyan-400",
  Binance: "bg-yellow-400",
  Lighter: "bg-purple-400",
  OKX: "bg-emerald-400",
  Bitget: "bg-teal-400",
  Bybit: "bg-orange-400",
};

function formatSignedPercent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Green for positive funding rates, red for negative, gray at zero (matches the perp search page). */
function rateSignClass(value: number): string {
  return value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-gray-400";
}

function fundingIntervalLabel(row: ArbitrageTableRow): string {
  if (row.market.kind === "spot") return "--";

  const seconds = row.market.kind === "perp" ? row.market.source.fundingInterval : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function annualizedFundingValue(row: ArbitrageTableRow, value: number, average = false): number | null {
  if (row.market.kind === "spot" || !Number.isFinite(value)) return null;
  if (row.exchange === "Lighter") {
    return average
      ? value * 24 * 365
      : (value / 8) * 24 * 365 * 100;
  }
  const seconds = row.market.source.fundingInterval;
  return Number.isFinite(seconds) && seconds > 0
    ? value * ((24 * 3600) / seconds) * 365 * 100
    : null;
}

function annualizedLabel(row: ArbitrageTableRow, value: number, average = false): string {
  const annualized = annualizedFundingValue(row, value, average);
  if (annualized === null) return "--";
  if (row.exchange === "Lighter") {
    const digits = Math.abs(annualized) >= 100 ? 1 : Math.abs(annualized) >= 10 ? 2 : 3;
    return formatSignedPercent(annualized, digits);
  }
  return formatAnnualizedRate(value, row.market.kind === "perp" ? row.market.source.fundingInterval : 28800);
}

function valueForSort(row: ArbitrageTableRow, field: SortField, spreadMode: SpreadMode): number | string | null {
  if (field === "exchange") return row.exchange;
  if (field === "pair") return row.pair;
  if (field === "spread") return spreadMode === "top" ? row.topSpread : row.impactSpread;
  if (field === "predictedFundingRate") return annualizedFundingValue(row, row.predictedFundingRate ?? Number.NaN);
  if (field === "latestSettlementRate") return annualizedFundingValue(row, row.latestSettlementRate ?? Number.NaN);
  if (field === "averageFundingRate2d") return annualizedFundingValue(row, row.averageFundingRate2d ?? Number.NaN, true);
  if (field === "averageFundingRate7d") return annualizedFundingValue(row, row.averageFundingRate7d ?? Number.NaN, true);
  if (field === "averageFundingRate30d") return annualizedFundingValue(row, row.averageFundingRate30d ?? Number.NaN, true);
  return row[field];
}

function displayNumber(value: number | null, formatter: (value: number) => string, className = "text-gray-300") {
  return value === null
    ? <span className="text-gray-600">--</span>
    : <span className={`whitespace-nowrap font-mono text-xs ${className}`}>{formatter(value)}</span>;
}

function SortHeaderButton({
  field,
  children,
  sort,
  onSort,
}: {
  field: SortField;
  children: ReactNode;
  sort: { field: SortField; descending: boolean };
  onSort: (field: SortField) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="ml-auto flex items-center whitespace-nowrap rounded-sm hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      {children}
      <span aria-hidden="true" className={`ml-1 ${sort.field === field ? "text-gray-300" : "text-gray-600"}`}>
        {sort.field === field ? (sort.descending ? "↓" : "↑") : "↕"}
      </span>
    </button>
  );
}

export default function ArbitrageMarketTable({
  rows,
  selectedLeg1Id,
  selectedLeg2Id,
  comboMode,
  detailLoading,
  detailErrors,
  impactLoading,
  impactErrors,
  impactResults,
  spreadMode,
  onSpreadModeChange,
  impactNotional,
  impactNotionalPresets,
  customNotional,
  editingCustomNotional,
  onPresetChange,
  onCustomNotionalChange,
  onApplyCustomNotional,
  impactDepthMode,
  onToggleImpactDepth,
  onSelect,
}: Props) {
  const [sort, setSort] = useState<{ field: SortField; descending: boolean }>({
    field: "quoteTurnover24h",
    descending: true,
  });

  const sortedRows = useMemo(() => {
    return [...rows].sort((first, second) => {
      const a = valueForSort(first, sort.field, spreadMode);
      const b = valueForSort(second, sort.field, spreadMode);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      const comparison = typeof a === "string" && typeof b === "string"
        ? a.localeCompare(b)
        : Number(a) - Number(b);
      return sort.descending ? -comparison : comparison;
    });
  }, [rows, sort, spreadMode]);

  const toggleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      descending: current.field === field ? !current.descending : true,
    }));
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
      <table className="w-full min-w-[1680px]">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-800/95">
            <th className="px-2.5 py-2 text-left text-[11px] font-medium text-gray-400"><SortHeaderButton field="exchange" sort={sort} onSort={toggleSort}>交易所</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-left text-[11px] font-medium text-gray-400"><SortHeaderButton field="pair" sort={sort} onSort={toggleSort}>交易对</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="midpoint" sort={sort} onSort={toggleSort}>中间价</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="indexPrice" sort={sort} onSort={toggleSort}>指数价格</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="change24h" sort={sort} onSort={toggleSort}>24h涨跌</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="premium" sort={sort} onSort={toggleSort}>折溢价</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="predictedFundingRate" sort={sort} onSort={toggleSort}>预测费率</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="quoteTurnover24h" sort={sort} onSort={toggleSort}>24h成交额</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="openInterestNotional" sort={sort} onSort={toggleSort}>持仓价值</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="historicalVolatility" sort={sort} onSort={toggleSort}>历史波动率</SortHeaderButton></th>
            <th className="w-[190px] px-2.5 py-2 text-right text-[11px] font-medium text-gray-400">
              <div className="flex flex-col items-end gap-1.5">
                <SortHeaderButton field="spread" sort={sort} onSort={toggleSort}>买卖价差</SortHeaderButton>
                <div className="inline-flex rounded border border-gray-600 bg-gray-900/70 p-0.5" aria-label="价差类型">
                  {(["top", "impact"] as SpreadMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={spreadMode === mode}
                      onClick={() => onSpreadModeChange(mode)}
                      className={`rounded px-1.5 py-0.5 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300 ${
                        spreadMode === mode
                          ? mode === "top" ? "bg-blue-500/25 text-blue-300" : "bg-orange-500/25 text-orange-300"
                          : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {mode === "top" ? "Top" : "Impact"}
                    </button>
                  ))}
                </div>
              </div>
              {spreadMode === "impact" && (
                <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
                  <select
                    aria-label="Impact 名义金额"
                    value={editingCustomNotional ? "custom" : String(impactNotional)}
                    onChange={(event) => onPresetChange(event.target.value)}
                    className="rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-[9px] text-gray-300 outline-none focus:border-indigo-400"
                  >
                    {impactNotionalPresets.map((value) => <option key={value} value={value}>${value}</option>)}
                    {!editingCustomNotional && !impactNotionalPresets.includes(impactNotional) && <option value={impactNotional}>${impactNotional}</option>}
                    <option value="custom">自定义</option>
                  </select>
                  {editingCustomNotional && (
                    <>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={customNotional}
                        onChange={(event) => onCustomNotionalChange(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") onApplyCustomNotional(); }}
                        aria-label="自定义 Impact 名义金额"
                        className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-[9px] text-gray-200 outline-none focus:border-indigo-400"
                      />
                      <button type="button" onClick={onApplyCustomNotional} className="rounded text-emerald-400 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-300">✓</button>
                    </>
                  )}
                </div>
              )}
              {spreadMode === "impact" && (
                <button
                  type="button"
                  aria-pressed={impactDepthMode === "max"}
                  onClick={onToggleImpactDepth}
                  className={`mt-1 rounded border px-1.5 py-0.5 text-[9px] font-medium transition-all active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${
                    impactDepthMode === "max"
                      ? "border-amber-500/60 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                      : "border-gray-600 bg-gray-900/70 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                  }`}
                >
                  {impactDepthMode === "max" ? "最大 REST 深度" : "标准深度 20/100"}
                </button>
              )}
            </th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400">当前结算周期</th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="latestSettlementRate" sort={sort} onSort={toggleSort}>最新结算费率</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="averageFundingRate2d" sort={sort} onSort={toggleSort}>平均费率（2天）</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="averageFundingRate7d" sort={sort} onSort={toggleSort}>平均费率（7天）</SortHeaderButton></th>
            <th className="px-2.5 py-2 text-right text-[11px] font-medium text-gray-400"><SortHeaderButton field="averageFundingRate30d" sort={sort} onSort={toggleSort}>平均费率（30天）</SortHeaderButton></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {sortedRows.map((row) => {
            const id = String(row.id);
            const leg1 = selectedLeg1Id === id;
            const leg2 = selectedLeg2Id === id;
            const impact = impactResults.get(id);
            const waitingForSpread = spreadMode === "impact" ? impactLoading.has(id) : detailLoading.has(id);
            return (
              <tr
                key={id}
                role="button"
                tabIndex={0}
                aria-pressed={leg1 || leg2}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row);
                  }
                }}
                className={`cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
                  leg1 ? "bg-indigo-950/55" : leg2 ? "bg-fuchsia-950/45" : "hover:bg-gray-700/50"
                }`}
              >
                <td className="px-2.5 py-2"><span className="flex items-center gap-1.5 whitespace-nowrap"><span className={`h-2 w-2 rounded-full ${EXCHANGE_DOT_COLORS[row.exchange] ?? "bg-gray-400"}`} /><span className="text-xs text-gray-300">{row.exchange}</span></span></td>
                <td className="px-2.5 py-2">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-xs font-medium text-white">{row.pair}</span>
                    <span className={`rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${row.market.kind === "spot" ? "bg-emerald-500/15 text-emerald-300" : "bg-indigo-500/15 text-indigo-300"}`}>{row.market.kind === "spot" ? "Spot" : "Perp"}</span>
                    {comboMode && leg1 && <span className="rounded bg-indigo-500 px-1 py-0.5 text-[8px] font-bold text-white">腿1</span>}
                    {comboMode && leg2 && <span className="rounded bg-fuchsia-500 px-1 py-0.5 text-[8px] font-bold text-white">腿2</span>}
                    {(detailErrors.has(id) || (spreadMode === "impact" && impactErrors.has(id))) && <span className="text-[10px] font-bold text-amber-400" title="部分详情加载失败" aria-label="部分详情加载失败">!</span>}
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.midpoint, formatPrice)}</td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.indexPrice, formatPrice)}</td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.change24h, (value) => formatSignedPercent(value), row.change24h !== null && row.change24h > 0 ? "text-green-400" : row.change24h !== null && row.change24h < 0 ? "text-red-400" : "text-gray-400")}</td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.premium, (value) => formatSignedPercent(value * 100, 4), row.premium !== null && row.premium > 0 ? "text-green-400" : row.premium !== null && row.premium < 0 ? "text-red-400" : "text-gray-400")}</td>
                <td className="px-2.5 py-2 text-right">{row.predictedFundingRate === null ? <span className="text-gray-600">--</span> : <span className={`whitespace-nowrap font-mono text-xs ${row.predictedFundingRate > 0 ? "text-green-400" : row.predictedFundingRate < 0 ? "text-red-400" : "text-gray-400"}`}>{annualizedLabel(row, row.predictedFundingRate)}</span>}</td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.quoteTurnover24h, formatVolume, "text-gray-400")}</td>
                <td className="px-2.5 py-2 text-right">{displayNumber(row.openInterestNotional, formatVolume, "text-gray-400")}</td>
                <td className="px-2.5 py-2 text-right" title={detailErrors.has(id) ? "详情加载失败" : undefined}>{detailLoading.has(id) ? <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-b-indigo-400 motion-reduce:animate-none" /> : displayNumber(row.historicalVolatility, (value) => `${value.toFixed(2)}%`, "text-orange-400")}</td>
                <td className="px-2.5 py-2 text-right" title={impactErrors.has(id) || detailErrors.has(id) ? "价差加载失败" : undefined}>
                  {waitingForSpread ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-b-indigo-400 motion-reduce:animate-none" />
                  ) : spreadMode === "impact" && impact === "insufficient" ? (
                    <span className="text-xs text-amber-400">深度不足</span>
                  ) : spreadMode === "impact" && impact === "no_ctVal" ? (
                    <span className="text-xs text-red-400">No ctVal</span>
                  ) : spreadMode === "impact" && impact === "no_multiplier" ? (
                    <span className="text-xs text-red-400">缺少合约乘数</span>
                  ) : (
                    <div className="flex flex-col items-end gap-px">
                      {displayNumber(spreadMode === "top" ? row.topSpread : row.impactSpread, (value) => `${value.toFixed(4)}%`)}
                      {spreadMode === "impact" && impact !== null && typeof impact === "object" && (
                        <>
                          <span className="whitespace-nowrap font-mono text-[10px] text-gray-500" title="买入冲击价差">买入 {formatSignedPercent(impact.buyImpactSpread, 4)}</span>
                          <span className="whitespace-nowrap font-mono text-[10px] text-gray-500" title="卖出冲击价差">卖出 {formatSignedPercent(impact.sellImpactSpread, 4)}</span>
                        </>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2.5 py-2 text-right"><span className="whitespace-nowrap font-mono text-xs text-gray-300">{fundingIntervalLabel(row)}</span></td>
                <td className="px-2.5 py-2 text-right">{row.latestSettlementRate === null ? <span className="text-gray-600">--</span> : <span className={`whitespace-nowrap font-mono text-xs ${rateSignClass(row.latestSettlementRate)}`}>{annualizedLabel(row, row.latestSettlementRate)}</span>}</td>
                <td className="px-2.5 py-2 text-right">{row.averageFundingRate2d === null ? <span className="text-gray-600">--</span> : <span className={`whitespace-nowrap font-mono text-xs ${rateSignClass(row.averageFundingRate2d)}`}>{annualizedLabel(row, row.averageFundingRate2d, true)}</span>}</td>
                <td className="px-2.5 py-2 text-right">{row.averageFundingRate7d === null ? <span className="text-gray-600">--</span> : <span className={`whitespace-nowrap font-mono text-xs ${rateSignClass(row.averageFundingRate7d)}`}>{annualizedLabel(row, row.averageFundingRate7d, true)}</span>}</td>
                <td className="px-2.5 py-2 text-right">{row.averageFundingRate30d === null ? <span className="text-gray-600">--</span> : <span className={`whitespace-nowrap font-mono text-xs ${rateSignClass(row.averageFundingRate30d)}`}>{annualizedLabel(row, row.averageFundingRate30d, true)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
