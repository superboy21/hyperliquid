// Hyperliquid API 服务

export interface FundingRate {
  coin: string;
  fundingRate: string;
  markPrice: string;
  indexPrice: string;
  premium: string;
  openInterest: string;
  dayVolume: string;
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

interface MetaAndAssetCtxs {
  universe: MarketInfo[];
  assetCtxs: AssetContext[];
}

// 获取所有市场的资金费率
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
      };
    });
  } catch (error) {
    console.error("Error fetching funding rates:", error);
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

// 格式化资金费率为百分比
export function formatFundingRate(rate: string): string {
  const rateNum = parseFloat(rate);
  return (rateNum * 100).toFixed(4) + "%";
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
