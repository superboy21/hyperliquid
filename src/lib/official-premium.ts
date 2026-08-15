// ==================== Official Premium Index Fetch ====================
// 「自适应」溢价指数数据源：优先消费各交易所官方发布的 premium 值，
// 或官方 premium K 线的最新 close，而不是从盘口自行重建（Lighter 除外，
// 它没有 REST 官方 premium 字段，需用 initial margin fraction 推导）。
//
// 各所口径（均返回小数，如 -0.0004 = -0.04%）：
//   OKX             GET /api/v5/public/funding-rate            -> premium 字段
//   Hyperliquid 原生 POST /info {"type":"metaAndAssetCtxs"}       -> premium 字段
//   Hyperliquid HIP-3 POST /info {"type":"metaAndAssetCtxs","dex"}-> premium 字段
//   Binance         GET /fapi/v1/premiumIndexKlines              -> 最新 K 线 close
//   Bitget          GET /api/v3/market/candles?type=premium      -> 最新 close
//   Bybit           GET /v5/market/premium-index-price-kline     -> 最新 close
//   Gate            GET /futures/usdt/premium_index              -> 最新 c
//   Lighter         无 REST 官方 premium，用 min_initial_margin_fraction 重建

import type { SearchExchangeRate } from "./search";
import { binanceFetch } from "./adapters/binance";
import { requestBitget } from "./adapters/bitget";
import { fetchNativeFundingSnapshot } from "./adapters/okx";
import { requestBybit } from "./adapters/bybit";
import { lighterFetch } from "./lighter";
import { fetchHyperliquidInfo } from "./hyperliquid";
import { computePremiumIndex, fetchImpactSpreadDetail } from "./impact-price";

type OfficialPremiumRate = Pick<SearchExchangeRate, "exchange" | "symbol" | "rawSymbol" | "marketId">;

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function latestClose(row: unknown, index: number): number | null {
  if (!Array.isArray(row)) return null;
  return parseOptionalNumber(row[index]);
}

// ==================== Hyperliquid ====================

interface HyperliquidPremiumMeta {
  universe?: Array<{ name?: string }>;
}

interface HyperliquidPremiumAssetContext {
  premium?: string | null;
}

async function fetchHyperliquidPremiumMap(
  dex: string | undefined,
  signal?: AbortSignal,
): Promise<Map<string, number | null>> {
  const body = dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" };
  const data = await fetchHyperliquidInfo<[HyperliquidPremiumMeta, HyperliquidPremiumAssetContext[]]>(body, 2, signal);
  const map = new Map<string, number | null>();
  if (!data) return map;
  const universe = data[0]?.universe ?? [];
  const assetCtxs = data[1] ?? [];
  universe.forEach((market, index) => {
    if (typeof market?.name !== "string" || market.name === "") return;
    map.set(market.name, parseOptionalNumber(assetCtxs[index]?.premium));
  });
  return map;
}

// ==================== Lighter（IM fraction 重建）====================

const LIGHTER_IMPACT_MARGIN_USDC = 500;
const LIGHTER_MARGIN_DENOMINATOR = 10_000;

interface LighterOrderBookDetailRow {
  market_id: number;
  min_initial_margin_fraction?: number;
  index_price?: number | string;
}

async function fetchLighterOfficialPremium(
  marketId: number | undefined,
  rawSymbol: string,
  signal?: AbortSignal,
): Promise<number | null> {
  if (marketId === undefined) return null;
  const detailsRes = await lighterFetch("orderBookDetails", "filter=perp", { signal });
  if (!detailsRes.ok) return null;
  const detailsData = (await detailsRes.json()) as { order_book_details?: LighterOrderBookDetailRow[] };
  const detail = detailsData.order_book_details?.find((row) => row.market_id === marketId);
  if (!detail) return null;

  const minImf = detail.min_initial_margin_fraction;
  const indexPrice = parseOptionalNumber(detail.index_price);
  if (minImf === undefined || minImf <= 0 || indexPrice === null) return null;

  // Impact Notional Amount = 500 USDC / Initial Margin Fraction
  //   = 500 / (min_initial_margin_fraction / 10000) = 5,000,000 / min_IMF
  const impactNotional = (LIGHTER_IMPACT_MARGIN_USDC * LIGHTER_MARGIN_DENOMINATOR) / minImf;
  const result = await fetchImpactSpreadDetail("Lighter", rawSymbol, signal, impactNotional, "max");
  if (result === null || typeof result === "string") return null;
  return computePremiumIndex(result.bidPrice, result.askPrice, indexPrice);
}

