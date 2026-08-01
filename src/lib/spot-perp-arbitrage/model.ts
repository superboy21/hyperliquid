import type { SearchExchangeRate } from "../search";
import type { SpotMarketRow } from "../spot-search";

declare const marketIdBrand: unique symbol;

/** Stable, kind-qualified identity. Callers must treat the encoded value as opaque. */
export type ArbitrageMarketId = string & { readonly [marketIdBrand]: true };

export interface PerpMarket {
  kind: "perp";
  source: SearchExchangeRate;
}

export interface SpotMarket {
  kind: "spot";
  source: SpotMarketRow;
}

export type ArbitrageMarket = PerpMarket | SpotMarket;

export interface MarketTableDetail {
  historicalVolatility?: number | null;
  topSpread?: number | null;
  impactSpread?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  lastSettlementRate?: number | null;
  avgFundingRate2d?: number | null;
  avgFundingRate7d?: number | null;
  avgFundingRate30d?: number | null;
}

/** The 15 data cells used by the Perp-shaped unified table. */
export interface ArbitrageTableRow {
  id: ArbitrageMarketId;
  market: ArbitrageMarket;
  exchange: string;
  pair: string;
  midpoint: number | null;
  indexPrice: number | null;
  change24h: number | null;
  premium: number | null;
  predictedFundingRate: number | null;
  quoteTurnover24h: number | null;
  openInterestNotional: number | null;
  historicalVolatility: number | null;
  topSpread: number | null;
  impactSpread: number | null;
  latestSettlementRate: number | null;
  averageFundingRate2d: number | null;
  averageFundingRate7d: number | null;
  averageFundingRate30d: number | null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const valueOrNull = finite(value);
  return valueOrNull !== null && valueOrNull > 0 ? valueOrNull : null;
}

function bboMidpoint(
  detail: Pick<MarketTableDetail, "bestBid" | "bestAsk">,
  source: { bestBid?: number; bestAsk?: number },
): number | null {
  const detailBid = positive(detail.bestBid);
  const detailAsk = positive(detail.bestAsk);
  if (detailBid !== null && detailAsk !== null) return (detailBid + detailAsk) / 2;
  const sourceBid = positive(source.bestBid);
  const sourceAsk = positive(source.bestAsk);
  return sourceBid !== null && sourceAsk !== null ? (sourceBid + sourceAsk) / 2 : null;
}

function encode(value: string | number): string {
  return encodeURIComponent(String(value));
}

export function asPerpMarket(source: SearchExchangeRate): PerpMarket {
  return { kind: "perp", source };
}

export function asSpotMarket(source: SpotMarketRow): SpotMarket {
  return { kind: "spot", source };
}

export function marketId(market: ArbitrageMarket): ArbitrageMarketId {
  if (market.kind === "spot") {
    return `spot:${encode(market.source.exchange)}:${encode(market.source.marketKey)}` as ArbitrageMarketId;
  }
  const source = market.source;
  const transportIdentity = source.rawSymbol ?? source.marketId ?? source.symbol;
  return `perp:${encode(source.exchange)}:${encode(transportIdentity)}` as ArbitrageMarketId;
}

export function marketDisplaySymbol(market: ArbitrageMarket): string {
  return market.kind === "spot" ? market.source.pair : market.source.symbol;
}

export function toTableRow(
  market: ArbitrageMarket,
  detail: MarketTableDetail = {},
): ArbitrageTableRow {
  if (market.kind === "spot") {
    const source = market.source;
    const detailMidpoint = bboMidpoint(detail, {});
    return {
      id: marketId(market),
      market,
      exchange: source.exchange,
      pair: source.pair,
      midpoint: detailMidpoint ?? finite(source.midPrice),
      indexPrice: null,
      change24h: finite(source.change24h),
      premium: null,
      predictedFundingRate: null,
      quoteTurnover24h: finite(source.quoteVolume),
      openInterestNotional: null,
      historicalVolatility: finite(detail.historicalVolatility),
      topSpread: finite(detail.topSpread),
      impactSpread: finite(detail.impactSpread),
      latestSettlementRate: null,
      averageFundingRate2d: null,
      averageFundingRate7d: null,
      averageFundingRate30d: null,
    };
  }

  const source = market.source;
  const midpoint = bboMidpoint(detail, source);
  const indexPrice = positive(source.indexPrice);
  const premium = indexPrice !== null && midpoint !== null
    ? midpoint / indexPrice - 1
    : null;

  return {
    id: marketId(market),
    market,
    exchange: source.exchange,
    pair: source.symbol,
    midpoint,
    indexPrice,
    change24h: finite(source.change24h),
    premium,
    predictedFundingRate: finite(source.fundingRate),
    quoteTurnover24h: finite(source.quoteVolume),
    openInterestNotional: finite(source.notionalValue),
    historicalVolatility: finite(detail.historicalVolatility) ?? finite(source.historicalVolatility),
    topSpread: finite(detail.topSpread) ?? finite(source.bidAskSpread),
    impactSpread: finite(detail.impactSpread),
    latestSettlementRate: finite(detail.lastSettlementRate) ?? finite(source.lastSettlementRate),
    averageFundingRate2d: finite(detail.avgFundingRate2d) ?? finite(source.avgFundingRate2d),
    averageFundingRate7d: finite(detail.avgFundingRate7d) ?? finite(source.avgFundingRate7d),
    averageFundingRate30d: finite(detail.avgFundingRate30d) ?? finite(source.avgFundingRate30d),
  };
}
