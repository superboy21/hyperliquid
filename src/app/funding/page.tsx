import type { Metadata } from "next";
import FundingMonitor from "@/components/funding/FundingMonitor";

export const metadata: Metadata = {
  title: "Hyperliquid 资金费率监控",
  description: "实时监控 Hyperliquid 交易所的资金费率，查看历史数据和统计信息",
};

export default function FundingPage() {
  return (
    <main className="min-h-screen bg-neutral-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 页面头部 */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white">
              Hyperliquid 资金费率监控
            </h1>
          </div>
          <p className="text-gray-400 ml-13">
            实时监控所有交易对的资金费率，追踪市场情绪变化
          </p>
        </div>

        {/* 监控组件 */}
        <FundingMonitor />
      </div>
    </main>
  );
}
