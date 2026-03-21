"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FundingCandlesChart from "@/components/funding/FundingCandlesChart";
import {
  formatAnnualizedRate,
  formatFundingRate,
  formatPrice,
  formatVolume,
  getAllFundingRatesWithHistory,
  getAverageFundingRatesByInterval,
  getCandleSnapshot,
  getFundingHistoryForDays,
  toAnnualizedRate,
  type CandleSnapshotItem,
  type ChartInterval,
  type FundingRate,
  type IntervalFundingRateItem,
} from "@/lib/hyperliquid";

type FilterType = "all" | "standard" | "xyzHip3" | "vntlHip3";
type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";

const isXyzHip3Coin = (coin: string) => coin.startsWith("xyz:");
const isVntlHip3Coin = (coin: string) => coin.startsWith("vntl:");
const isHip3Asset = (coin: string) => isXyzHip3Coin(coin) || isVntlHip3Coin(coin);

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
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
}: {
  title: string;
  rate: number | null;
}) {
  if (rate === null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-2 text-sm text-gray-500">暂无数据</p>
      </div>
    );
  }

  const annualized = toAnnualizedRate(rate);
  const colorClass = annualized >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`mt-2 font-mono text-lg font-bold ${colorClass}`}>{formatAnnualizedRate(rate)}</p>
      <p className="mt-1 text-xs text-gray-500">当前：{formatFundingRate(rate)}</p>
    </div>
  );
}

