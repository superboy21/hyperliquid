"use client";

import { ComponentType, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

// ==================== Types ====================

export type ChartInterval = "1d" | "4h" | "1h";
export type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";

export interface ExchangeFundingRate {
  symbol: string;
  fundingRate: number;
  markPrice: number;
  lastPrice: number;
  change24h: number;
  quoteVolume: number;
  openInterest: number;
  notionalValue: number;
  fundingInterval: number;
  assetCategory: string;
  bestBid?: number;
  bestAsk?: number;
}

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

export interface CandleSnapshotItem {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
}

export interface CategoryConfig {
  label: string;
  borderColor: string;
  bgColor: string;
  dotColor: string;
}

export interface ChartComponentProps {
  selectedCoin: string;
  interval: ChartInterval;
  candles: CandleSnapshotItem[];
  intervalFundingRates: IntervalFundingRateItem[];
  fundingIntervalSeconds: number;
}

export interface DetailData {
  candles: CandleSnapshotItem[];
  intervalFundingRates: IntervalFundingRateItem[];
  hourlyFundingRates30d: IntervalFundingRateItem[];
  bidAskSpread?: number | null;
}

export interface ExchangeFundingMonitorConfig {
  exchangeName: string;
  exchangeColor: string;
  categoryConfig: Record<string, CategoryConfig>;
  defaultFilterType: string;
  formatFundingRate: (rate: number) => string;
  formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) => string;
  formatStatCardAnnualizedRate?: (rate: number, fundingIntervalSeconds: number) => string;
  formatPrice: (price: number) => string;
  formatVolume: (volume: number) => string;
  ChartComponent: ComponentType<ChartComponentProps>;
  fetchRates: () => Promise<ExchangeFundingRate[]>;
  fetchDetailData: (symbol: string, interval: ChartInterval, rates: ExchangeFundingRate[]) => Promise<DetailData>;
  renderExchangeBadge?: (symbol: string) => ReactNode;
  renderInfoSection?: () => ReactNode;
  renderExtraStatsCard?: (rates: ExchangeFundingRate[]) => ReactNode;
  searchPlaceholder?: string;
  filterFn?: (rate: ExchangeFundingRate, filterType: string) => boolean;
}

// ==================== Constants ====================

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

// ==================== Utility Functions ====================

export function getFundingStats(items: IntervalFundingRateItem[]): FundingStats | null {
  if (items.length === 0) return null;
  const rates = items.map((item) => item.averageFundingRate);
  return {
    highest: Math.max(...rates),
    lowest: Math.min(...rates),
    average: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  };
}

