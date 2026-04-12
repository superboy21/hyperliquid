# 🚀 Exchange Funding Rate Monitor

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38bdf8)

**实时监控 Hyperliquid、Gate.io、Binance 和 Lighter 资金费率的专业交易工具**

[在线演示](https://your-demo-link.com) · [报告问题](https://github.com/your-repo/issues) · [功能建议](https://github.com/your-repo/discussions)

</div>

---

## ✨ 核心功能

### 📊 多交易所支持
- **Hyperliquid**: 支持永续合约和 HIP-3 资产（股票、商品、ETF）
- **Gate.io**: 支持 655+ 永续合约，自动识别资产类别
- **Binance**: 支持 200+ USDT 永续合约，智能资产分类筛选
- **Lighter**: 支持 160+ 永续合约，包括股票、ETF、外汇、商品、加密货币

### 📈 实时数据监控
- **自动刷新**: 每 300 秒自动更新数据
- **多维度排序**: 资金费率、价格、涨跌幅、成交量、持仓价值
- **智能筛选**: 按资产类别（Crypto、股票、ETF、外汇、商品等）快速筛选
- **最新结算费率**: 支持 Hyperliquid、Binance、Gate.io、Lighter 的真实已结算费率展示
- **保守请求策略**: Hyperliquid 采用按需加载（首屏前 10 + 点击 ±5），避免 API 限流
- **跨交易所搜索**: 支持搜索四个交易所的交易对，9+ 核心指标对比

### 🎯 专业图表分析
- **K 线图表**: 支持日线、4小时线、1小时线切换
- **资金费率副图**: 年化预测费率可视化
- **30 周期历史数据**: 完整的历史资金费率趋势
- **智能年化**: 根据图表周期自动调整年化系数

### 💡 智能统计
- **历史波动率**: 基于30周期对数收益率计算的年化波动率
- **当前买卖价差**: 实时买卖价差显示，公式 `(Best Ask - Best Bid) / Mid Price × 100`
- **7天/30天统计**: 最高、最低、平均资金费率
- **年化计算**: 自动换算年化预测费率（支持不同结算周期）
- **持仓价值加权**: 基于持仓量的加权平均年化

---

## 🎨 界面预览

```
┌─────────────────────────────────────────────────────────────────┐
│  交易所资金费率监控                                               │
│  [Hyperliquid] [Gate.io] [Binance] [Lighter]                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │交易对数量│ │正资金费率│ │负资金费率│ │平均年化  │ │ 结算周期 │   │
│  │   200   │ │   142   │ │    58   │ │ +8.3%   │ │   8h    │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  [全部] [Majors] [Metals] [Stocks] [Other Crypto]               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐ ┌─────────────────────────┐ │
│  │ 交易对列表                       │ │ K 线 + 资金费率图表      │ │
│  │ ─────────────────────────────── │ │                         │ │
│  │ BTC   69,832   -2.40%  +15.2%  │ │ BTC 近 30天 [日线][4h][1h]│ │
│  │ ETH    3,845   -3.15%  +8.7%   │ │    📈 K线 + 副图费率      │ │
│  │ SOL    178.5   -5.82%  +22.1%  │ │                         │ │
│  │ ...                            │ │                         │ │
│  └─────────────────────────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js** | 16.x | React 框架，App Router |
| **React** | 19.x | UI 组件库 |
| **TypeScript** | 5.x | 类型安全 |
| **Tailwind CSS** | 4.x | 响应式样式 |
| **ECharts** | 6.x | 专业图表库 |
| **Docker** | - | 容器化部署 |

### 架构特点

- **共享 ExchangeFundingMonitor 组件**: 4 个交易所共用同一 UI 组件（减少 ~47% 代码量）
- **统一数据标准化层**: 所有交易所数据转换为统一格式 `ExchangeFundingRate`
- **交易所 Normalizer**: 每个交易所独立的标准化函数，便于扩展
- **多周期年化计算**: 根据图表周期（1d/4h/1h）自动调整年化系数
- **历史波动率**: 基于对数收益率计算的年化波动率
- **资金收益率**: 基于中位数价格和平均费率计算的年化收益率
- **useMemo 优化**: 所有派生数据使用 `useMemo` 缓存，避免不必要的重算
- **保守请求策略**: Hyperliquid 采用按需加载最新结算费率，避免 API 限流
- **智能 hydration**: Gate.io 支持滚动按需加载，Binance/Hyperliquid 采用 batch/按需策略

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn 或 bun

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-repo/exchange-funding-monitor.git
cd exchange-funding-monitor

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:3000/funding
```

### Docker 部署

```bash
# 构建镜像
docker build -t funding-monitor .

# 运行容器
docker run -d -p 3000:3000 --name funding-monitor funding-monitor

# 或使用 Docker Compose
docker compose up -d --build
```

---

## 📁 项目结构

```
src/
├── app/
│   ├── funding/
│   │   └── page.tsx                    # 资金费率监控主页面
│   ├── search/
│   │   └── page.tsx                    # 跨交易所搜索页面
│   ├── api/
│   │   ├── gate/                       # Gate.io API 代理
│   │   ├── binance/                    # Binance API 代理（含 klines）
│   │   └── lighter/                    # Lighter API 代理
│   └── page.tsx                        # 首页
├── components/
│   ├── funding/
│   │   ├── ExchangeFundingMonitor.tsx  # 共享 UI 组件（表格、统计、筛选、排序）
│   │   ├── FundingMonitor.tsx          # Hyperliquid 数据获取 + 配置
│   │   ├── GateFundingMonitor.tsx      # Gate.io 数据获取 + 配置
│   │   ├── BinanceFundingMonitor.tsx   # Binance 数据获取 + 配置
│   │   ├── LighterFundingMonitor.tsx   # Lighter 数据获取 + 配置
│   │   └── *Chart.tsx                  # 各交易所图表组件
│   └── search/
│       └── CrossExchangeSearch.tsx     # 跨交易所搜索核心组件
├── lib/
│   ├── types.ts                        # 统一数据接口定义
│   ├── search.ts                       # 跨交易所搜索工具函数
│   ├── normalizers/                    # 数据标准化层
│   │   ├── index.ts                    # 统一导出和工具函数
│   │   ├── hyperliquid.ts              # Hyperliquid 标准化
│   │   ├── gateio.ts                   # Gate.io 标准化
│   │   └── binance.ts                  # Binance 标准化
│   ├── hyperliquid.ts                  # Hyperliquid API 封装
│   ├── gateio.ts                       # Gate.io API 封装
│   ├── lighter.ts                      # Lighter 格式化函数
│   └── utils/                          # 工具函数
│       └── funding.ts                  # 资金费率计算工具
└── ...
```

---

## 🎯 支持的交易所

### Hyperliquid
| 功能 | 支持状态 |
|------|----------|
| 永续合约 | ✅ |
| HIP-3 资产 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |
| 最新结算费率 | ✅ |
| 保守请求策略 | ✅ |

### Gate.io
| 功能 | 支持状态 |
|------|----------|
| 永续合约 (USDT) | ✅ |
| 655+ 交易对 | ✅ |
| 资产类别筛选 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |

### Binance
| 功能 | 支持状态 |
|------|----------|
| 永续合约 (USDT) | ✅ |
| 200+ 交易对 | ✅ |
| 资产类别筛选 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |
| 买卖价差显示 | ✅ |
| 持仓价值（异步加载） | ✅ |

### Lighter
| 功能 | 支持状态 |
|------|----------|
| 永续合约 | ✅ |
| 160+ 交易对 | ✅ |
| 资产类别筛选 | ✅ |
| 实时资金费率 | ✅ |
| 历史数据 | ✅ |
| K 线图表 | ✅ |
| 买卖价差显示 | ✅ |

---

## 📊 资产类别分类

### Gate.io
- **Crypto**: 主流币、Meme、Layer 1/2、DeFi、AI、游戏、RWA
- **股票/指数**: BABA、TSLA、NVDA、SPY、QQQ、SPX500、PAYP、GVZ、EWY 等
- **商品**: XAU、XAG、XBR、PAXG、SLVON 等
- **其他**: 其他类型的永续合约

### Binance
- **Majors**: BTC, ETH, BNB, SOL, HYPE, LINK, XRP, TRX, ADA, WLFI, AAVE, SKY, DOGE, BCH
- **Metals**: XAU, XAG, XPT, XPD, COPPER, PAXG, XAUT
- **Energy**: CL (WTI 原油), BZ (布伦特原油), NATGAS (天然气)
- **Stocks**: TSLA, MSTR, AMZN, AAPL, NVDA, EWY, EWJ, QQQ, SPY, META, GOOGL, MSFT, PAYP 等
- **Other Crypto**: 其他所有加密货币永续合约

### Lighter
- **Equities**: HOOD, AAPL, META, INTC, AMZN, BMNR, PLTR, COIN, SAMSUNG, STRC, AMD, SNDK, HANMI, HYUNDAI, ASML, CRCL, TSLA, NVDA, GOOGL, MSTR, MSFT
- **ETF/Index**: QQQ, SPY, KRCOMP, URA, IWM, MAGS, BOTZ, DIA
- **FX**: EURUSD, USDKRW, USDJPY, GBPUSD, USDCHF, USDCAD, AUDUSD, NZDUSD
- **Commodities**: XAU, XAG, WTI, BRENTOIL, XPT, XCU, XPD
- **Crypto**: 其他所有加密货币永续合约

---

## 🔧 配置选项

### 环境变量

```env
# 可选：自定义 API 基础 URL
NEXT_PUBLIC_HYPERLIQUID_API=https://api.hyperliquid.xyz
NEXT_PUBLIC_GATE_API=https://api.gate.io/api/v4
```

### 数据刷新间隔

默认每 300 秒自动刷新数据。可在 `ExchangeFundingMonitor.tsx` 中修改：

```typescript
const interval = setInterval(handleFetchRates, 300000); // 300 秒
```

### Hyperliquid 保守请求策略

Hyperliquid 页面采用按需加载最新结算费率策略：
- **初始加载**: 仅获取前 10 个交易对
- **点击行**: 加载当前点击交易对及其上下各 5 个交易对
- **切换标签**: 加载该标签页前 10 个交易对
- **其他情况**: 不自动获取最新结算费率，避免 API 限流

---

## 📈 计算公式

### 年化资金费率

```
年化费率 = 资金费率 × (24 / 结算周期小时) × 365 × 100
```

- **1小时结算 (Hyperliquid)**: `费率 × 24 × 365 × 100`
- **8小时结算 (Gate.io)**: `费率 × 3 × 365 × 100`
- **4小时结算**: `费率 × 6 × 365 × 100`

### 历史波动率（年化）

```
1. 计算对数收益率: r_i = ln(P_i / P_{i-1})
2. 计算标准差: σ = std(r_i)
3. 年化波动率: HV = σ × √(每年周期数) × 100
```

- **日线 (1d)**: HV = σ × √365 × 100
- **4小时线 (4h)**: HV = σ × √2190 × 100
- **1小时线 (1h)**: HV = √8760 × 100

### 资金收益率（年化）

```
1. 每周期中位数价格: P_median = (High + Low) / 2
2. 每周期收益: Return_i = P_median_i × FundingRate_i
3. 30周期总收益: Total_Return = Σ(Return_i)
4. 年化收益率: Yield = (Total_Return / Latest_Price) × 年化系数 × 100
```

- **日线 (1d)**: 年化系数 = 12
- **4小时线 (4h)**: 年化系数 = 72
- **1小时线 (1h)**: 年化系数 = 288

### 持仓价值加权平均

```
加权平均年化 = Σ(年化费率 × 持仓价值) / Σ(持仓价值)
```

### 当前买卖价差

```
买卖价差 = (Best Ask - Best Bid) / Mid Price × 100
```

- **Best Ask**: 最低卖价（交易所提供）
- **Best Bid**: 最高买价（交易所提供）
- **Mid Price**: 中间价 `(Best Ask + Best Bid) / 2`

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📝 更新日志

### v2026.04.14 (2026-04-14)
- ✨ **搜索页 detail 请求真正可取消**: 将 `AbortSignal` 从搜索页 UI 层传递到 Hyperliquid/Gate/Binance/Lighter 底层网络请求，旧请求不再只是"不回写 UI"，而是底层也会及时中止
- ✨ **代理路由取消传播**: Gate 和 Lighter 的 Next API 路由同时监听客户端 abort 信号，客户端断开时服务端尽快结束，避免空等超时
- ✨ **预期内取消日志降噪**: 检测 abort-like 错误并在日志级别降为静默/可选项，而非全部 `console.error`，减少控制台噪音
- ✨ **Lighter 搜索优化**: 优先复用已有的 `marketId`，减少一次额外的 funding-rates 查询
- ✨ **搜索页 Binance 最新结算费率按最大 fundingTime 取最新**: 修复与 Binance 单页口径一致（之前 limit>1 返回升序，取第一条约等于最旧）

### v2026.04.12 (2026-04-12)
- ✨ **Hyperliquid / Lighter 最新结算费率加载优化**: 首屏改为 `selected + 可见行` 按需 hydration，总上限 `7`，减少不必要的 settlement 请求
- ✨ **点击预取收紧**: Hyperliquid / Lighter 的 latest settlement 预取范围调整为 `±3`
- ✨ **共享缓存与去重**: `ExchangeFundingMonitor` 新增 `60000ms` settlement 缓存与 inflight 去重，减少重复 API 调用
- ✨ **selected 行自动回填**: 图表 detail funding history 请求现在会顺手回填 latest settlement，避免额外单独请求
- ✨ **短窗口回退策略**: Hyperliquid 先查 `12h` 后回退 `72h`，Lighter 先查 `6h` 后回退 `24h`，在保持显示口径不变的前提下减少请求数据量

### v2026.04.07 (2026-04-07)
- ✨ **Lighter 最新结算费率修复**: 改用 `fundings` 历史接口获取真实已结算费率，修正 12.5x 换算系数，显示逻辑与页面一致
- ✨ **跨交易所搜索页新增列**: 
  - “最新结算费率”列：对齐各交易所页面最新 settlement 获取方式（Hyperliquid: fundingHistory, Gate/Binance/Lighter: history 最新一条）
  - “平均费率（1天）”列：对齐各交易所图表日线最后一根 candle tooltip 的折算年化费率
- ✨ **搜索页布局优化**: 全宽容器 + 紧凑表格 + 禁止换行，减少横向滚动
- ✨ **搜索页延迟加载**: 新增列与其他 detail 指标一致，仅在用户搜索行为触发后才加载
- 🐛 搜索页settlement显示：修复 Lighter 响应格式兼容（兼容 `{fundings: [...]}` 和 `[...]` 两种返回）
- 🐛 K线图 tooltip 文字修改：“折算年化预测费率”改为“折算年化费率”（4个交易所统一）
- 🐛 Binance 移除 7 个已下架交易对：A2ZUSDT, FORTHUSDT, HOOKUSDT, LRCUSDT, NTRNUSDT, RDNTUSDT（MKUSDT 原本已在列表）

### v2026.04.06-2 (2026-04-06)
- ✨ **最新结算费率修复**: Hyperliquid 改用 `fundingHistory` API 获取真实已结算费率，不再错误复用预测费率
- ✨ **保守请求策略**: Hyperliquid 采用按需加载最新结算费率（首屏前 10 + 点击 ±3），避免 API 限流
- ✨ **智能 hydration**: Gate.io 支持滚动按需加载 + batch 请求（10 个/组）
- ✨ **Binance 统计卡恢复**: 修复 7 天/30 天统计卡数据缺失问题
- ✨ **重试/退避机制**: Hyperliquid `/info` 请求增加轻量重试与指数退避
- ✨ **请求合并**: 刷新主列表时保留已加载的 `lastSettlementRate`，避免重复 hydration
- 🐛 Gate.io 页面加载优化：前 50 初始化 + 滚动按需加载，不再全表加载
- 🐛 最新结算费率显示优化：无法获取时显示空白，不再显示错误值
- 🔄 自动刷新间隔统一改为 300 秒
- ♻️ 新增 `hydrationPolicy` 配置：支持各交易所自定义 hydration 策略
- ♻️ 新增 `getLatestSettledFundingRate()`：Hyperliquid 专用轻量结算费率获取函数

### v2026.04.06 (2026-04-06)
- ✨ **跨交易所搜索页**: 输入关键字搜索 Hyperliquid、Gate.io、Binance、Lighter 四个交易所的交易对
- ✨ 9 个核心指标对比：价格、24h涨跌、预测费率、24h成交额、持仓价值、历史波动率(30周期日线)、当前买卖价差、平均资金费率(7天)、平均资金费率(30天)
- ✨ 渐进式加载：字段 1-5 立即可见，字段 6-9 后台渐进式加载（并发 4 个）
- ✨ 搜索结果默认按持仓价值降序排序
- ✨ 搜索词变化时自动取消进行中的请求
- ✨ 表格列点击排序
- ✨ 搜索页与 funding 页互相入口按钮
- 🐛 搜索页修复：各交易所同名交易对缓存互相覆盖问题
- 🐛 搜索页修复：Lighter 预测费率年化公式（/8 处理）
- 🐛 搜索页修复：Lighter 平均费率年化公式（与交易所页一致）
- 🐛 搜索页修复：Lighter 买卖价差通过 orderBookOrders 获取
- 🐛 搜索页修复：Binance 持仓价值通过 openInterest API 获取
- 🐛 搜索页修复：平均费率计算先过滤 30 天数据
- ♻️ 重构 Exchange 切换按钮为配置数组（DRY）
- ♻️ 新增 `src/lib/search.ts` 跨交易所搜索工具函数
- ♻️ 新增 `src/components/search/CrossExchangeSearch.tsx` 核心搜索组件

### v2026.04.01 (2026-04-01)
- ✨ Hyperliquid HIP-3 新增：SP500（S&P 500 指数）、CRWV（CoreWeave）、DKNG（DraftKings）、HIMS（Hims & Hers）、COST（Costco）、LLY（Eli Lilly）
- 🗑️ Hyperliquid HIP-3 移除：SPY、QQQ、IWM、GLD、SLV、TLT、UVXY（与规格表对齐）
- ✨ Binance 新增 Energy 分类：CL（WTI 原油）、BZ（布伦特原油）、NATGAS（天然气）
- 🐛 Gate.io 历史资金费率修复：4h/2h/1h 结算周期的合约无法获取完整 30 天数据（原硬编码 `天数 × 3`，假设所有合约 8 小时结算）。修复后根据实际结算周期动态计算 `limit`
- 🐛 Stat Card "当前：" 改为 "周期："，显示正确的结算周期费率
- 🐛 周期费率计算修复：从年化值反推，公式 `annualizedPct × 结算周期小时 ÷ 8760`
- 🐛 Lighter 资金费率统计修复：stat card 与表格年化公式统一，消除 100x / 8x 偏差

### v2026.03.30 (2026-03-30)
- ✨ Binance Stocks 新增：PAYP（PayPal）
- ✨ Gate.io 股票/指数 新增：PAYP、GVZ（Gold Volatility Index）、EWY（iShares MSCI South Korea ETF）
- ♻️ **架构重构**: 提取共享 `ExchangeFundingMonitor` 组件，4 个交易所共用同一 UI（减少 ~47% 代码量，净减 1683 行）
- ♻️ Binance / Lighter 集成 normalizer 层，删除本地重复函数
- ⚡ 所有 Monitor 派生数据加 `useMemo`（`positiveCount`、`negativeCount`、`weightedAvgRate` 等）
- 🐛 Lighter 页面加载优化：3 个 API 请求全部并行（原为 2 并行 + 1 串行）
- 🐛 Lighter API 代理增加 15 秒超时（防止上游挂起阻塞）
- 🐛 Binance 持仓价值修复：OI 数据并入 fetchRates 主流程，确保共享组件拿到真实 OI
- 🐛 Lighter 资金费率年化计算修复：stat card 与表格使用不同公式，避免 100x / 8x 偏差
- 🐛 Lighter 买卖价差修复：fetchDetailData 新增 orderBook 请求获取 bid/ask
- 🎨 字号优化：表格标题、交易对名、图表标题、周期按钮统一缩小
- 🎨 图表标题与周期按钮改为同一行显示
- 🗑️ 删除 `/gate-funding` 孤立页面
- 🗑️ 删除 `GATE_API_URLS` 死代码
- 🗑️ 去重 Gate.io `ASSET_CATEGORIES`（减少 ~70% 内存占用）
- 🗑️ 移除未使用的 `Geist_Mono` 字体（节省 ~50KB）

### v2.6.0 (2026-03-29)
- ✨ Lighter Equities 新增：CRCL、TSLA、NVDA、GOOGL、MSTR、MSFT
- ✨ Lighter Commodities 新增：XPD

### v2.5.0 (2026-03-28)
- ✨ 新增 Lighter 交易所支持（160+ 永续合约）
- ✨ Lighter 资产分类（Equities、ETF/Index、FX、Commodities、Crypto）
- ✨ 使用 Lighter 官方 API 获取真实历史数据
- ✨ OI 加权平均年化资金费率计算
- ✨ 历史波动率计算
- ✨ 买卖价差显示
- 🐛 修复资金费率正负号问题（根据 direction 字段）
- 🐛 修复 API 限流问题

### v2.4.0 (2026-03-22)
- ✨ Binance 资产分类重构（Majors、Metals、Stocks、Other Crypto）
- ✨ 优化 Binance 页面加载速度（异步加载 openInterest）
- ✨ 自动刷新频率统一为 60 秒
- ✨ 字号优化（表头、交易对名称、图表标题）
- 🐛 修复 Gate.io API 代理超时问题
- 🐛 修复已下架资产过滤逻辑

### v2.3.0 (2026-03-22)
- ✨ 新增 Binance 交易所支持（200+ USDT 永续合约）
- ✨ Binance 资产类别筛选（Layer1/Layer2、DeFi、Meme、AI、GameFi、Storage 等）
- ✨ Binance 持仓价值显示（openInterest × markPrice）
- ✨ Binance 买卖价差显示（使用 bookTicker API）
- ✨ Binance 精确 30 天/7 天资金费率统计
- ✨ Binance 多结算周期支持（8h/4h/1h）
- ✨ 自动过滤已下架资产（无法获取 openInterest）
- 🐛 修复 Binance 图表 tooltip 不显示 K 线信息
- 🐛 修复 Binance 年化计算未乘以 100
- 🐛 修复 Binance 排序逻辑（与 Gate.io 一致）

### v2.2.0 (2026-03-20)
- ✨ 新增当前买卖价差显示 `(Best Ask - Best Bid) / Mid Price × 100`
- ✨ 支持 HIP3 资产的买卖价差计算
- ✨ 优化预测费率显示（年化值醒目 + 当前费率灰色）
- ✨ 移除 HIP3 交易对的彩色标签
- 🐛 修复 HIP3 资产买卖价差数据缺失问题

### v2.1.0 (2026-03-20)
- ✨ 新增统一数据标准化层（src/lib/types.ts 和 normalizers/）
- ✨ 新增历史波动率计算（支持多周期年化：1d/4h/1h）
- ✨ 新增资金收益率计算（基于中位数价格和平均费率）
- ✨ 优化图表周期切换（波动率和收益率自动更新）
- 🐛 修复 Gate.io 鼠标悬停显示的资金费率（考虑结算周期）
- 🐛 修复年化计算公式（支持不同结算周期）

### v2.0.0 (2026-03-20)
- ✨ 新增 Gate.io 交易所支持
- ✨ 新增资产类别筛选功能
- ✨ 新增多交易所切换功能
- 🐛 修复年化费率计算公式
- 🐛 修复筛选后统计数据不更新的问题

### v1.5.0 (2026-03-19)
- ✨ 新增 K 线图表功能
- ✨ 新增多周期切换（日线/4h/1h）
- ✨ 新增资金费率副图
- 🐛 修复时间桶对齐问题

### v1.0.0 (2026-03-18)
- 🎉 首次发布
- ✨ Hyperliquid 资金费率监控
- ✨ 实时数据刷新
- ✨ 历史数据查询

---

## ⚠️ 免责声明

本工具仅供信息参考，不构成投资建议。加密货币交易存在重大风险，可能不适合所有投资者。过往表现不代表未来收益。请在做出任何交易决策前，进行自己的研究并考虑您的财务状况。

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐️ Star 支持一下！**

Made with ❤️ for crypto traders

</div>
