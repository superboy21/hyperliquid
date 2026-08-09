"use client";

import CrossExchangeSearch from "@/components/search/CrossExchangeSearch";
import Link from "next/link";

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-neutral-900">
      <div className="w-full px-3 py-6 sm:px-4 lg:px-5 xl:px-6">
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white">跨交易所搜索</h1>
            </div>
            <nav className="flex flex-wrap items-center gap-2" aria-label="市场搜索导航">
              <Link
                href="/spot_perp_arbitrage"
                className="inline-flex items-center gap-2 rounded-lg border border-violet-600 bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:border-violet-500 hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                现货 / 永续组合
              </Link>
              <Link
                href="/funding"
                className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:border-blue-500 hover:bg-blue-500"
              >
                返回资金费率页
              </Link>
            </nav>
          </div>
          <p className="text-gray-400">
            输入关键字，搜索所有交易所的交易对，并对比 9核心指标。
          </p>
        </div>

        <CrossExchangeSearch />
      </div>
    </main>
  );
}
