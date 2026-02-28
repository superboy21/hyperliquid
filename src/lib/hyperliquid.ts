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
  markPrice: string;
  indexPrice: string;
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

// 获取所有永续合约市场的资金费率
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
      return {
        coin: market.name,
        fundingRate: ctx?.funding || "0",
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

// 获取所有现货市场（HIP-3）的资金费率
export async function getSpotFundingRates(): Promise<FundingRate[]> {
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMetaAndAssetCtxs" }),
    });

    if (!response.ok) throw new Error("Failed to fetch spot funding rates");

    const data = await response.json();
    
    // data is an array: [meta, assetCtxs]
    const meta: SpotMetaAndAssetCtxs = data[0];
    const assetCtxs: SpotAssetContext[] = data[1];
    
    if (!meta?.universe || !assetCtxs) {
      throw new Error("Invalid spot response format");
    }

    const rates: FundingRate[] = [];
    meta.universe.forEach((market: SpotMarketInfo, index: number) => {
      const ctx = assetCtxs[index];
      // 只返回有资金费率的 HIP-3 资产
      if (ctx?.funding && parseFloat(ctx.funding) !== 0) {
        rates.push({
          coin: market.name,
          fundingRate: ctx.funding || "0",
          markPrice: ctx.markPx || "0",
          indexPrice: ctx.oraclePx || "0",
          premium: ctx.premium || "0",
          openInterest: ctx.openInterest || "0",
          dayVolume: ctx.dayNtlVlm || "0",
          isSpot: true,
        });
      }
    });
    return rates;
  } catch (error) {
    console.error("Error fetching spot funding rates:", error);
    return [];
  }
}

// 获取所有资金费率（包括永续合约和 HIP-3 现货）
export async function getAllFundingRatesWithHistory(): Promise<FundingRate[]> {
  try {
    // 并行获取永续合约和现货数据
    const [perpRates, spotRates] = await Promise.all([
      getAllFundingRates(),
      getSpotFundingRates(),
    ]);

    // 合并数据
    const allRates = [...perpRates, ...spotRates];

    // 获取每个币种的历史数据（用于计算平均值）
    const ratesWithHistory = await Promise.all(
      allRates.map(async (rate) => {
        try {
          // 获取30天的历史数据
          const endTime = Date.now();
          const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
          const history = await getFundingHistory(rate.coin, startTime, endTime);

          if (history.length === 0) {
            return rate;
          }

          // 计算7天平均
          const sevenDaysAgo = endTime - 7 * 24 * 60 * 60 * 1000;
          const last7Days = history.filter((h) => h.time >= sevenDaysAgo);
          const avg7d =
            last7Days.length > 0
              ? last7Days.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) /
                last7Days.length
              : 0;

          // 计算30天平均
          const avg30d =
            history.reduce((sum, h) => sum + parseFloat(h.fundingRate), 0) /
            history.length;

          return {
            ...rate,
            avg7d,
            avg30d,
          };
        } catch (error) {
          console.error(`Error fetching history for ${rate.coin}:`, error);
          return rate;
        }
      })
    );

    return ratesWithHistory;
  } catch (error) {
    console.error("Error fetching all funding rates:", error);
    return [];
  }
}

// 获取历史资金费率
export async function getFundingHistory(
  coin: string,
  startTime?: number,
  endTime?: number
): Promise<FundingHistoryItem[]> {
  try {
    const body: any = {
      type: "fundingHistory",
      coin,
    };

    if (startTime) body.startTime = startTime;
    if (endTime) body.endTime = endTime;

    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // fundingHistory might not be available for all coins
      console.log(`No funding history available for ${coin}`);
      return [];
    }

    const data = await response.json();
    
    // Check if data is an array
    if (!Array.isArray(data)) {
      return [];
    }
    
    return data.map((item: any) => ({
      time: item.time,
      coin: item.coin,
      fundingRate: item.fundingRate,
      markPrice: item.markPrice || "0",
      indexPrice: item.indexPrice || "0",
    }));
  } catch (error) {
    console.error("Error fetching funding history:", error);
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

// 将资金费率转换为年化（Hyperliquid 每8小时结算一次）
export function toAnnualizedRate(rate: string | number): number {
  const rateNum = typeof rate === "string" ? parseFloat(rate) : rate;
  return rateNum * FUNDING_PERIODS_PER_YEAR;
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
