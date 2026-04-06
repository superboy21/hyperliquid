# Cross-Exchange Search Page

## TL;DR

> **Quick Summary**: 新建一个搜索页面，用户输入关键字后，从 4 个交易所（Hyperliquid、Gate.io、Binance、Lighter）筛选包含该关键字的所有交易对，以表格形式对比展示 9 个字段。
>
> **Deliverables**: 
> - `src/app/search/page.tsx` — 搜索页面
> - `src/components/search/CrossExchangeSearch.tsx` — 核心搜索组件
> - `src/lib/search.ts` — 跨交易所搜索工具函数
>
> **Estimated Effort**: Medium-High
> **Parallel Execution**: YES - 3 independent work units

---

## Context

### Original Request
用户要求新建搜索页面：
1. 输入关键字后，列出 4 个交易所所有包含该关键字的交易对
2. 表格对比 9 个字段：价格、24h涨跌、预测费率、24h成交额、持仓价值、历史波动率(30周期日线)、当前买卖价差、平均资金费率(7天)、平均资金费率(30天)
3. 表格注明交易所名称
4. 9 个字段必须与各交易所页面完全一致

### Current State
- 已有 4 个独立的交易所监控页面，各有自己的 `fetchRates()` 和 `fetchDetailData()`
- `ExchangeFundingMonitor.tsx` (776 行) 是所有交易所共享的 UI 组件
- 字段 1-5 来自 `fetchRates()` 立即可用
- 字段 6-9 需要 `fetchDetailData()` 获取 candles + funding history，目前只对单个选中币种计算
- 各交易所的 API 路由：`/api/hyperliquid`, `/api/gate/futures/usdt/tickers`, `/api/binance`, `/api/lighter`

### Architecture Decision: Progressive Loading for Fields 6-9

**问题**: 字段 6-9 需要为每个 symbol 单独调用 candles + funding history API。如果搜索结果有 100 个 symbol × 4 交易所 = 400 个 symbol，每个需要 2 个 API 调用 = 800 个请求。

**方案**: 渐进式加载
1. 搜索后立即获取所有交易所的 rates（字段 1-5）→ 表格立即可见
2. 字段 6-9 按行渐进式加载，使用并发控制（最多 4 个并行请求）
3. 每行显示 loading 状态，加载完成后显示数值
4. 使用 `AbortController` 支持搜索词变化时取消进行中的请求

---

## Work Objectives

### Core Objective
创建跨交易所搜索页面，确保 9 个字段的计算逻辑与各交易所页面完全一致。

### Concrete Deliverables
1. `src/app/search/page.tsx` — 路由页面，包含搜索输入
2. `src/components/search/CrossExchangeSearch.tsx` — 核心组件：搜索逻辑、表格渲染、渐进式加载
3. `src/lib/search.ts` — 工具函数：跨交易所搜索、字段 6-9 批量计算

### Definition of Done
- [ ] 搜索框输入关键字后，4 个交易所的匹配交易对显示在表格中
- [ ] 9 个字段全部正确显示，数值与各交易所页面一致
- [ ] 字段 6-9 渐进式加载，有 loading 状态
- [ ] 搜索词变化时取消进行中的请求
- [ ] TypeScript 编译通过
- [ ] 表格支持排序（至少支持按费率、价格排序）

### Must Have
- 字段 1-5 立即显示（来自 rates 数据）
- 字段 6-9 渐进式加载
- 交易所列显示交易所名称和颜色标识
- 搜索词变化时取消进行中的请求

### Must NOT Have (Guardrails)
- 不修改现有交易所监控页面的任何代码
- 不引入新的外部依赖
- 不使用 `as any`
- 不在搜索页中复用 `ExchangeFundingMonitor.tsx`（它太重了，包含图表、筛选等不需要的功能）

---

## Execution Strategy

```
Wave 1 (Parallel):
├── Task 1: Create search utility functions [quick]
├── Task 2: Create CrossExchangeSearch component [deep]
└── Task 3: Create search page route [quick]
```

---

## TODOs

### Task 1: Create Search Utility Functions

**What to do**:
- 创建 `src/lib/search.ts`
- 定义 `SearchResultRow` 接口，包含所有 9 个字段 + exchange 标识
- 实现 `fetchAllExchangeRates()` — 并行调用 4 个交易所的 fetchRates，合并结果
- 实现 `filterByKeyword(rates, keyword)` — 按关键字过滤
- 实现 `computeField6_Volatility(candles)` — 复用 `ExchangeFundingMonitor.tsx:328-347` 的逻辑，计算 30 周期日线的年化波动率
- 实现 `computeField7_Spread(bestBid, bestAsk)` — 复用 `ExchangeFundingMonitor.tsx:350-361` 的逻辑
- 实现 `computeField8_9_AvgFundingRates(hourlyHistory)` — 复用 `ExchangeFundingMonitor.tsx:317-323` 的逻辑
- 实现 `fetchDetailForSymbol(exchange, symbol, rates)` — 调用对应交易所的 fetchDetailData
- 实现 `batchFetchDetails(exchange, symbols, rates, concurrency)` — 带并发控制的批量 detail 获取

**Must NOT do**:
- 不修改任何现有文件
- 不改变现有 API 路由

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: `[]`

