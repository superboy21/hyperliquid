// Hyperliquid API 服务

export interface FundingRate {
  coin: string;
  fundingRate: string;
  markPrice: string;
  indexPrice: string;
  premium: string;
  openInterest: string;
  dayVolume: string;
  isSpot?: boolean;
  // 历史平均值
  avg7d?: number;
  avg30d?: number;
}

export interface FundingHistoryItem {
  time: number;
  coin: string;
  fundingRate: string;
  premium: string;  // 预测资金费率
  markPrice?: string;
  indexPrice?: string;
}

export interface MarketInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

export interface SpotMarketInfo {
  name: string;
  tokens: [number, number]; // [baseTokenId, quoteTokenId]
  index: number;
  isCanonical: boolean;
}

interface AssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: string[] | null;
  dayBaseVlm: string;
}

interface SpotAssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
  impactPxs: string[] | null;
  dayBaseVlm: string;
}

interface MetaAndAssetCtxs {
  universe: MarketInfo[];
  assetCtxs: AssetContext[];
}

interface SpotMetaAndAssetCtxs {
  tokens: Array<{
    name: string;
    index: number;
    szDecimals: number;
    weiDecimals: number;
  }>;
  universe: SpotMarketInfo[];
  assetCtxs: SpotAssetContext[];
}

// Hyperliquid 资金费率周期（每8小时一次）
const FUNDING_PERIODS_PER_YEAR = 365 * 3; // 365天 * 每天3次

// 已知的 HIP-3 资产列表（基于实际可用的资产）
const KNOWN_HIP3_ASSETS = [
  "xyz:SILVER",
  "xyz:GOLD",
  "xyz:MSTR",
  "xyz:COIN",
  "xyz:NVDA",
  "xyz:AMD",
  "xyz:TSLA",
  "xyz:AAPL",
  "xyz:GOOGL",
  "xyz:AMZN",
  "xyz:MSFT",
  "xyz:META",
  "xyz:NFLX",
  "xyz:SPY",
  "xyz:QQQ",
  "xyz:IWM",
  "xyz:GLD",
  "xyz:SLV",
  "xyz:TLT",
  "xyz:UVXY",
  // 新增 HIP-3 资产（来自规格列表）
  "xyz:XYZ100",
  "xyz:PLATINUM",
  "xyz:COPPER",
  "xyz:CL",
  "xyz:NATGAS",
  "xyz:JPY",
  "xyz:EUR",
  "xyz:URNM",
  "xyz:INTC",
  "xyz:MU",
  "xyz:PLTR",
  "xyz:ORCL",
  "xyz:HOOD",
  "xyz:CRCL",
  "xyz:SNDK",
  "xyz:RIVN",
  "xyz:USAR",
  "xyz:TSM",
  "xyz:SKHX",
  "xyz:SMSN",
  "xyz:HYUNDAI",
];

// 获取所有永续合约市场的资金费率（使用结算费率 funding）
export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });

    if (!response.ok) throw new Error("Failed to fetch funding rates");

    const data = await response.json();
    
    // data is an array: [meta, assetCtxs]
    const meta = data[0];
    const assetCtxs: AssetContext[] = data[1];
    
    if (!meta?.universe || !assetCtxs) {
      throw new Error("Invalid response format");
    }

    return meta.universe.map((market: MarketInfo, index: number) => {
      const ctx = assetCtxs[index];
      // 使用 funding（结算费率）作为当前费率，而不是 premium（预测费率）
      // 因为预测费率可能不稳定，结算费率是实际已发生的
      const fundingRate = ctx?.funding || "0";
      return {
        coin: market.name,
        fundingRate: fundingRate,
        markPrice: ctx?.markPx || "0",
        indexPrice: ctx?.oraclePx || "0",
        premium: ctx?.premium || "0",
        openInterest: ctx?.openInterest || "0",
        dayVolume: ctx?.dayNtlVlm || "0",
        isSpot: false,
      };
    });
  } catch (error) {
    console.error("Error fetching funding rates:", error);
    return [];
  }
}

// 获取所有 HIP-3 现货资产的当前资金费率
// 注意：HIP-3 资产的 fundingHistory API 返回空数组，无法获取资金费率数据
export async function getSpotFundingRates(): Promise<FundingRate[]> {
  // 尝试通过 fundingHistory API 获取 HIP-3 资产数据
  // 如果 API 返回空数组，则该资产不会显示
  return await getHip3FundingRates();
}

