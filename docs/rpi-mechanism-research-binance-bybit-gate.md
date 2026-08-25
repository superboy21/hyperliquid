# RPI（Retail Price Improvement）机制研究报告：Binance / Bybit / Gate

**研究日期**：2026-08-25
**研究方法**：内置 WebSearch + exa MCP + Firecrawl MCP + Parallel Search MCP 四路检索交叉验证，官方公告/FAQ/API 文档原文核对，并对全部关键端点做了**本机无鉴权实测**（curl 直连）。

---

## 一、结论速览

| 问题 | Binance | Bybit | Gate |
| --- | --- | --- | --- |
| **① spot 有无 RPI？** | ❌ 无（仅 USDⓈ-M 合约有） | ✅ 有（2025-02-20 起） | ✅ 有（2026-01-07 面向做市商开放） |
| **① perp 有无 RPI？** | ✅ 有（2025-11-20 起，USDⓈ-M 合约，258 个币对白名单） | ✅ 有（2025-04-03 起，USDT/USDC 线性 + 反向永续；期权除外） | ✅ 有（`future_rpi_maker_fee` 字段 + 合约 RPI book 端点实测存在） |
| **② API 能否读到含 RPI 的 book？** | ✅ 能：`GET /fapi/v1/rpiDepth`（REST）+ `<symbol>@rpiDepth@500ms`（WS），**官方文档明确记载** | ✅ 能：`GET /v5/market/rpi_orderbook`（REST）+ `orderbook.rpi.{symbol}`（WS），**官方文档明确记载**，且区分 RPI / 非 RPI 数量 | ⚠️ 能（实测）：`GET /api/v4/spot/rpi_order_book`、`GET /api/v4/futures/{settle}/rpi_order_book`，**但官方文档未记载（端点存在但语义无文档）**，仅 REST、无 WS |
| **③ 读 RPI book 需要 API key 吗？** | ❌ 不需要（公开行情端点，本机实测无 key 成功） | ❌ 不需要（公开行情端点，本机实测无 key 成功） | ❌ 不需要（实测无 key 成功） |

> **通用规则**：三家的**普通 order book 接口均剔除 RPI 订单**。要看含 RPI 的 book 必须走各自的专用 RPI 端点。下单 RPI 订单才需要 API key（且 Bybit/Gate 限指定做市商）。

---

## 二、RPI 机制是什么

RPI（Retail Price Improvement，零售价格改进/优化）订单是一种特殊 maker 订单：

- **Post-only**：永远向订单簿提供流动性，绝不作为 taker 成交；
- **定向撮合**：只与"非算法"taker 订单撮合（即网页/App 手动下单的散户），**不与任何 API 提交的订单撮合**；
- **低优先级**：同价位上所有非 RPI 订单成交后才轮到 RPI 订单；
- **隐藏于 API**：普通 API 订单簿/行情流中不可见，只在交易界面 GUI 上显示（无特殊标签）；
- 目的：为散户在盘口价内（spread 内）提供更优成交价，同时把高频/算法流量隔离在外。

三家机制同源（Bybit 2025-02 首创于此轮加密潮，Binance/Gate 跟进），细节差异见下文。

---

## 三、Binance（只有合约有，现货没有）

### 3.1 机制概况

- **上线时间**：2025-11-20，仅 **USDⓈ-M 合约**（FAQ 归类于 Crypto Derivatives → Futures）。
- **现货无 RPI**：实测 `GET https://api.binance.com/api/v3/rpiDepth` 返回 **404**，spot 各官方文档/FAQ 均无 RPI 记载。
- **谁可以下 RPI 单**：**所有用户**（FAQ 明确 "All users can place RPI orders"），通过 REST/WebSocket API 提交 `order_type=LIMIT` + `time_in_force="RPI"`；不支持的币对报错 `-4188 This symbol is not in symbol white list`。
- **费率**：RPI 订单收取**专属 RPI 佣金**，叠加在该币对标准 maker 费之上（可通过 User Commission Rate 接口查询）。
- **覆盖币对**（实测 `fapi/v1/exchangeInfo` 的 `permissionSets` 含 `RPI` 的合约，2026-08-25 快照）：**258 个 USDⓈ-M 合约**，以股票/指数期货为主（TSLAUSDT、NVDAUSDT、AAPLUSDT、SPYUSDT、QQQUSDT、MSTRUSDT、COINUSDT…）+ 长尾山寨币；**BTCUSDT、ETHUSDT 等主流币不在名单内**（BTCUSDT 的 permissionSets 仅 `["GRID","COPY","DCA","PSB"]`）。

### 3.2 API 端点变化（官方 FAQ 明确列出）

