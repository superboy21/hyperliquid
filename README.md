# HyperTools - 跨交易所市场工具包

一个面向加密市场交易者的跨交易所工具包，提供 Hyperliquid、Gate.io、Binance、OKX、Lighter、Bitget 和 Bybit 七家交易所的永续合约资金费率监控、永续搜索与 Spot/Perp 组合分析。

## 功能特性

- **七交易所资金费率监控**：追踪 Hyperliquid、Gate.io、Binance、OKX、Lighter、Bitget 和 Bybit 的永续合约资金费率
- **Spot/Perp 组合分析**：统一搜索七家交易所的现货与永续市场，按选择顺序分析 Perp/Perp、Spot/Spot 或混合价差与比率；现货侧涵盖价格、成交额、波动率与盘口价差
- **Impact 策略推荐**：基于 Impact 执行价自动枚举跨市场买低卖高组合，展示数量可配置，支持套利空间、手续费、Spot 只能买与收敛天数即时筛选，并给出扣费后收益、美元收益、年化收益率，以及组合资金费率（可选 2 天/最新结算/预测/7 天/30 天均值）与成本（Impact 价差、最优买卖价差）列
- **RPI 盘口模式**：Binance、Gate.io、Bitget、Bybit、OKX 支持读取含 RPI（Retail Price Improvement）订单的盘口计算 Impact，端点失败时回退普通盘口并提示
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
│   ├── search/             # 跨交易所搜索与 Spot/Perp 组合分析页面
│   ├── api/spot/[exchange] # 七交易所现货公开市场严格代理
│   ├── api/bitget/         # Bitget V3 UTA 公开市场 API 服务端代理
│   ├── layout.tsx          # 根布局
│   └── page.tsx            # 首页
├── components/             # React 组件
│   ├── funding/            # 资金费率监控组件
│   │   ├── FundingMonitor.tsx          # Hyperliquid 资金费率监控
│   │   ├── ExchangeFundingMonitor.tsx  # 通用交易所监控组件
│   │   └── ...
│   ├── search/             # 永续合约搜索组件
│   │   └── CrossExchangeSearch.tsx
│   └── spot-perp-arbitrage/ # 统一市场表、组合图表、混合分析面板与共享现货图表
│       └── SpotSearchCandlesChart.tsx
├── lib/                    # 工具函数与服务
│   ├── hyperliquid.ts      # Hyperliquid API 封装
│   ├── gateio.ts           # Gate.io API 封装
│   ├── lighter.ts          # Lighter API 封装
│   ├── search.ts           # 跨交易所搜索逻辑
│   ├── search-candles.ts   # 搜索图表数据获取
│   ├── spot-search.ts      # 现货列表、标准化身份与渐进详情
│   ├── spot-search-candles.ts # 现货 K 线获取与标准化
│   ├── spot-impact-price.ts   # 现货盘口冲击价差
│   ├── spot-combo.ts       # 现货 K 线组合纯函数（未接入现货页面）
│   ├── spot-perp-arbitrage/ # Spot/Perp 模型、查询、对齐组合与统计
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
通用交易所资金费率监控组件供七家交易所页面复用；资金费率页可在 Hyperliquid、Gate.io、Binance、OKX、Lighter、Bitget 和 Bybit 之间切换。

### CrossExchangeSearch.tsx
跨交易所搜索与对比工具，支持：
- 多交易所价格/费率对比
- 搜索命中后渐进加载详情，点击结果时按需加载图表
- 组合图表（Spread/Ratio 模式）
- 历史资金费率与成交额子图

### SpotSearchCandlesChart.tsx
现货双面板图表（共享组件，位于 `src/components/spot-perp-arbitrage/`）：上方为 K 线，下方可切换报价币成交额或基础币成交量；现货图表不包含资金费率。该组件由 `/search` 的选中现货市场来源图表复用。独立的 `/spotsearch` 页面及其 `SpotMarketSearch` 控制器已移除；现货列表、K 线、订单簿与 Impact 计算继续由共享数据层（`/api/spot/[exchange]`、`src/lib/spot-*`）提供。

