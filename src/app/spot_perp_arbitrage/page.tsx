import Link from "next/link";
import SpotPerpArbitrageController from "@/components/spot-perp-arbitrage/SpotPerpArbitrageController";

export default function SpotPerpArbitragePage() {
  return (
    <main className="min-h-[100dvh] bg-neutral-900">
      <div className="w-full px-3 py-6 sm:px-4 lg:px-5 xl:px-6">
        <header className="mb-7">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 shadow-lg shadow-violet-950/40">
                <svg aria-hidden="true" className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white sm:text-3xl">现货 / 永续组合分析</h1>
                <p className="mt-1 text-xs text-violet-300 sm:hidden">Spot · Perp</p>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-2" aria-label="市场工具导航">
              <Link href="/search" className="rounded-lg border border-indigo-600/70 bg-indigo-600/15 px-3 py-2 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">永续搜索</Link>
              <Link href="/" className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">工具首页</Link>
            </nav>
          </div>
          <p className="max-w-4xl text-sm text-gray-400">在六家交易所中搜索现货与永续市场，按顺序组合两条腿，对齐可用历史并查看价差、比值、成交额与资金费率。</p>
        </header>
        <SpotPerpArbitrageController />
      </div>
    </main>
  );
}
