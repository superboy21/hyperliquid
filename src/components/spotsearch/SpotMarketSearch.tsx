"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type SpotDetailResult,
  type SpotMarketRow,
  fetchAllSpotMarkets,
  fetchSpotDetail,
  filterSpotMarkets,
  spotMarketIdentity as spotMarketKey,
} from "@/lib/spot-search";
import {
  type SpotCandlePoint,
  type SpotCandleResult,
  type SpotChartInterval,
  fetchSpotCandles,
} from "@/lib/spot-search-candles";
import {
  SPOT_IMPACT_PRESETS,
  type SpotImpactResult,
  fetchSpotImpactSpread,
} from "@/lib/spot-impact-price";
import { type ImpactDepthMode } from "@/lib/order-book-impact";
import SpotSearchCandlesChart from "./SpotSearchCandlesChart";

type SortField = "market" | "midPrice" | "change24h" | "turnover24h" | "volatility" | "spread";
type SpreadMode = "top" | "impact";
type ChartRange = "all" | "1y" | "6m" | "1m" | "1d" | "4h";
type QuoteFilter = "USDT" | "USDC" | "U" | "USD1" | "USD" | "all";
type UnknownRecord = Record<string, unknown>;

const RANGE_MS: Record<ChartRange, number | null> = {
  all: null,
  "1y": 365 * 24 * 60 * 60 * 1000,
  "6m": 183 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

const EXCHANGE_COLORS: Record<string, string> = {
  Hyperliquid: "bg-blue-400",
  "Gate.io": "bg-cyan-400",
  Binance: "bg-yellow-400",
  Lighter: "bg-purple-400",
  OKX: "bg-emerald-400",
  Bitget: "bg-teal-400",
  Bybit: "bg-orange-400",
};

const EXPECTED_EXCHANGES = ["Hyperliquid", "Gate.io", "Binance", "Lighter", "OKX", "Bitget"] as const;
const QUOTE_FILTERS: ReadonlyArray<{ value: QuoteFilter; label: string }> = [
  { value: "USDT", label: "USDT" },
  { value: "USDC", label: "USDC" },
  { value: "U", label: "U" },
  { value: "USD1", label: "USD1" },
  { value: "USD", label: "USD" },
  { value: "all", label: "全部" },
];

const IMPACT_PRESETS = SPOT_IMPACT_PRESETS as readonly number[];
const DEFAULT_IMPACT_NOTIONAL = IMPACT_PRESETS.find((value) => value === 1000) ?? IMPACT_PRESETS[0] ?? 1000;

function recordOf(value: unknown): UnknownRecord {
  return value as UnknownRecord;
}

function textFrom(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function marketExchange(market: SpotMarketRow): string {
  return textFrom(recordOf(market).exchange, "未知交易所");
}

function marketSymbol(market: SpotMarketRow): string {
  const record = recordOf(market);
  return textFrom(record.symbol, textFrom(record.pair, "--"));
}

function marketCurrencies(market: SpotMarketRow): { base: string; quote: string } {
  const record = recordOf(market);
  const symbol = marketSymbol(market);
  const [symbolBase = symbol, symbolQuote = ""] = symbol.split(/[\/-]/);
  return {
    base: textFrom(record.baseCurrency, textFrom(record.base, symbolBase)),
    quote: textFrom(record.quoteCurrency, textFrom(record.quote, symbolQuote)),
  };
}

function bbo(value: SpotMarketRow | SpotDetailResult | undefined): { bid: number | null; ask: number | null } {
  if (!value) return { bid: null, ask: null };
  const record = recordOf(value);
  return {
    bid: numberFrom(record.bestBid ?? record.bid),
    ask: numberFrom(record.bestAsk ?? record.ask),
  };
}

function midpointFromBbo(value: SpotMarketRow | SpotDetailResult | undefined): number | null {
  const { bid, ask } = bbo(value);
  return bid != null && ask != null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
}

function displayMidpoint(market: SpotMarketRow, detail?: SpotDetailResult): number | null {
  return midpointFromBbo(detail) ?? midpointFromBbo(market) ?? numberFrom(recordOf(market).midPrice);
}

function topSpread(detail?: SpotDetailResult): number | null {
  const { bid, ask } = bbo(detail);
  if (bid == null || ask == null || bid <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 100 : null;
}

function marketChange(market: SpotMarketRow): number | null {
  const record = recordOf(market);
  return numberFrom(record.change24h ?? record.priceChangePercent24h ?? record.changePercent24h);
}

function marketTurnover(market: SpotMarketRow): number | null {
  const record = recordOf(market);
  return numberFrom(record.quoteTurnover24h ?? record.turnover24h ?? record.quoteVolume ?? record.volume24h);
}

function detailVolatility(detail?: SpotDetailResult): number | null {
  if (!detail) return null;
  const record = recordOf(detail);
  return numberFrom(record.historicalVolatility ?? record.volatility);
}

function candleTime(candle: SpotCandlePoint): number {
  const record = recordOf(candle);
  return numberFrom(record.openTime ?? record.time ?? record.timestamp) ?? 0;
}

function candlesFrom(result: SpotCandleResult): SpotCandlePoint[] {
  const value = recordOf(result).candles;
  return Array.isArray(value) ? value as SpotCandlePoint[] : [];
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 10_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(2);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function impactValue(result: SpotImpactResult | undefined): number | "insufficient" | "error" | null {
  if (result === undefined) return null;
  if (typeof result === "number") return Number.isFinite(result) ? result : "error";
  if (result === null) return "error";
  return "insufficient";
}

export default function SpotMarketSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("USDT");
  const [markets, setMarkets] = useState<SpotMarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [sort, setSort] = useState<{ field: SortField; descending: boolean }>({ field: "turnover24h", descending: true });
  const [details, setDetails] = useState<Map<string, SpotDetailResult>>(new Map());
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Set<string>>(new Set());
  const [spreadMode, setSpreadMode] = useState<SpreadMode>("top");
  const [impactNotional, setImpactNotional] = useState(DEFAULT_IMPACT_NOTIONAL);
  const [impactDepthMode, setImpactDepthMode] = useState<ImpactDepthMode>("standard");
  const [customNotional, setCustomNotional] = useState("");
  const [showCustomNotional, setShowCustomNotional] = useState(false);
  const [impactResults, setImpactResults] = useState<Map<string, SpotImpactResult>>(new Map());
  const [impactLoading, setImpactLoading] = useState<Set<string>>(new Set());
  const [impactErrors, setImpactErrors] = useState<Set<string>>(new Set());

  const [selectedMarket, setSelectedMarket] = useState<SpotMarketRow | null>(null);
  const [chartInterval, setChartInterval] = useState<SpotChartInterval>("1d" as SpotChartInterval);
  const [chartRange, setChartRange] = useState<ChartRange>("1y");
  const [candles, setCandles] = useState<SpotCandlePoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartRetry, setChartRetry] = useState(0);
  const [showBaseVolume, setShowBaseVolume] = useState(false);

  const detailAbortRef = useRef<AbortController | null>(null);
  const impactAbortRef = useRef<AbortController | null>(null);
  const chartAbortRef = useRef<AbortController | null>(null);
  const chartPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    detailAbortRef.current?.abort();
    impactAbortRef.current?.abort();
    setDetailLoading(new Set());
    setImpactLoading(new Set());
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 500);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchAllSpotMarkets()
      .then((result) => {
        if (!cancelled) setMarkets(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "现货市场数据暂时不可用");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadVersion]);

  const searchSettled = query.trim() === debouncedQuery;
  const quoteFilteredMarkets = useMemo(
    () => quoteFilter === "all"
      ? markets
      : markets.filter((market) => market.quoteAsset.toUpperCase() === quoteFilter),
    [markets, quoteFilter],
  );
  const matchedMarkets = useMemo(
    () => debouncedQuery ? filterSpotMarkets(quoteFilteredMarkets, debouncedQuery) : quoteFilteredMarkets,
    [debouncedQuery, quoteFilteredMarkets],
  );
  const visibleMarkets = query.trim() ? matchedMarkets : quoteFilteredMarkets;
  const hasMatchedSearch = searchSettled && debouncedQuery.length > 0 && matchedMarkets.length > 0;
  const unavailableExchanges = useMemo(() => {
    const available = new Set(markets.map(marketExchange));
    return EXPECTED_EXCHANGES.filter((exchange) => !available.has(exchange));
  }, [markets]);

  useEffect(() => {
    detailAbortRef.current?.abort();
    setDetails(new Map());
    setDetailErrors(new Set());

    if (!hasMatchedSearch) {
      setDetailLoading(new Set());
      return;
    }

    const controller = new AbortController();
    detailAbortRef.current = controller;
    const rows = matchedMarkets;
    setDetailLoading(new Set(rows.map((market) => spotMarketKey(market))));
    let cursor = 0;

    const worker = async () => {
      while (cursor < rows.length && !controller.signal.aborted) {
        const market = rows[cursor++];
        const key = spotMarketKey(market);
        try {
          const detail = await fetchSpotDetail(market, controller.signal);
          if (!controller.signal.aborted) {
            setDetails((previous) => new Map(previous).set(key, detail));
          }
        } catch (error) {
          if (!controller.signal.aborted && !isAbortError(error)) {
            setDetailErrors((previous) => new Set(previous).add(key));
          }
        } finally {
          if (!controller.signal.aborted) {
            setDetailLoading((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            });
          }
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(3, rows.length) }, () => worker()));
    return () => controller.abort();
  }, [hasMatchedSearch, matchedMarkets]);

  useEffect(() => {
    impactAbortRef.current?.abort();
    setImpactResults(new Map());
    setImpactErrors(new Set());

    if (spreadMode !== "impact" || !hasMatchedSearch) {
      setImpactLoading(new Set());
      return;
    }

    const controller = new AbortController();
    impactAbortRef.current = controller;
    const rows = matchedMarkets;
    setImpactLoading(new Set(rows.map((market) => spotMarketKey(market))));
    let cursor = 0;

    const worker = async () => {
      while (cursor < rows.length && !controller.signal.aborted) {
        const market = rows[cursor++];
        const key = spotMarketKey(market);
        try {
          const result = await fetchSpotImpactSpread(market, impactNotional, controller.signal, impactDepthMode);
          if (!controller.signal.aborted) setImpactResults((previous) => new Map(previous).set(key, result));
        } catch (error) {
          if (!controller.signal.aborted && !isAbortError(error)) {
            setImpactErrors((previous) => new Set(previous).add(key));
          }
        } finally {
          if (!controller.signal.aborted) {
            setImpactLoading((previous) => {
              const next = new Set(previous);
              next.delete(key);
              return next;
            });
          }
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(2, rows.length) }, () => worker()));
    return () => controller.abort();
  }, [hasMatchedSearch, impactDepthMode, impactNotional, matchedMarkets, spreadMode]);

  useEffect(() => {
    setSelectedMarket(null);
    setCandles([]);
    setChartError(null);
    chartAbortRef.current?.abort();
  }, [query, quoteFilter]);

  useEffect(() => {
    if (!selectedMarket) return;
    chartAbortRef.current?.abort();
    const controller = new AbortController();
    chartAbortRef.current = controller;
    setChartLoading(true);
    setChartError(null);
    setCandles([]);

    void fetchSpotCandles(selectedMarket, chartInterval, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCandles(candlesFrom(result));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setChartError(error instanceof Error ? error.message : "K线数据加载失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setChartLoading(false);
      });

    return () => controller.abort();
  }, [chartInterval, chartRetry, selectedMarket]);

  useEffect(() => () => {
    detailAbortRef.current?.abort();
    impactAbortRef.current?.abort();
    chartAbortRef.current?.abort();
  }, []);

  const spreadFor = useCallback((market: SpotMarketRow): number | null => {
    const key = spotMarketKey(market);
    if (spreadMode === "top") return topSpread(details.get(key));
    const value = impactValue(impactResults.get(key));
    return typeof value === "number" ? value : null;
  }, [details, impactResults, spreadMode]);

  const sortedMarkets = useMemo(() => {
    const rows = [...visibleMarkets];
    rows.sort((first, second) => {
      const firstKey = spotMarketKey(first);
      const secondKey = spotMarketKey(second);
      const value = (market: SpotMarketRow, key: string): number | string => {
        switch (sort.field) {
          case "market": return `${marketExchange(market)} ${marketSymbol(market)}`;
          case "midPrice": return displayMidpoint(market, details.get(key)) ?? Number.NEGATIVE_INFINITY;
          case "change24h": return marketChange(market) ?? Number.NEGATIVE_INFINITY;
          case "turnover24h": return marketTurnover(market) ?? Number.NEGATIVE_INFINITY;
          case "volatility": return detailVolatility(details.get(key)) ?? Number.NEGATIVE_INFINITY;
          case "spread": return spreadFor(market) ?? Number.NEGATIVE_INFINITY;
        }
      };
      const a = value(first, firstKey);
      const b = value(second, secondKey);
      const comparison = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
      return sort.descending ? -comparison : comparison;
    });
    return rows;
  }, [details, sort, spreadFor, visibleMarkets]);

  const filteredCandles = useMemo(() => {
    const duration = RANGE_MS[chartRange];
    if (!duration) return candles;
    const cutoff = Date.now() - duration;
    return candles.filter((candle) => candleTime(candle) >= cutoff);
  }, [candles, chartRange]);

  const handleSort = (field: SortField) => {
    setSort((previous) => ({ field, descending: previous.field === field ? !previous.descending : true }));
  };

  const chooseMarket = (market: SpotMarketRow) => {
    const selected = selectedMarket && spotMarketKey(selectedMarket) === spotMarketKey(market);
    if (selected) {
      chartAbortRef.current?.abort();
      setSelectedMarket(null);
      setCandles([]);
      return;
    }
    setSelectedMarket(market);
    window.setTimeout(() => chartPanelRef.current?.focus(), 0);
  };

  const applyCustomNotional = () => {
    const value = Number(customNotional);
    if (!Number.isFinite(value) || value <= 0) return;
    setImpactNotional(value);
    setShowCustomNotional(false);
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span aria-hidden="true" className={`ml-1 ${sort.field === field ? "text-gray-300" : "text-gray-600"}`}>
      {sort.field === field ? (sort.descending ? "↓" : "↑") : "↕"}
    </span>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-b-emerald-400" />
          <p className="text-gray-400">正在汇总现货市场...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/20 p-6 text-center" role="alert">
        <p className="text-red-300">现货市场加载失败：{loadError}</p>
        <button type="button" onClick={() => setLoadVersion((value) => value + 1)} className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label htmlFor="spot-quote-filter" className="flex shrink-0 flex-col gap-1 text-[11px] font-medium text-gray-400">
            报价币
            <select
              id="spot-quote-filter"
              value={quoteFilter}
              onChange={(event) => setQuoteFilter(event.target.value as QuoteFilter)}
              className="h-[46px] min-w-28 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm font-medium text-gray-200 outline-none transition-colors hover:border-gray-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              {QUOTE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="min-w-0 flex-1">
            <label htmlFor="spot-market-search" className="sr-only">搜索现货交易对</label>
            <div className="relative">
              <svg aria-hidden="true" className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id="spot-market-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入币种或交易对，例如 BTC、ETH、SOL/USDT..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-3 pl-10 pr-11 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-gray-500 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
                  <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500" aria-live="polite">
          <span>{query.trim() ? `找到 ${visibleMarkets.length} 个现货市场` : `共 ${quoteFilteredMarkets.length} 个现货市场`}</span>
          {!searchSettled && <span className="text-gray-400">正在筛选...</span>}
          {detailLoading.size > 0 && <span className="flex items-center gap-1.5"><span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-b-emerald-400" />正在补充详情（{detailLoading.size}）</span>}
          {unavailableExchanges.length > 0 && markets.length > 0 && <span className="text-amber-400">部分数据源暂不可用：{unavailableExchanges.join("、")}</span>}
          {detailErrors.size > 0 && <span className="text-amber-400">{detailErrors.size} 个市场详情暂不可用</span>}
          {impactErrors.size > 0 && spreadMode === "impact" && <span className="text-amber-400">{impactErrors.size} 个深度请求失败</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
        <table className="w-full min-w-[860px] table-fixed">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800">
              <th className="sticky left-0 z-20 w-[220px] bg-gray-800 px-4 py-3 text-left text-[11px] font-medium text-gray-400 shadow-[1px_0_0_#374151]">
                <button type="button" onClick={() => handleSort("market")} className="flex items-center hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">交易所交易对<SortIcon field="market" /></button>
              </th>
              <th className="w-[130px] px-3 py-3 text-right text-[11px] font-medium text-gray-400"><button type="button" onClick={() => handleSort("midPrice")} className="ml-auto flex items-center hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">中间价<SortIcon field="midPrice" /></button></th>
              <th className="w-[125px] px-3 py-3 text-right text-[11px] font-medium text-gray-400"><button type="button" onClick={() => handleSort("change24h")} className="ml-auto flex items-center hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">24小时涨跌<SortIcon field="change24h" /></button></th>
              <th className="w-[155px] px-3 py-3 text-right text-[11px] font-medium text-gray-400"><button type="button" onClick={() => handleSort("turnover24h")} className="ml-auto flex items-center hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">24小时成交额<SortIcon field="turnover24h" /></button></th>
              <th className="w-[135px] px-3 py-3 text-right text-[11px] font-medium text-gray-400"><button type="button" onClick={() => handleSort("volatility")} className="ml-auto flex items-center hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">历史波动率<SortIcon field="volatility" /></button></th>
              <th className="w-[210px] px-3 py-2 text-right text-[11px] font-medium text-gray-400">
                <div className="flex items-center justify-end gap-1.5">
                  <div className="inline-flex rounded border border-gray-600 bg-gray-900/60 p-0.5" aria-label="价差类型">
                    {(["top", "impact"] as SpreadMode[]).map((mode) => (
                      <button key={mode} type="button" aria-pressed={spreadMode === mode} onClick={() => setSpreadMode(mode)} className={`rounded px-1.5 py-0.5 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${spreadMode === mode ? (mode === "top" ? "bg-blue-500/25 text-blue-300" : "bg-orange-500/25 text-orange-300") : "text-gray-500 hover:text-gray-300"}`}>{mode === "top" ? "Top" : "Impact"}</button>
                    ))}
                  </div>
                  <button type="button" onClick={() => handleSort("spread")} className="flex items-center whitespace-nowrap hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">买卖价差<SortIcon field="spread" /></button>
                </div>
                {spreadMode === "impact" && (
                  <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
                    <span className="text-[9px] font-normal text-gray-500">报价币名义金额</span>
                    {!showCustomNotional ? (
                      <select value={IMPACT_PRESETS.includes(impactNotional) ? String(impactNotional) : "custom-value"} onChange={(event) => { if (event.target.value === "custom") { setCustomNotional(String(impactNotional)); setShowCustomNotional(true); } else { setImpactNotional(Number(event.target.value)); } }} aria-label="报价币名义金额" className="rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-[9px] text-gray-300 focus:border-emerald-500 focus:outline-none">
                        {IMPACT_PRESETS.map((value) => <option key={value} value={value}>{value}</option>)}
                        {!IMPACT_PRESETS.includes(impactNotional) && <option value="custom-value">{impactNotional}</option>}
                        <option value="custom">自定义</option>
                      </select>
                    ) : (
                      <form onSubmit={(event) => { event.preventDefault(); applyCustomNotional(); }} className="flex items-center gap-1">
                        <input type="number" min="0" step="any" autoFocus value={customNotional} onChange={(event) => setCustomNotional(event.target.value)} aria-label="自定义报价币名义金额" className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-[9px] text-gray-200 focus:border-emerald-500 focus:outline-none" />
                        <button type="submit" disabled={!(Number(customNotional) > 0)} className="text-emerald-400 disabled:text-gray-600">✓</button>
                      </form>
                    )}
                  </div>
                )}
                {spreadMode === "impact" && (
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      aria-pressed={impactDepthMode === "max"}
                      onClick={() => setImpactDepthMode((current) => current === "standard" ? "max" : "standard")}
                      className={`rounded border px-1.5 py-0.5 text-[9px] font-medium transition-all active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 ${
                        impactDepthMode === "max"
                          ? "border-amber-500/60 bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.12)] hover:bg-amber-500/30"
                          : "border-gray-600 bg-gray-900/70 text-gray-400 hover:border-gray-500 hover:bg-gray-700 hover:text-gray-200"
                      }`}
                    >
                      {impactDepthMode === "max" ? "最大 REST 深度" : "标准深度 20/100"}
                    </button>
                  </div>
                )}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {sortedMarkets.map((market) => {
              const key = spotMarketKey(market);
              const detail = details.get(key);
              const selected = selectedMarket ? spotMarketKey(selectedMarket) === key : false;
              const midpoint = displayMidpoint(market, detail);
              const change = marketChange(market);
              const turnover = marketTurnover(market);
              const volatility = hasMatchedSearch ? detailVolatility(detail) : null;
              const exchange = marketExchange(market);
              const symbol = marketSymbol(market);
              const { base, quote } = marketCurrencies(market);
              const impact = impactValue(impactResults.get(key));
              const waitingForSpread = spreadMode === "impact" ? impactLoading.has(key) : detailLoading.has(key);
              return (
                <tr
                  key={key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => chooseMarket(market)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseMarket(market); } }}
                  className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${selected ? "bg-emerald-950/45" : "hover:bg-gray-700/45"}`}
                >
                  <td className={`sticky left-0 z-10 px-4 py-2.5 shadow-[1px_0_0_#374151] ${selected ? "bg-[#102f2b]" : "bg-gray-800"}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${EXCHANGE_COLORS[exchange] ?? "bg-gray-400"}`} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-white">{base}{quote ? `/${quote}` : symbol !== base ? ` · ${symbol}` : ""}</div>
                        <div className="mt-0.5 truncate text-[10px] text-gray-500">{exchange}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">{midpoint != null ? formatPrice(midpoint) : <span className="text-gray-600">--</span>}</td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${change == null ? "text-gray-600" : change > 0 ? "text-green-400" : change < 0 ? "text-red-400" : "text-gray-400"}`}>{change == null ? "--" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</td>
                  <td className="px-3 py-2.5 text-right"><span className="font-mono text-xs text-gray-400">{turnover != null ? formatCompact(turnover) : "--"}</span>{turnover != null && quote && <span className="ml-1 text-[9px] text-gray-600">{quote}</span>}</td>
                  <td className="px-3 py-2.5 text-right">
                    {!hasMatchedSearch ? <span className="text-xs text-gray-600">--</span> : detailLoading.has(key) ? <span aria-label="正在加载波动率" className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-b-emerald-400" /> : volatility != null ? <span className="font-mono text-xs text-orange-400">{volatility.toFixed(2)}%</span> : <span className="text-xs text-gray-600">--</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!hasMatchedSearch ? <span className="text-xs text-gray-600">--</span> : waitingForSpread ? <span aria-label="正在加载买卖价差" className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-b-emerald-400" /> : spreadMode === "impact" && impact === "insufficient" ? <span className="text-xs text-amber-400">深度不足</span> : spreadMode === "impact" && (impact === "error" || impactErrors.has(key)) ? <span className="text-xs text-gray-600">--</span> : spreadFor(market) != null ? <span className="font-mono text-xs text-gray-300">{spreadFor(market)?.toFixed(4)}%</span> : <span className="text-xs text-gray-600">--</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {quoteFilteredMarkets.length > 0 && sortedMarkets.length === 0 && query.trim() && searchSettled && (
          <div className="p-10 text-center" role="status"><p className="text-gray-400">没有找到“{query.trim()}”相关的现货市场</p><p className="mt-1 text-sm text-gray-600">可尝试币种简称或完整交易对</p></div>
        )}
        {markets.length === 0 && !query.trim() && (
          <div className="p-10 text-center" role="status"><p className="text-gray-400">暂未获取到现货市场</p><button type="button" onClick={() => setLoadVersion((value) => value + 1)} className="mt-3 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">重新加载</button></div>
        )}
        {markets.length > 0 && quoteFilteredMarkets.length === 0 && (
          <div className="p-10 text-center" role="status"><p className="text-gray-400">当前没有以 {quoteFilter === "all" ? "所选币种" : quoteFilter} 报价的现货市场</p><p className="mt-1 text-sm text-gray-600">请选择其他报价币或“全部”</p></div>
        )}
      </div>

      {selectedMarket && (
        <div ref={chartPanelRef} tabIndex={-1} className="mt-4 rounded-lg border border-gray-700 bg-gray-800 p-3 outline-none sm:p-4" aria-live="polite">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${EXCHANGE_COLORS[marketExchange(selectedMarket)] ?? "bg-gray-400"}`} />
              <span className="text-sm font-medium text-white">{marketExchange(selectedMarket)} {marketSymbol(selectedMarket)}</span>
              {candles.length > 0 && <span className="text-xs text-gray-500">{filteredCandles.length} 根K线</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <div className="mr-1 inline-flex rounded bg-gray-900/60 p-0.5" aria-label="成交数据类型">
                <button type="button" aria-pressed={!showBaseVolume} onClick={() => setShowBaseVolume(false)} className={`rounded px-2 py-1 text-xs ${!showBaseVolume ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-300"}`}>报价币成交额</button>
                <button type="button" aria-pressed={showBaseVolume} onClick={() => setShowBaseVolume(true)} className={`rounded px-2 py-1 text-xs ${showBaseVolume ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-300"}`}>基础币成交量</button>
              </div>
              {(String(chartInterval) === "1m" ? (["1d", "4h"] as ChartRange[]) : (["all", "1y", "6m", "1m", "1d"] as ChartRange[])).map((range) => <button type="button" key={range} onClick={() => setChartRange(range)} className={`rounded px-2 py-1 text-xs ${chartRange === range ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>{range === "all" ? "全部" : range}</button>)}
              <span className="mx-1 hidden h-5 w-px bg-gray-700 sm:block" />
              {(["1w", "1d", "4h", "1h", "5m", "1m"] as SpotChartInterval[]).map((interval) => <button type="button" key={String(interval)} onClick={() => { setChartInterval(interval); if (String(interval) === "1m" && chartRange !== "1d" && chartRange !== "4h") setChartRange("1d"); }} className={`rounded px-2 py-1 text-xs ${chartInterval === interval ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200"}`}>{String(interval)}</button>)}
              <button type="button" onClick={() => { chartAbortRef.current?.abort(); setSelectedMarket(null); setCandles([]); }} aria-label="关闭图表" className="ml-1 rounded bg-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-600 hover:text-gray-200">✕</button>
            </div>
          </div>
          {chartLoading ? (
            <div className="flex h-[440px] items-center justify-center sm:h-[520px]" role="status"><div className="text-center"><div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-gray-700 border-b-blue-400" /><p className="text-gray-400">正在加载现货K线...</p></div></div>
          ) : chartError ? (
            <div className="flex h-[440px] items-center justify-center sm:h-[520px]" role="alert"><div className="text-center"><p className="text-red-400">K线加载失败</p><p className="mt-1 max-w-md text-sm text-gray-500">{chartError}</p><button type="button" onClick={() => setChartRetry((value) => value + 1)} className="mt-4 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700">重新加载K线</button></div></div>
          ) : filteredCandles.length > 0 ? (
            <SpotSearchCandlesChart exchange={marketExchange(selectedMarket)} symbol={marketSymbol(selectedMarket)} interval={chartInterval} candles={filteredCandles} showBaseVolume={showBaseVolume} />
          ) : (
            <div className="flex h-[440px] items-center justify-center text-gray-500 sm:h-[520px]" role="status">当前周期暂无K线数据</div>
          )}
        </div>
      )}
    </div>
  );
}