export function FundingStatCard({
  title,
  rate,
  fundingIntervalSeconds,
  formatFundingRate,
  formatAnnualizedRate,
  formatStatCardAnnualizedRate,
}: {
  title: string;
  rate: number | null;
  fundingIntervalSeconds: number;
  formatFundingRate: (rate: number) => string;
  formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) => string;
  formatStatCardAnnualizedRate?: (rate: number, fundingIntervalSeconds: number) => string;
}) {
  if (rate === null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-2 text-sm text-gray-500">暂无数据</p>
      </div>
    );
  }

  const annualizedStr = formatStatCardAnnualizedRate
    ? formatStatCardAnnualizedRate(rate, fundingIntervalSeconds)
    : formatAnnualizedRate(rate, fundingIntervalSeconds);
  const isPositive = !annualizedStr.startsWith("-");

  // Derive per-settlement-period rate from the annualized value
  // annualizedPct = hourlyEquivalent * 8760 for all exchanges
  // perPeriodRate = annualizedPct * fundingIntervalHours / 8760
  const annualizedPctNum = parseFloat(annualizedStr.replace(/[^0-9.eE+\-]/g, "")) || 0;
  const fundingIntervalHours = fundingIntervalSeconds / 3600;
  const perPeriodRate = annualizedPctNum * fundingIntervalHours / 8760;
  const perPeriodStr = `${perPeriodRate >= 0 ? "+" : ""}${perPeriodRate.toFixed(4)}%`;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`mt-2 font-mono text-lg font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
        {annualizedStr}
      </p>
      <p className="mt-1 text-xs text-gray-500">周期：{perPeriodStr}</p>
    </div>
  );
}

// ==================== Main Component ====================

export default function ExchangeFundingMonitor({ config }: { config: ExchangeFundingMonitorConfig }) {
  const {
    exchangeName,
    exchangeColor,
    categoryConfig,
    defaultFilterType,
    formatFundingRate,
    formatAnnualizedRate,
    formatStatCardAnnualizedRate,
    formatPrice,
    formatVolume,
    ChartComponent,
    fetchRates,
    fetchDetailData,
    renderExchangeBadge,
    renderInfoSection,
    renderExtraStatsCard,
    searchPlaceholder = "搜索交易对，例如 BTC、ETH",
    filterFn,
  } = config;

  // State
  const [fundingRates, setFundingRates] = useState<ExchangeFundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<string>(defaultFilterType);
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("1d");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candles, setCandles] = useState<CandleSnapshotItem[]>([]);
  const [intervalFundingRates, setIntervalFundingRates] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates30d, setHourlyFundingRates30d] = useState<IntervalFundingRateItem[]>([]);
  const [detailBidAskSpread, setDetailBidAskSpread] = useState<number | null>(null);

  // Fetch rates
  const handleFetchRates = useCallback(async () => {
    try {
      setError(null);
      const rates = await fetchRates();
      if (rates.length === 0) {
        setError("未能获取到资金费率数据，请稍后重试。");
        return;
      }
      setFundingRates(rates);
      setLastUpdate(new Date());
    } catch (fetchError) {
      console.error("Error fetching data:", fetchError);
      setError("获取数据时发生错误。");
    } finally {
      setLoading(false);
    }
  }, [fetchRates]);

  useEffect(() => {
    handleFetchRates();
    const interval = setInterval(handleFetchRates, 60000);
    return () => clearInterval(interval);
  }, [handleFetchRates]);

  // Fetch detail data
  const handleFetchDetail = useCallback(
    async (symbol: string, interval: ChartInterval) => {
      setDetailLoading(true);
      setDetailError(null);
      setCandles([]);
      setIntervalFundingRates([]);
      setHourlyFundingRates30d([]);
      setDetailBidAskSpread(null);

      try {
        const detailData = await fetchDetailData(symbol, interval, fundingRates);
        if (detailData.candles.length === 0) {
          setDetailError(`暂时拿不到该资产最近 30 天的${intervalLabels[interval]}数据。`);
          return;
        }
        setCandles(detailData.candles);
        setIntervalFundingRates(detailData.intervalFundingRates);
        setHourlyFundingRates30d(detailData.hourlyFundingRates30d);
        setDetailBidAskSpread(detailData.bidAskSpread ?? null);
      } catch (fetchError) {
        console.error("Error fetching detail:", fetchError);
        setDetailError("加载图表数据时发生错误。");
      } finally {
        setDetailLoading(false);
      }
    },
    [fetchDetailData, fundingRates],
  );

  useEffect(() => {
    if (selectedCoin) {
      handleFetchDetail(selectedCoin, selectedInterval);
    }
  }, [handleFetchDetail, selectedCoin, selectedInterval]);

  // Filter and sort
  const filteredAndSortedRates = useMemo(() => {
    return fundingRates
      .filter((rate) => {
        const matchesSearch = rate.symbol.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filterFn ? filterFn(rate, filterType) : filterType === "all" || rate.assetCategory === filterType;
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case "rate":
            comparison = Math.abs(b.fundingRate) - Math.abs(a.fundingRate);
            break;
          case "name":
            comparison = a.symbol.localeCompare(b.symbol);
            break;
          case "price":
            comparison = b.lastPrice - a.lastPrice;
            break;
          case "change":
            comparison = b.change24h - a.change24h;
            break;
          case "volume":
            comparison = b.quoteVolume - a.quoteVolume;
            break;
          case "oi":
            comparison = b.notionalValue - a.notionalValue;
            break;
        }
        return sortDesc ? comparison : -comparison;
      });
  }, [fundingRates, searchTerm, sortBy, sortDesc, filterType, filterFn]);

  // Auto-select first coin
  useEffect(() => {
    if (!selectedCoin && filteredAndSortedRates.length > 0) {
      setSelectedCoin(filteredAndSortedRates[0].symbol);
      return;
    }
    if (selectedCoin && !filteredAndSortedRates.some((rate) => rate.symbol === selectedCoin)) {
      setSelectedCoin(filteredAndSortedRates[0]?.symbol ?? null);
    }
  }, [filteredAndSortedRates, selectedCoin]);

  // Stats
  const positiveRates = useMemo(() => fundingRates.filter((rate) => rate.fundingRate > 0).length, [fundingRates]);
  const negativeRates = useMemo(() => fundingRates.filter((rate) => rate.fundingRate < 0).length, [fundingRates]);

  const calculateWeightedAverage = (rates: ExchangeFundingRate[]) => {
    if (rates.length === 0) return 0;
    const totalNotional = rates.reduce((sum, rate) => sum + rate.notionalValue, 0);
    if (totalNotional === 0) return 0;
    return rates.reduce((sum, rate) => sum + rate.fundingRate * rate.notionalValue, 0) / totalNotional;
  };

  const averageRate = useMemo(() => calculateWeightedAverage(filteredAndSortedRates), [filteredAndSortedRates]);

  const recent7HourlyFundingRates = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return hourlyFundingRates30d.filter((item) => item.bucketStartTime >= sevenDaysAgo);
  }, [hourlyFundingRates30d]);

  const fundingStats30d = useMemo(() => getFundingStats(hourlyFundingRates30d), [hourlyFundingRates30d]);
  const fundingStats7d = useMemo(() => getFundingStats(recent7HourlyFundingRates), [recent7HourlyFundingRates]);

  const selectedSummary = useMemo(() => {
    if (candles.length === 0) return null;

    const closes = candles.map((candle) => Number(candle.close));
    const highs = candles.map((candle) => Number(candle.high));
    const lows = candles.map((candle) => Number(candle.low));

    // Historical volatility (annualized)
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }

    let historicalVolatility = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const periodVolatility = Math.sqrt(variance);
      const periodsPerYear = selectedInterval === "1d" ? 365 : selectedInterval === "4h" ? 365 * 6 : 365 * 24;
      historicalVolatility = periodVolatility * Math.sqrt(periodsPerYear) * 100;
    }

    // Bid-ask spread: use detail data if available, otherwise compute from fundingRates
    let bidAskSpread: number | null = null;
    if (detailBidAskSpread !== null) {
      bidAskSpread = detailBidAskSpread;
    } else if (selectedCoin) {
      const selectedRate = fundingRates.find((r) => r.symbol === selectedCoin);
      if (selectedRate?.bestBid && selectedRate?.bestAsk) {
        const midPrice = (selectedRate.bestBid + selectedRate.bestAsk) / 2;
        if (midPrice > 0) {
          bidAskSpread = ((selectedRate.bestAsk - selectedRate.bestBid) / midPrice) * 100;
        }
      }
    }

    return {
      latestClose: closes[closes.length - 1],
      highestHigh: Math.max(...highs),
      lowestLow: Math.min(...lows),
      historicalVolatility,
      bidAskSpread,
    };
  }, [candles, selectedInterval, selectedCoin, fundingRates, detailBidAskSpread]);

  const selectedFundingInterval = useMemo(() => {
    if (!selectedCoin) return 28800;
    const selected = fundingRates.find((r) => r.symbol === selectedCoin);
    return selected?.fundingInterval ?? 28800;
  }, [selectedCoin, fundingRates]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDesc((current) => !current);
      return;
    }
    setSortBy(field);
    setSortDesc(true);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className={`mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-${exchangeColor}-500`} />
          <p className="mt-4 text-gray-400">正在加载 {exchangeName} 资金费率数据...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="mb-4 text-red-400">{error}</p>
          <button
            onClick={handleFetchRates}
            className={`rounded-lg bg-${exchangeColor}-600 px-4 py-2 text-white transition-colors hover:bg-${exchangeColor}-700`}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">交易对数量</p>
          <p className="text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        {renderExtraStatsCard && renderExtraStatsCard(fundingRates)}
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">正资金费率</p>
          <p className="text-2xl font-bold text-green-400">{positiveRates}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">负资金费率</p>
          <p className="text-2xl font-bold text-red-400">{negativeRates}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">当前平均年化（OI 加权）</p>
          <p
            className={`text-lg font-bold ${
              formatAnnualizedRate(averageRate).startsWith("-") ? "text-red-400" : "text-green-400"
            }`}
          >
            {formatAnnualizedRate(averageRate)}
          </p>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(categoryConfig).map(([key, catConfig]) => (
          <button
            key={key}
            onClick={() => setFilterType(key)}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === key
                ? `${catConfig.borderColor} ${catConfig.bgColor} text-white`
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${catConfig.dotColor}`} />
              {catConfig.label}
              {key !== "all" && (
                <span className="text-xs opacity-70">
                  ({fundingRates.filter((r) => r.assetCategory === key).length})
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Search and sort */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["rate", "price", "change", "volume", "oi", "name"] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === field
                  ? `border-${exchangeColor}-600 bg-${exchangeColor}-600 text-white`
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {field === "rate" && "预测费率"}
              {field === "price" && "价格"}
              {field === "change" && "24h 涨跌"}
              {field === "volume" && "24h 成交额"}
              {field === "oi" && "持仓价值"}
              {field === "name" && "名称"}
              {sortBy === field && (sortDesc ? " ↓" : " ↑")}
            </button>
          ))}
        </div>
      </div>

      {/* Last update */}
      {lastUpdate && (
        <div className="text-sm text-gray-500">
          最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}（每 60 秒自动刷新）
        </div>
      )}

      {/* Table and chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
        {/* Table */}
        <div className="min-h-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 lg:flex lg:h-full lg:flex-col">
          <div className="border-b border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-white">
              {filterType === "all"
                ? `${exchangeName} 资金费率总览`
                : `${categoryConfig[filterType]?.label ?? filterType} 资金费率`}
            </h2>
            <p className="text-sm text-gray-400">
              共 {filteredAndSortedRates.length} 个交易对
              {searchTerm && `（从 ${fundingRates.length} 个中筛选）`}
            </p>
          </div>
          <div className="max-h-[960px] overflow-x-auto overflow-y-auto lg:min-h-0 lg:flex-1">
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">交易对</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">价格</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 涨跌</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">预测费率</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 成交额</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">持仓价值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAndSortedRates.map((rate) => (
                  <tr
                    key={rate.symbol}
                    onClick={() => setSelectedCoin(rate.symbol)}
                    className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                      selectedCoin === rate.symbol ? "bg-gray-700/90" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-white">{rate.symbol}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-gray-300">{formatPrice(rate.lastPrice)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-mono text-sm ${
                          rate.change24h > 0 ? "text-green-400" : rate.change24h < 0 ? "text-red-400" : "text-gray-400"
                        }`}
                      >
                        {rate.change24h >= 0 ? "+" : ""}
                        {rate.change24h.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div>
                        <span
                          className={`font-mono font-medium ${
                            rate.fundingRate > 0 ? "text-green-400" : rate.fundingRate < 0 ? "text-red-400" : "text-gray-400"
                          }`}
                        >
                          {formatAnnualizedRate(rate.fundingRate, rate.fundingInterval)}
                        </span>
                        <span className="ml-2 text-xs text-gray-500">({formatFundingRate(rate.fundingRate)})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-gray-400">{formatVolume(rate.quoteVolume)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-sm text-gray-400">{formatVolume(rate.notionalValue)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAndSortedRates.length === 0 && (
              <div className="p-8 text-center text-gray-500">没有找到匹配的交易对。</div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  {selectedCoin ? `${selectedCoin} 近 30 天价格与资金费率` : "选择左侧资产查看图表"}
                </h2>
                {selectedCoin && renderExchangeBadge && renderExchangeBadge(selectedCoin)}
              </div>
              {selectedCoin && (
                <div className="flex gap-2">
                  {(["1d", "4h", "1h"] as ChartInterval[]).map((interval) => (
                    <button
                      key={interval}
                      onClick={() => setSelectedInterval(interval)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selectedInterval === interval
                          ? `border-${exchangeColor}-600 bg-${exchangeColor}-600 text-white`
                          : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      {intervalLabels[interval]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="p-4">
            {!selectedCoin ? (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-4 h-16 w-16 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 3v18h18M7 14l3-3 3 2 5-7"
                    />
                  </svg>
                  <p>点击左侧交易对后，这里会显示价格图表和费率表现。</p>
                </div>
              </div>
            ) : detailLoading ? (
              <div className="flex h-[560px] items-center justify-center">
                <div className="text-center">
                  <div className={`mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-${exchangeColor}-500`} />
                  <p className="mt-4 text-sm text-gray-400">
                    正在加载 {selectedCoin} 的 {intervalLabels[selectedInterval]} 数据...
                  </p>
                </div>
              </div>
            ) : detailError ? (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-red-400">{detailError}</p>
                  <button
                    onClick={() => handleFetchDetail(selectedCoin, selectedInterval)}
                    className={`mt-4 rounded-lg bg-${exchangeColor}-600 px-4 py-2 text-white transition-colors hover:bg-${exchangeColor}-700`}
                  >
                    重新加载图表
                  </button>
                </div>
              </div>
            ) : candles.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <ChartComponent
                    selectedCoin={selectedCoin}
                    interval={selectedInterval}
                    candles={candles}
                    intervalFundingRates={intervalFundingRates}
                    fundingIntervalSeconds={selectedFundingInterval}
                  />
                </div>

                {selectedSummary && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">结算周期</p>
                      <p className={`mt-2 font-mono text-lg font-bold text-${exchangeColor}-400`}>
                        {selectedFundingInterval / 3600} 小时
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{exchangeName} 合约</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">历史波动率(30周期)</p>
                      <p className="mt-2 font-mono text-lg font-bold text-purple-400">
                        {selectedSummary.historicalVolatility.toFixed(2)}%
                      </p>
                      <p className="mt-1 text-xs text-gray-500">年化</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">当前买卖价差</p>
                      <p className="mt-2 font-mono text-lg font-bold text-yellow-400">
                        {selectedSummary.bidAskSpread !== null ? `${selectedSummary.bidAskSpread.toFixed(4)}%` : "--"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">(Ask-Bid)/Mid</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  <FundingStatCard
                    title="最高资金费率(7天)"
                    rate={fundingStats7d?.highest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                  <FundingStatCard
                    title="最低资金费率(7天)"
                    rate={fundingStats7d?.lowest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                  <FundingStatCard
                    title="平均资金费率(7天)"
                    rate={fundingStats7d?.average ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                  <FundingStatCard
                    title="最高资金费率(30天)"
                    rate={fundingStats30d?.highest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                  <FundingStatCard
                    title="最低资金费率(30天)"
                    rate={fundingStats30d?.lowest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                  <FundingStatCard
                    title="平均资金费率(30天)"
                    rate={fundingStats30d?.average ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <p>暂无可展示的图表数据。</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info section */}
      {renderInfoSection && renderInfoSection()}
    </div>
  );
}