// 通过 WebSocket 获取 HIP-3 资产的实时资金费率
// 注意：WebSocket 订阅格式可能不正确，暂时禁用，改用 fundingHistory API
async function getSpotRatesFromWebSocket(): Promise<FundingRate[]> {
  console.log("[WebSocket] WebSocket currently disabled, using fundingHistory API instead");
  return [];
}

// 获取单个 HIP-3 资产的当前资金费率
async function getHip3FundingRate(coin: string): Promise<FundingRate | null> {
  try {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 48 * 60 * 60; // 48小时前（秒级）
    
    console.log(`Fetching HIP-3 rate for ${coin}, startTime: ${startTime} (48h ago)`);
    
    const history = await getFundingHistory(coin, startTime);
    
    console.log(`${coin} history returned ${history.length} items`);
    
    if (history.length === 0) {
      // API 返回空数组，暂时无法获取该资产数据
      console.warn(`${coin}: fundingHistory API returned empty array`);
      return null;
    }
    
    // 获取最新的资金费率
    const latest = history[history.length - 1];
    
    // 对于 HIP-3 资产:
    // - fundingRate: 上期结算费率（实际收取的）
    // - premium: 下期预测费率（预测的）
    // 使用 fundingRate（结算费率）作为当前费率
    return {
      coin: coin,
      fundingRate: latest.fundingRate,
      markPrice: latest.markPrice || "0",
      indexPrice: latest.indexPrice || "0",
      premium: latest.premium || "0",
      openInterest: "0",
      dayVolume: "0",
      isSpot: true,
    };
  } catch (error) {
    console.error(`Error fetching HIP-3 funding rate for ${coin}:`, error);
    return null;
  }
}

// 获取所有 HIP-3 资产的资金费率
export async function getHip3FundingRates(): Promise<FundingRate[]> {
  // 串行获取 HIP-3 资产数据，避免请求过多
  const rates: FundingRate[] = [];
  
  for (const coin of KNOWN_HIP3_ASSETS) {
    try {
      const rate = await getHip3FundingRate(coin);
      if (rate) {
        rates.push(rate);
      }
      // 添加小延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Failed to fetch ${coin}:`, error);
    }
  }
  
  return rates;
}

// 获取所有资金费率（永续合约 + HIP-3 资产）
export async function getAllFundingRatesWithHistory(): Promise<FundingRate[]> {
  try {
    console.log("Starting to fetch all funding rates...");
    
    // 获取永续合约数据
    const perpRates = await getAllFundingRates();
    console.log(`Got ${perpRates.length} perpetual rates`);
    
    // 获取 HIP-3 资产当前实时资金费率（使用 spotMetaAndAssetCtxs API）
    let hip3Rates: FundingRate[] = [];
    try {
      hip3Rates = await getSpotFundingRates();
      console.log(`Got ${hip3Rates.length} HIP-3 spot rates`);
    } catch (e) {
      console.log("HIP-3 rates fetch failed (expected if API unavailable):", e);
    }
    
    if (perpRates.length === 0 && hip3Rates.length === 0) {
      console.error("No funding rates returned");
      return [];
    }

    // 合并并去重
    const allRates = [...perpRates];
    
    for (const hip3Rate of hip3Rates) {
      const exists = allRates.some(r => r.coin === hip3Rate.coin);
      if (!exists) {
        allRates.push(hip3Rate);
      }
    }
    
    console.log(`Total rates: ${allRates.length}`);
    return allRates;
  } catch (error) {
    console.error("Error fetching all funding rates:", error);
    return [];
  }
}

// 获取单个币种的历史平均值（按需调用）
export async function getFundingAverages(coin: string): Promise<{ avg7d: number; avg30d: number } | null> {
  try {
    const endTime = Math.floor(Date.now() / 1000);
    // API最多返回500条记录，超过会导致最新数据丢失
    // 请求两次15天数据并拼接：15天约360条，两个15天共720条，取最新的30天(约360条)
    
    // 第一次请求：最近15天
    const startTime1 = endTime - 15 * 24 * 60 * 60;
    const history1 = await getFundingHistory(coin, startTime1);
    console.log(`${coin} history (first 15d): ${history1.length} items`);
    
    // 第二次请求：更早的15天
    const startTime2 = startTime1 - 15 * 24 * 60 * 60;
    const history2 = await getFundingHistory(coin, startTime2);
    console.log(`${coin} history (second 15d): ${history2.length} items`);
    
    // 合并并按时间排序（最新的在前）
    const combinedHistory = [...history1, ...history2].sort((a, b) => b.time - a.time);
    console.log(`${coin} combined history: ${combinedHistory.length} items`);
    
    // 取最近的30天数据（API返回的time是毫秒级）
    const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30Days = combinedHistory.filter((h) => h.time >= thirtyDaysAgoMs);
    console.log(`${coin} last 30 days: ${last30Days.length} items`);

    if (last30Days.length === 0) {
      console.log(`No history data available for ${coin}`);
      return null;
    }

    // 计算7天平均（API返回的time是毫秒级）
    const endTimeMs = endTime * 1000; // 转换为毫秒
    const sevenDaysAgoMs = endTimeMs - 7 * 24 * 60 * 60 * 1000;
    const last7Days = last30Days.filter((h) => h.time >= sevenDaysAgoMs);
    const avg7d =
      last7Days.length > 0
        ? last7Days.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / last7Days.length
        : 0;

    // 计算30天平均
    const avg30d =
      last30Days.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) / last30Days.length;

    return { avg7d, avg30d };
  } catch (error) {
    console.error(`Error fetching averages for ${coin}:`, error);
    return null;
  }
}