export default function FundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("1d");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candles, setCandles] = useState<CandleSnapshotItem[]>([]);
  const [intervalFundingRates, setIntervalFundingRates] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates30d, setHourlyFundingRates30d] = useState<IntervalFundingRateItem[]>([]);

  const fetchRates = useCallback(async () => {
    try {
      setError(null);
      const rates = await getAllFundingRatesWithHistory();

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

  const ratesByType = useMemo(() => {
    return fundingRates.filter((rate) => {
      if (filterType === "xyzHip3") return isXyzHip3Coin(rate.coin);
      if (filterType === "vntlHip3") return isVntlHip3Coin(rate.coin);
      if (filterType === "standard") return !isHip3Asset(rate.coin);
      return true;
    });
  }, [filterType, fundingRates]);

  const filteredAndSortedRates = useMemo(() => {
    return ratesByType
      .filter((rate) => rate.coin.toLowerCase().includes(searchTerm.toLowerCase()))
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
          const changeA =
            parseFloat(a.prevDayPx) > 0
              ? (parseFloat(a.markPrice) - parseFloat(a.prevDayPx)) / parseFloat(a.prevDayPx)
              : 0;
          const changeB =
            parseFloat(b.prevDayPx) > 0
              ? (parseFloat(b.markPrice) - parseFloat(b.prevDayPx)) / parseFloat(b.prevDayPx)
              : 0;
          return sortDesc ? changeB - changeA : changeA - changeB;
        }

        if (sortBy === "oi") {
          const openInterestA = parseFloat(a.openInterest) * parseFloat(a.markPrice);
          const openInterestB = parseFloat(b.openInterest) * parseFloat(b.markPrice);
          return sortDesc ? openInterestB - openInterestA : openInterestA - openInterestB;
        }

        return sortDesc ? b.coin.localeCompare(a.coin) : a.coin.localeCompare(b.coin);
      });
  }, [ratesByType, searchTerm, sortBy, sortDesc]);

  useEffect(() => {
    if (!selectedCoin && filteredAndSortedRates.length > 0) {
      setSelectedCoin(filteredAndSortedRates[0].coin);
      return;
    }

    if (selectedCoin && !filteredAndSortedRates.some((rate) => rate.coin === selectedCoin)) {
      setSelectedCoin(filteredAndSortedRates[0]?.coin ?? null);
    }
  }, [filteredAndSortedRates, selectedCoin]);

  const positiveRates = fundingRates.filter((rate) => parseFloat(rate.fundingRate) > 0).length;
  const negativeRates = fundingRates.filter((rate) => parseFloat(rate.fundingRate) < 0).length;
  const hip3Count = fundingRates.filter((rate) => isHip3Asset(rate.coin)).length;

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

  const standardRates = fundingRates.filter((rate) => !isHip3Asset(rate.coin));
  const xyzHip3Rates = fundingRates.filter((rate) => isXyzHip3Coin(rate.coin));
  const vntlHip3Rates = fundingRates.filter((rate) => isVntlHip3Coin(rate.coin));

  const averageRate =
    filterType === "standard"
      ? calculateWeightedAverage(standardRates)
      : filterType === "xyzHip3"
        ? calculateWeightedAverage(xyzHip3Rates)
        : filterType === "vntlHip3"
          ? calculateWeightedAverage(vntlHip3Rates)
          : calculateWeightedAverage(fundingRates);

  const averageAnnualized = toAnnualizedRate(averageRate);

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

    // 计算历史波动率（年化）
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
      
      // 根据图表周期计算年化系数
      // 1d: 每年365个周期, 4h: 每年365*6=2190个周期, 1h: 每年365*24=8760个周期
      const periodsPerYear = selectedInterval === "1d" ? 365 : selectedInterval === "4h" ? 365 * 6 : 365 * 24;
      historicalVolatility = periodVolatility * Math.sqrt(periodsPerYear) * 100; // 年化，百分比
    }

    // 获取当前选中交易对的买卖价差
    let bidAskSpread = null;
    if (selectedCoin) {
      const selectedRate = fundingRates.find(r => r.coin === selectedCoin);
      if (selectedRate?.bestBid && selectedRate?.bestAsk && selectedRate?.midPrice) {
        const bestBid = parseFloat(selectedRate.bestBid);
        const bestAsk = parseFloat(selectedRate.bestAsk);
        const midPrice = parseFloat(selectedRate.midPrice);
        if (midPrice > 0) {
          bidAskSpread = ((bestAsk - bestBid) / midPrice) * 100;
        }
      }
    }

    const latestPrice = closes[closes.length - 1];

    return {
      latestClose: latestPrice,
      highestHigh: Math.max(...highs),
      lowestLow: Math.min(...lows),
      historicalVolatility,
      bidAskSpread,
    };
  }, [candles, selectedInterval, selectedCoin, fundingRates]);

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
          <p className="mt-4 text-gray-400">正在加载资金费率数据...</p>
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
          <p className="text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">HIP-3 资产</p>
          <p className="text-2xl font-bold text-purple-400">{hip3Count}</p>
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
            {formatAnnualizedRate(averageRate)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === "all"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            全部资产
          </button>
          <button
            onClick={() => setFilterType("standard")}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === "standard"
                ? "border-cyan-600 bg-cyan-600 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              标准资产
            </span>
          </button>
          <button
            onClick={() => setFilterType("xyzHip3")}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === "xyzHip3"
                ? "border-purple-600 bg-purple-600 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              Xyz-Hip3
            </span>
          </button>
          <button
            onClick={() => setFilterType("vntlHip3")}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === "vntlHip3"
                ? "border-amber-600 bg-amber-600 text-white"
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Vntl-Hip3
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="搜索交易对，例如 BTC、ETH、xyz:GOLD、vntl:OPENAI"
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
              预测费率 {sortDesc ? "↓" : "↑"}
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
            <h2 className="text-lg font-semibold text-white">
              {filterType === "all" ? "资金费率总览" : "筛选结果"}
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
                {filteredAndSortedRates.map((rate) => {
                  const markPrice = parseFloat(rate.markPrice);
                  const previousDayPrice = parseFloat(rate.prevDayPx);
                  const change24h =
                    previousDayPrice > 0 ? ((markPrice - previousDayPrice) / previousDayPrice) * 100 : 0;

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
                        <span className="font-mono text-sm text-gray-300">{formatPrice(rate.markPrice)}</span>
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
                        <div>
                          <span
                            className={`font-mono font-medium ${
                              parseFloat(rate.fundingRate) > 0
                                ? "text-green-400"
                                : parseFloat(rate.fundingRate) < 0
                                  ? "text-red-400"
                                  : "text-gray-400"
                            }`}
                          >
                            {formatAnnualizedRate(rate.fundingRate)}
                          </span>
                          <span className="ml-2 text-xs text-gray-500">
                            ({formatFundingRate(rate.fundingRate)})
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">{formatVolume(rate.dayVolume)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">
                          {formatVolume(parseFloat(rate.openInterest) * parseFloat(rate.markPrice))}
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
              {selectedCoin && isXyzHip3Coin(selectedCoin) && (
                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">Xyz-Hip3</span>
              )}
              {selectedCoin && isVntlHip3Coin(selectedCoin) && (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">Vntl-Hip3</span>
              )}
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
                  <FundingCandlesChart
                    coin={selectedCoin}
                    interval={selectedInterval}
                    candles={candles}
                    intervalFundingRates={intervalFundingRates}
                  />
                </div>

                {selectedSummary && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">结算周期</p>
                      <p className="mt-2 font-mono text-lg font-bold text-blue-400">1 小时</p>
                      <p className="mt-1 text-xs text-gray-500">Hyperliquid 统一</p>
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
                        {selectedSummary.bidAskSpread !== null 
                          ? `${selectedSummary.bidAskSpread.toFixed(4)}%` 
                          : "--"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">(Ask-Bid)/Mid</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  <FundingStatCard title="最高资金费率(7天)" rate={fundingStats7d?.highest ?? null} />
                  <FundingStatCard title="最低资金费率(7天)" rate={fundingStats7d?.lowest ?? null} />
                  <FundingStatCard title="平均资金费率(7天)" rate={fundingStats7d?.average ?? null} />
                  <FundingStatCard title="最高资金费率(30天)" rate={fundingStats30d?.highest ?? null} />
                  <FundingStatCard title="最低资金费率(30天)" rate={fundingStats30d?.lowest ?? null} />
                  <FundingStatCard title="平均资金费率(30天)" rate={fundingStats30d?.average ?? null} />
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
        <h3 className="mb-2 text-sm font-medium text-gray-300">资金费率说明</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
          <li>
            <strong className="text-gray-300">HIP-3 资产</strong>
            ：Hyperliquid Improvement Proposal 3 支持的扩展资产，例如商品和股票指数等。
          </li>
          <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
          <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
          <li>页面展示的是按当前周期聚合后，再换算成年化的预测费率，便于横向比较。</li>
          <li>右侧 7 天与 30 天统计会跟随当前图表周期切换，保持和副图一致的统计口径。</li>
        </ul>
      </div>
    </div>
  );
}
