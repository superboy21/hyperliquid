import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-900 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">
          Next.js Starter Template
        </h1>
        <p className="text-gray-400 mb-8">
          A minimal Next.js starter with TypeScript and Tailwind CSS
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          {/* 资金费率监控卡片 */}
          <Link
            href="/funding"
            className="group bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center mb-4 group-hover:bg-blue-600/30 transition-colors">
              <svg
                className="w-6 h-6 text-blue-400"
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
            <h2 className="text-xl font-semibold text-white mb-2">
              资金费率监控
            </h2>
            <p className="text-gray-400 text-sm">
              实时监控 Hyperliquid 交易所的资金费率，查看历史数据
            </p>
          </Link>

          {/* 占位卡片 */}
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50">
            <div className="w-12 h-12 bg-gray-700/50 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-400 mb-2">
              添加更多功能
            </h2>
            <p className="text-gray-500 text-sm">
              告诉我你想添加什么功能，我来帮你实现
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