**普通端点（剔除 RPI）**：

| 端点 | 变化 |
| --- | --- |
| `GET /fapi/v1/depth` | RPI 订单被剔除 |
| `GET /fapi/v1/ticker/bookTicker` | RPI 订单被剔除 |
| WS `depth` / WS API depth request | RPI 订单被剔除 |
| WS `<symbol>@bookTicker` / `!bookTicker` | RPI 订单被剔除 |

**专用 RPI 端点（含 RPI，公开）**：

| 端点 | 说明 |
| --- | --- |
| `GET /fapi/v1/rpiDepth?symbol=XXX` | **RPI 订单簿快照，RPI 订单聚合进响应**；交叉价位隐藏；limit 仅支持 `[1000]`（默认 1000），权重 20。实测无 key 返回真实数据 |
| WS `<symbol>@rpiDepth@500ms`（fstream.binance.com） | **RPI 增量深度流，含 RPI 订单**，500ms 推送。公开行情流，无需鉴权 |

**成交标记**：`GET /fapi/v1/trades`、`/fapi/v1/historicalTrades` 新增 `isRPITrade` 布尔列；aggTrades 聚合但不打标。

> ⚠️ 细节坑：`rpiDepth` 对**任何** symbol 都返回 200（包括无 RPI 的 BTCUSDT），此时返回的就是普通 book；判断某 symbol 是否真有 RPI 流动性要看 `exchangeInfo.permissionSets` 是否含 `RPI`。

### 3.3 鉴权

`rpiDepth` 属行情类端点，**无需 API key**（本机直连+代理双路实测均成功，无任何鉴权头）。

---

## 四、Bybit（spot + perp 都有，文档最完善）

### 4.1 机制概况

- **上线时间**：现货 **2025-02-20**（两个月测试期，最初要求该现货品类 maker 份额 >10% 的做市商参与）；合约 **2025-04-03**（首批 USDC 永续/交割 + 反向合约，现已覆盖 USDT 线性）。
- **覆盖市场**：现货 + 衍生品（USDT/USDC 线性、反向；**期权除外**），支持逐仓/全仓/组合保证金。
- **谁可以下 RPI 单**：**仅指定做市商合作伙伴**，且**只能通过 OpenAPI** 下单（`timeInForce = "RPIPostOnly"`）；未授权者报错 "RPI orders are restricted to approved Market Makers only"。
- **2026-06-12 重大更新**：`rpiTakerAccess=true`——API taker 也可**主动 opt-in** 撮合 RPI 流动性：仅限市价 IOC/FOK、强制 **50ms speed bump** 延迟、默认 false（向后兼容）。覆盖现货 + 线性/反向永续。

### 4.2 API 端点

**普通端点（剔除 RPI）**：`GET /v5/market/orderbook` 及 WS `orderbook.{depth}.{symbol}` 均明确**剔除 RPI 订单**（2025-02 现货 RPI 上线公告即写明）。

**专用 RPI 端点（含 RPI，公开）**：

| 端点 | 说明 |
| --- | --- |
| `GET /v5/market/rpi_orderbook?category=spot\|linear\|inverse&symbol=XXX&limit=N` | **RPI 订单簿快照**，现货/合约最多 **50 档**（limit [1,50]）。返回三列结构：`[price, 非RPI数量, RPI数量]`——**RPI 与非 RPI 数量分开给出**，当 RPI 与对侧非 RPI 价格交叉时 RPI 数量失效隐藏。实测 spot 和 linear 均返回真实数据（spot BTCUSDT 买一 79222.1 含 RPI 挂量 0.426 等） |
| WS `orderbook.rpi.{symbol}`（stream.bybit.com 公共频道） | **50 档 RPI 订单簿推送，100ms 频率**，snapshot/delta 模式，公开频道无需鉴权 |

**成交标记**：REST 最近成交新增 `isRPITrade`，WS publicTrade 新增 `RPI` 布尔。

### 4.3 鉴权

`/v5/market/rpi_orderbook` 属公开行情端点，**无需 API key**（本机实测成功）。

---

## 五、Gate（spot + perp 都有，端点存在但未写入文档）

### 5.1 机制概况

