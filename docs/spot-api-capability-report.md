# 六交易所现货（Spot）API 能力研究报告

> 调研日期：2026-08-01（同日补充：实时订单簿深度调研）
> 范围：项目已集成的六个交易所 —— Binance、OKX、Gate.io、Bitget、Hyperliquid、Lighter
> 说明：项目当前代码接入的是这六家的**合约/永续**接口（fapi / SWAP / futures / USDT-FUTURES / perp），本报告评估的是各家**现货公开行情 API** 的能力（均无需 API Key）。

---

## 一、Binance（币安现货）

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | ✅ 支持 | `GET /api/v3/ticker/price` | 单交易对或全市场；`price` 字段 |
| 买一/卖一价 | ✅ 支持 | `GET /api/v3/ticker/bookTicker` | `bidPrice/bidQty/askPrice/askQty`；`ticker/24hr` FULL 响应里也附带 bid/ask |
| 24h 成交额 | ✅ 支持 | `GET /api/v3/ticker/24hr` | `quoteVolume`（计价币成交额）、`volume`（基础币成交量） |
| 24h 涨跌幅 | ✅ 支持 | `GET /api/v3/ticker/24hr` | `priceChangePercent`（滚动 24h）；不传 symbol 时权重高（全市场 weight≈40），需注意限频 |
| 订单簿深度（多档） | ✅ 支持 | `GET /api/v3/depth` | 默认 100、**最多 5000 档/侧**（超出截断）；权重随档数大涨：1–100→5、101–500→25、501–1000→50、1001–5000→250；WS `@depth` 增量流可维护本地全量盘口 |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | ✅ 支持 | `GET /api/v3/klines` | 15 种粒度：`1s,1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M`；单次默认 500、**上限 1000 条**；用 `startTime/endTime` 翻页可回溯**自上市起的全部历史**（BTCUSDT 可到 2017 年） |
| 历史 bid/ask | 🟡 部分支持 | REST 无此接口；官方公共数据下载 `data.binance.vision` | 数据 dump 提供历史 `bookTicker`/`depth` 快照文件（按日/月打包），适合离线回填；**在线 REST/WebSocket 只有实时值** |

---

## 二、OKX（现货）

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | ✅ 支持 | `GET /api/v5/market/ticker?instType=SPOT`（单）/ `market/tickers`（全） | `last` 字段 |
| 买一/卖一价 | ✅ 支持 | 同上 | `bidPx/bidSz/askPx/askSz` 直接内嵌在 ticker 里，一次请求全拿到 |
| 24h 成交额 | ✅ 支持 | 同上 | `volCcy24h`（计价币量）× `last` 折算美元；`vol24h` 为基础币量 |
| 24h 涨跌幅 | 🟡 部分支持 | 同上 | **无直接字段**，需用 `open24h` 与 `last` 自算：`(last-open24h)/open24h`（项目现有合约适配器即如此处理）；另有 `sodUtc0/sodUtc8` 开盘价 |
| 订单簿深度（多档） | ✅ 支持 | `GET /api/v5/market/books`（≤400 档/侧）；`GET /api/v5/market/books-full`（≤5000 档/侧） | `sz` 参数默认 1，需显式指定；books-full 限频更严；WS `books`（400 档）/`books-l2-tbt`（400 档逐笔） |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | ✅ 支持 | `GET /api/v5/market/candles` + `GET /api/v5/market/history-candles` | 粒度：`1m,3m,5m,15m,30m,1H,2H,4H,6H,12H,1D,1W,1M,3M,6M,1Y`（含 utc 变体）。`candles` 仅最近 1440 根；`history-candles` 单次上限 **300 条**，用 `after` 翻页可取**近年数据**（1s 粒度仅近 3 个月）；更早需走官方历史数据服务（`market/history-candles` 之外的 Historical Market Data，含 1 分钟 K 线，自 2021-01-01，单次最多拉 20 天/20 个月） |
| 历史 bid/ask | ❌ 不支持 | 仅有实时 `market/books`（深度快照，sz≤400）/ WS | 公开 API 不提供历史盘口快照；历史逐笔成交有（`history-trades`，近 3 个月） |

---

