"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAllFundingRates,
  getFundingHistory,
  formatFundingRate,
  formatPrice,
  formatTime,
  type FundingRate,
  type FundingHistoryItem,
} from "@/lib/hyperliquid";

export default function FundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [history, setHistory] = useState<FundingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"rate" | "name">("rate");
  const [sortDesc, setSortDesc] = useState(true);

  // 获取资金费率数据
  const fetchData = useCallback(async () => {
    try {
      const rates = await getAllFundingRates();
      setFundingRates(rates);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载和定时刷新
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 每30秒刷新
    return () => clearInterval(interval);
  }, [fetchData]);

  // 获取历史数据
  const fetchHistory = useCallback(async (coin: string) => {
    setHistoryLoading(true);
    try {
      // 获取过去7天的历史数据
      const endTime = Date.now();
      const startTime = endTime - 7 * 24 * 60 * 60 * 1000;
      const historyData = await getFundingHistory(coin, startTime, endTime);
      setHistory(historyData);
    } catch (error) {
      console.error("Error fetching history:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 当选择币种时获取历史数据
  useEffect(() => {
    if (selectedCoin) {
      fetchHistory(selectedCoin);
    }
  }, [selectedCoin, fetchHistory]);

  // 过滤和排序
  const filteredAndSortedRates = fundingRates
    .filter(
      (rate) =>
        rate.coin.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "rate") {
        const rateA = parseFloat(a.fundingRate);
        const rateB = parseFloat(b.fundingRate);
        return sortDesc ? rateB - rateA : rateA - rateB;
      } else {
        return sortDesc
          ? b.coin.localeCompare(a.coin)
          : a.coin.localeCompare(b.coin);
      }
    });

  // 计算统计数据
  const positiveRates = fundingRates.filter(
    (r) => parseFloat(r.fundingRate) > 0
  ).length;
  const negativeRates = fundingRates.filter(
    (r) => parseFloat(r.fundingRate) < 0
  ).length;
  const avgRate =
    fundingRates.length > 0
      ? fundingRates.reduce((sum, r) => sum + parseFloat(r.fundingRate), 0) /
        fundingRates.length
      : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">加载资金费率数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">交易对数量</p>
          <p className="text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">正资金费率</p>
          <p className="text-2xl font-bold text-green-400">{positiveRates}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">负资金费率</p>
          <p className="text-2xl font-bold text-red-400">{negativeRates}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">平均资金费率</p>
          <p
            className={`text-2xl font-bold ${
              avgRate >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {formatFundingRate(avgRate.toString())}
          </p>
        </div>
      </div>

      {/* 搜索和排序 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="搜索交易对..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSortBy("rate");
              setSortDesc(!sortDesc);
            }}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              sortBy === "rate"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            按费率 {sortDesc ? "↓" : "↑"}
          </button>
          <button
            onClick={() => {
              setSortBy("name");
              setSortDesc(!sortDesc);
            }}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              sortBy === "name"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            按名称 {sortDesc ? "↓" : "↑"}
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 资金费率列表 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">实时资金费率</h2>
            <p className="text-sm text-gray-400">每30秒自动刷新</p>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-900 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">
                    交易对
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    资金费率
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    标记价格
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAndSortedRates.map((rate) => (
                  <tr
                    key={rate.coin}
                    onClick={() => setSelectedCoin(rate.coin)}
                    className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                      selectedCoin === rate.coin ? "bg-gray-700" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-white">
                        {rate.coin}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-mono font-medium ${
                          parseFloat(rate.fundingRate) >= 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {formatFundingRate(rate.fundingRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-gray-300 font-mono">
                        {formatPrice(rate.markPrice)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 历史数据图表 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">
              {selectedCoin ? `${selectedCoin} 历史资金费率` : "选择交易对查看历史"}
            </h2>
            {selectedCoin && (
              <p className="text-sm text-gray-400">过去7天数据</p>
            )}
          </div>
          <div className="p-4">
            {selectedCoin ? (
              historyLoading ? (
                <div className="flex items-center justify-center h-[400px]">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-4">
                  {/* 简化的历史数据展示 */}
                  <div className="h-[300px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-900 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">
                            时间
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">
                            资金费率
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {history
                          .slice()
                          .reverse()
                          .map((item, index) => (
                            <tr key={index} className="hover:bg-gray-700/50">
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {formatTime(item.time)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span
                                  className={`font-mono text-sm ${
                                    parseFloat(item.fundingRate) >= 0
                                      ? "text-green-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {formatFundingRate(item.fundingRate)}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 统计信息 */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
                    <div>
                      <p className="text-sm text-gray-400">最高费率</p>
                      <p className="text-lg font-mono text-green-400">
                        {formatFundingRate(
                          Math.max(
                            ...history.map((h) => parseFloat(h.fundingRate))
                          ).toString()
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">最低费率</p>
                      <p className="text-lg font-mono text-red-400">
                        {formatFundingRate(
                          Math.min(
                            ...history.map((h) => parseFloat(h.fundingRate))
                          ).toString()
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-gray-400">
                  暂无历史数据
                </div>
              )
            ) : (
              <div className="flex items-center justify-center h-[400px] text-gray-400">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 mx-auto mb-4 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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

      {/* 说明 */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-sm font-medium text-gray-300 mb-2">资金费率说明</h3>
        <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
          <li>正资金费率：多头支付给空头，表示市场看涨情绪较强</li>
          <li>负资金费率：空头支付给多头，表示市场看跌情绪较强</li>
          <li>资金费率每8小时结算一次（UTC 00:00, 08:00, 16:00）</li>
          <li>数据来源于 Hyperliquid 官方 API</li>
        </ul>
      </div>
    </div>
  );
}