**References**:
- `src/components/funding/ExchangeFundingMonitor.tsx:328-347` — 波动率计算逻辑
- `src/components/funding/ExchangeFundingMonitor.tsx:350-361` — 买卖价差计算
- `src/components/funding/ExchangeFundingMonitor.tsx:317-323` — 平均费率计算
- `src/lib/types.ts` — 统一类型定义
- `src/components/funding/FundingMonitor.tsx:55-70` — Hyperliquid fetchDetailData
- `src/components/funding/GateFundingMonitor.tsx:46-62` — Gate.io fetchDetailData
- `src/components/funding/BinanceFundingMonitor.tsx:290-370` — Binance fetchDetailData
- `src/components/funding/LighterFundingMonitor.tsx:230-360` — Lighter fetchDetailData

**Acceptance Criteria**:
- [ ] npx tsc --noEmit → 0 errors
- [ ] 所有函数有完整类型注解
- [ ] 无 `as any`

---

### Task 2: Create CrossExchangeSearch Component

**What to do**:
- 创建 `src/components/search/CrossExchangeSearch.tsx`
- 组件结构：
  1. 搜索输入框（带 debounce 300ms）
  2. 结果表格，包含 10 列（交易所 + 9 个字段）
  3. 交易所列：显示交易所名称 + 颜色圆点
  4. 字段 1-5：直接从 rates 数据渲染
  5. 字段 6-9：初始显示 "—" 或 loading spinner，渐进式加载
- 状态管理：
  - `searchTerm: string` — 搜索关键词
  - `allRates: ExchangeFundingRate[]` — 4 个交易所的 rates
  - `filteredRates: ExchangeFundingRate[]` — 过滤后的结果
  - `detailCache: Map<string, DetailData>` — 缓存已加载的 detail 数据（key: "exchange:symbol"）
  - `loadingDetails: Set<string>` — 正在加载的 detail（key: "exchange:symbol"）
  - `abortController: AbortController | null` — 用于取消请求
- 效果：
  - 组件挂载时并行获取 4 个交易所的 rates
  - 搜索词变化时过滤数据，取消进行中的 detail 请求
  - 对过滤后的结果，逐个触发 detail 获取（带并发限制，最多 4 个并行）
- 表格样式：
  - 深色主题（与现有页面一致）
  - 交易所列：彩色圆点 + 名称（blue=Hyperliquid, cyan=Gate.io, yellow=Binance, purple=Lighter）
  - 数字列：右对齐，使用现有的 formatPrice, formatVolume, formatAnnualizedRate
  - 百分比列：带 +/- 号，正绿负红
  - 加载中的单元格：显示小 spinner
  - 表格头部可点击排序（至少支持按费率、价格排序）

**Must NOT do**:
- 不修改任何现有文件
- 不引入新的 UI 库
- 不使用 `ExchangeFundingMonitor.tsx`（太重）
- 不改变现有 API 路由

**Recommended Agent Profile**:
- **Category**: `deep`
- **Skills**: `[]`

**References**:
- `src/components/funding/ExchangeFundingMonitor.tsx` — 表格样式参考
- `src/lib/types.ts` — 类型定义
- `src/app/funding/page.tsx` — 页面布局参考

**Acceptance Criteria**:
- [ ] npx tsc --noEmit → 0 errors
- [ ] 搜索框输入后立即可见字段 1-5
- [ ] 字段 6-9 渐进式加载，有 loading 状态
- [ ] 搜索词变化时取消进行中的请求
- [ ] 表格支持排序

---

### Task 3: Create Search Page Route

**What to do**:
- 创建 `src/app/search/page.tsx`
- 页面结构：
  1. 顶部标题栏（与 `/funding` 页面风格一致）
  2. 搜索输入框（集成在页面中，也可放在组件内）
  3. `CrossExchangeSearch` 组件
- 保持与现有页面一致的布局和样式

**Must NOT do**:
- 不修改任何现有文件

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: `[]`

**References**:
- `src/app/funding/page.tsx` — 页面布局模板

**Acceptance Criteria**:
- [ ] npx tsc --noEmit → 0 errors
- [ ] 页面可正常渲染

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  验证 9 个字段的计算逻辑与各交易所页面完全一致，TypeScript 编译通过，无 `as any`。

- [ ] F2. **Functional Verification** — `unspecified-high`
  手动验证：搜索 "BTC" 确认 4 个交易所的 BTC 交易对都出现，字段数值与各自页面一致。

---

## Commit Strategy

- **1**: `feat(search): add cross-exchange search utility functions` — src/lib/search.ts
- **2**: `feat(search): add CrossExchangeSearch component with progressive loading` — src/components/search/CrossExchangeSearch.tsx
- **3**: `feat(search): add search page route` — src/app/search/page.tsx
- **4**: `chore: run tsc --noEmit verification` — verification only

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit  # Expected: 0 errors
```

### Final Checklist
- [ ] 9 个字段计算逻辑与各交易所页面一致
- [ ] 字段 1-5 立即显示
- [ ] 字段 6-9 渐进式加载
- [ ] 搜索词变化时取消请求
- [ ] TypeScript 编译通过
- [ ] 无 `as any`
- [ ] 表格支持排序
- [ ] 交易所标识清晰
