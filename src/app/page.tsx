import Link from "next/link";

type ToolAccent = "blue" | "indigo" | "violet";

interface ToolEntry {
  href: string;
  name: string;
  description: string;
  actionLabel: string;
  accent: ToolAccent;
  iconPath: string;
}

const ACCENT_CLASSES: Record<
  ToolAccent,
  {
    tile: string;
    glow: string;
    cardHover: string;
    actionColor: string;
    focusRing: string;
  }
> = {
  blue: {
    tile: "from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25",
    glow: "from-blue-500/5 to-purple-500/5",
    cardHover: "hover:border-blue-500/50 hover:shadow-blue-500/10",
    actionColor: "text-blue-400 group-hover:text-blue-300",
    focusRing: "focus-visible:ring-blue-300",
  },
  indigo: {
    tile: "from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/25",
    glow: "from-indigo-500/5 to-sky-500/5",
    cardHover: "hover:border-indigo-500/50 hover:shadow-indigo-500/10",
    actionColor: "text-indigo-400 group-hover:text-indigo-300",
    focusRing: "focus-visible:ring-indigo-300",
  },
  violet: {
    tile: "from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25",
    glow: "from-violet-500/5 to-indigo-500/5",
    cardHover: "hover:border-violet-500/50 hover:shadow-violet-500/10",
    actionColor: "text-violet-400 group-hover:text-violet-300",
    focusRing: "focus-visible:ring-violet-300",
  },
};

const TOOLS: ToolEntry[] = [
  {
    href: "/funding",
    name: "交易所资金费率监控",
    description: "实时监控七家交易所资金费率，支持交易所切换、K 线图表与年化费率统计。",
    actionLabel: "开始使用",
    accent: "blue",
    iconPath: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  },
  {
    href: "/search",
    name: "跨交易所搜索",
    description: "跨交易所搜索永续交易对，对比盘口中间价、历史波动率与买卖价差等核心指标。",
    actionLabel: "搜索市场",
    accent: "indigo",
    iconPath: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    href: "/spot_perp_arbitrage",
    name: "现货 / 永续组合分析",
    description: "统一搜索现货与永续市场，按点击顺序构建价差或比值组合，查看重叠历史、成交额与资金费率。",
    actionLabel: "打开组合工具",
    accent: "violet",
    iconPath: "M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900">
      <header className="border-b border-white/10 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
              <svg
                className="h-6 w-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-white">HyperTools</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        {/* 标题区 */}
        <div className="mb-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75 motion-reduce:animate-none"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
            </span>
            Web3 交易工具箱
          </div>
          <h1 className="mb-6 text-5xl font-bold text-white md:text-6xl">
            专为链上交易者打造的
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent"> 数据分析工具</span>
          </h1>
          <p className="mx-auto max-w-2xl text-xl text-gray-400">
            聚合七家交易所资金费率，提供跨交易所搜索与现货 / 永续组合分析，帮助你更快发现市场机会。
          </p>
        </div>

        {/* 工具入口 */}
        <h2 className="sr-only">工具入口</h2>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
          {TOOLS.map((tool) => {
            const accent = ACCENT_CLASSES[tool.accent];
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`group relative flex h-full flex-col rounded-2xl border border-white/10 bg-gray-800/50 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 ${accent.cardHover} ${accent.focusRing} motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
              >
                <div
                  className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${accent.glow} opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none`}
                />
                <div className="relative flex h-full flex-col">
                  <div className="mb-4 flex items-center justify-between">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${accent.tile}`}>
                      <svg
                        className="h-6 w-6 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tool.iconPath} />
                      </svg>
                    </div>
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                      已上线
                    </span>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-white">{tool.name}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-gray-400">{tool.description}</p>
                  <div
                    className={`mt-4 flex items-center gap-2 text-sm font-medium transition-colors duration-300 ${accent.actionColor} motion-reduce:transition-none`}
                  >
                    {tool.actionLabel}
                    <svg
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* 特性区 */}
        <div className="mx-auto mt-20 grid max-w-4xl grid-cols-1 gap-8 text-center md:grid-cols-3">
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
              <svg
                className="h-6 w-6 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="mb-2 font-semibold text-white">实时数据</h3>
            <p className="text-sm text-gray-500">每 5 分钟自动刷新，尽量保证数据时效。</p>
          </div>
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10">
              <svg
                className="h-6 w-6 text-purple-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="mb-2 font-semibold text-white">安全可靠</h3>
            <p className="text-sm text-gray-500">使用公开市场数据接口，无需连接钱包。</p>
          </div>
          <div>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10">
              <svg
                className="h-6 w-6 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mb-2 font-semibold text-white">免费使用</h3>
            <p className="text-sm text-gray-500">所有核心功能均可直接使用，没有隐藏费用。</p>
          </div>
        </div>

        {/* 页脚 */}
        <div className="mt-20 text-center">
          <p className="mb-4 text-sm text-gray-500">如果你有功能建议，欢迎继续一起完善。</p>
          <div className="flex items-center justify-center gap-4 text-gray-600">
            <span className="text-sm">Built for Perpetual Traders</span>
            <span className="text-gray-700">|</span>
            <span className="text-sm">2026 HyperTools</span>
          </div>
        </div>
      </div>
    </main>
  );
}