## 三、Gate.io（现货）

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | ✅ 支持 | `GET /api/v4/spot/tickers` | `last`；单交易对或全市场一次返回 |
| 买一/卖一价 | ✅ 支持 | `GET /api/v4/spot/tickers` | `highest_bid/lowest_ask` 直接内嵌 |
| 24h 成交额 | ✅ 支持 | `GET /api/v4/spot/tickers` | `quote_volume`（计价币）、`base_volume`（基础币） |
| 24h 涨跌幅 | ✅ 支持 | `GET /api/v4/spot/tickers` | `change_percentage`（滚动 24h）；另有 `change_utc0/change_utc8`（自然日口径） |
| 订单簿深度（多档） | ✅ 支持 | `GET /api/v4/spot/order_book` | 最多 **100 档/侧**（limit 默认 10，2020-12 起上限提至 100）；`interval` 价格合并参数（0=不合并）；`order_book_id` 版本号便于增量同步；WS `spot.obu` 可达 400 档、`spot.order_book_update` 增量维护 |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | ✅ 支持 | `GET /api/v4/spot/candlesticks` | 粒度：`1s,10s,30s,1m,5m,15m,30m,1h,4h,8h,1d,7d,30d`（`30d` 指自然月；1s/30s 为后期新增）；单次**最多 1000 点**；`limit` 与 `from/to` 互斥（指定时间区间时不能带 limit）；用 `from/to`（秒级时间戳）逐段翻页可回溯长期历史 |
| 历史 bid/ask | ❌ 不支持 | 仅有实时 `GET /spot/order_book` | 无历史盘口快照接口 |

---

## 四、Bitget（现货，API v2）

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | ✅ 支持 | `GET /api/v2/spot/market/tickers` | `lastPr`；单交易对用 `symbol` 参数 |
| 买一/卖一价 | ✅ 支持 | `GET /api/v2/spot/market/tickers` | `bidPr/askPr/bidSz/askSz` 直接内嵌 |
| 24h 成交额 | ✅ 支持 | `GET /api/v2/spot/market/tickers` | `quoteVolume`、`usdtVolume`、`baseVolume` |
| 24h 涨跌幅 | ✅ 支持 | `GET /api/v2/spot/market/tickers` | `change24h`（滚动 24h，小数比率）、`changeUtc24h`（UTC 日） |
| 订单簿深度（多档） | ✅ 支持 | `GET /api/v2/spot/market/orderbook` | 最多 **150 档/侧**（limit 默认即上限 150）；`type=step0–step5` 档位合并（step0 不合并）；限频 20 次/秒（IP） |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | ✅ 支持 | `GET /api/v2/spot/market/candles`（近期）+ `GET /api/v2/spot/market/history-candles`（更早） | 粒度：`1min,3min,5min,15min,30min,1h,4h,6h,12h,1day,3day,1week,1M` + utc 变体。`candles` 上限 1000 条/次，但**可查询窗口按粒度受限**：1m/3m/5m 仅 1 个月、15m 52 天、30m 62 天、1H 83 天、4H 240 天、6H 360 天；`history-candles` 上限 **200 条/次**、必须传 `endTime`，向前翻页取更早历史。限频 20 次/秒（IP） |
| 历史 bid/ask | ❌ 不支持 | 仅有实时 `spot/market/orderbook` / `merge-depth` | 无历史盘口快照接口 |

---

## 五、Hyperliquid（HyperCore 现货）

> Hyperliquid 现货为链上订单簿市场（PURR/USDC、HYPE/USDC、UBTC/USDC 等）。Info API 对永续与现货通用，现货币名用 `PURR/USDC` 或 `@{universe index}`（如 HYPE 为 `@107`）表示。

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | 🟡 部分支持 | `POST /info` `{"type":"spotMetaAndAssetCtxs"}` | 无"最新一笔成交价"字段，只有 `midPx`（中间价）/`markPx`，可作参考价；逐笔成交需订阅 WebSocket `trades` 频道 |
| 买一/卖一价 | ✅ 支持 | `POST /info` `{"type":"l2Book","coin":"@107"}` | `levels[0][0]`=买一、`levels[1][0]`=卖一（项目已实现同款方法 `fetchL2BookBestBidAsk`）；现货 ctx 不含 impactPxs |
| 24h 成交额 | ✅ 支持 | `spotMetaAndAssetCtxs` | `dayNtlVlm`（USDC 名义成交额）、`dayBaseVlm`（基础币量） |
| 24h 涨跌幅 | 🟡 部分支持 | `spotMetaAndAssetCtxs` | 无直接字段，用 `prevDayPx`（24h 前标记价）与 `midPx` 自算 |
| 订单簿深度（多档） | 🟡 部分支持 | `POST /info` `{"type":"l2Book","coin":"@107"}` | REST 快照**最多 20 档/侧**；`nSigFigs`（2–5/null 全精度）+`mantissa`（1/2/5，仅 nSigFigs=5 时）做价格聚合；每档含订单数 `n`；WS `l2Book` 订阅可持续推送，自行维护本地全量盘口（深度不受 20 档限制） |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | 🟡 部分支持 | `POST /info` `{"type":"candleSnapshot", req:{coin:"@107", interval, startTime, endTime}}` | 粒度齐全：`1m,3m,5m,15m,30m,1h,2h,4h,8h,12h,1d,3d,1w,1M`；**硬性限制：每个市场每种粒度仅保留最近 5000 根**（1m≈3.5 天、1h≈208 天、1d≈13.7 年但受上市日约束），更早数据官方 API 无法获取，需自建归档节点 |
| 历史 bid/ask | ❌ 不支持 | 仅实时 `l2Book` / WS | 无历史盘口快照 |

