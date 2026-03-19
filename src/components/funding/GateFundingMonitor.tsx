"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GateFundingCandlesChart from "@/components/funding/GateFundingCandlesChart";
import {
  formatAnnualizedRate,
  formatFundingRate,
  formatPrice,
  formatVolume,
  getAllFundingRates,
  getAverageFundingRatesByInterval,
  getCandleSnapshot,
  getFundingHistoryForDays,
  toAnnualizedRate,
  type CandleSnapshotItem,
  type ChartInterval,
  type FundingRate,
  type IntervalFundingRateItem,
} from "@/lib/gateio";

type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";
type FilterType = "all" | "Crypto" | "股票/指数" | "商品" | "其他";

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

// 资产类别配置
const CATEGORY_CONFIG: Record<string, { label: string; borderColor: string; bgColor: string; dotColor: string }> = {
  all: { label: "全部资产", borderColor: "border-blue-600", bgColor: "bg-blue-600", dotColor: "bg-blue-400" },
  Crypto: { label: "Crypto", borderColor: "border-purple-600", bgColor: "bg-purple-600", dotColor: "bg-purple-400" },
  "股票/指数": { label: "股票/指数", borderColor: "border-amber-600", bgColor: "bg-amber-600", dotColor: "bg-amber-400" },
  "商品": { label: "商品", borderColor: "border-yellow-600", bgColor: "bg-yellow-600", dotColor: "bg-yellow-400" },
  "其他": { label: "其他", borderColor: "border-gray-600", bgColor: "bg-gray-600", dotColor: "bg-gray-400" },
};

interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
}

function getFundingStats(items: IntervalFundingRateItem[]): FundingStats | null {
  if (items.length === 0) {
    return null;
  }

  const rates = items.map((item) => item.averageFundingRate);
  return {
    highest: Math.max(...rates),
    lowest: Math.min(...rates),
    average: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  };
}

function FundingStatCard({
  title,
  rate,
  fundingIntervalSeconds = 28800,
}: {
  title: string;
  rate: number | null;
  fundingIntervalSeconds?: number;
}) {
  if (rate === null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-2 text-sm text-gray-500">暂无数据</p>
      </div>
    );
  }

  const colorClass = rate >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`mt-2 font-mono text-base ${colorClass}`}>{formatFundingRate(rate)}</p>
      <p className="mt-1 text-xs text-gray-500">年化：{formatAnnualizedRate(rate, fundingIntervalSeconds)}</p>
    </div>
  );
}

