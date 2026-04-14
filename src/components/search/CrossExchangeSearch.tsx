"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAllRates,
  filterByKeyword,
  fetchDetailForSymbol,
  batchFetchDetails,
  type SearchExchangeRate,
} from "@/lib/search";
import {
  formatPrice,
  formatVolume,
  formatAnnualizedRate,
  formatFundingRate,
} from "@/lib/types";

// ==================== Types ====================

type SortField =
  | "symbol"
  | "exchange"
  | "price"
  | "change24h"
  | "fundingRate"
  | "volume"
  | "notionalValue"
  | "volatility"
  | "spread"
  | "latestSettlement"
  | "avg1d"
  | "avg7d"
  | "avg30d";

interface SortConfig {
  field: SortField;
  descending: boolean;
}

interface DetailCache {
  historicalVolatility: number | null;
  bidAskSpread: number | null;
  latestSettlementRate: number | null;
  avgFundingRate1d: number | null;
  avgFundingRate7d: number | null;
  avgFundingRate30d: number | null;
}

function getDetailKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

// ==================== Constants ====================

const EXCHANGE_DOT_COLORS: Record<string, string> = {
  Hyperliquid: "bg-blue-400",
  "Gate.io": "bg-cyan-400",
  Binance: "bg-yellow-400",
  Lighter: "bg-purple-400",
  OKX: "bg-emerald-400",
};

function formatSearchAnnualizedRate(rate: number, fundingInterval: number, exchange: string): string {
  if (exchange === "Lighter") {
    const annualizedPct = (rate / 8) * 24 * 365 * 100;
    const absRate = Math.abs(annualizedPct);
    if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
    if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
    return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
  }

  return formatAnnualizedRate(rate, fundingInterval);
}

function formatSearchAverageAnnualizedRate(rate: number, fundingInterval: number, exchange: string): string {
  if (exchange === "Lighter") {
    // Match LighterFundingMonitor.tsx -> formatAnnualizedRateFromHourly(rate)
    const annualizedPct = rate * 24 * 365;
    const absRate = Math.abs(annualizedPct);
    if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
    if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
    return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
  }

  return formatAnnualizedRate(rate, fundingInterval);
}

function formatSearchSettlementRate(rate: number, fundingInterval: number, exchange: string): string {
  if (exchange === "Lighter") {
    // Lighter settlement rate: /8 adjustment like predicted rate
    const annualizedPct = (rate / 8) * 24 * 365 * 100;
    const absRate = Math.abs(annualizedPct);
    if (absRate >= 100) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}%`;
    if (absRate >= 10) return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}%`;
    return `${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(3)}%`;
  }

  return formatAnnualizedRate(rate, fundingInterval);
}

function formatSearchSettlementPeriodRate(rate: number, exchange: string): string {
  if (exchange === "Lighter") {
    const hourlyRate = rate / 8;
    return `${(hourlyRate * 100).toFixed(4)}%`;
  }

  return formatFundingRate(rate);
}

// ==================== Utility ====================

function getSortValue(rate: SearchExchangeRate & { detail?: DetailCache }, field: SortField): number | string {
  switch (field) {
    case "symbol":
      return rate.symbol;
    case "exchange":
      return rate.exchange;
    case "price":
      return rate.lastPrice;
    case "change24h":
      return rate.change24h;
    case "fundingRate":
      return Math.abs(rate.fundingRate);
    case "volume":
      return rate.quoteVolume;
    case "notionalValue":
      return rate.notionalValue;
    case "volatility":
      return rate.detail?.historicalVolatility ?? -1;
    case "spread":
      return rate.detail?.bidAskSpread ?? -1;
    case "latestSettlement":
      return rate.detail?.latestSettlementRate ?? -999;
    case "avg1d":
      return rate.detail?.avgFundingRate1d ?? -999;
    case "avg7d":
      return rate.detail?.avgFundingRate7d ?? -999;
    case "avg30d":
      return rate.detail?.avgFundingRate30d ?? -999;
    default:
      return 0;
  }
}

// ==================== Component ====================

