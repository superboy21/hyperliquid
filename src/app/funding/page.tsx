import type { Metadata } from "next";
import FundingMonitor from "@/components/funding/FundingMonitor";

export const metadata: Metadata = {
  title: "Hyperliquid 资金费率监控",
  description: "实时查看 Hyperliquid 各资产资金费率、价格走势与最近 30 天图表。",
};

export default function FundingPage() {
  return (
    <main className="min-h-screen bg-neutral-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
              <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white">Hyperliquid 资金费率监控</h1>
          </div>
          <p className="text-gray-400">
            实时监控各交易对资金费率，并在右侧查看最近 30 天日线蜡烛图和日均资金费率副图。
          </p>
        </div>

        <FundingMonitor />
      </div>
    </main>
  );
}
