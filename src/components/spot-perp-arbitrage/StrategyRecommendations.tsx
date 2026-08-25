"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_FUNDING_RATE_MODE,
  DEFAULT_IMPACT_COST_MODE,
  DEFAULT_STRATEGY_SETTINGS,
  FUNDING_RATE_MODE_OPTIONS,
  IMPACT_COST_MODE_OPTIONS,
  STRATEGY_RECOMMENDATION_LIMITS,
  comboFundingRate,
  comboImpactCost,
  legAnnualizedFundingPercent,
  legFundingRateValue,
  type FundingRateMode,
  type ImpactCostMode,
  type StrategyDraftSettings,
  type StrategyRecommendation,
  type StrategyRecommendationLimit,
} from "@/lib/spot-perp-arbitrage";
import { formatPrice } from "@/lib/types";

const CONVERGENCE_PRESETS = ["3", "7", "14", "30", "90", "180"] as const;
type DraftField = keyof StrategyDraftSettings;

interface Props {
  recommendations: readonly StrategyRecommendation[];
  impactLoading: boolean;
  recommendationLimit: StrategyRecommendationLimit;
  onRecommendationLimitChange: (value: StrategyRecommendationLimit) => void;
  impactNotional: number;
  convergenceDays: number;
  impactNotionalPresets: readonly number[];
  customNotional: string;
  editingCustomNotional: boolean;
  onImpactPresetChange: (value: string) => void;
  onCustomNotionalChange: (value: string) => void;
  onApplyCustomNotional: () => void;
  onRecommendationSelect: (recommendation: StrategyRecommendation) => void;
  selectedRecommendationKey: string | null;
  chartMode: "ratio" | "spread";
  onChartModeToggle: () => void;
  draft: StrategyDraftSettings;
  onDraftChange: (field: DraftField, value: string | boolean) => void;
  hasUnappliedChanges: boolean;
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function kindLabel(kind: "spot" | "perp"): string {
  return kind === "spot" ? "现货" : "永续";
}

function priceClass(value: number): string {
  return value >= 0 ? "text-emerald-300" : "text-red-300";
}

function formatUsd(value: number): string {
  const sign = value >= 0 ? "" : "-";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fundingSignClass(value: number): string {
  return value > 0 ? "text-emerald-300" : value < 0 ? "text-red-300" : "text-gray-400";
}

function formatSignedPercent(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** 组合资金费率单元格：年化（主）+ 原始单期费率差（次，即 买入−卖出）。 */
function fundingRateCell(recommendation: StrategyRecommendation, mode: FundingRateMode): ReactNode {
  const buyRate = legFundingRateValue(recommendation.buy, mode);
  const sellRate = legFundingRateValue(recommendation.sell, mode);
  if (buyRate === null || sellRate === null) {
    return <span className="text-gray-600">--</span>;
  }
  const raw = (comboFundingRate(recommendation.buy, recommendation.sell, mode) ?? 0) * 100;
  const buyAnnualized = legAnnualizedFundingPercent(recommendation.buy, buyRate);
  const sellAnnualized = legAnnualizedFundingPercent(recommendation.sell, sellRate);
  const annualized = buyAnnualized !== null && sellAnnualized !== null ? buyAnnualized - sellAnnualized : null;
  return (
    <div className="flex flex-col items-end gap-px">
      {annualized !== null && (
        <span className={`whitespace-nowrap font-mono text-xs ${fundingSignClass(annualized)}`}>{formatSignedPercent(annualized, 3)}</span>
      )}
      <span className={`whitespace-nowrap font-mono text-[10px] text-gray-500 ${raw !== 0 ? "" : "text-gray-600"}`}>{formatSignedPercent(raw, 4)}</span>
    </div>
  );
}

/** 冲击成本单元格：买入腿 + 卖出腿 的买卖价差（百分数），mode 选择 Impact（默认）或 Top 盘口价差。 */
function impactCostCell(recommendation: StrategyRecommendation, mode: ImpactCostMode): ReactNode {
  const cost = comboImpactCost(recommendation.buy, recommendation.sell, mode);
  if (cost === null) return <span className="text-gray-600">--</span>;
  return <span className="whitespace-nowrap font-mono text-xs text-gray-300">{`${cost.toFixed(4)}%`}</span>;
}

export default function StrategyRecommendations({
  recommendations,
  impactLoading,
  recommendationLimit,
  onRecommendationLimitChange,
  impactNotional,
  convergenceDays,
  impactNotionalPresets,
  customNotional,
  editingCustomNotional,
  onImpactPresetChange,
  onCustomNotionalChange,
  onApplyCustomNotional,
  onRecommendationSelect,
  selectedRecommendationKey,
  chartMode,
  onChartModeToggle,
  draft,
  onDraftChange,
  hasUnappliedChanges,
}: Props) {
  const convergenceSelectValue = CONVERGENCE_PRESETS.includes(draft.convergenceDays as typeof CONVERGENCE_PRESETS[number])
    ? draft.convergenceDays
    : "custom";
  const [fundingRateMode, setFundingRateMode] = useState<FundingRateMode>(DEFAULT_FUNDING_RATE_MODE);
  const [impactCostMode, setImpactCostMode] = useState<ImpactCostMode>(DEFAULT_IMPACT_COST_MODE);

  return (
    <section className="rounded-lg border border-violet-500/30 bg-violet-950/10 p-3 sm:p-4" aria-label="寻找策略推荐">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">寻找策略</h2>
          <p className="mt-1 text-xs text-gray-500">基于 Impact 买入价与卖出价，寻找当前结果中的跨市场价差。</p>
        </div>
        <div className="flex flex-wrap items-end justify-start gap-2 text-xs xl:justify-end" aria-label="策略设置">
          <label className="flex flex-col gap-1 text-gray-500">
            推荐数量
            <select
              aria-label="策略推荐数量"
              value={String(recommendationLimit)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "all") {
                  onRecommendationLimitChange("all");
                  return;
                }
                const numericValue = Number(value);
                onRecommendationLimitChange(
                  STRATEGY_RECOMMENDATION_LIMITS.includes(numericValue as StrategyRecommendationLimit)
                    ? numericValue as StrategyRecommendationLimit
                    : DEFAULT_STRATEGY_SETTINGS.recommendationLimit,
                );
              }}
              className="h-7 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
            >
              {STRATEGY_RECOMMENDATION_LIMITS.map((value) => (
                <option key={value} value={String(value)}>{value === "all" ? "全部" : value}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            Impact value
            <div className="flex items-center gap-1">
              <select
                aria-label="策略 Impact value"
                value={editingCustomNotional ? "custom" : String(impactNotional)}
                onChange={(event) => onImpactPresetChange(event.target.value)}
                className="h-7 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
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
                    aria-label="策略自定义 Impact value"
                    className="h-7 w-16 rounded border border-gray-700 bg-gray-900 px-1 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
                  />
                  <button type="button" onClick={onApplyCustomNotional} className="rounded px-1 text-emerald-400 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-300" aria-label="确认自定义 Impact value">✓</button>
                </>
              )}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            最小套利空间 (%)
            <input type="number" step="0.1" value={draft.minGross} onChange={(event) => onDraftChange("minGross", event.target.value)} className="h-7 w-20 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" aria-label="套利空间最小值 (%)" />
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            最大套利空间 (%)
            <input type="number" step="0.1" value={draft.maxGross} onChange={(event) => onDraftChange("maxGross", event.target.value)} className="h-7 w-20 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" aria-label="套利空间最大值 (%)" />
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            总手续费率 (%)
            <input type="number" min="0" step="0.01" value={draft.totalFee} onChange={(event) => onDraftChange("totalFee", event.target.value)} className="h-7 w-20 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" aria-label="总交易手续费率 (%)" />
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            冲击成本
            <select
              aria-label="冲击成本价差来源"
              value={impactCostMode}
              onChange={(event) => setImpactCostMode(event.target.value as ImpactCostMode)}
              className="h-7 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
            >
              {IMPACT_COST_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            组合资金费率
            <select
              aria-label="组合资金费率模式"
              value={fundingRateMode}
              onChange={(event) => setFundingRateMode(event.target.value as FundingRateMode)}
              className="h-7 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
            >
              {FUNDING_RATE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="flex h-7 items-center gap-1.5 whitespace-nowrap text-gray-300">
            <input type="checkbox" checked={draft.spotOnlyBuy} onChange={(event) => onDraftChange("spotOnlyBuy", event.target.checked)} className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-violet-500 focus:ring-violet-400" />
            Spot 只能买
          </label>
          <label className="flex flex-col gap-1 text-gray-500">
            收敛天数
            <div className="flex items-center gap-1">
              <select
                aria-label="收敛天数预设"
                value={convergenceSelectValue}
                onChange={(event) => onDraftChange("convergenceDays", event.target.value === "custom" ? "" : event.target.value)}
                className="h-7 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
              >
                <option value="3">3 天</option>
                <option value="7">7 天</option>
                <option value="14">14 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="180">180 天</option>
                <option value="custom">自定义</option>
              </select>
              {convergenceSelectValue === "custom" && <input type="number" min="1" step="1" value={draft.convergenceDays} onChange={(event) => onDraftChange("convergenceDays", event.target.value)} className="h-7 w-16 rounded border border-gray-700 bg-gray-900 px-1.5 text-[11px] text-gray-200 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400" aria-label="自定义收敛天数" />}
            </div>
          </label>
        </div>
      </div>

      {hasUnappliedChanges && <p className="mt-3 text-xs text-amber-300" role="status">Impact value 已修改，点击上方“刷新”后生效。</p>}
      <p className="mt-3 text-[11px] text-gray-600">手续费仅用于年化计算，不参与套利空间筛选与排序。</p>

      {impactLoading ? (
        <div className="mt-4 rounded border border-gray-700 bg-gray-900/40 px-3 py-4 text-center text-xs text-gray-500" role="status">正在获取 Impact 执行价…</div>
      ) : recommendations.length === 0 ? (
        <div className="mt-4 rounded border border-gray-700 bg-gray-900/40 px-3 py-4 text-center text-xs text-gray-500" role="status">当前设置下没有满足条件的可执行组合。</div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-700 bg-gray-900/40">
          <div className="flex items-center justify-between gap-2 border-b border-gray-700 px-3 py-2 text-xs text-violet-200">
            <span>策略图表：A 买入 · B 卖出 · {chartMode === "ratio" ? "A / B Ratio" : "A − B Spread"}</span>
            {selectedRecommendationKey !== null && (
              <button
                type="button"
                onClick={onChartModeToggle}
                aria-pressed={chartMode === "spread"}
                className="shrink-0 rounded border border-violet-500/50 bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-200 transition-colors hover:border-violet-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                {chartMode === "ratio" ? "切换为 A − B Spread" : "切换为 A / B Ratio"}
              </button>
            )}
          </div>
          <table className="w-full min-w-[1200px] text-left text-xs" aria-label="策略推荐表格">
            <caption className="sr-only">当前可执行套利策略推荐</caption>
            <thead className="border-b border-gray-700 bg-gray-900/80 text-[11px] font-medium text-gray-500">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-2">排名</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2">买入腿</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">买入执行价</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2">卖出腿</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">卖出执行价</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">套利空间</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">扣费后收益</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">美元收益</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">冲击成本</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">组合资金费率</th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">按 {convergenceDays} 天年化收益率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {recommendations.map((recommendation) => (
                <tr
                  key={`${recommendation.buy.id}:${recommendation.sell.id}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedRecommendationKey === `${recommendation.buy.id}:${recommendation.sell.id}`}
                  aria-label={`${selectedRecommendationKey === `${recommendation.buy.id}:${recommendation.sell.id}` ? "关闭" : "显示"}策略图表：A 买入 ${recommendation.buy.exchange} ${recommendation.buy.symbol}，B 卖出 ${recommendation.sell.exchange} ${recommendation.sell.symbol}`}
                  onClick={() => onRecommendationSelect(recommendation)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRecommendationSelect(recommendation);
                    }
                  }}
                  className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 hover:bg-gray-800/70 ${selectedRecommendationKey === `${recommendation.buy.id}:${recommendation.sell.id}` ? "bg-violet-900/35" : ""}`}
                >
                  <td className="whitespace-nowrap px-3 py-3 align-top font-mono font-semibold text-violet-300">#{recommendation.rank}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="min-w-[150px]">
                      <div className="text-[10px] text-gray-500">{recommendation.buy.exchange}</div>
                      <div className="mt-0.5 font-medium text-gray-200">{recommendation.buy.symbol}</div>
                      <span className="mt-1 inline-flex rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">{kindLabel(recommendation.buy.kind)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right align-top font-mono text-emerald-300">{formatPrice(recommendation.buy.price)}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="min-w-[150px]">
                      <div className="text-[10px] text-gray-500">{recommendation.sell.exchange}</div>
                      <div className="mt-0.5 font-medium text-gray-200">{recommendation.sell.symbol}</div>
                      <span className="mt-1 inline-flex rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{kindLabel(recommendation.sell.kind)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right align-top font-mono text-fuchsia-300">{formatPrice(recommendation.sell.price)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right align-top font-mono ${priceClass(recommendation.gross)}`}>{percent(recommendation.gross)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right align-top font-mono ${priceClass(recommendation.netReturn)}`}>{percent(recommendation.netReturn)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right align-top font-mono ${priceClass(recommendation.usdReturn)}`}>{formatUsd(recommendation.usdReturn)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right align-top">{impactCostCell(recommendation, impactCostMode)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right align-top">{fundingRateCell(recommendation, fundingRateMode)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right align-top font-mono font-semibold ${priceClass(recommendation.annualized)}`}>{percent(recommendation.annualized)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
