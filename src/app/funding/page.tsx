"use client";

import { useState } from "react";
import FundingMonitor from "@/components/funding/FundingMonitor";
import GateFundingMonitor from "@/components/funding/GateFundingMonitor";
import BinanceFundingMonitor from "@/components/funding/BinanceFundingMonitor";
import LighterFundingMonitor from "@/components/funding/LighterFundingMonitor";

type Exchange = "hyperliquid" | "gate" | "binance" | "lighter";

export default function FundingPage() {
  const [selectedExchange, setSelectedExchange] = useState<Exchange>("hyperliquid");

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
            <h1 className="text-3xl font-bold text-white">交易所资金费率监控</h1>
          </div>
          <p className="text-gray-400">
            实时监控各交易对资金费率，并在右侧查看最近 30 天日线蜡烛图和日均资金费率副图。
          </p>
          
          {/* 交易所切换按钮 */}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => setSelectedExchange("hyperliquid")}
              className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium transition-all ${
                selectedExchange === "hyperliquid"
                  ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Hyperliquid
              {selectedExchange === "hyperliquid" && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">当前</span>
              )}
            </button>
            <button
              onClick={() => setSelectedExchange("gate")}
              className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium transition-all ${
                selectedExchange === "gate"
                  ? "border-cyan-600 bg-cyan-600 text-white shadow-lg shadow-cyan-600/25"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
              </svg>
              Gate.io
              {selectedExchange === "gate" && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">当前</span>
              )}
            </button>
            <button
              onClick={() => setSelectedExchange("binance")}
              className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium transition-all ${
                selectedExchange === "binance"
                  ? "border-yellow-600 bg-yellow-600 text-white shadow-lg shadow-yellow-600/25"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Binance
              {selectedExchange === "binance" && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">当前</span>
              )}
            </button>
            <button
              onClick={() => setSelectedExchange("lighter")}
              className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-medium transition-all ${
                selectedExchange === "lighter"
                  ? "border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-600/25"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Lighter
              {selectedExchange === "lighter" && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-xs">当前</span>
              )}
            </button>
          </div>
        </div>

        {/* 根据选择显示对应的监控组件 */}
        {selectedExchange === "hyperliquid" ? (
          <FundingMonitor />
        ) : selectedExchange === "gate" ? (
          <GateFundingMonitor />
        ) : selectedExchange === "binance" ? (
          <BinanceFundingMonitor />
        ) : (
          <LighterFundingMonitor />
        )}
      </div>
    </main>
  );
}
