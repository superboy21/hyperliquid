import { isAbortLikeError, throwIfAborted } from "./utils/abort";
import {
  buildGateBatchProxyRequest,
  createGateDirectRequest,
  enrichGateTickers,
  hasCompleteGateTickerEnrichment,
  requestGate,
  type GateTransportOptions,
} from "./gate-upstream";

// Gate.io API 资金费率监控模块
// API 文档: https://www.gate.com/docs/developers/apiv4/en/

// ==================== 类型定义 ====================

export interface GateTicker {
  contract: string;                    // 合约名称，如 "BTC_USDT"
  last: string;                        // 最新成交价
  low_24h: string;                     // 24h 最低价
  high_24h: string;                    // 24h 最高价
  change_percentage: string;           // 24h 涨跌幅（百分比）
  change_price: string;                // 24h 涨跌价
  funding_rate: string;                // 当前资金费率
  funding_rate_indicative: string;     // 预测资金费率
  mark_price: string;                  // 标记价格
  index_price: string;                 // 指数价格
  total_size: string;                  // 持仓量（张）
  volume_24h: string;                  // 24h 成交量（张）
  volume_24h_settle: string;           // 24h 成交量（结算货币）
  volume_24h_base: string;             // 24h 成交量（基础货币）
  volume_24h_quote: string;            // 24h 成交量（计价货币）
  quanto_multiplier: string;           // 合约乘数
  highest_bid: string;                 // 最高买价
  lowest_ask: string;                  // 最低卖价
  funding_interval: number;            // 结算周期（秒）
  asset_category: string;              // 资产类别
}

export interface GateFundingHistoryItem {
  contract: string;                    // 合约名称
  t: number;                           // 时间戳（秒）
  r: string;                           // 资金费率
}

export interface GateBatchFundingRatesResponseItem {
  contract?: string;
  data?: GateFundingHistoryItem[];
  error?: {
    status: number;
    message: string;
    retryAfter?: string;
  };
}

export interface GateCandlestick {
  t: number;                           // K 线开始时间（秒）
  o: string;                           // 开盘价
  h: string;                           // 最高价
  l: string;                           // 最低价
  c: string;                           // 收盘价
  v: number;                           // 成交量（张）
  sum: string;                         // 成交额
}

export interface GatePremiumIndexItem {
  t?: number;
  c?: string;
}

// 内部使用的统一类型
export interface FundingRate {
  coin: string;                        // 合约名称（转换为 "BTC" 格式）
  fundingRate: string;                 // 当前资金费率
  fundingRateIndicative: string;       // 预测资金费率
  markPrice: string;                   // 标记价格
  indexPrice: string;                  // 指数价格
  openInterest: string;                // 持仓量（张）
  dayVolume: string;                   // 24h 成交量
  change24h: string;                   // 24h 涨跌幅
  lastPrice: string;                   // 最新价格
  notionalValue: string;               // 持仓价值（USD）
  fundingInterval: number;             // 结算周期（秒）
  assetCategory: string;               // 资产类别
  bestBid?: string;                    // 最佳买价
  bestAsk?: string;                    // 最佳卖价
  midPrice?: string;                   // 中间价
}

export interface FundingHistoryItem {
  time: number;                        // 时间戳（毫秒）
  fundingRate: string;                 // 资金费率
}

export interface CandleSnapshotItem {
  openTime: number;                    // 开盘时间（毫秒）
  closeTime: number;                   // 收盘时间（毫秒）
  open: string;                        // 开盘价
  high: string;                        // 最高价
  low: string;                         // 最低价
  close: string;                       // 收盘价
  volume: string;                      // 成交量
}

export type ChartInterval = "1d" | "4h" | "1h" | "1m";

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

// ==================== API 调用函数 ====================

/**
 * 获取所有合约的行情数据（包含资金费率）
 */
export async function getGateContracts(signal?: AbortSignal): Promise<unknown[]> {
  try {
    throwIfAborted(signal);
    const response = await requestGate("contracts", {}, signal);
    throwIfAborted(signal);
    if (!response.ok) return [];
    const data = await response.json();
    throwIfAborted(signal);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }
    return [];
  }
}

