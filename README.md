# HyperTools - 跨交易所永续合约工具包

一个面向永续合约交易者的专业工具包，提供 Hyperliquid、Gate.io、Binance、OKX、Lighter 和 Bitget 六家交易所的资金费率监控与跨交易所搜索。

## 功能特性

- **六交易所资金费率监控**：追踪 Hyperliquid、Gate.io、Binance、OKX、Lighter 和 Bitget 的永续合约资金费率
- **历史数据分析**：查看 30 天资金费率历史及统计指标
- **智能排序与筛选**：按费率、价格、成交量、持仓量、24h 涨跌幅排序
- **资产类型筛选**：按标准资产、XYZ-Hip3、Vntl-Hip3、Para-Hip3、Km-Hip3 分类查看
- **加权平均计算**：持仓量加权平均资金费率
- **响应式设计**：适配桌面端和移动端

## 技术栈

- **框架**：Next.js 16 (React 19)
- **语言**：TypeScript
- **样式**：Tailwind CSS 4
- **状态管理**：React Hooks (useState, useEffect)
- **数据获取**：原生 Fetch API + Hyperliquid SDK + Next.js 服务端代理
- **包管理器**：Bun

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── funding/            # 资金费率监控页面
│   ├── search/             # 跨交易所搜索页面
│   ├── api/bitget/         # Bitget V3 UTA 公开市场 API 服务端代理
│   ├── layout.tsx          # 根布局
│   └── page.tsx            # 首页
├── components/             # React 组件
│   ├── funding/            # 资金费率监控组件
│   │   ├── FundingMonitor.tsx          # Hyperliquid 资金费率监控
│   │   ├── ExchangeFundingMonitor.tsx  # 通用交易所监控组件
│   │   └── ...
│   └── search/             # 搜索页面组件
│       └── CrossExchangeSearch.tsx
├── lib/                    # 工具函数与服务
│   ├── hyperliquid.ts      # Hyperliquid API 封装
│   ├── gateio.ts           # Gate.io API 封装
│   ├── lighter.ts          # Lighter API 封装
│   ├── search.ts           # 跨交易所搜索逻辑
│   ├── search-candles.ts   # 搜索图表数据获取
│   ├── symbol-mapping.ts   # API 名称与显示名称映射
│   ├── adapters/           # 交易所适配器
│   │   ├── binance.ts
│   │   ├── bitget.ts       # Bitget 请求调度、标准化与历史数据适配
│   │   ├── gate.ts
│   │   └── okx.ts
│   └── utils/              # 通用工具函数
└── ...
```

## 核心组件

### FundingMonitor.tsx
Hyperliquid 资金费率监控主组件，包含：
- 汇总统计（总交易对数、HIP-3 资产数、正/负费率数量）
- 筛选控件（资产类型、搜索、排序）
- 实时资金费率数据表格
- 选中资产的历史图表
- 资金费率说明区域

### ExchangeFundingMonitor.tsx
通用交易所资金费率监控组件供六家交易所页面复用；资金费率页可在 Hyperliquid、Gate.io、Binance、OKX、Lighter 和 Bitget 之间切换。

### CrossExchangeSearch.tsx
跨交易所搜索与对比工具，支持：
- 多交易所价格/费率对比
- 搜索命中后渐进加载详情，点击结果时按需加载图表
- 组合图表（Spread/Ratio 模式）
- 历史资金费率与成交额子图

## 快速开始

### 环境要求

- [Bun](https://bun.sh/)（包管理器）
- Node.js 18+

### 安装

```bash
bun install
```

### 开发

```bash
bun dev
```

### 构建生产版本

```bash
bun build
```

### 启动生产服务器

```bash
bun start
```

## 可用命令

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动开发服务器 |
| `bun build` | 构建生产版本 |
| `bun start` | 启动生产服务器 |
| `bun lint` | 运行 ESLint |
| `bun typecheck` | 运行 TypeScript 类型检查 |
| `bun test` | 运行 Bun 测试套件 |

## 功能详解

### 资金费率监控

Hyperliquid 市场包含两类资产；其余交易所展示各自支持的永续合约：
1. **标准永续合约**：BTC、ETH、SOL 等传统加密货币永续合约
2. **HIP-3 资产**：Hyperliquid Improvement Proposal 3 支持的扩展资产，包括：
   - **XYZ-Hip3**：商品（GOLD、SILVER）、股票（AAPL、TSLA、NVDA）、ETF（DRAM、XLE）、指数（SP500、JP225）、FX（JPY、EUR）等 82 个资产
   - **Vntl-Hip3**：加密主题指数（SPACEX、OPENAI、ANTHROPIC、MAG7、SEMIS 等）
   - **Para-Hip3**：市场主导指数（BTC.D、TOTAL2、OTHERS）
   - **Km-Hip3**（Kinetiq Markets）：股票（AAPL、TSLA、TENCENT）、商品（GOLD、SILVER）、指数（US500、USTECH）、债券（USBOND）等 24 个资产

### API 名称映射

部分资产的 API 内部名称与 Spec 显示名称不同，已自动映射：
- `xyz:CL` → `xyz:WTIOIL`
- `xyz:SKHX` → `xyz:SKHYNIX`
- `xyz:SMSN` → `xyz:SAMSUNG`
- `para:BTCD` → `para:BTC.D`

### 跨交易所搜索

支持以下交易所的实时数据对比：
- Hyperliquid
- Gate.io
- Binance
- OKX
- Lighter
- Bitget

搜索首次加载六家交易所的基础市场列表；只有在输入搜索条件并产生结果后才渐进获取详情字段，K 线、历史资金费率及组合图表则在点击结果后按需加载。

支持组合图表语法：
- `ETH-BTC`：价差图（Spread）
- `ETH/BTC`：比率图（Ratio）

### 数据更新频率

- 资金费率列表每 5 分钟自动刷新
- 资金费率页的历史数据和图表在选中资产时按需加载
- 搜索详情在搜索命中后渐进加载，搜索图表在选中结果时按需加载
- 数据来自各交易所公开市场 API，无需交易所 API Key；部分请求通过 Next.js 服务端代理转发

### 排序选项

| 排序字段 | 说明 |
|----------|------|
| 费率 | 当前年化资金费率 |
| 价格 | 当前标记价格 |
| 涨跌 | 24h 价格变化百分比 |
| 成交量 | 24h 交易量 |
| 持仓量 | 未平仓合约价值 |
| 名称 | 按名称字母排序 |

## API 集成

项目使用以下公开市场 API，并按交易所的 CORS、限流和标准化需要选择直连或 Next.js 服务端代理：
- Hyperliquid：`POST /info`（`metaAndAssetCtxs`、`fundingHistory`、`l2Book`）
- Gate.io：前端通过 `/api/gate/futures/usdt/*` 服务端路由访问 USDT 永续合约公开端点
- Binance：前端通过 `/api/binance`、`/api/binance/klines` 和 `/api/binance/ccxt` 服务端路由访问公开市场数据
- OKX：前端通过 `/api/okx` 和 `/api/okx/ccxt` 服务端路由访问公开市场数据
- Lighter：公开 API 采用限速直连，并在失败时回退到 `/api/lighter`；指数价格使用 `/api/lighter/index-prices`
- Bitget：前端统一请求 `/api/bitget`，由白名单服务端代理访问 V3 UTA 公开市场端点

这些公开市场数据无需交易所认证，但并非所有浏览器请求都直接发往交易所；服务端代理用于处理 CORS、参数白名单、超时和上游错误映射。

### Bitget V3 UTA

- 市场范围限定为 `category=USDT-FUTURES` 中状态为 `online`、类型为 `perpetual` 的 USDT 永续合约。
- `/api/bitget` 仅允许映射到 `/api/v3/market/instruments`、`tickers`、`current-fund-rate`、`history-fund-rate`、`candles`、`history-candles` 和 `orderbook` 的公开操作，并校验参数后由服务端代理转发。
- `src/lib/adapters/bitget.ts` 将列表、历史资金费率、K 线和订单簿统一为项目的标准数据结构；显示名称与请求所需的原始 `rawSymbol` 分开保存。
- 资金结算周期不是固定值：适配器读取每个合约的实际 1、2、4 或 8 小时间隔，并据此计算周期费率与年化值。
- 所有 Bitget 浏览器请求共享 FIFO 单并发调度器，请求启动至少间隔 250ms（附少量抖动），并对超时、HTTP 429 和 5xx 执行有上限的重试；取消信号会停止排队或进行中的请求。
- 历史 K 线先请求一次近期端点，再按需分页回溯历史端点；周线由 UTC 周一开始的日线聚合生成。Funding 页面详情和 Search 图表均按需获取历史数据。

## 部署

本 Next.js 应用可部署至：
- Vercel（推荐）
- Netlify
- Docker 容器
- 任何 Node.js 托管平台

## 参与贡献

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add some amazing feature'`）
4. 推送至分支（`git push origin feature/amazing-feature`）
5. 发起 Pull Request

## 许可证

本项目基于 MIT 许可证开源，详见 LICENSE 文件。

## 免责声明

本工具仅供参考，不构成投资建议。加密货币交易存在重大风险，可能不适合所有投资者。过往表现不代表未来收益。请在做出任何交易决策前，自行评估财务状况并进行充分研究。

## 致谢

- Hyperliquid 提供公开 API
- 开源的 Next.js 和 Tailwind CSS 社区
- 所有贡献者

## 更新日志

### v2026.07.18
- 新增 Bitget 资金费率页与跨交易所搜索支持，应用现覆盖六家交易所
- 新增 `src/lib/adapters/bitget.ts` 标准适配器及 `/api/bitget` V3 UTA 公开市场服务端代理
- 支持 Bitget 在线 USDT 永续合约、动态 1/2/4/8 小时资金结算周期、历史资金费率、K 线和订单簿价差
- 新增 Bitget 共享单并发调度、请求间隔、超时、有限重试、分页上限和取消处理
- 搜索详情改为命中后渐进加载，图表在选择结果时按需加载；文档刷新周期修正为 5 分钟
- 验证通过：62 项测试、TypeScript 类型检查、ESLint 与生产构建

### v2026.05.31
- 新增 KM Hip3 资产（Kinetiq Markets）：24 个资产，包括股票（AAPL、TSLA、TENCENT）、商品（GOLD、SILVER、USOIL）、指数（US500、USTECH、SMALL2000）、债券（USBOND）、FX（EUR）
- 新增 Km-Hip3 筛选标签页（emerald 主题色）
- 新增 `src/lib/symbol-mapping.ts` 共享 API 名称映射模块
- XYZ Hip3 资产从 45 个扩展至 82 个（与 API 完全同步）
- 资产分类新增 ETF、FX、债券类别
- 修复 Km-Hip3 标签页显示全部资产的 bug
- 修复搜索页面历史资金费率对重命名资产无法显示的问题
- README 更新为中文版

### v2026.05.04
- 新增 Para-Hip3 资产类别（独立筛选标签页）
- 新增 Para-Hip3 资产：para:BTC.D、para:TOTAL2、para:OTHERS
- 修复 API 名称映射：内部名称 `para:BTCD` 映射为显示名称 `para:BTC.D`

### v2026.04.24
- 搜索图表新增 1 分钟（1m）周期支持
- 新增组合图表功能（Spread/Ratio 模式）
- 支持多交易所对比（Hyperliquid、Gate.io、Binance、OKX、Lighter）

### v2026.04.23
- 默认时间范围调整为 "1年"
- 修复 Hyperliquid/Gate.io/Lighter 历史资金费率分页问题

### v2026.04.22
- 搜索图表新增第三个子图：历史平均结算资金费率
- 新增时间范围筛选按钮
- 修复 OKX 数据问题