export default function GateFundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("1d");
  const [selectedCategory, setSelectedCategory] = useState<FilterType>("all");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candles, setCandles] = useState<CandleSnapshotItem[]>([]);
  const [intervalFundingRates, setIntervalFundingRates] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates30d, setHourlyFundingRates30d] = useState<IntervalFundingRateItem[]>([]);

  const fetchRates = useCallback(async () => {
    try {
      setError(null);
      const rates = await getAllFundingRates();

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
  }, []);

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, 30000);
    return () => clearInterval(interval);
  }, [fetchRates]);

  const fetchDetail = useCallback(async (coin: string, chartInterval: ChartInterval) => {
    setDetailLoading(true);
    setDetailError(null);
    setCandles([]);
    setIntervalFundingRates([]);
    setHourlyFundingRates30d([]);

    try {
      const [candleData, fundingHistory] = await Promise.all([
        getCandleSnapshot(coin, chartInterval, 30),
        getFundingHistoryForDays(coin, 30),
      ]);

      if (candleData.length === 0) {
        setDetailError(`暂时拿不到该资产最近 30 天的${intervalLabels[chartInterval]}数据。`);
        return;
      }

      const visibleCandles =
        chartInterval === "1d" ? candleData : candleData.slice(Math.max(candleData.length - 30, 0));

      const aggregatedFundingRates = getAverageFundingRatesByInterval(fundingHistory, chartInterval);
      const visibleFundingRates = aggregatedFundingRates.filter((item) =>
        visibleCandles.some((candle) => candle.openTime === item.bucketStartTime),
      );
      const hourlyFundingRates = getAverageFundingRatesByInterval(fundingHistory, "1h");

      setCandles(visibleCandles);
      setIntervalFundingRates(visibleFundingRates);
      setHourlyFundingRates30d(hourlyFundingRates);
    } catch (fetchError) {
      console.error("Error fetching detail:", fetchError);
      setDetailError("加载图表数据时发生错误。");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCoin) {
      fetchDetail(selectedCoin, selectedInterval);
    }
  }, [fetchDetail, selectedCoin, selectedInterval]);

  const filteredAndSortedRates = useMemo(() => {
    return fundingRates
      .filter((rate) => {
        // 搜索词筛选
        const matchesSearch = rate.coin.toLowerCase().includes(searchTerm.toLowerCase());
        // 资产类别筛选
        const matchesCategory = selectedCategory === "all" || rate.assetCategory === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (sortBy === "rate") {
          const rateA = parseFloat(a.fundingRate);
          const rateB = parseFloat(b.fundingRate);
          return sortDesc ? rateB - rateA : rateA - rateB;
        }

        if (sortBy === "volume") {
          const volumeA = parseFloat(a.dayVolume);
          const volumeB = parseFloat(b.dayVolume);
          return sortDesc ? volumeB - volumeA : volumeA - volumeB;
        }

        if (sortBy === "price") {
          const priceA = parseFloat(a.markPrice);
          const priceB = parseFloat(b.markPrice);
          return sortDesc ? priceB - priceA : priceA - priceB;
        }

        if (sortBy === "change") {
          const changeA = parseFloat(a.change24h);
          const changeB = parseFloat(b.change24h);
          return sortDesc ? changeB - changeA : changeA - changeB;
        }

        if (sortBy === "oi") {
          const notionalA = parseFloat(a.notionalValue) || 0;
          const notionalB = parseFloat(b.notionalValue) || 0;
          return sortDesc ? notionalB - notionalA : notionalA - notionalB;
        }

        return sortDesc ? b.coin.localeCompare(a.coin) : a.coin.localeCompare(b.coin);
      });
  }, [fundingRates, searchTerm, sortBy, sortDesc, selectedCategory]);

  useEffect(() => {
    if (!selectedCoin && filteredAndSortedRates.length > 0) {
      setSelectedCoin(filteredAndSortedRates[0].coin);
      return;
    }

    if (selectedCoin && !filteredAndSortedRates.some((rate) => rate.coin === selectedCoin)) {
      setSelectedCoin(filteredAndSortedRates[0]?.coin ?? null);
    }
  }, [filteredAndSortedRates, selectedCoin]);

  const positiveRates = filteredAndSortedRates.filter((rate) => parseFloat(rate.fundingRate) > 0).length;
  const negativeRates = filteredAndSortedRates.filter((rate) => parseFloat(rate.fundingRate) < 0).length;

  const calculateWeightedAverage = (rates: FundingRate[]) => {
    if (rates.length === 0) {
      return 0;
    }

    const totalNotional = rates.reduce(
      (sum, rate) => sum + parseFloat(rate.openInterest) * parseFloat(rate.markPrice),
      0,
    );

    if (totalNotional === 0) {
      return 0;
    }

    return (
      rates.reduce(
        (sum, rate) =>
          sum +
          parseFloat(rate.fundingRate) * parseFloat(rate.openInterest) * parseFloat(rate.markPrice),
        0,
      ) / totalNotional
    );
  };

  const averageRate = calculateWeightedAverage(filteredAndSortedRates);
  const averageAnnualized = toAnnualizedRate(averageRate);

  // 获取当前选中合约的结算周期
  const selectedFundingInterval = useMemo(() => {
    if (!selectedCoin) return 28800;
    const selected = fundingRates.find(r => r.coin === selectedCoin);
    return selected?.fundingInterval || 28800;
  }, [selectedCoin, fundingRates]);

  const recent7HourlyFundingRates = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return hourlyFundingRates30d.filter((item) => item.bucketStartTime >= sevenDaysAgo);
  }, [hourlyFundingRates30d]);

  const fundingStats30d = useMemo(() => getFundingStats(hourlyFundingRates30d), [hourlyFundingRates30d]);
  const fundingStats7d = useMemo(() => getFundingStats(recent7HourlyFundingRates), [recent7HourlyFundingRates]);

  const selectedSummary = useMemo(() => {
    if (candles.length === 0) {
      return null;
    }

    const closes = candles.map((candle) => Number(candle.close));
    const highs = candles.map((candle) => Number(candle.high));
    const lows = candles.map((candle) => Number(candle.low));

    return {
      latestClose: closes[closes.length - 1],
      highestHigh: Math.max(...highs),
      lowestLow: Math.min(...lows),
    };
  }, [candles]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDesc((current) => !current);
      return;
    }

    setSortBy(field);
    setSortDesc(true);
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
          <p className="mt-4 text-gray-400">正在加载 Gate.io 资金费率数据...</p>
        </div>
      </div>
    );
  }

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
            onClick={fetchRates}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">交易对数量</p>
          <p className="text-2xl font-bold text-white">{filteredAndSortedRates.length}</p>
        </div>
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
          <p className={`text-lg font-bold ${averageAnnualized >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatAnnualizedRate(averageRate, selectedFundingInterval)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Gate.io 永续合约</p>
          <p className="text-2xl font-bold text-cyan-400">USDT</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
            <button
              key={key}
              onClick={() => setSelectedCategory(key as FilterType)}
              className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
                selectedCategory === key
                  ? `${config.borderColor} ${config.bgColor} text-white`
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${config.dotColor}`} />
                {config.label}
                <span className="text-xs text-gray-400">
                  ({key === "all" ? fundingRates.length : fundingRates.filter(r => r.assetCategory === key).length})
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="搜索交易对，例如 BTC、ETH、SOL"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleSort("rate")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "rate"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              年化预测费率 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("price")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "price"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              价格 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("change")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "change"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 涨跌 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("volume")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "volume"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 成交额 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("oi")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "oi"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              持仓价值 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => toggleSort("name")}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "name"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              名称 {sortDesc ? "↓" : "↑"}
            </button>
          </div>
        </div>
      </div>

      {lastUpdate && (
        <div className="text-sm text-gray-500">
          最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}（每 30 秒自动刷新）
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
        <div className="min-h-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 lg:flex lg:h-full lg:flex-col">
          <div className="border-b border-gray-700 p-4">
            <h2 className="text-lg font-semibold text-white">Gate.io 资金费率总览</h2>
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
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">年化预测费率</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 成交额</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">持仓价值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAndSortedRates.map((rate) => {
                  const markPrice = parseFloat(rate.markPrice);
                  const change24h = parseFloat(rate.change24h);

                  return (
                    <tr
                      key={rate.coin}
                      onClick={() => setSelectedCoin(rate.coin)}
                      className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                        selectedCoin === rate.coin ? "bg-gray-700/90" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{rate.coin}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-300">{formatPrice(rate.lastPrice)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono text-sm ${
                            change24h > 0 ? "text-green-400" : change24h < 0 ? "text-red-400" : "text-gray-400"
                          }`}
                        >
                          {change24h >= 0 ? "+" : ""}
                          {change24h.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono font-medium ${
                            parseFloat(rate.fundingRate) > 0
                              ? "text-green-400"
                              : parseFloat(rate.fundingRate) < 0
                                ? "text-red-400"
                                : "text-gray-400"
                          }`}
                        >
                          {formatAnnualizedRate(rate.fundingRate, rate.fundingInterval)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">{formatVolume(rate.dayVolume)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">
                          {formatVolume(parseFloat(rate.notionalValue) || 0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAndSortedRates.length === 0 && (
              <div className="p-8 text-center text-gray-500">没有找到匹配的交易对。</div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">
                {selectedCoin ? `${selectedCoin} 近 30 天价格与资金费率` : "选择左侧资产查看图表"}
              </h2>
            </div>

            {selectedCoin && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(["1d", "4h", "1h"] as ChartInterval[]).map((interval) => (
                  <button
                    key={interval}
                    onClick={() => setSelectedInterval(interval)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selectedInterval === interval
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {intervalLabels[interval]}
                  </button>
                ))}
              </div>
            )}

            {selectedCoin && (
              <p className="mt-3 text-sm text-gray-400">
                当前查看 {intervalLabels[selectedInterval]}，副图显示对应周期预测费率的年化值。
              </p>
            )}
          </div>

          <div className="p-4">
            {!selectedCoin ? (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg className="mx-auto mb-4 h-16 w-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />
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
                    onClick={() => fetchDetail(selectedCoin, selectedInterval)}
                    className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                  >
                    重新加载图表
                  </button>
                </div>
              </div>
            ) : candles.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <GateFundingCandlesChart
                    coin={selectedCoin}
                    interval={selectedInterval}
                    candles={candles}
                    intervalFundingRates={intervalFundingRates}
                    fundingIntervalSeconds={selectedFundingInterval}
                  />
                </div>

                {selectedSummary && (
                  <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400">
                    <p>
                      当前价格区间：最低 {formatPrice(selectedSummary.lowestLow)}，最高 {formatPrice(selectedSummary.highestHigh)}，
                      最新收盘 {formatPrice(selectedSummary.latestClose)}。
                    </p>
                    <p className="mt-2">
                      4 小时线和 1 小时线只显示最近 30 根；日线仍显示最近 30 天。下方六个统计框固定显示
                      7 天和 30 天的资金费率统计，不跟随图表周期变化。
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  <FundingStatCard title="最高资金费率(7天)" rate={fundingStats7d?.highest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                  <FundingStatCard title="最低资金费率(7天)" rate={fundingStats7d?.lowest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                  <FundingStatCard title="平均资金费率(7天)" rate={fundingStats7d?.average ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                  <FundingStatCard title="最高资金费率(30天)" rate={fundingStats30d?.highest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                  <FundingStatCard title="最低资金费率(30天)" rate={fundingStats30d?.lowest ?? null} fundingIntervalSeconds={selectedFundingInterval} />
                  <FundingStatCard title="平均资金费率(30天)" rate={fundingStats30d?.average ?? null} fundingIntervalSeconds={selectedFundingInterval} />
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

      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">Gate.io 资金费率说明</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
          <li>Gate.io 永续合约采用 USDT 结算机制。</li>
          <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
          <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
          <li>主要合约每 8 小时结算一次，部分合约每 4 小时结算。</li>
          <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
          <li>右侧 7 天与 30 天统计固定显示资金费率统计，不跟随图表周期变化。</li>
        </ul>
      </div>
    </div>
  );
}