- **上线时间**：**2026-01-07** 公告"面向所有符合条件的做市商开放 RPI 订单"。撮合规则与 Bybit 同构：仅与非 API taker 撮合、隔离高频、最低撮合优先级。
- **谁可以下 RPI 单**：符合条件的**做市商**（公告让联系客户经理 / Institutional@gate.com）；API 侧通过 **CrossEx 跨所交易 API**（`POST /crossex/orders`，`time_in_force="RPI"`）下单，**按 UID 白名单开通**。2026-07-30 CrossEx 升级公告：RPI 下单当前支持 **Gate 合约+现货、Binance 合约、Bybit 现货**（即 Gate 的跨所账户还能替你在币安/Bybit 下 RPI 单）。
- **费率/支持范围查询**：`GET /crossex/fee` 返回 `spot_rpi_maker_fee` / `future_rpi_maker_fee`（及 `special_fee_list[].rpi_fee_rate`）；`GET /crossex/rule/symbols` 每个币对返回 `support_rpi` 布尔（实测公开可访问，无 key）。这两点写入了官方 API 文档 changelog（v4.106.108，2026-07）。

### 5.2 RPI book 端点（实测存在，官方文档未记载）

| 端点 | 实测结果 |
| --- | --- |
| `GET /api/v4/spot/rpi_order_book?currency_pair=BTC_USDT&limit=N` | ✅ HTTP 200，返回 `[price, qty]` 结构（与普通 book 同构，无 RPI/非 RPI 拆分）。**无需 API key** |
| `GET /api/v4/futures/{settle}/rpi_order_book?contract=BTC_USDT` | ✅ HTTP 200，返回 `{s: size, p: price}` 对象数组。**无需 API key** |
| WebSocket RPI 频道 | ❌ 不存在。官方 WS 文档（6589 行）全文检索 **零** RPI 记载 |

**⚠️ 重要警示**（诚实披露实测异常）：

1. **官方文档未记载**：Gate API v4 官方文档全文（含 changelog）只提到 crossex 的 RPI 下单/费率/`support_rpi` 字段，**没有任何 `rpi_order_book` 端点的定义**——语义（是"普通book+RPI聚合"还是"仅RPI单"）无官方说明。
2. **数据行为可疑**：同步采样对比中，spot `rpi_order_book` 在相隔数秒的多次请求中返回**完全相同的快照**（疑似低频更新/缓存），且其 top-of-book 与普通 `order_book` 不满足"含 RPI 的 book 应至少不劣于普通 book"的嵌套关系（合约侧同样）。在 Gate 给出官方文档前，**不建议把该端点用于生产级定价**。
3. Gate 普通端点是否剔除 RPI：官方公告未明说 book 可见性（只说了撮合规则）。按三所机制惯例及专用端点的存在推断应为剔除，但**无 Gate 官方原文直接证实**，此点置信度低于 Binance/Bybit。

### 5.3 鉴权

`spot/rpi_order_book`、`futures/{settle}/rpi_order_book`、`crossex/rule/symbols` 实测均**无需 API key**；`crossex/fee` 与 crossex 下单等私有接口需 key。

---

## 六、三个问题的直接回答

**Q1：这些交易所的 spot 和 perp 有没有 RPI 机制？**

- **Binance**：perp（USDⓈ-M 合约）✅ 有（2025-11-20 起，258 个币对白名单，以股票/指数期货+山寨为主，BTC/ETH 不在列）；spot ❌ 没有。
- **Bybit**：spot ✅（2025-02-20 起）+ perp ✅（2025-04-03 起，线性+反向）都有；仅做市商可挂 RPI 单。
- **Gate**：spot ✅ + perp ✅ 都有（2026-01-07 面向做市商开放）；仅做市商（UID 白名单）可挂 RPI 单。

**Q2：他们的 API 能否读到包含 RPI 的 book？**

- **能，三家都有专用 RPI book 端点**，但文档化程度差异大：
  - Binance 合约：`/fapi/v1/rpiDepth`（REST，1000 档，RPI 聚合进价位）+ `@rpiDepth@500ms`（WS）——官方文档明确记载；
  - Bybit：`/v5/market/rpi_orderbook`（REST，50 档，**RPI/非 RPI 数量分列**）+ `orderbook.rpi.{symbol}`（WS，100ms）——官方文档明确记载，**信息量最大**；
  - Gate：`/api/v4/spot/rpi_order_book` + `/api/v4/futures/{settle}/rpi_order_book`（REST）——**端点实测存在但官方文档零记载**，无 WS，数据更新行为可疑，慎用。
- 注意：普通 depth/orderbook 端点三家都剔除 RPI；Binance 的 bookTicker、Bybit 的普通 orderbook WS 同样剔除。

**Q3：能读到 RPI book 的 API 需不需要 API key？**

- **三家都不需要**。所有 RPI book 端点均为公开行情接口，本机（2026-08-25）无任何鉴权实测全部成功。需要 key 的是下单类接口（且 Bybit/Gate 的 RPI 挂单权限仅限指定做市商；Binance 所有用户可挂但收专属 RPI 佣金）。