export async function getGateTickers(contract?: string, signal?: AbortSignal): Promise<GateTicker[]> {
  try {
    throwIfAborted(signal);
    const params: Record<string, string> = contract ? { contract } : {};
    const [tickersResponse, contracts] = await Promise.all([
      requestGate("tickers", params, signal),
      getGateContracts(signal),
    ]);
    const response = tickersResponse;

    if (!response.ok) {
      throw new Error(`Failed to fetch tickers: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid ticker response format");
    }

    // Contracts are required metadata. Do not let enrichment fill in an
    // assumed 8-hour interval when the contracts leg was unavailable.
    if (!hasCompleteGateTickerEnrichment(data, contracts)) {
      throw new Error("Gate ticker contracts enrichment is unavailable");
    }
    return enrichGateTickers(data, contracts) as unknown as GateTicker[];
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }
    console.error("Error fetching Gate.io tickers:", error);
    return [];
  }
}

/** Fetch all USDT perpetual tickers with the same contracts enrichment as the proxy route. */
export async function getAllGateTickers(signal?: AbortSignal): Promise<GateTicker[]> {
  return getGateTickers(undefined, signal);
}

/**
 * 获取所有合约的资金费率数据（统一格式）
 */
export async function getAllFundingRates(): Promise<FundingRate[]> {
  const tickers = await getAllGateTickers();

  return tickers.map((ticker) => {
    const totalSize = parseFloat(ticker.total_size) || 0;
    const markPrice = parseFloat(ticker.mark_price) || 0;
    const multiplier = parseFloat(ticker.quanto_multiplier) || 1;
    
    // 持仓价值 = 持仓张数 * 合约乘数 * 标记价格
    const notionalValue = totalSize * multiplier * markPrice;

    // 计算中间价
    const bestBid = ticker.highest_bid || "0";
    const bestAsk = ticker.lowest_ask || "0";
    const midPrice = bestBid && bestAsk 
      ? String((parseFloat(bestBid) + parseFloat(bestAsk)) / 2) 
      : "0";

    return {
      coin: formatContractName(ticker.contract),
      fundingRate: ticker.funding_rate || "0",
      fundingRateIndicative: ticker.funding_rate_indicative || "0",
      markPrice: ticker.mark_price || "0",
      indexPrice: ticker.index_price || "0",
      openInterest: ticker.total_size || "0",
      dayVolume: ticker.volume_24h_settle || "0",
      change24h: ticker.change_percentage || "0",
      lastPrice: ticker.last || "0",
      notionalValue: String(notionalValue),
      fundingInterval: ticker.funding_interval || 28800,
      assetCategory: ticker.asset_category || "其他",
      bestBid,
      bestAsk,
      midPrice,
    };
  });
}

/**
 * 获取指定合约的历史资金费率
 * @param contract 合约名称，如 "BTC_USDT"
 * @param limit 返回记录数量，默认 100
 */
export async function getFundingHistory(
  contract: string,
  limit: number = 100,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  try {
    throwIfAborted(signal);

    const response = await requestGate("funding-rate", { contract, limit: String(limit) }, signal);
    throwIfAborted(signal);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    throwIfAborted(signal);
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item: GateFundingHistoryItem) => ({
      time: item.t * 1000, // 转换为毫秒
      fundingRate: item.r,
    }));
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }

    console.error(`Error fetching funding history for ${contract}:`, error);
    return [];
  }
}

/**
 * 批量获取多个合约的历史资金费率
 */
export async function getBatchFundingHistory(
  contracts: string[],
  signal?: AbortSignal,
): Promise<Map<string, FundingHistoryItem[]>> {
  throwIfAborted(signal);
  if (contracts.length === 0) {
    return new Map();
  }

  return fetchGateBatchFundingHistory(contracts, signal);
}

function normalizeFundingHistoryPayload(payload: unknown): FundingHistoryItem[] | null {
  if (!Array.isArray(payload)) return null;
  if (!payload.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<GateFundingHistoryItem>;
    return typeof row.t === "number" && Number.isFinite(row.t) && typeof row.r === "string";
  })) {
    return null;
  }
  return payload.map((item) => {
    const row = item as GateFundingHistoryItem;
    return { time: row.t * 1000, fundingRate: row.r };
  });
}

/**
 * Fetch latest funding settlements direct-first per contract. Gate's public
 * API has no bulk endpoint: successful direct items are retained, while only
 * transport/geo failures are grouped into <=50-contract proxy requests.
 */
export async function fetchGateBatchFundingHistory(
  contracts: string[],
  signal?: AbortSignal,
  options: GateTransportOptions = {},
): Promise<Map<string, FundingHistoryItem[]>> {
  throwIfAborted(signal);
  const uniqueContracts = Array.from(new Set(contracts));
  if (uniqueContracts.length === 0) return new Map();

  const direct = createGateDirectRequest(options);
  const fetchImpl = options.fetch ?? fetch;
  const result = new Map<string, FundingHistoryItem[]>();
  const directNeedsProxy = await Promise.all(uniqueContracts.map(async (contract) => {
    throwIfAborted(signal);
    let observedDirect429 = false;
    let response: Response;
    try {
      response = await direct("funding-rate", { contract, limit: "1" }, signal, (directResponse) => {
        if (directResponse.status === 429) observedDirect429 = true;
      });
    } catch (error) {
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
      // A direct 429 is authoritative for this contract, even if the
      // direct client's retry subsequently fails as a transport error.
      if (observedDirect429) return false;
      // Only direct transport failures (including the direct client's own
      // timeout) are eligible for the batch proxy. Parsing and validation are
      // deliberately below this catch so malformed 200 responses never proxy.
      return true;
    }

    throwIfAborted(signal);
    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return false;
      }

      const history = normalizeFundingHistoryPayload(payload);
      // A malformed successful payload is a business/data failure, not a
      // transport failure, and must not cause a proxy retry.
      if (history) result.set(contract, history);
      return false;
    }

    if (observedDirect429) return false;
    if (response.status === 403 || response.status === 451 || response.status >= 500) return true;
    // 400/404/429 are definitive direct responses; do not proxy them.
    return false;
  }));
  const proxyContracts = uniqueContracts.filter((_, index) => directNeedsProxy[index]);

  for (let offset = 0; offset < proxyContracts.length; offset += 50) {
    throwIfAborted(signal);
    const chunk = proxyContracts.slice(offset, offset + 50);
    const request = buildGateBatchProxyRequest(chunk);
    try {
      const response = await fetchImpl(request.url, { ...request.init, signal });
      if (!response.ok) continue;
      const payload = await response.json();
      if (!Array.isArray(payload)) continue;
      for (const item of payload as GateBatchFundingRatesResponseItem[]) {
        if (!item.contract || !Array.isArray(item.data) || result.has(item.contract)) continue;
        result.set(item.contract, normalizeFundingHistoryPayload(item.data) ?? []);
      }
    } catch (error) {
      if (isAbortLikeError(error) || signal?.aborted) {
        throwIfAborted(signal);
        throw error;
      }
    }
  }
  return result;
}

/**
 * 获取指定合约的历史资金费率（指定天数）
 * @param coin 合约名称（简化格式，如 "BTC"）
 * @param days 天数
 * @param fundingIntervalSeconds 结算周期（秒），默认 28800（8 小时）
 */
export async function getFundingHistoryForDays(
  coin: string,
  days: number = 30,
  fundingIntervalSeconds: number = 28800,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  const contract = toContractName(coin);
  const settlementsPerDay = 86400 / fundingIntervalSeconds;
  const limit = Math.min(Math.ceil(days * settlementsPerDay), 1000);
  return getFundingHistory(contract, limit, signal);
}

/**
 * 获取指定合约的全部历史资金费率（自动分页直到获取完所有可用数据）
 * Gate.io API 每次最多返回 1000 条，通过 from/to 时间戳分页
 */
export async function getFundingHistoryAll(
  coin: string,
  fundingIntervalSeconds: number = 28800,
  signal?: AbortSignal,
): Promise<FundingHistoryItem[]> {
  const contract = toContractName(coin);
  const allHistory: FundingHistoryItem[] = [];
  const seen = new Set<number>();
  let currentTo = Math.floor(Date.now() / 1000);
  const pageSize = 1000;
  const maxLoops = 30;

  for (let i = 0; i < maxLoops; i++) {
    throwIfAborted(signal);

    // Gate API 对 from/to 范围有限制，单次最多约 90 天
    // 通过多次分页向前翻，每次 90 天窗口
    const windowSeconds = 90 * 24 * 3600; // 90 天
    const currentFrom = Math.max(0, currentTo - windowSeconds);

    const response = await requestGate("funding-rate", {
      contract,
      limit: String(pageSize),
      from: String(currentFrom),
      to: String(currentTo),
    }, signal);
    throwIfAborted(signal);

    if (!response.ok) break;

    const data = await response.json();
    throwIfAborted(signal);
    if (!Array.isArray(data) || data.length === 0) break;

    let newCount = 0;
    for (const item of data as GateFundingHistoryItem[]) {
      const time = item.t * 1000;
      if (!seen.has(time)) {
        seen.add(time);
        allHistory.push({ time, fundingRate: item.r });
        newCount++;
      }
    }

    if (newCount === 0) break;

    // 继续往前获取：用最早的时间戳作为下一次的 to
    const earliestTime = Math.min(...(data as GateFundingHistoryItem[]).map((h: GateFundingHistoryItem) => h.t));
    currentTo = earliestTime - 1;

    if (currentTo <= 0) break;
  }

  return allHistory.sort((a, b) => a.time - b.time);
}

/**
 * 获取 K 线数据
 * @param contract 合约名称，如 "BTC_USDT"
 * @param interval K 线周期
 * @param limit 返回数量
 */
export async function getCandleSnapshot(
  coin: string,
  interval: ChartInterval = "1d",
  limit: number = 30,
  signal?: AbortSignal,
): Promise<CandleSnapshotItem[]> {
  try {
    throwIfAborted(signal);

    const contract = toContractName(coin);
    const intervalParam = convertInterval(interval);

    const response = await requestGate("candlesticks", { contract, interval: intervalParam, limit: String(limit) }, signal);
    throwIfAborted(signal);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    throwIfAborted(signal);
    if (!Array.isArray(data)) {
      return [];
    }

    // Gate.io 返回格式: {t: timestamp, o: open, h: high, l: low, c: close, v: volume, sum: quote_volume}
    return data.map((item: { t: number; o: string; h: string; l: string; c: string; v: number; sum: string }) => {
      const openTime = item.t * 1000; // 转换为毫秒
      const intervalMs = getIntervalMs(interval);
      return {
        openTime,
        closeTime: openTime + intervalMs,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: String(item.v),
      };
    });
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }

    console.error(`Error fetching candles for ${coin}:`, error);
    return [];
  }
}

/** Fetch Gate's official premium-index series (direct-first, then proxy). */
export async function getGatePremiumIndex(
  contract: string,
  limit: number = 1,
  signal?: AbortSignal,
): Promise<GatePremiumIndexItem[]> {
  try {
    throwIfAborted(signal);
    const response = await requestGate("premium-index", { contract, limit: String(limit) }, signal);
    throwIfAborted(signal);
    if (!response.ok) return [];
    const data = await response.json();
    throwIfAborted(signal);
    return Array.isArray(data) ? data as GatePremiumIndexItem[] : [];
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }
    return [];
  }
}

export interface GateOrderBookPayload {
  bids?: Array<{ p: string; s: number }>;
  asks?: Array<{ p: string; s: number }>;
}

/** Fetch a Gate futures order book, including the RPI endpoint when requested. */
export async function getGateOrderBook(
  contract: string,
  limit: number,
  signal?: AbortSignal,
  rpi = false,
): Promise<GateOrderBookPayload | null> {
  try {
    throwIfAborted(signal);
    const response = await requestGate("order-book", {
      contract,
      limit: String(limit),
      ...(rpi ? { rpi: "1" } : {}),
    }, signal);
    throwIfAborted(signal);
    if (!response.ok) return null;
    const data = await response.json();
    throwIfAborted(signal);
    return data && typeof data === "object" ? data as GateOrderBookPayload : null;
  } catch (error) {
    if (isAbortLikeError(error) || signal?.aborted) {
      throwIfAborted(signal);
      throw error;
    }
    return null;
  }
}

// ==================== 数据处理函数 ====================

/**
 * 按时间间隔计算平均资金费率
 */
export function getAverageFundingRatesByInterval(
  history: FundingHistoryItem[],
  interval: ChartInterval
): IntervalFundingRateItem[] {
  const intervalMs = getIntervalMs(interval);
  const grouped = new Map<number, { total: number; count: number }>();

  for (const item of history) {
    const bucketStartTime = Math.floor(item.time / intervalMs) * intervalMs;
    const existing = grouped.get(bucketStartTime) ?? { total: 0, count: 0 };
    existing.total += parseFloat(item.fundingRate);
    existing.count += 1;
    grouped.set(bucketStartTime, existing);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStartTime, value]) => ({
      bucketStartTime,
      averageFundingRate: value.count > 0 ? value.total / value.count : 0,
      sampleCount: value.count,
    }));
}

// ==================== 格式化函数 ====================

/**
 * 将资金费率转换为年化费率
 * @param rate 资金费率
 * @param fundingIntervalSeconds 结算周期（秒），默认 28800（8小时）
 */
export function toAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): number {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  // 年化 = 费率 * (24小时 / 结算周期小时) * 365天 * 100
  const settlementsPerDay = 24 / (fundingIntervalSeconds / 3600);
  return rateNumber * settlementsPerDay * 365 * 100;
}

/**
 * 格式化资金费率
 */
export function formatFundingRate(rate: string | number): string {
  const rateNumber = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(rateNumber * 100).toFixed(4)}%`;
}

/**
 * 格式化年化资金费率
 */
export function formatAnnualizedRate(rate: string | number, fundingIntervalSeconds: number = 28800): string {
  const annualized = toAnnualizedRate(rate, fundingIntervalSeconds);
  const absRate = Math.abs(annualized);

  if (absRate >= 100) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(1)}%`;
  }

  if (absRate >= 10) {
    return `${annualized > 0 ? "+" : ""}${annualized.toFixed(2)}%`;
  }

  return `${annualized > 0 ? "+" : ""}${annualized.toFixed(3)}%`;
}

/**
 * 格式化价格
 */
export function formatPrice(price: string | number): string {
  const priceNumber = typeof price === "string" ? parseFloat(price) : price;

  if (priceNumber >= 1000) {
    return priceNumber.toFixed(2);
  }
  if (priceNumber >= 1) {
    return priceNumber.toFixed(4);
  }
  return priceNumber.toFixed(6);
}

/**
 * 格式化成交量
 */
export function formatVolume(volume: string | number): string {
  const volumeNumber = typeof volume === "string" ? parseFloat(volume) : volume;

  if (volumeNumber >= 1e9) {
    return `${(volumeNumber / 1e9).toFixed(2)}B`;
  }
  if (volumeNumber >= 1e6) {
    return `${(volumeNumber / 1e6).toFixed(2)}M`;
  }
  if (volumeNumber >= 1e3) {
    return `${(volumeNumber / 1e3).toFixed(2)}K`;
  }
  return volumeNumber.toFixed(2);
}

/**
 * 格式化时间
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * 格式化日期
 */
export function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
}

/**
 * 格式化 K 线标签
 */
export function formatIntervalLabel(timestamp: number, interval: ChartInterval): string {
  if (interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/**
 * 格式化坐标轴标签（带换行）
 */
export function formatAxisIntervalLabel(timestamp: number, interval: ChartInterval): string {
  if (interval === "1d") {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    });
  }

  if (interval === "4h") {
    return new Date(timestamp).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).replace(" ", "\n");
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).replace(" ", "\n");
}

// ==================== 辅助函数 ====================

/**
 * 将合约名称转换为简化格式
 * "BTC_USDT" -> "BTC"
 */
function formatContractName(contract: string): string {
  return contract.replace("_USDT", "").replace("_USD", "");
}

/**
 * 将简化名称转换为合约名称
 * "BTC" -> "BTC_USDT"
 */
function toContractName(coin: string): string {
  // 如果已经包含 _USDT 或 _USD，直接返回
  if (coin.includes("_")) {
    return coin;
  }
  return `${coin}_USDT`;
}

/**
 * 将 ChartInterval 转换为 Gate.io API 参数
 */
function convertInterval(interval: ChartInterval): string {
  switch (interval) {
    case "1d":
      return "1d";
    case "4h":
      return "4h";
    case "1h":
      return "1h";
    case "1m":
      return "1m";
    default:
      return "1d";
  }
}

/**
 * 获取时间间隔的毫秒数
 */
function getIntervalMs(interval: ChartInterval): number {
  switch (interval) {
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "1m":
      return 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}
