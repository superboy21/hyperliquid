import ccxt from "ccxt";
import { NextRequest, NextResponse } from "next/server";
import type { CanonicalFundingRateRow } from "@/lib/types";

export const runtime = "nodejs";

type GateIoExchange = InstanceType<typeof ccxt.gateio>;
type GateFundingRateEntry = {
  symbol?: string;
  info?: {
    name?: string;
    mark_price?: string;
    index_price?: string;
    funding_rate?: string;
    funding_interval?: number | string;
    total_size?: string;
    quanto_multiplier?: string;
  };
  fundingRate?: number | string | null;
  markPrice?: number | string | null;
  indexPrice?: number | string | null;
};

type GateTickerEntry = {
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
  percentage?: number | null;
  quoteVolume?: number | null;
};

let exchangePromise: Promise<GateIoExchange> | null = null;

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function createExchange(): Promise<GateIoExchange> {
  if (!exchangePromise) {
    exchangePromise = (async () => {
      const exchange = new ccxt.gateio({
        enableRateLimit: true,
        options: { defaultType: "swap" },
      });
      await exchange.loadMarkets();
      return exchange;
    })();
  }

  return exchangePromise;
}

async function getListRows(): Promise<CanonicalFundingRateRow[]> {
  const exchange = await createExchange();
  const fundingRates = (await exchange.fetchFundingRates()) as Record<string, GateFundingRateEntry>;
  const entries = Object.values(fundingRates).filter((entry) => entry.symbol?.endsWith("/USDT:USDT") && entry.info?.name);
  const symbols = entries.map((entry) => entry.symbol as string);
  const tickers = (await exchange.fetchTickers(symbols)) as Record<string, GateTickerEntry>;

  return entries.map((entry) => {
    const unifiedSymbol = entry.symbol as string;
    const rawContract = entry.info?.name as string;
    const symbol = rawContract.replace(/_USDT$/i, "");
    const ticker = tickers[unifiedSymbol];
    const markPrice = toNumber(entry.markPrice ?? entry.info?.mark_price);
    const openInterestContracts = toNumber(entry.info?.total_size);
    const multiplier = toNumber(entry.info?.quanto_multiplier) || 1;

    return {
      exchange: "gateio",
      transportMode: "ccxt",
      symbol,
      rawSymbol: rawContract,
      marketKey: unifiedSymbol,
      fundingRate: toNumber(entry.fundingRate ?? entry.info?.funding_rate),
      predictedFundingRate: null,
      lastSettlementRate: null,
      markPrice,
      indexPrice: toNumber(entry.indexPrice ?? entry.info?.index_price),
      lastPrice: ticker?.last ?? markPrice,
      change24h: ticker?.percentage ?? 0,
      quoteVolume: ticker?.quoteVolume ?? 0,
      openInterest: openInterestContracts,
      notionalValue: openInterestContracts * multiplier * markPrice,
      fundingIntervalSeconds: toNumber(entry.info?.funding_interval) || 28800,
      assetCategory: "其他",
      bestBid: ticker?.bid ?? null,
      bestAsk: ticker?.ask ?? null,
    } satisfies CanonicalFundingRateRow;
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "list";

  try {
    if (mode !== "list") {
      return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
    }

    return NextResponse.json(await getListRows());
  } catch (error) {
    console.error("[Gate CCXT] Route error:", error);
    return NextResponse.json({ error: "Failed to fetch Gate CCXT data" }, { status: 500 });
  }
}
