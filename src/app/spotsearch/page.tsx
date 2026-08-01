"use client";

import Link from "next/link";
import SpotMarketSearch from "@/components/spotsearch/SpotMarketSearch";

export default function SpotSearchPage() {
  return (
    <main className="min-h-[100dvh] bg-neutral-900">
      <div className="w-full px-3 py-6 sm:px-4 lg:px-5 xl:px-6">
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600">
                <svg aria-hidden="true" className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M7 4v6m10-6v6M5 13h4v4H5v-4zm10 0h4v4h-4v-4z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">跨交易所现货搜索</h1>
                <p className="mt-1 text-xs text-emerald-400 sm:hidden">Spot Markets</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2" aria-label="市场搜索导航">
              <Link href="/spot_perp_arbitrage" className="inline-flex items-center gap-2 rounded-lg border border-violet-600 bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-violet-500 hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
                现货 / 永续组合
              </Link>
              <Link href="/search" className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-indigo-500 hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
                永续合约搜索
              </Link>
              <Link href="/funding" className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">
                返回资金费率页
              </Link>
            </nav>
          </div>
          <p className="text-gray-400">搜索各交易所现货市场，对比价格、成交额、波动率和真实盘口价差。</p>
        </div>
        <SpotMarketSearch />
      </div>
    </main>
  );
}
