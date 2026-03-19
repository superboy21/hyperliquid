import type { Metadata } from "next";
import GateFundingMonitor from "@/components/funding/GateFundingMonitor";

export const metadata: Metadata = {
  title: "Gate.io 资金费率监控",
  description: "Gate.io 永续合约资金费率实时监控工具，支持 K 线图表、年化费率计算、7天/30天统计。",
};

export default function GateFundingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">Gate.io 资金费率监控</h1>
          <p className="mt-2 text-gray-400">
            实时监控 Gate.io 永续合约资金费率，支持多周期图表和年化费率计算
          </p>
        </div>
        <GateFundingMonitor />
      </div>
    </main>
  );
}