### SpotPerpArbitrageController.tsx
`/search` 是仅用于市场分析的七交易所 Spot+Perp 统一搜索页。现货默认筛选 `USDT`，可切换 `USDC`、`U`、`USD1`、`USD` 或全部；普通查询可选择单市场并复用来源图表。紧凑语法 `A-B`/`A/B` 分别生成价差/比率，点击顺序确定第一、第二腿；其中 `BTC/USDT` 明确按 BTC 与 USDT 两项的比率查询解析，而不是精确现货交易对查询。

页面还提供 Impact 策略推荐（`寻找策略`）：基于 Impact 买入/卖出执行价枚举所有启用市场的跨市场组合，默认展示套利空间区间内的前五名；策略模式下结果表支持逐市场勾选参与并即时重排，点击推荐行会在结果表上方打开 A 买入/B 卖出的组合图，默认为 `A / B Ratio`，可通过标题旁按钮切换为 `A − B Spread`，再次点击同一推荐即关闭图表。

双腿分析按精确时间戳交集和较短可用历史对齐：Perp/Perp 保留原搜索组合图行为，Spot/Spot 与混合组合展示各腿成交额来源，混合组合还展示有观测值的带符号资金费率。混合分析面板始终消费当前可见时间范围，可按每侧 `0%`、`1%`、`2.5%`、`5%` 或 `10%` 对派生收盘值去尾，并显示均值、总体标准差区间、保留/移除数量及 Spot/Perp 成交额均值；页面不执行自动交易或套利下单。

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

搜索首次加载七家交易所的基础市场列表；只有在输入搜索条件并产生结果后才渐进获取详情字段，K 线、历史资金费率及组合图表则在点击结果后按需加载。

支持组合图表语法：
- `ETH-BTC`：价差图（Spread）
- `ETH/BTC`：比率图（Ratio）

### Spot/Perp 组合分析

`/search` 将七家交易所的 Spot 与 Perp 市场合并到同一查询和结果表中。页面支持来源单市场图表，以及按选择顺序生成的 Perp/Perp、Spot/Spot 和混合组合图；组合窗口以精确对齐后的较短历史为准，混合统计与图表共享同一可见范围。现货列表、K 线、订单簿与 Impact 深度继续由共享数据层提供（`/api/spot/[exchange]`、`src/lib/spot-*`、`src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx`）。本功能用于观察与统计，不包含自动套利执行。

### Impact 策略推荐

在 `/search` 点击 `寻找策略` 可打开策略推荐面板：

- **组合枚举**：基于 Impact 买入执行价（ask VWAP）与卖出执行价（bid VWAP），比较所有启用市场的跨市场方向，跳过自身配对与无效深度；开启「Spot 只能买」时现货只能作为买入腿
- **默认参数**：Impact value `$3000`、套利空间 `0.2%–1.5%`、总手续费率 `0.1%`、收敛 `3 天`（支持 3/7/14/30/90/180 天预设及自定义）
- **推荐数量**：展示条数可配置，不再固定前五名
- **即时筛选**：套利空间、手续费、Spot 只能买、收敛天数与市场勾选均基于当前 Impact 结果即时重算，只有修改 Impact value 需要手动刷新
- **收益列**：套利空间、扣费后收益、美元收益（Impact value × 扣费后收益率）以及按收敛天数年化的收益率
- **组合资金费率与成本列**：组合资金费率支持按 2 天均值（默认）、最新结算、预测、7 天或 30 天均值计算并按各自结算周期年化；成本列展示双腿 Impact 价差与最优买卖价差
- **策略图表**：点击推荐行打开 A 买入/B 卖出组合图，默认 `A / B Ratio`，可切换为 `A − B Spread`；再次点击同一行关闭图表

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
- Bitget：前端统一请求 `/api/bitget`，由白名单服务端代理访问 V3 UTA 公开市场端点；现货严格代理另允许 Bitget Reality 周末公共 V3 SPOT orderbook action

这些公开市场数据无需交易所认证，但并非所有浏览器请求都直接发往交易所；服务端代理用于处理 CORS、参数白名单、超时和上游错误映射。

### 现货严格代理

`/api/spot/[exchange]` 是 Hyperliquid、Gate.io、Binance、Lighter、OKX、Bitget 和 Bybit 七家交易所的严格现货门面，允许 `list`、`candles`、`book` 三类操作，以及仅 Bitget 可用的 `instrument` 元数据操作（用于核验 Reality instruments）和 `realityBook` 公共 V3 SPOT 订单簿操作；所有参数仍严格白名单校验，并校验交易所、交易对/市场 ID、周期、时间范围和请求上限后映射到固定上游主机。订单簿 REST 最大深度按交易所限制为 Hyperliquid 20、Gate.io 100、Binance 5000、Lighter 250、OKX 5000、Bitget 150；Hyperliquid 现货列表使用 `spotMetaAndAssetCtxs`，PURR 请求使用上游要求的 `PURR/USDC`，其余索引市场使用 `@index`。

