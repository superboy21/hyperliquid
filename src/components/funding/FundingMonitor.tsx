"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAllFundingRatesWithHistory,
  getFundingHistory,
  formatAnnualizedRate,
  formatPrice,
  formatTime,
  formatVolume,
  toAnnualizedRate,
  type FundingRate,
  type FundingHistoryItem,
} from "@/lib/hyperliquid";

// Helper function to calculate averages from history
function calculateAveragesFromHistory(history: FundingHistoryItem[]) {
  if (history.length === 0) return { avg7d: null, avg30d: null };

  const endTimeMs = Date.now(); // 毫秒级时间戳
  const sevenDaysAgoMs = endTimeMs - 7 * 24 * 60 * 60 * 1000; // 7天前的毫秒级时间戳
  // API返回的time是毫秒级
  const last7Days = history.filter((h) => h.time >= sevenDaysAgoMs);

  const avg7d =
    last7Days.length > 0
      ? last7Days.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / last7Days.length
      : null;

  const avg30d =
    history.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / history.length;

  return { avg7d, avg30d };
}

export default function FundingMonitor() {
  const [fundingRates, setFundingRates] = useState<FundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [history, setHistory] = useState<FundingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"rate" | "name" | "volume">("volume");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<"all" | "hip3" | "standard">("all");

  // 获取资金费率数据
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const rates = await getAllFundingRatesWithHistory();
      
      if (rates.length === 0) {
        setError("未能获取到资金费率数据，请稍后重试");
      } else {
        setFundingRates(rates);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("获取数据时发生错误");
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
    setHistory([]); // 清空旧数据
    try {
      // API最多返回500条记录，超过会丢失最新数据
      // 请求两次15天数据并拼接：15天约360条，两个15天共720条，取最新的30天
      const endTime = Math.floor(Date.now() / 1000);
      
      // 第一次请求：最近15天
      const startTime1 = endTime - 15 * 24 * 60 * 60;
      console.log(`Fetching history for ${coin}: startTime1=${startTime1} (${new Date(startTime1 * 1000).toISOString()})`);
      const history1 = await getFundingHistory(coin, startTime1);
      console.log(`History1 (last 15d) for ${coin}: ${history1.length} items`);
      
      // 第二次请求：更早的15天
      const startTime2 = startTime1 - 15 * 24 * 60 * 60;
      console.log(`Fetching history for ${coin}: startTime2=${startTime2} (${new Date(startTime2 * 1000).toISOString()})`);
      const history2 = await getFundingHistory(coin, startTime2);
      console.log(`History2 (15d-30d ago) for ${coin}: ${history2.length} items`);
      
      // 合并并按时间排序（最新的在前）
      const combinedHistory = [...history1, ...history2].sort((a, b) => b.time - a.time);
      console.log(`Combined history for ${coin}: ${combinedHistory.length} items`);
      
      // 取最近的30天数据（API返回的time是毫秒级）
      const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const last30Days = combinedHistory.filter((h) => h.time >= thirtyDaysAgoMs);
      console.log(`Last 30 days for ${coin}: ${last30Days.length} items`);
      
      if (last30Days.length > 0) {
        console.log(`First item time: ${last30Days[0].time} (${new Date(last30Days[0].time).toISOString()})`);
        console.log(`Last item time: ${last30Days[last30Days.length-1].time} (${new Date(last30Days[last30Days.length-1].time).toISOString()})`);
      }
      
      setHistory(last30Days);
    } catch (error) {
      console.error("Error fetching history:", error);
      setHistory([]);
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

  // 根据类型筛选
  const ratesByType = fundingRates.filter((rate) => {
    if (filterType === "hip3") return rate.coin.startsWith("xyz:");
    if (filterType === "standard") return !rate.coin.startsWith("xyz:");
    return true;
  });

  // 过滤和排序
  const filteredAndSortedRates = ratesByType
    .filter(
      (rate) =>
        rate.coin.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "rate") {
        const rateA = parseFloat(a.fundingRate);
        const rateB = parseFloat(b.fundingRate);
        return sortDesc ? rateB - rateA : rateA - rateB;
      } else if (sortBy === "volume") {
        const volA = parseFloat(a.dayVolume);
        const volB = parseFloat(b.dayVolume);
        return sortDesc ? volB - volA : volA - volB;
      } else {
        return sortDesc
          ? b.coin.localeCompare(a.coin)
          : a.coin.localeCompare(b.coin);
      }
    });

  // 计算统计数据（使用年化值）
  const positiveRates = fundingRates.filter(
    (r) => parseFloat(r.fundingRate) > 0
  ).length;
  const negativeRates = fundingRates.filter(
    (r) => parseFloat(r.fundingRate) < 0
  ).length;
  const zeroRates = fundingRates.filter(
    (r) => parseFloat(r.fundingRate) === 0
  ).length;
  const hip3Count = fundingRates.filter(
    (r) => r.coin.startsWith("xyz:")
  ).length;
  
  // 计算平均年化资金费率
  const avgRate =
    fundingRates.length > 0
      ? fundingRates.reduce((sum, r) => sum + parseFloat(r.fundingRate), 0) /
        fundingRates.length
      : 0;
  const avgAnnualized = toAnnualizedRate(avgRate);

  const totalVolume = fundingRates.reduce(
    (sum, r) => sum + parseFloat(r.dayVolume),
    0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">正在加载资金费率数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">交易对数量</p>
          <p className="text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">HIP-3 资产</p>
          <p className="text-2xl font-bold text-purple-400">{hip3Count}</p>
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
          <p className="text-gray-400 text-sm">零资金费率</p>
          <p className="text-2xl font-bold text-gray-400">{zeroRates}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <p className="text-gray-400 text-sm">当前平均年化</p>
          <p
            className={`text-lg font-bold ${
              avgAnnualized >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {formatAnnualizedRate(avgRate)}
          </p>
        </div>
      </div>

      {/* 搜索、筛选和排序 */}
      <div className="flex flex-col gap-4">
        {/* 资产类型切换 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterType("all")}
            className={`px-4 py-2 rounded-lg border transition-colors font-medium ${
              filterType === "all"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            全部资产
          </button>
          <button
            onClick={() => setFilterType("standard")}
            className={`px-4 py-2 rounded-lg border transition-colors font-medium ${
              filterType === "standard"
                ? "bg-cyan-600 border-cyan-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              标准资产
            </span>
          </button>
          <button
            onClick={() => setFilterType("hip3")}
            className={`px-4 py-2 rounded-lg border transition-colors font-medium ${
              filterType === "hip3"
                ? "bg-purple-600 border-purple-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400"></span>
              HIP-3 资产
            </span>
          </button>
        </div>

        {/* 搜索和排序 */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="搜索交易对 (如: BTC, ETH, xyz:gold...)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              setSortBy("rate");
              setSortDesc(!sortDesc);
            }}
            className={`px-3 py-2 rounded-lg border transition-colors text-sm ${
              sortBy === "rate"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            当前年化 {sortDesc ? "↓" : "↑"}
          </button>
          <button
            onClick={() => {
              setSortBy("volume");
              setSortDesc(!sortDesc);
            }}
            className={`px-3 py-2 rounded-lg border transition-colors text-sm ${
              sortBy === "volume"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            交易量 {sortDesc ? "↓" : "↑"}
          </button>
          <button
            onClick={() => {
              setSortBy("name");
              setSortDesc(!sortDesc);
            }}
            className={`px-3 py-2 rounded-lg border transition-colors text-sm ${
              sortBy === "name"
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
            }`}
          >
            名称 {sortDesc ? "↓" : "↑"}
          </button>
          </div>
          </div>
        </div>

      {/* 更新时间 */}
      {lastUpdate && (
        <div className="text-sm text-gray-500">
          最后更新: {lastUpdate.toLocaleTimeString("zh-CN")} (每30秒自动刷新)
        </div>
      )}

      {/* 主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 资金费率列表 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">
              {filterType === "hip3" ? "最新结算年化" : filterType === "standard" ? "预测年化" : "资金费率年化"}
            </h2>
            <p className="text-sm text-gray-400">
              共 {filteredAndSortedRates.length} 个交易对
              {searchTerm && ` (筛选自 ${fundingRates.length} 个)`}
            </p>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-900 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">
                    交易对
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">
                    {filterType === "hip3" ? "最新结算年化" : filterType === "standard" ? "预测年化" : "年化资金费率"}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400 hidden lg:table-cell">
                    24h 交易量
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
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {rate.coin}
                        </span>
                        {rate.coin.startsWith("xyz:") && (
                          <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                            HIP-3
                          </span>
                        )}
                      </div>
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
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-gray-400 font-mono text-sm">
                        {formatVolume(rate.dayVolume)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAndSortedRates.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                没有找到匹配的交易对
              </div>
            )}
          </div>
        </div>

        {/* 历史数据图表 */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">
                {selectedCoin ? `${selectedCoin} 历史资金费率` : "选择交易对查看历史"}
              </h2>
              {selectedCoin && selectedCoin.startsWith("xyz:") && (
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                  HIP-3
                </span>
              )}
            </div>
            {selectedCoin && (
              <p className="text-sm text-gray-400">过去48小时数据</p>
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
                            年化资金费率
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {history.map((item, index) => (
                            <tr key={index} className="hover:bg-gray-700/50">
                              <td className="px-3 py-2 text-sm text-gray-300">
                                {formatTime(item.time)}
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

                  {/* 统计信息 */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700">
                    <div>
                      <p className="text-sm text-gray-400">最高年化费率</p>
                      <p className="text-lg font-mono text-green-400">
                        {formatAnnualizedRate(
                          Math.max(
                            ...history.map((h) => parseFloat(h.fundingRate))
                          ).toString()
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">最低年化费率</p>
                      <p className="text-lg font-mono text-red-400">
                        {formatAnnualizedRate(
                          Math.min(
                            ...history.map((h) => parseFloat(h.fundingRate))
                          ).toString()
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">7天平均年化</p>
                      <p className="text-lg font-mono text-blue-400">
                        {(() => {
                          const endTimeMs = Date.now(); // 毫秒级时间戳
                          const sevenDaysAgoMs = endTimeMs - 7 * 24 * 60 * 60 * 1000; // 7天前的毫秒级时间戳
                          // API返回的time是毫秒级
                          const last7Days = history.filter((h) => h.time >= sevenDaysAgoMs);
                          if (last7Days.length === 0) return "-";
                          const avg = last7Days.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / last7Days.length;
                          return formatAnnualizedRate(avg);
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">30天平均年化</p>
                      <p className="text-lg font-mono text-purple-400">
                        {(() => {
                          if (history.length === 0) return "-";
                          const avg = history.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / history.length;
                          return formatAnnualizedRate(avg);
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-gray-400">
                  <div className="text-center">
                    <p>暂无历史数据</p>
                    <p className="text-sm text-gray-500 mt-2">
                      {selectedCoin} 的历史数据不可用
                    </p>
                  </div>
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
          <li><strong className="text-gray-300">最新结算年化</strong>：显示已结算的资金费率乘以 365×3 = 1095 次计算得出的年化值</li>
          <li>正资金费率：多头支付给空头，表示市场看涨情绪较强</li>
          <li>负资金费率：空头支付给多头，表示市场看跌情绪较强</li>
          <li>资金费率每8小时结算一次（UTC 00:00, 08:00, 16:00）</li>
          <li>7天和30天平均基于历史资金费率数据计算</li>
          <li className="text-yellow-500">注：HIP-3 资产（如 xyz:gold、xyz:mstr 等）因 API 限制，暂无法获取资金费率数据</li>
        </ul>
      </div>
    </div>
  );
}
