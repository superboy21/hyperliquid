# 七家交易所 Perp「溢价指数 / 冲击价」API 能力调研

> 调研日期：2026-08-15
> 调研问题：① 各所 API 能否直接拿到每个 perp 合约的「冲击买价/冲击卖价」或对应的「冲击名义金额（impact notional）」？② 能否直接拿到「溢价指数（premium index）」的实际值？

## 结论速览

| 交易所 | 直接返回溢价指数值？ | 直接返回冲击买/卖价？ | 冲击名义金额可查？ |
|---|---|---|---|
| Binance | ❌ | ❌ | 间接（IMN ≈ 200 × maxLeverage，maxLeverage 可查） |
| OKX | ✅ `premium` 字段 | ❌ | 间接（impact value = 200 × maxLeverage） |
| Bybit | ❌（仅历史 K 线） | ❌ | 间接（IMN 固定，未直接暴露） |
| Gate.io | ⚠️ 仅 K 线（可取最新值） | ❌ | ✅ `funding_impact_value` 字段 |
| Bitget | ❌ | ❌ | ❌ |
| Hyperliquid | ✅ `premium` 字段 | ❌ | ✅ 固定 4000 USD（文档明确） |
| Lighter | ❌ | ❌ | ❌（需进一步确认） |

**核心结论：**
1. **没有任何一家直接返回「冲击买价/冲击卖价」本身** —— 这个值在所有交易所都需要自己用订单簿深度 + 冲击名义金额计算（即本项目已实现的 VWAP 扫单逻辑）。
2. **只有 OKX 和 Hyperliquid 能直接拿到溢价指数的实际值**（都是 `premium` 字段）。
3. **Gate.io 提供溢价指数的 K 线**（`premium_index` 端点），取最新一根的收盘值即近似当前值；同时**直接返回 `funding_impact_value`（冲击名义金额）**。
4. **冲击名义金额（impact notional）**：Gate 直接给、Hyperliquid 固定 4000 USD；Binance/OKX/Bybit 用行业通用公式 `IMN ≈ 200 × maxLeverage` 推导；Bitget/Lighter 未暴露。

---

## 逐所详情

### 1. Binance（USDT-M Futures）

- **溢价指数值**：`GET /fapi/v1/premiumIndex` 端点名字带 "premiumIndex"，但**返回的是 mark price + 资金费率数据**（`markPrice` / `indexPrice` / `lastFundingRate` / `nextFundingTime` / `interestRate` 等），**不返回 premium index 数值，也不返回冲击价**。
- **冲击买/卖价**：不直接返回。需用 `/fapi/v1/depth` 订单簿 + Impact Margin Notional（IMN）自行扫单计算。
- **冲击名义金额**：不直接返回。官方定义 `IMN = 200 USD / 初始保证金率(maxLeverage)`，即 **`IMN ≈ 200 × maxLeverage`**（例：BTCUSDT 125x → IMN = 25,000 USDT）。maxLeverage 可通过 `/fapi/v1/leverageBracket` 获取。
- **公式**：`Premium Index = [max(0, Impact Bid − Index) − max(0, Index − Impact Ask)] / Index`（本项目当前采用的正是此公式）。
- 参考：https://dev.binance.vision/t/futures-markprice-indexprice-calculation-problem/870

### 2. OKX

- **溢价指数值**：✅ `GET /api/v5/public/funding-rate?instId=...` 返回 `premium` 字段（"Current premium index value"）。
- **冲击买/卖价**：不直接返回。
- **冲击名义金额**：官方术语叫「深度加权金额」= 200 × 该合约最高杠杆倍数，maxLeverage 通过 `/api/v5/public/instruments` 的 `lever` 字段获取。
- **口径**：溢价指数 = `[max(0, 深度加权买价 − 指数) − max(0, 指数 − 深度加权卖价)] / 指数`，其中「深度加权买/卖价」= 深度加权金额 ÷ 满足该金额所需交易币数量（即 VWAP，等价于 impact price）。**与 Binance 公式结构完全一致**（同为 depth-weighted / impact 口径，仅术语不同）。资金费率 = `clamp[(平均溢价指数 + clamp(利率 − 平均溢价指数, ±0.05%)) / (8/N), 上限, 下限]`，利率固定 0.01%。
- 参考：https://www.okx.com/zh-hans/help/perps-funding-fee-mechanism

### 3. Bybit