---

## 六、Lighter（现货，2025-12 上线）

> Lighter 原为纯永续 DEX，**2025 年 12 月上线现货交易**（首批 ETH/USDC，现有 LIT/USDC 等，目前交易对很少）。API 侧已有一等公民支持：`orderBooks`/`orderBookDetails` 带 `filter=spot` 参数，响应中有独立的 `spot_order_book_details` 数组。

### 第一部分：实时数据

| 数据项 | 支持情况 | API 接口 | 关键字段 / 限制 |
|---|---|---|---|
| 最新成交价 | ✅ 支持 | `GET /api/v1/orderBookDetails?filter=spot` | `last_trade_price` |
| 买一/卖一价 | ✅ 支持 | `GET /api/v1/orderBookOrders?market_id={id}&limit={n≤250}` | 返回 bids/asks 档位数列，取首档得 BBO |
| 24h 成交额 | ✅ 支持 | `GET /api/v1/orderBookDetails?filter=spot` | `daily_quote_token_volume`（计价币）、`daily_base_token_volume`（基础币） |
| 24h 涨跌幅 | ✅ 支持 | `GET /api/v1/orderBookDetails?filter=spot` | `daily_price_change`（日涨跌，另含 `daily_price_low/high`、`daily_chart`） |
| 订单簿深度（多档） | ✅ 支持 | `GET /api/v1/orderBookOrders?market_id={id}&limit={n}` | limit 必填，**1–250 档/侧**；返回 bids/asks 档位数列；注意标准档约 60 req/min 的限频（项目已有全局节流） |

### 第二部分：历史数据

| 数据项 | 支持情况 | API 接口 | 关键限制 |
|---|---|---|---|
| 历史 K 线 | 🟡 部分支持 | `GET /api/v1/candles?market_id={id}&resolution={r}&start_timestamp&end_timestamp&count_back` | 粒度仅 8 档：`1m,5m,15m,30m,1h,4h,12h,1d`（无 3m/2h/周/月线）；接口与合约共用，传现货 market_id 即可；**深度自市场上线起算——现货 2025-12 才上线，天然只有数月历史**。另有 `marketPriceCharts`、`markPriceCandles` 两个图表端点。注意标准档限频约 60 次/分（项目代码已有全局节流） |
| 历史 bid/ask | ❌ 不支持 | 仅实时 `orderBookOrders` | 无历史盘口快照 |

---

## 七、对比汇总表

### 实时数据能力矩阵

| 交易所 | 最新成交价 | 买一/卖一 | 24h 成交额 | 24h 涨跌幅 | 实时数据主接口 |
|---|---|---|---|---|---|
| **Binance** | ✅ `ticker/price` | ✅ `ticker/bookTicker` | ✅ `ticker/24hr` → `quoteVolume` | ✅ `priceChangePercent` | `/api/v3/ticker/*` |
| **OKX** | ✅ `last` | ✅ `bidPx/askPx` | ✅ `volCcy24h` | 🟡 需 `open24h` 自算 | `/api/v5/market/ticker(s)`（一次请求四项全含） |
| **Gate.io** | ✅ `last` | ✅ `highest_bid/lowest_ask` | ✅ `quote_volume` | ✅ `change_percentage` | `/api/v4/spot/tickers`（一次请求四项全含） |
| **Bitget** | ✅ `lastPr` | ✅ `bidPr/askPr` | ✅ `quoteVolume/usdtVolume` | ✅ `change24h` | `/api/v2/spot/market/tickers`（一次请求四项全含） |
| **Hyperliquid** | 🟡 仅 midPx/markPx | ✅ `l2Book` | ✅ `dayNtlVlm` | 🟡 需 `prevDayPx` 自算 | `POST /info`（`spotMetaAndAssetCtxs` + `l2Book`） |
| **Lighter** | ✅ `last_trade_price` | ✅ `orderBookOrders` | ✅ `daily_quote_token_volume` | ✅ `daily_price_change` | `/api/v1/orderBookDetails?filter=spot` |