### RPI 盘口模式

RPI（Retail Price Improvement）订单是改进散户成交价的特殊挂单，各交易所的普通 order book 均会剔除 RPI 订单。Impact 计算支持切换 `normal` / `rpi` 盘口模式：Binance（USDⓈ-M 合约 `rpiDepth`）、Gate.io、Bitget、Bybit、OKX 走各自专用 RPI 端点读取含 RPI 的盘口，Hyperliquid 与 Lighter 无 RPI 端点、始终使用普通盘口且不触发回退提示；RPI 端点失败时自动回退普通端点并提示用户。端点机制研究详见 `docs/rpi-mechanism-research-binance-bybit-gate.md`。

### Bitget Reality rToken 现货

Bitget Reality Protocol 股票代币（rToken，如 RAAPLUSDT）的订单经券商路由至美股撮合。现货列表通过全量 instruments 的 `isReality` 标记识别 rToken（1 小时缓存）。UTC 周一至周五仍优先使用 ticker BBO（锚定美股盘口），缺少 ticker BBO 时保留既有 orderbook fallback；UTC 周六、周日则 Top 与 Impact 专用 Bitget 公共 V3 `GET /api/v3/market/orderbook?category=SPOT&symbol=...&limit=...`，解析 `data.b` / `data.a`，失败、空或缺少可用两侧时严格不回退 ticker BBO、RPI 或旧 V2 orderbook。该 V3 公共盘口不是经过认证的 Reality canonical depth，不能据此宣称券商路由的真实可成交深度；安全最大请求深度为 150 档。

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

### v2026.08.31
- Spread/Ratio 组合图新增波动率平价与自定义配比：所有 Perp/Perp、Spot/Spot、混合组合图在图表上方提供「波动率平价」「自定义配比」控制，基于当前可见区间（含预设区间与 ECharts 缩放）对两腿原始收盘价按对数收益样本方差与 `sqrt(365d/平均间隔)` 年化分别计算波动率，取反比并归一化为最小权重为 1 的配比，图表按 `(wA×A)/(wB×B)` 与 `wA×A−wB×B` 加权并显示两腿年化波动率与当前 `A:B`，再次点击恢复 `1:1`
- 自定义配比支持分别输入 `A`/`B` 正数权重（默认 `1:1`），校验后「应用」生效，未确认前保持 `1:1` 并提示待应用状态，两种模式互斥且切换数据源时自动重置；加权仅作用于 OHLC 显示，成交额/资金费等元数据不变，缩放时保持视口并在无效窗口时回退 `1:1`
- 验证通过：462 项测试、TypeScript 类型检查、ESLint、Next.js 生产构建

### v2026.08.30
- 搜索页交易所筛选改为包含式多选：选中一个或多个交易所时仅显示其并集，未选中任何交易所则显示全部；再次点击已选项可取消选中，全部取消后恢复全量
- 更新筛选文案与按钮状态：新增「交易所（可多选；未选择表示全部）」标签，选中状态使用高亮勾选与中英文提示，空结果文案同步提示交易所选择
- 验证通过：454 项测试、TypeScript 类型检查、ESLint

### v2026.08.29
- Bitget Reality rToken 周末定价修正：UTC 周六/周日的 Top 与 Impact 改用 Bitget 公共 V3 SPOT orderbook（`GET /api/v3/market/orderbook?category=SPOT`，解析 `data.b`/`data.a`，安全上限 150 档），通过严格的 Bitget 专用 `realityBook` 上游动作实现，保留 direct-first + 代理回退
- 失败、空或缺少可用买卖两侧时严格不回退 ticker BBO、RPI 或旧 V2 订单簿；该公共 V3 盘口不是经认证的 Reality canonical depth
- 工作日保留 ticker BBO 假想盘口（`$10000` 名义深度）及既有 fallback，非 Reality 市场与其他交易所行为不变；周末路径绕过 RPI 重试与回退提示
- 验证通过：454 项测试、TypeScript 类型检查、ESLint、Next.js 生产构建及 RAAPLUSDT V3 实时盘口冒烟