// ==================== 单所 premium 获取 ====================

async function fetchBinancePremium(rawSymbol: string, signal?: AbortSignal): Promise<number | null> {
  const response = await binanceFetch(
    "premiumIndexKlines",
    `symbol=${encodeURIComponent(rawSymbol)}&interval=1m&limit=1`,
    { signal },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as unknown[];
  return latestClose(rows[0], 4);
}

async function fetchBitgetPremium(rawSymbol: string, signal?: AbortSignal): Promise<number | null> {
  const payload = await requestBitget(
    "candles",
    { symbol: rawSymbol, interval: "1m", type: "premium", limit: "1" },
    signal,
  );
  const rows = Array.isArray(payload) ? payload : [];
  return latestClose(rows[0], 4);
}

async function fetchBybitPremium(rawSymbol: string, signal?: AbortSignal): Promise<number | null> {
  const payload = (await requestBybit(
    "premium-index-price-kline",
    { symbol: rawSymbol, interval: "1", limit: "1" },
    signal,
  )) as { list?: unknown[] } | null;
  return latestClose(payload?.list?.[0], 4);
}

async function fetchGatePremium(rawSymbol: string, signal?: AbortSignal): Promise<number | null> {
  const response = await fetch(
    `/api/gate/futures/usdt/premium_index?contract=${encodeURIComponent(rawSymbol)}&limit=1`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ c?: string }>;
  return parseOptionalNumber(rows?.[0]?.c);
}

// ==================== 预取上下文（全量端点只请求一次）====================

export interface OfficialPremiumContext {
  hyperliquidNative: Map<string, number | null>;
  hyperliquidHip3: Map<string, number | null>;
  okx: Map<string, number | null>;
}

export async function prefetchOfficialPremiumContext(signal?: AbortSignal): Promise<OfficialPremiumContext> {
  const [native, xyz, para, hyna, okxSnapshot] = await Promise.allSettled([
    fetchHyperliquidPremiumMap(undefined, signal),
    fetchHyperliquidPremiumMap("xyz", signal),
    fetchHyperliquidPremiumMap("para", signal),
    fetchHyperliquidPremiumMap("hyna", signal),
    fetchNativeFundingSnapshot(signal),
  ]);

  const hyperliquidNative = new Map<string, number | null>();
  if (native.status === "fulfilled") {
    for (const [coin, premium] of native.value) hyperliquidNative.set(coin, premium);
  }

  const hyperliquidHip3 = new Map<string, number | null>();
  for (const result of [xyz, para, hyna]) {
    if (result.status === "fulfilled") {
      for (const [coin, premium] of result.value) hyperliquidHip3.set(coin, premium);
    }
  }

  const okx = new Map<string, number | null>();
  if (okxSnapshot.status === "fulfilled") {
    for (const [instId, entry] of okxSnapshot.value) okx.set(instId, parseOptionalNumber(entry.premium));
  }

  return { hyperliquidNative, hyperliquidHip3, okx };
}

// ==================== 统一入口 ====================

export async function fetchOfficialPremium(
  rate: OfficialPremiumRate,
  signal: AbortSignal | undefined,
  ctx: OfficialPremiumContext,
): Promise<number | null> {
  const rawSymbol = rate.rawSymbol ?? rate.symbol;
  try {
    switch (rate.exchange) {
      case "OKX":
        return ctx.okx.get(rawSymbol) ?? null;
      case "Hyperliquid": {
        const hip3 = rawSymbol.includes(":");
        const map = hip3 ? ctx.hyperliquidHip3 : ctx.hyperliquidNative;
        return map.get(rawSymbol) ?? null;
      }
      case "Binance":
        return await fetchBinancePremium(rawSymbol, signal);
      case "Bitget":
        return await fetchBitgetPremium(rawSymbol, signal);
      case "Bybit":
        return await fetchBybitPremium(rawSymbol, signal);
      case "Gate.io":
        return await fetchGatePremium(rawSymbol, signal);
      case "Lighter":
        return await fetchLighterOfficialPremium(rate.marketId, rawSymbol, signal);
      default:
        return null;
    }
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn(`[official-premium] fetch failed for ${rate.exchange} ${rawSymbol}:`, error);
    return null;
  }
}