### 历史数据能力矩阵

| 交易所 | 历史 K 线 | K 线粒度 | 单次上限 | 历史深度 | 历史 bid/ask |
|---|---|---|---|---|---|
| **Binance** | ✅ `GET /api/v3/klines` | 15 档（1s–1M） | 1000 | **全历史**（自上市，startTime/endTime 翻页） | 🟡 REST 无；官方数据 dump（data.binance.vision）可离线回填 |
| **OKX** | ✅ `candles` + `history-candles` | 16 档（1m–1Y，无 1s 现货） | 300 | 近年（1s 仅 3 个月）；更早走官方历史数据服务（1m K线，自 2021-01） | ❌ |
| **Gate.io** | ✅ `GET /spot/candlesticks` | 13 档（1s–30d） | 1000 | 长期历史（from/to 分段翻页；limit 与时间区间互斥） | ❌ |
| **Bitget** | ✅ `candles` + `history-candles` | 13 档（1min–1M） | 1000 / 200 | 近期接口按粒度限窗（1m 仅 1 个月…6H 360 天）；更早用 history-candles 翻页 | ❌ |
| **Hyperliquid** | 🟡 `candleSnapshot` | 14 档（1m–1M） | — | **仅最近 5000 根/粒度**（1m≈3.5 天，1h≈208 天），硬上限 | ❌ |
| **Lighter** | 🟡 `GET /api/v1/candles` | 8 档（1m–1d，无周/月） | — | 自市场上线起；现货 2025-12 上线，仅数月 | ❌ |

### 实时订单簿深度能力矩阵（2026-08-01 补充）

| 交易所 | 深度接口 | REST 最大档数/侧 | 档位合并/聚合 | 更深数据的途径 |
|---|---|---|---|---|
| **Binance** | `GET /api/v3/depth` | **5000**（权重 250，慎用） | 无（原始档） | WS `@depth` 增量流维护本地全量簿 |
| **OKX** | `market/books` / `market/books-full` | 400 / **5000** | 无 | WS `books-l2-tbt`（400 档逐笔） |
| **Gate.io** | `GET /spot/order_book` | 100 | `interval` 价格合并 | WS `spot.obu`（400 档）、`spot.order_book_update` 增量 |
| **Bitget** | `GET /spot/market/orderbook` | 150 | `type=step0–step5` | WS books 频道 |
| **Hyperliquid** | `POST /info l2Book` | **仅 20** | `nSigFigs`+`mantissa` 聚合 | WS `l2Book` 订阅维护本地全量簿 |
| **Lighter** | `GET /orderBookOrders` | 250 | 无 | WS order_book 频道；受 60 req/min 限频约束 |

### 结论速览

1. **实时现货数据**：四家 CEX（Binance/OKX/Gate/Bitget）全部齐备且基本一个 ticker 接口搞定；Hyperliquid 缺"最新成交价"与"直接涨跌幅"字段（需用 midPx/prevDayPx 折算）；Lighter 现货实时数据齐备但市场极少。
2. **历史 K 线**：Binance 最强（全历史、1000/次、15 粒度）；OKX/Gate/Bitget 均可分页取长期历史但各有窗口/条数限制；Hyperliquid 有 5000 根硬上限；Lighter 粒度最少且现货历史仅数月。
3. **历史 bid/ask**：六家**均无在线历史盘口快照 API**；唯 Binance 通过官方公共数据下载（data.binance.vision 的 bookTicker 文件）可部分满足，其余只能自行实时采集落库。
4. **订单簿深度**：REST 档数排序 Binance(5000) > OKX(5000，需 books-full) > Lighter(250) > Bitget(150) > Gate(100) > Hyperliquid(仅 20)；六家都有 WS 推送可维护更深的本地盘口——做冲击成本/流动性分析时，Hyperliquid 必须走 WS 方案，CEX 用 REST 轮询即可覆盖 100–5000 档。项目已有的 `impact-price.ts`（Bitget 合约 orderbook 冲击成本算法）可直接平移到现货端点。
5. **对项目的意义**：若要扩展现货监控，Binance/OKX/Gate/Bitget 可复用现有适配器模式直接换现货端点；Hyperliquid 可复用项目已有的 `l2Book`/`candleSnapshot` 封装（改 coin 为 `@index`）；Lighter 需新增 `orderBookDetails?filter=spot` 与 `orderBookOrders` 接入，且注意 60 req/min 节流。