// 获取历史资金费率
export async function getFundingHistory(
  coin: string,
  startTimeSeconds?: number,
  endTimeSeconds?: number
): Promise<FundingHistoryItem[]> {
  try {
    const body: any = {
      type: "fundingHistory",
      coin,
    };

    // startTime 需要毫秒级时间戳，且只传 startTime 不传 endTime
    if (startTimeSeconds) {
      body.startTime = startTimeSeconds * 1000;
    }

    console.log(`[API] Request fundingHistory for ${coin}:`, body);

    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Origin": "https://app.hyperliquid.xyz",
        "Referer": "https://app.hyperliquid.xyz/"
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.log(`[API] Response not OK for ${coin}:`, response.status);
      return [];
    }

    const data = await response.json();
    
    console.log(`[API] Response for ${coin}:`, Array.isArray(data) ? `${data.length} items` : data);
    
    // Check if data is an array
    if (!Array.isArray(data)) {
      console.log(`[API] Data is not an array for ${coin}:`, typeof data);
      return [];
    }
    
    return data.map((item: any) => ({
      time: item.time,
      coin: item.coin,
      fundingRate: item.fundingRate,
      premium: item.premium || "0",
      markPrice: item.markPrice || "0",
      indexPrice: item.indexPrice || "0",
    }));
  } catch (error) {
    console.error("[API] Error fetching funding history:", error);
    return [];
  }
}

// 获取所有交易对信息
export async function getMeta(): Promise<MarketInfo[]> {
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });

    if (!response.ok) throw new Error("Failed to fetch meta");

    const data = await response.json();
    return data.universe || [];
  } catch (error) {
    console.error("Error fetching meta:", error);
    return [];
  }
}

// 将资金费率转换为年化
// Hyperliquid 资金费率每小时结算一次
// 年化公式：fundingRate * 24 * 365 * 100
export function toAnnualizedRate(rate: string | number): number {
  const rateNum = typeof rate === "string" ? parseFloat(rate) : rate;
  // 每小时结算一次：每天24次 × 365天 = 8760次/年
  return rateNum * 24 * 365 * 100;
}

// 格式化资金费率为百分比（原始值）
export function formatFundingRate(rate: string): string {
  const rateNum = parseFloat(rate);
  return (rateNum * 100).toFixed(4) + "%";
}

// 格式化年化资金费率
export function formatAnnualizedRate(rate: string | number): string {
  const annualized = toAnnualizedRate(rate);
  const absRate = Math.abs(annualized);
  
  if (absRate >= 100) {
    return (annualized > 0 ? "+" : "") + annualized.toFixed(1) + "%";
  } else if (absRate >= 10) {
    return (annualized > 0 ? "+" : "") + annualized.toFixed(2) + "%";
  } else {
    return (annualized > 0 ? "+" : "") + annualized.toFixed(3) + "%";
  }
}

// 格式化价格
export function formatPrice(price: string, decimals: number = 4): string {
  const priceNum = parseFloat(price);
  if (priceNum > 1000) {
    return priceNum.toFixed(2);
  } else if (priceNum > 1) {
    return priceNum.toFixed(4);
  } else {
    return priceNum.toFixed(6);
  }
}

// 格式化大额数字
export function formatVolume(volume: string): string {
  const vol = parseFloat(volume);
  if (vol >= 1e9) {
    return (vol / 1e9).toFixed(2) + "B";
  } else if (vol >= 1e6) {
    return (vol / 1e6).toFixed(2) + "M";
  } else if (vol >= 1e3) {
    return (vol / 1e3).toFixed(2) + "K";
  }
  return vol.toFixed(2);
}

// 格式化时间
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}
