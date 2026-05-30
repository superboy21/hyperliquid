# HyperTools - Hyperliquid 交易工具包

一个面向 Hyperliquid 交易者的专业工具包，提供实时资金费率监控、持仓分析和套利机会发现。

## 功能特性

- **实时资金费率监控**：追踪 Hyperliquid 所有永续合约及 HIP-3 资产的资金费率
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
- **数据获取**：原生 Fetch API + Hyperliquid SDK
- **包管理器**：Bun

## 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── funding/            # 资金费率监控页面
│   ├── search/             # 跨交易所搜索页面
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
通用交易所资金费率监控组件，支持 Gate.io、Binance、OKX、Lighter 四个交易所。

### CrossExchangeSearch.tsx
跨交易所搜索与对比工具，支持：
- 多交易所价格/费率对比
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

## 功能详解

### 资金费率监控

应用监控两类资产：
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

支持组合图表语法：
- `ETH-BTC`：价差图（Spread）
- `ETH/BTC`：比率图（Ratio）

### 数据更新频率

- 资金费率每 30 秒自动刷新
- 历史数据在选中资产时按需加载
- 所有数据均来自各交易所公开 API，无需认证

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

项目使用以下公开 API 端点：
- Hyperliquid：`POST /info`（`metaAndAssetCtxs`、`fundingHistory`、`l2Book`）
- Gate.io：`GET /api/v4/spot/funding_rate`、`GET /api/v4/futures/usdt/funding_rate`
- Binance：`GET /fapi/v1/fundingRate`
- OKX：`GET /api/v5/public/funding-rate-history`
- Lighter：`GET /v1/lighter/funding-rate-history`

所有 API 调用均直接发往各交易所端点，无需认证。

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
