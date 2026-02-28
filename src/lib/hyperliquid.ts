// Hyperliquid API 服务

export interface FundingRate {
  coin: string;
  fundingRate: string;
  nextFundingTime: number;
  premium: string;
  markPrice: string;
  indexPrice: string;
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

// 获取所有市场的资金费率
export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });

    if (!response.ok) throw new Error("Failed to fetch funding rates");

    const mids = await response.json();
    
    // 获取资金费率数据
    const fundingResponse = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "fundingRates" }),
    });

    if (!fundingResponse.ok) throw new Error("Failed to fetch funding rates");

    const fundingData = await fundingResponse.json();
    
    return fundingData.map((item: any) => ({
      coin: item.coin,
      fundingRate: item.fundingRate,
      nextFundingTime: item.nextFundingTime,
      premium: item.premium || "0",
      markPrice: mids[item.coin] || "0",
      indexPrice: item.indexPrice || mids[item.coin] || "0",
    }));
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

    if (!response.ok) throw new Error("Failed to fetch funding history");

    const data = await response.json();
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
  return priceNum.toFixed(decimals);
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
