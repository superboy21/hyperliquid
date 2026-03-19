"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatAnnualizedRate,
  formatPrice,
  formatTime,
  formatVolume,
  getAllFundingRatesWithHistory,
  getFundingHistory,
  toAnnualizedRate,
  type FundingHistoryItem,
  type FundingRate,
} from "@/lib/hyperliquid";

export default function FundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [history, setHistory] = useState<FundingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"rate" | "name" | "volume" | "price" | "change" | "oi">("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<"all" | "standard" | "xyzHip3" | "vntlHip3">("all");

  const isXyzHip3 = (coin: string) => coin.startsWith("xyz:");
  const isVntlHip3 = (coin: string) => coin.startsWith("vntl:");
  const isHip3Coin = (coin: string) => isXyzHip3(coin) || isVntlHip3(coin);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const rates = await getAllFundingRatesWithHistory();

      if (rates.length === 0) {
        setError("未能获取到资金费率数据，请稍后重试。");
      } else {
        setFundingRates(rates);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("获取数据时发生错误。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const fetchHistory = useCallback(async (coin: string) => {
    setHistoryLoading(true);
    setHistory([]);

    try {
      const endTime = Math.floor(Date.now() / 1000);
      const startTime1 = endTime - 15 * 24 * 60 * 60;
      const history1 = await getFundingHistory(coin, startTime1);

      const startTime2 = startTime1 - 15 * 24 * 60 * 60;
      const history2 = await getFundingHistory(coin, startTime2);

      const combinedHistory = [...history1, ...history2].sort((a, b) => b.time - a.time);
      const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const last30Days = combinedHistory.filter((item) => item.time >= thirtyDaysAgoMs);

      setHistory(last30Days);
    } catch (fetchError) {
      console.error("Error fetching history:", fetchError);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCoin) {
      fetchHistory(selectedCoin);
    }
  }, [selectedCoin, fetchHistory]);

  const ratesByType = fundingRates.filter((rate) => {
    if (filterType === "xyzHip3") return isXyzHip3(rate.coin);
    if (filterType === "vntlHip3") return isVntlHip3(rate.coin);
    if (filterType === "standard") return !isHip3Coin(rate.coin);
    return true;
  });

  const filteredAndSortedRates = ratesByType
    .filter((rate) => rate.coin.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "rate") {
        const rateA = parseFloat(a.fundingRate);
        const rateB = parseFloat(b.fundingRate);
        return sortDesc ? rateB - rateA : rateA - rateB;
      }

      if (sortBy === "volume") {
        const volA = parseFloat(a.dayVolume);
        const volB = parseFloat(b.dayVolume);
        return sortDesc ? volB - volA : volA - volB;
      }

      if (sortBy === "price") {
        const priceA = parseFloat(a.markPrice);
        const priceB = parseFloat(b.markPrice);
        return sortDesc ? priceB - priceA : priceA - priceB;
      }

      if (sortBy === "change") {
        const changeA = (parseFloat(a.markPrice) - parseFloat(a.prevDayPx)) / parseFloat(a.prevDayPx);
        const changeB = (parseFloat(b.markPrice) - parseFloat(b.prevDayPx)) / parseFloat(b.prevDayPx);
        return sortDesc ? changeB - changeA : changeA - changeB;
      }

      if (sortBy === "oi") {
        const valueA = parseFloat(a.openInterest) * parseFloat(a.markPrice);
        const valueB = parseFloat(b.openInterest) * parseFloat(b.markPrice);
        return sortDesc ? valueB - valueA : valueA - valueB;
      }

      return sortDesc ? b.coin.localeCompare(a.coin) : a.coin.localeCompare(b.coin);
    });

  const positiveRates = fundingRates.filter((rate) => parseFloat(rate.fundingRate) > 0).length;
  const negativeRates = fundingRates.filter((rate) => parseFloat(rate.fundingRate) < 0).length;
  const hip3Count = fundingRates.filter((rate) => isHip3Coin(rate.coin)).length;

  const calculateWeightedAvg = (rates: FundingRate[]) => {
    if (rates.length === 0) return 0;

    const totalPositionValue = rates.reduce(
      (sum, rate) => sum + parseFloat(rate.openInterest) * parseFloat(rate.markPrice),
      0,
    );

    if (totalPositionValue === 0) return 0;

    const weightedSum = rates.reduce(
      (sum, rate) =>
        sum +
        parseFloat(rate.fundingRate) * parseFloat(rate.openInterest) * parseFloat(rate.markPrice),
      0,
    );

    return weightedSum / totalPositionValue;
  };

  const standardRates = fundingRates.filter((rate) => !isHip3Coin(rate.coin));
  const xyzHip3Rates = fundingRates.filter((rate) => isXyzHip3(rate.coin));
  const vntlHip3Rates = fundingRates.filter((rate) => isVntlHip3(rate.coin));
  const hip3Rates = fundingRates.filter((rate) => isHip3Coin(rate.coin));

  const weightedAvgAll = calculateWeightedAvg(fundingRates);
  const weightedAvgStandard = calculateWeightedAvg(standardRates);
  const weightedAvgXyzHip3 = calculateWeightedAvg(xyzHip3Rates);
  const weightedAvgVntlHip3 = calculateWeightedAvg(vntlHip3Rates);
  const weightedAvgHip3 = calculateWeightedAvg(hip3Rates);

  const avgRate =
    filterType === "standard"
      ? weightedAvgStandard
      : filterType === "xyzHip3"
        ? weightedAvgXyzHip3
        : filterType === "vntlHip3"
          ? weightedAvgVntlHip3
          : weightedAvgAll;
  const avgAnnualized = toAnnualizedRate(avgRate);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500"></div>
          <p className="mt-4 text-gray-400">正在加载资金费率数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="mb-4 text-red-400">{error}</p>
          <button
            onClick={fetchData}
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
          <p className={`text-lg font-bold ${avgAnnualized >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatAnnualizedRate(avgRate)}
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
              <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
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
              <span className="h-2 w-2 rounded-full bg-purple-400"></span>
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
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              Vntl-Hip3
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="搜索交易对，例如 BTC、ETH、xyz:GOLD..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSortBy("rate");
                setSortDesc(!sortDesc);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "rate"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              当前年化 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => {
                setSortBy("price");
                setSortDesc(!sortDesc);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "price"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              价格 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => {
                setSortBy("change");
                setSortDesc(!sortDesc);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "change"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              24h 涨跌 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => {
                setSortBy("volume");
                setSortDesc(!sortDesc);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "volume"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              交易量 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => {
                setSortBy("oi");
                setSortDesc(!sortDesc);
              }}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === "oi"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              持仓价值 {sortDesc ? "↓" : "↑"}
            </button>
            <button
              onClick={() => {
                setSortBy("name");
                setSortDesc(!sortDesc);
              }}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 p-4">
            <h2 className="text-lg font-semibold text-white">
              {filterType === "all" ? "资金费率年化" : "预测年化"}
            </h2>
            <p className="text-sm text-gray-400">
              共 {filteredAndSortedRates.length} 个交易对
              {searchTerm && `（从 ${fundingRates.length} 个中筛选）`}
            </p>
          </div>
          <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">交易对</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">价格</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 涨跌</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    {filterType === "all" ? "年化资金费率" : "预测年化"}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">24h 交易量</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">持仓价值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAndSortedRates.map((rate) => {
                  const markPx = parseFloat(rate.markPrice);
                  const prevDayPx = parseFloat(rate.prevDayPx);
                  const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;

                  return (
                    <tr
                      key={rate.coin}
                      onClick={() => setSelectedCoin(rate.coin)}
                      className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                        selectedCoin === rate.coin ? "bg-gray-700" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{rate.coin}</span>
                          {isXyzHip3(rate.coin) && (
                            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-400">
                              Xyz-Hip3
                            </span>
                          )}
                          {isVntlHip3(rate.coin) && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
                              Vntl-Hip3
                            </span>
                          )}
                        </div>
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
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">{formatVolume(rate.dayVolume)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-400">
                          {formatVolume(String(parseFloat(rate.openInterest) * parseFloat(rate.markPrice)))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAndSortedRates.length === 0 && (
              <div className="p-8 text-center text-gray-500">没有找到匹配的交易对</div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">
                {selectedCoin ? `${selectedCoin} 历史资金费率` : "选择交易对查看历史"}
              </h2>
              {selectedCoin && isXyzHip3(selectedCoin) && (
                <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">Xyz-Hip3</span>
              )}
              {selectedCoin && isVntlHip3(selectedCoin) && (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">Vntl-Hip3</span>
              )}
            </div>
            {selectedCoin && <p className="text-sm text-gray-400">过去 30 天数据</p>}
          </div>
          <div className="p-4">
            {selectedCoin ? (
              historyLoading ? (
                <div className="flex h-[400px] items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500"></div>
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-4">
                  <div className="h-[300px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-gray-900">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">时间</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">小时资金费率</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">年化资金费率</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {history.map((item, index) => (
                          <tr key={index} className="hover:bg-gray-700/50">
                            <td className="px-3 py-2 text-sm text-gray-300">{formatTime(item.time)}</td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`font-mono text-sm ${
                                  parseFloat(item.fundingRate) > 0
                                    ? "text-green-400"
                                    : parseFloat(item.fundingRate) < 0
                                      ? "text-red-400"
                                      : "text-gray-400"
                                }`}
                              >
                                {(parseFloat(item.fundingRate) * 100).toFixed(4)}%
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`font-mono text-sm ${
                                  parseFloat(item.fundingRate) > 0
                                    ? "text-green-400"
                                    : parseFloat(item.fundingRate) < 0
                                      ? "text-red-400"
                                      : "text-gray-400"
                                }`}
                              >
                                {formatAnnualizedRate(item.fundingRate)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-4">
                    <div>
                      <p className="text-sm text-gray-400">最高年化费率</p>
                      <p className="text-lg font-mono text-green-400">
                        {formatAnnualizedRate(
                          Math.max(...history.map((item) => parseFloat(item.fundingRate))).toString(),
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">最低年化费率</p>
                      <p className="text-lg font-mono text-red-400">
                        {formatAnnualizedRate(
                          Math.min(...history.map((item) => parseFloat(item.fundingRate))).toString(),
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">7 天平均年化</p>
                      <p className="text-lg font-mono text-blue-400">
                        {(() => {
                          const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
                          const last7Days = history.filter((item) => item.time >= sevenDaysAgoMs);
                          if (last7Days.length === 0) return "-";
                          const avg =
                            last7Days.reduce((sum, item) => sum + parseFloat(item.fundingRate), 0) /
                            last7Days.length;
                          return formatAnnualizedRate(avg);
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">30 天平均年化</p>
                      <p className="text-lg font-mono text-purple-400">
                        {(() => {
                          if (history.length === 0) return "-";
                          const avg =
                            history.reduce((sum, item) => sum + parseFloat(item.fundingRate), 0) /
                            history.length;
                          return formatAnnualizedRate(avg);
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-[400px] items-center justify-center text-gray-400">
                  <div className="text-center">
                    <p>暂无历史数据</p>
                    <p className="mt-2 text-sm text-gray-500">{selectedCoin} 的历史数据暂时不可用</p>
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-[400px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg className="mx-auto mb-4 h-16 w-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  <p>点击左侧交易对查看历史数据</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">资金费率说明</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-400">
          <li><strong className="text-gray-300">HIP-3 资产</strong>：Hyperliquid Improvement Proposal 3 支持的扩展资产，例如商品和股票指数等。</li>
          <li>正资金费率表示多头支付空头，通常代表市场偏多。</li>
          <li>负资金费率表示空头支付多头，通常代表市场偏空。</li>
          <li>资金费率按小时结算，年化数据主要用于观察趋势。</li>
          <li>7 天与 30 天平均值基于历史资金费率数据计算。</li>
        </ul>
      </div>
    </div>
  );
}
