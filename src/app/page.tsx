import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900">
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
              <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-white">HyperTools</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
            </span>
            Web3 交易工具箱
          </div>
          <h1 className="mb-6 text-5xl font-bold text-white md:text-6xl">
            专为链上交易者打造的
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent"> 数据分析工具</span>
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-gray-400">
            为 Hyperliquid 交易者打造的专业工具集，实时监控资金费率，帮助你更快发现市场机会。
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/funding"
            className="group relative rounded-2xl border border-white/10 bg-gray-800/50 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-500/10"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                  已上线
                </span>
              </div>
              <h3 className="mb-2 text-xl font-bold text-white">交易所资金费率监控</h3>
              <p className="text-sm leading-relaxed text-gray-400">
                实时监控 Hyperliquid 和 Gate.io 全市场资金费率，支持多交易所切换、K 线图表和年化费率统计。
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-blue-400 transition-colors group-hover:text-blue-300">
                开始使用
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          <div className="relative rounded-2xl border border-white/5 bg-gray-800/30 p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-700/50">
                <svg className="h-6 w-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-400">
                开发中
              </span>
            </div>
            <h3 className="mb-2 text-xl font-bold text-gray-300">持仓分析</h3>
            <p className="text-sm leading-relaxed text-gray-500">
              分析大额持仓变化，追踪鲸鱼动向，帮助你发现市场趋势与潜在机会。
            </p>
          </div>

          <div className="relative rounded-2xl border border-white/5 bg-gray-800/30 p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-700/50">
                <svg className="h-6 w-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 3v8m-3-5h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-400">
                开发中
              </span>
            </div>
            <h3 className="mb-2 text-xl font-bold text-gray-300">套利计算器</h3>
            <p className="text-sm leading-relaxed text-gray-500">
              自动计算资金费率套利机会，支持跨交易所与跨周期套利策略。
            </p>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl grid-cols-1 gap-8 text-center md:grid-cols-3">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
              <svg className="h-6 w-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h4 className="mb-2 font-semibold text-white">实时数据</h4>
            <p className="text-sm text-gray-500">每 30 秒自动刷新，尽量保证数据时效。</p>
          </div>
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10">
              <svg className="h-6 w-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h4 className="mb-2 font-semibold text-white">安全可靠</h4>
            <p className="text-sm text-gray-500">直接连接公开市场数据，无需连接钱包。</p>
          </div>
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
              <svg className="h-6 w-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h4 className="mb-2 font-semibold text-white">免费使用</h4>
            <p className="text-sm text-gray-500">所有核心功能均可直接使用，没有隐藏费用。</p>
          </div>
        </div>

        <div className="mt-20 text-center">
          <p className="mb-4 text-sm text-gray-500">如果你有功能建议，欢迎继续一起完善。</p>
          <div className="flex items-center justify-center gap-4 text-gray-600">
            <span className="text-sm">Built for Hyperliquid Traders</span>
            <span className="text-gray-700">|</span>
            <span className="text-sm">2026 HyperTools</span>
          </div>
        </div>
      </div>
    </main>
  );
}