---

## 七、对本项目（Funding Monitor / 套利搜索页）的实际影响

1. **冲击价格/溢价指数口径**：若用 Binance 合约 `/fapi/v1/depth`（或 Bybit `/v5/market/orderbook`）算 impact bid/ask，**RPI 流动性天然不可见**——对 258 个 RPI 白名单合约，API 视角的盘口与 GUI 散户看到的盘口可能存在系统性差异（RPI 单挂在 spread 内）。做现货-永续套利时，Binance 合约侧的"实际可成交价"对散户路径可能优于 API 模拟路径。
2. **如需含 RPI 的口径**：Binance 用 `rpiDepth`（注意 limit 固定 1000、权重 20、交叉价位隐藏）；Bybit 用 `rpi_orderbook`（仅 50 档、100ms WS）；Gate 暂不建议依赖。
3. **币对选择**：Binance RPI 集中在 xStock/指数期货和山寨合约——若套利标的恰在这些币对上，影响不可忽略；BTC/ETH 主流对当前无 RPI，可忽略。
4. **成交数据**：Binance `isRPITrade`、Bybit `isRPITrade`/`RPI` 字段可用于识别 RPI 成交，做成交量/滑点分析时注意区分。

---

## 八、参考来源

**Binance**
- 官方 FAQ《What Is an RPI Order?》（含端点变更表）：https://www.binance.com/en/support/faq/detail/92c83c53173947c4a44f9a7277c3b9ce
- 官方公告（2025-11-18，RPI 上线）：https://www.binance.com/en/support/announcement/detail/d0ed1c8add7848c8b3e5a87bbabf6300
- API 文档 RPI Order Book（`/fapi/v1/rpiDepth`）：https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book-RPI
- API 文档 WS RPI Diff. Book Depth Streams（`@rpiDepth@500ms`）：https://developers.binance.info/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams
- API 文档 Order Book / bookTicker（RPI excluded 声明）：https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book

**Bybit**
- 帮助中心《Retail Price Improvement (RPI) Order》：https://www.bybit.com/en/help-center/article/Retail-Price-Improvement-RPI-Order
- 合约 RPI 上线公告（2025-04-02）：https://announcements.bybit.com/en/article/introducing-retail-price-improvement-rpi-orders-for-futures-trading-bltcfbde734c04aac85
- API 文档 Get RPI Orderbook：https://bybit-exchange.github.io/docs/v5/market/rpi-orderbook
- API 文档 WS RPI Orderbook：https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook-rpi
- API taker opt-in 公告（2026-06-12，`rpiTakerAccess`）：https://announcements.bybit-global.com/en/article/rpi-liquidity-now-available-to-api-taker-orders-bltb943887bfa4c4d17

**Gate**
- 官方公告《Gate 计划面向做市商全面开放 RPI 订单》（2026-01-07）：https://www.gate.com/announcements/article/49079
- 官方公告《CrossEx 升级：…开放 RPI 订单》（2026-07-30）：https://www.gate.com/announcements/apiupdates
- Gate API v4 官方文档（changelog 中 crossex RPI 相关记载，无 rpi_order_book 文档）：https://www.gate.com/docs/developers/apiv4/en/

**实测**（2026-08-25，本机，无鉴权）
- `curl https://fapi.binance.com/fapi/v1/rpiDepth?symbol=BTCUSDT` → 200 真实数据（直连+代理双路）
- `curl https://api.binance.com/api/v3/rpiDepth` → 404（现货无此端点）
- `curl https://api.bybit.com/v5/market/rpi_orderbook?category=spot&symbol=BTCUSDT&limit=3` → 200，含 RPI 数量列
- `curl https://api.bybit.com/v5/market/rpi_orderbook?category=linear&symbol=BTCUSDT&limit=3` → 200
- `curl https://api.gateio.ws/api/v4/spot/rpi_order_book?currency_pair=BTC_USDT` → 200
- `curl https://api.gateio.ws/api/v4/futures/usdt/rpi_order_book?contract=BTC_USDT` → 200
- `curl https://api.gateio.ws/api/v4/crossex/rule/symbols` → 200（含 `support_rpi` 字段）
- Binance `fapi/v1/exchangeInfo` 解析：258 个合约 `permissionSets` 含 `RPI`

> 附注（超纲但相关）：Bitget（2026-03）与 Phemex（2025-10）也已上线 RPI，且 Bitget 有公开的 `GET /api/v3/market/rpi-orderbook`（RPI/非 RPI 数量分列）+ WS `rpi-books` 频道。本次研究范围仅限 Binance/Bybit/Gate。