- **溢价指数值**：❌ 无实时值端点。仅 `GET /v5/market/premium-index-price-kline` 返回溢价指数的**历史 K 线**（可取最新一根近似当前值，但非专用实时端点）。
- **冲击买/卖价**：`/v5/market/tickers` 仅返回 `bid1Price`/`ask1Price`（最优一档），**不返回冲击价**。需自行用 `/v5/market/orderbook` + IMN 计算。
- **冲击名义金额**：官方帮助文档提到 "Premium Index Bottom Volume = Impact Margin Notional"，IMN 为固定值，但**未在公开 API 字段中直接暴露**（需查文档或自设）。
- 参考：https://bybit-exchange.github.io/docs/v5/market/premium-index-kline 、https://www.bybit.com/en/help-center/article/Index-Price-Calculation

### 4. Gate.io

- **溢价指数值**：⚠️ `GET /futures/{settle}/premium_index` 返回溢价指数的 **K 线**（字段 `t/c/h/l/o`），取最新一根 `c`（收盘）即近似当前 premium index。
- **冲击买/卖价**：不直接返回。
- **冲击名义金额**：✅ `GET /futures/{settle}/contracts` 的 Contract 模型新增 **`funding_impact_value`** 字段（"funding rate depth impact value"），即官方冲击名义金额。
- **公式**：`Premium Index = [max(0, Depth-Weighted Bid − Index) − max(0, Index − Depth-Weighted Ask)] / Index`。
- 参考：https://www.gate.com/docs/developers/apiv4/en/futures/ 、https://www.gate.com/help/futures/futures-logic/27569/funding-rate-and-funding-fee

### 5. Bitget

- **溢价指数值**：❌ 未提供 premium index 端点。`/api/v2/mix/market/ticker(s)` 仅返回 `fundingRate` / `markPrice` / `indexPrice` 等。
- **冲击买/卖价**：❌ 不返回。需自行用 `/api/v2/mix/market/merge-depth` + 自设 impact notional 计算。
- **冲击名义金额**：❌ 未找到公开暴露。
- 参考：https://www.bitget.com/zh-CN/api-doc/classic/contract/market/Get-Symbol-Price

### 6. Hyperliquid（DEX）

- **溢价指数值**：✅ `POST /info`（`{"type":"metaAndAssetCtxs"}`）返回每个 asset 的 **`premium`** 字段（`premium = impact_price_difference / oracle_price`，其中 `impact_price_difference = max(impact_bid_px − oracle_px, 0) − max(oracle_px − impact_ask_px, 0)`）。
- **冲击买/卖价**：不直接返回 impact_bid_px / impact_ask_px（只返回算好的 `premium` 和 `markPx` / `oraclePx`）。
- **冲击名义金额**：✅ **固定 4000 USD**（官方文档明确，无需 API 查询）。
- **⚠️ 口径注意**：HIP-3 perp 用不同公式 `premium = 0.5 × (impact_bid + impact_ask)/oracle − 1`；且 funding 每 1 小时结算（premium 每 5 秒采样、每小时平均）。
- 参考：https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding

### 7. Lighter（DEX，zk-rollup）

- **溢价指数值**：❌ `GET /api/v1/funding-rates` 仅返回 `rate`（资金费率），**不含 premium index**。
- **冲击买/卖价**：❌ 不直接返回。mark price 由「Stork 预言机 + CEX mark 中位数 + impact price」构成，但 impact price 未在 `funding-rates` / `orderBookDetails` 中单独暴露，需自行用 `orderBookOrders` 计算。
- **冲击名义金额**：❌ 未找到公开暴露。
- 参考：https://apis.io/apis/lighter/lighter-funding-api

---

## 对本项目的启示

1. **「冲击买价/冲击卖价」在所有交易所都要自算** —— 当前项目已实现的 `fetchSearchImpactSpreadDetail` / `computeOrderBookImpactDetail`（订单簿 VWAP 扫单）是**唯一通用解法**，方向正确。
2. **冲击名义金额可以更"官方"**：
   - Hyperliquid 应固定用 **4000 USD**（当前可能未对齐）；
   - Gate.io 可从 `contracts` 的 `funding_impact_value` 直接读；
   - Binance / OKX / Bybit 可按 `200 × maxLeverage` 推导（比统一默认值更贴近官方口径）。
3. **可"白嫖"官方溢价指数做交叉校验**：OKX（`premium` 字段）、Hyperliquid（`premium` 字段）、Gate（`premium_index` K 线）三家可直接拿到官方值，可与自算结果比对，用于验证自算逻辑是否正确。
4. **口径差异需注意**：OKX 与 Binance 同用「深度加权/冲击价」口径（仅术语不同）；Hyperliquid HIP-3 用不同公式（冲击中间价）、普通 perp 用 impact 口径；Gate 用 depth-weighted 价 —— 各家 premium index 基本可比，仅 Hyperliquid HIP-3 需单独注意口径。