### v2026.08.26
- Impact 策略推荐新增组合资金费率列：支持 2 天均值（默认）、最新结算、预测、7 天与 30 天均值五种费率来源，并按各腿结算周期年化（现货腿按 0 处理）
- 策略推荐表新增成本列：双腿 Impact 价差与最优买卖价差
- 策略推荐展示数量可配置，不再固定前五名；默认最小套利空间下限调整为 `0.2%`
- 新增 RPI 盘口模式：Binance USDⓈ-M 合约、Gate.io、Bitget、Bybit、OKX 支持读取含 RPI 订单的盘口计算 Impact，端点失败自动回退普通盘口并提示；新增 `src/lib/rpi-book.ts` 与机制研究文档
- Bitget Reality rToken 现货识别与定价修正：通过 instruments `isReality` 标记识别 rToken，中间价/价差与 Impact 优先使用 ticker BBO 假想盘口（bid/ask 各 `$10000` 名义深度），orderbook 仅作 fallback
- 新增 `scripts/` 探测脚本（rToken 价差与 Reality instruments 核验）
- 验证通过：Bun 测试套件、TypeScript 类型检查

### v2026.08.22
- 新增 Impact 策略推荐（`寻找策略`）：基于 Impact 买入/卖出执行价枚举所有启用市场的跨市场组合，默认展示套利空间区间内的前五名
- 策略设置支持套利空间、总手续费率、Spot 只能买与收敛天数即时重算；Impact value 默认 `$3000`，修改后需手动刷新生效
- 推荐表新增扣费后收益、美元收益（Impact value × 扣费后收益率）与按收敛天数年化的收益率列
- 策略模式下结果表新增逐市场参与勾选与全选/全不选，取消勾选即时重排推荐且不重新请求盘口
- 点击推荐行在结果表上方打开 A 买入/B 卖出组合图，默认 `A / B Ratio`，可一键切换为 `A − B Spread`；再次点击同一行关闭图表
- 所有单市场/价差/比率图表及统计面板移至搜索区之后、结果表之前
- Impact 模式结果行显示买入/卖出冲击执行价，并支持最优买价/最优卖价临时排序
- 修复手动刷新后 Binance 持仓价值占位不再重新水合的问题
- 验证通过：413 项测试、TypeScript 类型检查、ESLint 与 diff 检查

### v2026.08.02
- 新增 `/spot_perp_arbitrage` 六交易所 Spot+Perp 统一搜索与分析页，支持来源单市场图表及 Perp/Perp、Spot/Spot、混合价差/比率组合
- 现货默认使用 USDT 报价筛选，并支持 USDC、U、USD1、USD、全部；紧凑 `-`/`/` 查询按点击顺序确定双腿，`BTC/USDT` 明确解析为比率查询
- 双腿数据按精确时间戳和较短历史对齐；混合面板基于可见范围提供逐侧去尾、均值、总体标准差、资金费率与分腿成交额统计
- 最终 Oracle 审查通过；已知父级证据为 30 项聚焦测试和此前生产构建通过

### v2026.08.01
- 新增 `/spotsearch` 六交易所现货搜索，统一交易对身份并展示中间价、24 小时涨跌/成交额、历史波动率及 Top/Impact 盘口价差
- 新增严格 `/api/spot/[exchange]` 门面、按交易所限制的 REST 深度，以及 Hyperliquid PURR 特殊传输标识
- 详情与 Impact 请求仅在搜索命中后渐进加载；点击单个市场时按需加载 K 线与报价币成交额/基础币成交量双面板图表
- Spot、通用 Perp 与 Bitget Perp 统一使用同一套排序 VWAP Impact 算法，计算前强制按最优价格排序且不修改原始盘口
- Gate Perp Impact 不再在缺少 `quanto_multiplier` 时回退为 1；无法取得有效乘数时明确显示“缺少合约乘数”并停止计算
- Spot 与 Perp Impact 默认使用 Hyperliquid 20 档、其他交易所 100 档；Spot Search、Perp Search 和 Funding 均可切换到各市场的最大 REST 深度
- 验证通过：121 项测试、TypeScript 类型检查、ESLint、生产构建，以及六交易所列表/K 线/订单簿/深度实时冒烟测试

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