export default function CrossExchangeSearch() {
  const [searchTerm, setSearchTerm] = useState("");
  const [allRates, setAllRates] = useState<SearchExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: "fundingRate", descending: true });
  const [detailCache, setDetailCache] = useState<Map<string, DetailCache>>(new Map());
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const ratesRef = useRef<SearchExchangeRate[]>([]);

  // Fetch all rates on mount
  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      setError(null);
      try {
        const rates = await fetchAllRates();
        if (!cancelled) {
          setAllRates(rates);
          ratesRef.current = rates;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch rates");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter by keyword
  const filteredRates = useMemo(() => {
    return filterByKeyword(allRates, searchTerm);
  }, [allRates, searchTerm]);

  // Sort
  const sortedRates = useMemo(() => {
    const sorted = [...filteredRates].sort((a, b) => {
      const aVal = getSortValue(
        { ...a, detail: detailCache.get(getDetailKey(a.exchange, a.symbol)) },
        sortConfig.field,
      );
      const bVal = getSortValue(
        { ...b, detail: detailCache.get(getDetailKey(b.exchange, b.symbol)) },
        sortConfig.field,
      );

      let cmp = 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = Number(aVal) - Number(bVal);
      }
      return sortConfig.descending ? -cmp : cmp;
    });
    return sorted;
  }, [filteredRates, sortConfig, detailCache]);

  // Progressive detail fetching
  const startDetailFetching = useCallback(
    (rates: SearchExchangeRate[]) => {
      // Cancel previous
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      // Clear cache
      setDetailCache(new Map());
      setDetailLoading(new Set(rates.map((r) => getDetailKey(r.exchange, r.symbol))));

      batchFetchDetails(
        rates,
        (rate, detail) => {
          if (signal.aborted) return;
          const key = getDetailKey(rate.exchange, rate.symbol);
          setDetailCache((prev) => {
            const next = new Map(prev);
            next.set(key, {
              historicalVolatility: detail.historicalVolatility,
              bidAskSpread: detail.bidAskSpread,
              latestSettlementRate: detail.lastSettlementRate,
              avgFundingRate1d: detail.avgFundingRate1d,
              avgFundingRate7d: detail.avgFundingRate7d,
              avgFundingRate30d: detail.avgFundingRate30d,
            });
            return next;
          });
          setDetailLoading((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        },
        signal,
        4,
      );
    },
    [],
  );

  // Trigger detail fetching ONLY when user enters a search term
  useEffect(() => {
    if (filteredRates.length > 0 && !loading && searchTerm.trim()) {
      startDetailFetching(filteredRates);
    } else {
      // Cancel any in-flight requests when search term is cleared
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setDetailCache(new Map());
      setDetailLoading(new Set());
    }
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [filteredRates, loading, searchTerm, startDetailFetching]);

  // When user searches, default results to sort by notional value descending.
  // When search is cleared, restore the page default sort.
  useEffect(() => {
    if (searchTerm.trim()) {
      setSortConfig({ field: "notionalValue", descending: true });
    } else {
      setSortConfig({ field: "fundingRate", descending: true });
    }
  }, [searchTerm]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const handleSort = (field: SortField) => {
    setSortConfig((prev) => ({
      field,
      descending: prev.field === field ? !prev.descending : true,
    }));
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field) return <span className="text-gray-600 ml-1">↕</span>;
    return <span className="text-gray-400 ml-1">{sortConfig.descending ? "↓" : "↑"}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />
          <p className="text-gray-400">正在加载各交易所数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 p-6 text-center">
        <p className="text-red-400">加载失败: {error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Search Input */}
      <div className="mb-6">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="输入关键字搜索交易对，例如 BTC、ETH、SOL..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 py-3 pl-10 pr-4 text-white placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
          <span>共 {filteredRates.length} 个交易对</span>
          {detailLoading.size > 0 && (
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
              正在加载详情 ({detailLoading.size} 个)...
            </span>
          )}
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
        <table className="w-full min-w-[1360px] xl:min-w-0">
          <thead>
            <tr className="border-b border-gray-700">
              <th
                className="cursor-pointer px-2 py-2 text-left text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("exchange")}
              >
                <span className="flex items-center whitespace-nowrap">
                  交易所
                  <SortIcon field="exchange" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-left text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("symbol")}
              >
                <span className="flex items-center whitespace-nowrap">
                  交易对
                  <SortIcon field="symbol" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("price")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  价格
                  <SortIcon field="price" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("change24h")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  24h涨跌
                  <SortIcon field="change24h" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("fundingRate")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  预测费率
                  <SortIcon field="fundingRate" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("volume")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  24h成交额
                  <SortIcon field="volume" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("notionalValue")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  持仓价值
                  <SortIcon field="notionalValue" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("volatility")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  历史波动率
                  <SortIcon field="volatility" />
                </span>
              </th>
                <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("spread")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  买卖价差
                  <SortIcon field="spread" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("latestSettlement")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  最新结算费率
                  <SortIcon field="latestSettlement" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("avg1d")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  平均费率（1天）
                  <SortIcon field="avg1d" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("avg7d")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  平均费率(7天)
                  <SortIcon field="avg7d" />
                </span>
              </th>
              <th
                className="cursor-pointer px-2 py-2 text-right text-[11px] font-medium text-gray-400 hover:text-gray-200 xl:px-2.5"
                onClick={() => handleSort("avg30d")}
              >
                <span className="flex items-center justify-end whitespace-nowrap">
                  平均费率(30天)
                  <SortIcon field="avg30d" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {sortedRates.map((rate) => {
              const detailKey = getDetailKey(rate.exchange, rate.symbol);
              const detail = detailCache.get(detailKey);
              const isLoading = detailLoading.has(detailKey);
              const dotColor = EXCHANGE_DOT_COLORS[rate.exchange] || "bg-gray-400";

              return (
                <tr key={`${rate.exchange}-${rate.symbol}`} className="transition-colors hover:bg-gray-700/50">
                  {/* Exchange */}
                  <td className="px-2 py-2 xl:px-2.5">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
                      <span className="text-xs font-medium text-gray-300">{rate.exchange}</span>
                    </span>
                  </td>
                  {/* Symbol */}
                  <td className="px-2 py-2 xl:px-2.5">
                      <span className="whitespace-nowrap text-xs font-medium text-white">{rate.symbol}</span>
                  </td>
                  {/* Price */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                      <span className="whitespace-nowrap font-mono text-xs text-gray-300">{formatPrice(rate.lastPrice)}</span>
                  </td>
                  {/* 24h Change */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                      <span
                        className={`whitespace-nowrap font-mono text-xs ${
                          rate.change24h > 0
                            ? "text-green-400"
                            : rate.change24h < 0
                              ? "text-red-400"
                              : "text-gray-400"
                        }`}
                      >
                      {rate.change24h >= 0 ? "+" : ""}
                      {rate.change24h.toFixed(2)}%
                    </span>
                  </td>
                  {/* Funding Rate */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                      <div className="whitespace-nowrap">
                      <span
                        className={`font-mono text-xs font-medium ${
                          rate.fundingRate > 0
                            ? "text-green-400"
                            : rate.fundingRate < 0
                              ? "text-red-400"
                              : "text-gray-400"
                        }`}
                      >
                        {formatSearchAnnualizedRate(rate.fundingRate, rate.fundingInterval, rate.exchange)}
                      </span>
                      <span className="ml-1 text-xs text-gray-500">
                        ({formatFundingRate(rate.fundingRate)})
                      </span>
                    </div>
                  </td>
                  {/* Volume */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                      <span className="whitespace-nowrap font-mono text-xs text-gray-400">{formatVolume(rate.quoteVolume)}</span>
                  </td>
                  {/* Notional Value */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                      <span className="whitespace-nowrap font-mono text-xs text-gray-400">{formatVolume(rate.notionalValue)}</span>
                  </td>
                  {/* Volatility */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.historicalVolatility != null ? (
                      <span className="whitespace-nowrap font-mono text-xs text-orange-400">
                        {detail.historicalVolatility.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  {/* Bid-Ask Spread */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.bidAskSpread != null ? (
                      <span className="whitespace-nowrap font-mono text-xs text-gray-300">
                        {detail.bidAskSpread.toFixed(4)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  {/* Latest Settlement Rate */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.latestSettlementRate != null ? (
                      <div className="whitespace-nowrap text-right">
                        <span
                          className={`font-mono text-xs font-medium ${
                            detail.latestSettlementRate > 0
                              ? "text-green-400"
                              : detail.latestSettlementRate < 0
                                ? "text-red-400"
                                : "text-gray-400"
                          }`}
                        >
                          {formatSearchSettlementRate(detail.latestSettlementRate, rate.fundingInterval, rate.exchange)}
                        </span>
                        <span className="ml-1 text-xs text-gray-500">
                          ({formatSearchSettlementPeriodRate(detail.latestSettlementRate, rate.exchange)})
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  {/* Avg 1d */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.avgFundingRate1d != null ? (
                      <span
                        className={`whitespace-nowrap font-mono text-xs ${
                          detail.avgFundingRate1d > 0
                            ? "text-green-400"
                            : detail.avgFundingRate1d < 0
                              ? "text-red-400"
                              : "text-gray-400"
                        }`}
                      >
                        {formatSearchAverageAnnualizedRate(detail.avgFundingRate1d, rate.fundingInterval, rate.exchange)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  {/* Avg 7d */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.avgFundingRate7d != null ? (
                      <span
                        className={`whitespace-nowrap font-mono text-xs ${
                          detail.avgFundingRate7d > 0
                            ? "text-green-400"
                            : detail.avgFundingRate7d < 0
                              ? "text-red-400"
                              : "text-gray-400"
                        }`}
                      >
                        {formatSearchAverageAnnualizedRate(detail.avgFundingRate7d, rate.fundingInterval, rate.exchange)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  {/* Avg 30d */}
                  <td className="px-2 py-2 text-right xl:px-2.5">
                    {isLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-b border-blue-500" />
                      ) : detail?.avgFundingRate30d != null ? (
                      <span
                        className={`whitespace-nowrap font-mono text-xs ${
                          detail.avgFundingRate30d > 0
                            ? "text-green-400"
                            : detail.avgFundingRate30d < 0
                              ? "text-red-400"
                              : "text-gray-400"
                        }`}
                      >
                        {formatSearchAverageAnnualizedRate(detail.avgFundingRate30d, rate.fundingInterval, rate.exchange)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedRates.length === 0 && searchTerm && (
          <div className="p-8 text-center text-gray-500">
            没有找到包含 &quot;{searchTerm}&quot; 的交易对
          </div>
        )}
        {sortedRates.length === 0 && !searchTerm && allRates.length > 0 && (
          <div className="p-8 text-center text-gray-500">输入关键字开始搜索</div>
        )}
      </div>
    </div>
  );
}
