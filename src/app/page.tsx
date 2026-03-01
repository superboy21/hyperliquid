import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900">
      {/* Header */}
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-white">HyperTools</span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            Web3 交易工具箱
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
            专业的链上交易
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent"> 数据分析工具</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            为 Hyperliquid 交易者打造的专业工具集，实时监控资金费率，发现交易机会
          </p>
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* 资金费率监控 */}
          <Link
            href="/funding"
            className="group relative bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-400 text-xs font-medium border border-green-500/20">
                  已上线
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">资金费率监控</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                实时监控 Hyperliquid 全市场资金费率，支持永续合约和 HIP-3 现货资产，提供历史数据分析和智能排序
              </p>
              <div className="mt-4 flex items-center gap-2 text-blue-400 text-sm font-medium group-hover:text-blue-300 transition-colors">
                开始使用
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          {/* 持仓分析 - 开发中 */}
          <div className="relative bg-gray-800/30 backdrop-blur-sm rounded-2xl p-6 border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-gray-700/50 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-medium border border-yellow-500/20">
                开发中
              </span>
            </div>
            <h3 className="text-xl font-bold text-gray-300 mb-2">持仓分析</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              分析大额持仓变化，追踪鲸鱼动向，发现市场趋势和潜在机会
            </p>
          </div>

          {/* 套利计算器 - 开发中 */}
          <div className="relative bg-gray-800/30 backdrop-blur-sm rounded-2xl p-6 border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-gray-700/50 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 36v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-medium border border-yellow-500/20">
                开发中
              </span>
            </div>
            <h3 className="text-xl font-bold text-gray-300 mb-2">套利计算器</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              自动计算资金费率套利机会，支持跨交易所和跨期套利策略
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto text-center">
          <div>
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h4 className="text-white font-semibold mb-2">实时数据</h4>
            <p className="text-gray-500 text-sm">30秒自动刷新，确保数据时效性</p>
          </div>
          <div>
            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h4 className="text-white font-semibold mb-2">安全可靠</h4>
            <p className="text-gray-500 text-sm">直连链上数据，无需连接钱包</p>
          </div>
          <div>
            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h4 className="text-white font-semibold mb-2">免费使用</h4>
            <p className="text-gray-500 text-sm">所有功能完全免费，无隐藏费用</p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-20 text-center">
          <p className="text-gray-500 text-sm mb-4">有功能建议？欢迎反馈</p>
          <div className="flex items-center justify-center gap-4 text-gray-600">
            <span className="text-sm">Built for Hyperliquid Traders</span>
            <span className="text-gray-700">|</span>
            <span className="text-sm">2025 HyperTools</span>
          </div>
        </div>
      </div>
    </main>
  );
}
