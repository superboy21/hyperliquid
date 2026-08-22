"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAllRates,
  fetchDetailForSymbol,
  hydrateSearchBinanceOpenInterest,
  partitionProgressiveDetailRates,
  type DetailResult,
  type SearchExchangeRate,
} from "@/lib/search";
import {
  fetchAllSpotMarkets,
  fetchSpotDetail,
  type SpotDetailResult,
  type SpotMarketRow,
} from "@/lib/spot-search";
import {
  DEFAULT_IMPACT_NOTIONAL,
  IMPACT_NOTIONAL_PRESETS,
  DEFAULT_PREMIUM_INDEX_NOTIONAL,
  PREMIUM_INDEX_NOTIONAL_PRESETS,
  computePremiumIndex,
  fetchSearchImpactSpreadDetail,
  type ImpactSpreadDetailResult,
} from "@/lib/impact-price";
import { fetchSpotImpactSpreadDetail } from "@/lib/spot-impact-price";
import { fetchOfficialPremium, prefetchOfficialPremiumContext } from "@/lib/official-premium";
import { DETAIL_LANE_PROFILE } from "@/lib/search-detail-lanes";
import type { SearchCandleResult, SearchChartInterval } from "@/lib/search-candles";
import type { SpotCandleResult } from "@/lib/spot-search-candles";
import type { ComboCandleResult } from "@/lib/combo";
import {
  DEFAULT_SPOT_QUOTE_FILTER,
  EMPTY_SELECTION,
  SPOT_QUOTE_FILTERS,
  asPerpMarket,
  asSpotMarket,
  applyBinanceOpenInterestHydration,
  combineLoadedLegs,
  filterAlignedRange,
  loadMarketCandles,
  marketDisplaySymbol,
  marketId,
  searchArbitrageMarkets,
  selectPendingBinanceOpenInterestTargets,
  toTableRow,
  transitionSelection,
  type ArbitrageChartRange,
  type ArbitrageExchange,
  type ArbitrageMarket,
  type LoadedLeg,
  type MarketTableDetail,
  type OrderedSelection,
  type SpotContainingCombinationResult,
  type SpotQuoteFilter,
  type MarketKindFilter,
} from "@/lib/spot-perp-arbitrage";
import { filterInChartTimeSelection, filterTimedInChartTimeSelection, type ChartTimeSelection } from "@/lib/spot-perp-arbitrage/chart-time-selection";
import { createChartRequestWindow } from "@/lib/chart-request-window";
import SearchCandlesChart from "@/components/search/SearchCandlesChart";
import ComboSearchCandlesChart from "@/components/search/ComboSearchCandlesChart";
import SpotSearchCandlesChart from "@/components/spot-perp-arbitrage/SpotSearchCandlesChart";
import ArbitrageMarketTable from "./ArbitrageMarketTable";
import SpotContainingCombinationChart from "./SpotContainingCombinationChart";
import MixedAnalyticsDashboard from "./MixedAnalyticsDashboard";
import SingleMarketAnalyticsDashboard from "./SingleMarketAnalyticsDashboard";

type UniverseState = "loading" | "ready" | "error";
type SpreadMode = "top" | "impact";
type PremiumIndexMode = "adaptive" | "manual";
type ChartPayload =
  | { kind: "single"; leg: LoadedLeg }
  | { kind: "perp-combo"; result: ComboCandleResult }
  | { kind: "spot-combo"; result: SpotContainingCombinationResult };

const SINGLE_RANGE_MS: Record<ArbitrageChartRange, number | null> = {
  all: null,
  "3y": 3 * 365 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  "6m": 183 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

const QUOTE_LABELS: Record<SpotQuoteFilter, string> = {
  USDT: "USDT",
  USDC: "USDC",
  U: "U",
  USD1: "USD1",
  USD: "USD",
  all: "全部",
};

const ALL_EXCHANGES: ArbitrageExchange[] = ["Hyperliquid", "Gate.io", "Binance", "Lighter", "OKX", "Bitget", "Bybit"];

export function normalizeChartRange(
  interval: SearchChartInterval,
  range: ArbitrageChartRange,
  singleSpot: boolean,
): ArbitrageChartRange {
  if (interval === "1m") return range === "1d" || range === "4h" ? range : "1d";
  if (range === "4h") return "1d";
  if (singleSpot && range === "3y") return "1y";
  return range;
}

/** Only Bitget perp transport consumes the bounded chart request window. */
export function hasSelectedBitgetPerp(...markets: Array<ArbitrageMarket | null | undefined>): boolean {
  return markets.some((market) => market?.kind === "perp" && market.source.exchange === "Bitget");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, delayMs);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function runBounded<T>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (value: T) => Promise<void>,
  delayMs = 0,
): Promise<void> {
  let cursor = 0;
  const run = async () => {
    while (!signal.aborted && cursor < values.length) {
      const value = values[cursor++];
      await worker(value);
      if (!signal.aborted && delayMs > 0) await wait(delayMs, signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
}

function perpDetail(detail: DetailResult): MarketTableDetail {
  return {
    historicalVolatility: detail.historicalVolatility,
    topSpread: detail.bidAskSpread,
    bestBid: detail.bestBid,
    bestAsk: detail.bestAsk,
    lastSettlementRate: detail.lastSettlementRate,
    avgFundingRate2d: detail.avgFundingRate2d,
    avgFundingRate7d: detail.avgFundingRate7d,
    avgFundingRate30d: detail.avgFundingRate30d,
  };
}

function spotDetail(detail: SpotDetailResult): MarketTableDetail {
  return {
    historicalVolatility: detail.historicalVolatility,
    topSpread: detail.topSpread,
    topSpreadSource: detail.topSpreadSource,
    bestBid: detail.bestBid,
    bestAsk: detail.bestAsk,
  };
}

function filterSinglePerp(result: SearchCandleResult, range: ArbitrageChartRange): SearchCandleResult {
  const duration = SINGLE_RANGE_MS[range];
  if (duration === null) return result;
  const cutoff = Date.now() - duration;
  return {
    ...result,
    candles: result.candles.filter((point) => point.openTime >= cutoff),
    fundingRates: result.fundingRates.filter((point) => point.time >= cutoff),
  };
}

function filterSingleSpot(result: SpotCandleResult, range: ArbitrageChartRange): SpotCandleResult {
  const duration = SINGLE_RANGE_MS[range];
  if (duration === null) return result;
  const cutoff = Date.now() - duration;
  return { ...result, candles: result.candles.filter((point) => point.openTime >= cutoff) };
}

export default function SpotPerpArbitrageController() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [spotQuote, setSpotQuote] = useState<SpotQuoteFilter>(DEFAULT_SPOT_QUOTE_FILTER);
  const [marketFilter, setMarketFilter] = useState<MarketKindFilter>("all");
  const [excludedExchanges, setExcludedExchanges] = useState<ReadonlySet<ArbitrageExchange>>(new Set());
  const [universe, setUniverse] = useState<ArbitrageMarket[]>([]);
  const [perpUniverseState, setPerpUniverseState] = useState<UniverseState>("loading");
  const [spotUniverseState, setSpotUniverseState] = useState<UniverseState>("loading");
  const universeGenerationRef = useRef(0);
  const oiAbortRef = useRef<AbortController | null>(null);
  const oiGenerationRef = useRef(0);
  const oiResultContractRef = useRef("");

  const [details, setDetails] = useState<Map<string, MarketTableDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Set<string>>(new Set());
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailGenerationRef = useRef(0);

  const [spreadMode, setSpreadMode] = useState<SpreadMode>("top");
  const [impactNotional, setImpactNotional] = useState(DEFAULT_IMPACT_NOTIONAL);
  const [customNotional, setCustomNotional] = useState(String(DEFAULT_IMPACT_NOTIONAL));
  const [editingCustomNotional, setEditingCustomNotional] = useState(false);
  const [impactResults, setImpactResults] = useState<Map<string, ImpactSpreadDetailResult>>(new Map());
  const [impactLoading, setImpactLoading] = useState<Set<string>>(new Set());
  const [impactErrors, setImpactErrors] = useState<Set<string>>(new Set());
  const impactAbortRef = useRef<AbortController | null>(null);

  const [premiumIndexNotional, setPremiumIndexNotional] = useState(DEFAULT_PREMIUM_INDEX_NOTIONAL);
  const [premiumIndexCustomNotional, setPremiumIndexCustomNotional] = useState(String(DEFAULT_PREMIUM_INDEX_NOTIONAL));
  const [editingPremiumIndexCustom, setEditingPremiumIndexCustom] = useState(false);
  const [premiumIndexMode, setPremiumIndexMode] = useState<PremiumIndexMode>("adaptive");
  const [premiumIndexResults, setPremiumIndexResults] = useState<Map<string, ImpactSpreadDetailResult>>(new Map());
  const [officialPremiumResults, setOfficialPremiumResults] = useState<Map<string, number | null>>(new Map());
  const [premiumIndexLoading, setPremiumIndexLoading] = useState<Set<string>>(new Set());
  const [premiumIndexErrors, setPremiumIndexErrors] = useState<Set<string>>(new Set());
  const premiumIndexAbortRef = useRef<AbortController | null>(null);

  // 手动刷新：点击刷新按钮后重拉市场列表，并通过 markets 引用变化级联重算详情/买卖价差/溢价指数。
  const [refreshTick, setRefreshTick] = useState(0);

  // 抓取参数快照 ref：render 期间同步最新值，供「搜索变化 / 手动刷新」触发抓取时读取。
  // 参数本身变化不直接触发重算（避免调整 impact 额/价差模式时立即重拉数据）。
  const impactParamsRef = useRef({ spreadMode, impactNotional });
  impactParamsRef.current = { spreadMode, impactNotional };

  const premiumIndexParamsRef = useRef({ premiumIndexNotional, premiumIndexMode });
  premiumIndexParamsRef.current = { premiumIndexNotional, premiumIndexMode };

  const [selection, setSelection] = useState<OrderedSelection>(EMPTY_SELECTION);
  const [chartInterval, setChartInterval] = useState<SearchChartInterval>("1d");
  const [chartRange, setChartRange] = useState<ArbitrageChartRange>("1y");
  const [showBaseVolume, setShowBaseVolume] = useState(false);
  const [chartPayload, setChartPayload] = useState<ChartPayload | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartRetry, setChartRetry] = useState(0);
  const [exactTimeSelection, setExactTimeSelection] = useState<ChartTimeSelection | null>(null);
  const chartAbortRef = useRef<AbortController | null>(null);
  const chartGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++universeGenerationRef.current;
    const controller = new AbortController();
    setPerpUniverseState("loading");
    setSpotUniverseState("loading");
    void Promise.allSettled([
      fetchAllRates(),
      fetchAllSpotMarkets(controller.signal),
    ]).then(([perpResult, spotResult]) => {
      if (controller.signal.aborted || generation !== universeGenerationRef.current) return;
      const markets: ArbitrageMarket[] = [];
      if (perpResult.status === "fulfilled") {
        markets.push(...perpResult.value.map(asPerpMarket));
        setPerpUniverseState("ready");
      } else {
        setPerpUniverseState("error");
      }
      if (spotResult.status === "fulfilled") {
        markets.push(...spotResult.value.map(asSpotMarket));
        setSpotUniverseState("ready");
      } else {
        setSpotUniverseState("error");
      }
      setUniverse(markets);
    });
    return () => controller.abort();
  }, [refreshTick]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 500);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setSelection((current) => transitionSelection(current, { type: "reset", reason: "query" }));
    chartAbortRef.current?.abort();
    chartGenerationRef.current += 1;
    setChartPayload(null);
    setChartLoading(false);
    setChartError(null);
    setChartRange("1y");
    setExactTimeSelection(null);
  }, [query, spotQuote, marketFilter, excludedExchanges]);

  const searchResult = useMemo(
    () => searchArbitrageMarkets(universe, debouncedQuery, spotQuote, marketFilter, excludedExchanges),
    [debouncedQuery, spotQuote, marketFilter, excludedExchanges, universe],
  );
  const querySettled = query === debouncedQuery;
  const validSearch = querySettled && (searchResult.query.kind === "normal" || searchResult.query.kind === "combo");
  const resultKey = useMemo(
    () => searchResult.markets.map((market) => String(marketId(market))).join("|"),
    [searchResult.markets],
  );
  const oiResultContract = `${query}\u0000${debouncedQuery}\u0000${spotQuote}\u0000${validSearch ? "valid" : "inactive"}\u0000${resultKey}`;

  useEffect(() => {
    oiAbortRef.current?.abort();
    const generation = ++oiGenerationRef.current;
    oiResultContractRef.current = oiResultContract;
    if (!validSearch || !debouncedQuery.trim()) return;

    const targets = selectPendingBinanceOpenInterestTargets(searchResult.markets);
    if (targets.length === 0) return;
    const controller = new AbortController();
    oiAbortRef.current = controller;
    const active = () => (
      !controller.signal.aborted
      && generation === oiGenerationRef.current
      && oiResultContract === oiResultContractRef.current
    );

    void hydrateSearchBinanceOpenInterest(targets, controller.signal)
      .then((hydration) => {
        if (!active() || hydration.size === 0) return;
        setUniverse((current) => applyBinanceOpenInterestHydration(current, hydration));
      })
      .catch((error) => {
        if (active() && !isAbortError(error)) {
          console.warn("[SpotPerpArbitrage] Binance OI hydration failed:", error);
        }
      });
    return () => controller.abort();
  }, [debouncedQuery, oiResultContract, searchResult.markets, validSearch]);

  useEffect(() => {
    detailAbortRef.current?.abort();
    const generation = ++detailGenerationRef.current;
    setDetails(new Map());
    setDetailErrors(new Set());
    if (!validSearch || searchResult.markets.length === 0) {
      setDetailLoading(new Set());
      return;
    }

    const controller = new AbortController();
    detailAbortRef.current = controller;
    const active = () => !controller.signal.aborted && generation === detailGenerationRef.current;
    setDetailLoading(new Set(searchResult.markets.map((market) => String(marketId(market)))));

    const finish = (id: string) => {
      if (!active()) return;
      setDetailLoading((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    };
    const fail = (id: string, error: unknown) => {
      if (!active() || isAbortError(error)) return;
      setDetailErrors((current) => new Set(current).add(id));
    };

    const perpRates = searchResult.markets.flatMap((market) => market.kind === "perp" ? [market.source] : []);
    const spotRows = searchResult.markets.flatMap((market) => market.kind === "spot" ? [market.source] : []);
    const lanes = partitionProgressiveDetailRates(perpRates);
    const fetchPerp = async (rate: SearchExchangeRate) => {
      const market = asPerpMarket(rate);
      const id = String(marketId(market));
      try {
        const result = await fetchDetailForSymbol(rate, controller.signal, undefined, { priority: "background" });
        if (active()) setDetails((current) => new Map(current).set(id, perpDetail(result)));
      } catch (error) {
        fail(id, error);
      } finally {
        finish(id);
      }
    };
    const fetchSpot = async (row: SpotMarketRow) => {
      const market = asSpotMarket(row);
      const id = String(marketId(market));
      try {
        const result = await fetchSpotDetail(row, controller.signal);
        if (active()) setDetails((current) => new Map(current).set(id, spotDetail(result)));
      } catch (error) {
        fail(id, error);
      } finally {
        finish(id);
      }
    };

    void Promise.all([
      runBounded(lanes.generic, DETAIL_LANE_PROFILE.generic.concurrency, controller.signal, fetchPerp),
      runBounded(lanes.lighter, DETAIL_LANE_PROFILE.lighter.concurrency, controller.signal, fetchPerp, DETAIL_LANE_PROFILE.lighter.delayMs),
      runBounded(lanes.bitget, DETAIL_LANE_PROFILE.bitget.concurrency, controller.signal, fetchPerp),
      runBounded(lanes.bybit, DETAIL_LANE_PROFILE.bybit.concurrency, controller.signal, fetchPerp),
      runBounded(lanes.okx, DETAIL_LANE_PROFILE.okx.concurrency, controller.signal, fetchPerp, DETAIL_LANE_PROFILE.okx.delayMs),
      runBounded(spotRows, 3, controller.signal, fetchSpot),
    ]);
    return () => controller.abort();
  }, [resultKey, searchResult.markets, validSearch]);

  useEffect(() => {
    impactAbortRef.current?.abort();
    setImpactResults(new Map());
    setImpactErrors(new Set());
    const { spreadMode: mode, impactNotional: notional } = impactParamsRef.current;
    if (mode !== "impact" || !validSearch || searchResult.markets.length === 0) {
      setImpactLoading(new Set());
      return;
    }
    const controller = new AbortController();
    impactAbortRef.current = controller;
    const markets = searchResult.markets;
    setImpactLoading(new Set(markets.map((market) => String(marketId(market)))));

    const fetchImpact = async (market: ArbitrageMarket) => {
      const id = String(marketId(market));
      try {
        const result = market.kind === "perp"
          ? await fetchSearchImpactSpreadDetail(market.source, controller.signal, notional, "max")
          : await fetchSpotImpactSpreadDetail(market.source, notional, controller.signal, "max");
        if (!controller.signal.aborted) setImpactResults((current) => new Map(current).set(id, result));
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setImpactErrors((current) => new Set(current).add(id));
        }
      } finally {
        if (!controller.signal.aborted) {
          setImpactLoading((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      }
    };
    void runBounded(markets, 2, controller.signal, fetchImpact, 100);
    return () => controller.abort();
  }, [resultKey, searchResult.markets, validSearch]);

  useEffect(() => {
    premiumIndexAbortRef.current?.abort();
    setPremiumIndexResults(new Map());
    setOfficialPremiumResults(new Map());
    setPremiumIndexErrors(new Set());
    const { premiumIndexNotional: notional, premiumIndexMode: mode } = premiumIndexParamsRef.current;
    if (!validSearch || searchResult.markets.length === 0) {
      setPremiumIndexLoading(new Set());
      return;
    }
    const controller = new AbortController();
    premiumIndexAbortRef.current = controller;
    const markets = searchResult.markets.filter((market) => market.kind === "perp");
    setPremiumIndexLoading(new Set(markets.map((market) => String(marketId(market)))));

    // 自适应模式：Hyperliquid（原生/HIP-3）与 OKX 的全量 premium 只请求一次，供逐市场查表。
    const ctxPromise = mode === "adaptive" ? prefetchOfficialPremiumContext(controller.signal) : Promise.resolve(null);

    const fetchPremium = async (market: ArbitrageMarket) => {
      const id = String(marketId(market));
      try {
        if (mode === "adaptive") {
          const ctx = await ctxPromise;
          const result = market.kind === "perp" && ctx !== null
            ? await fetchOfficialPremium(market.source, controller.signal, ctx)
            : null;
          if (!controller.signal.aborted) setOfficialPremiumResults((current) => new Map(current).set(id, result));
        } else {
          const result = market.kind === "perp"
            ? await fetchSearchImpactSpreadDetail(market.source, controller.signal, notional, "max")
            : null;
          if (!controller.signal.aborted) setPremiumIndexResults((current) => new Map(current).set(id, result));
        }
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setPremiumIndexErrors((current) => new Set(current).add(id));
        }
      } finally {
        if (!controller.signal.aborted) {
          setPremiumIndexLoading((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      }
    };
    void runBounded(markets, 2, controller.signal, fetchPremium, 100);
    return () => controller.abort();
  }, [resultKey, searchResult.markets, validSearch]);

  const tableRows = useMemo(() => searchResult.markets.map((market) => {
    const id = String(marketId(market));
    const impact = impactResults.get(id);
    const premiumImpact = premiumIndexResults.get(id);
    const row = toTableRow(market, {
      ...details.get(id),
      impactSpread: impact !== null && typeof impact === "object" ? impact.spread : null,
    });
    const premiumIndex = premiumIndexMode === "adaptive"
      ? officialPremiumResults.get(id) ?? null
      : premiumImpact !== null && typeof premiumImpact === "object" && row.indexPrice !== null
        ? computePremiumIndex(premiumImpact.bidPrice, premiumImpact.askPrice, row.indexPrice)
        : null;
    return { ...row, premiumIndex };
  }), [details, impactResults, officialPremiumResults, premiumIndexMode, premiumIndexResults, searchResult.markets]);

  const comboMode = searchResult.query.kind === "combo";
  const selectedChartIncludesBitget = hasSelectedBitgetPerp(selection.leg1, selection.leg2);
  const bitgetChartRange = selectedChartIncludesBitget ? chartRange : null;
  const chartTransportRange = selectedChartIncludesBitget
    ? normalizeChartRange(chartInterval, bitgetChartRange!, !comboMode && selection.leg1?.kind === "spot")
    : "all" as const;

  useEffect(() => {
    chartAbortRef.current?.abort();
    const generation = ++chartGenerationRef.current;
    const needsSecondLeg = searchResult.query.kind === "combo";
    if (!selection.leg1 || (needsSecondLeg && !selection.leg2)) {
      setChartPayload(null);
      setChartLoading(false);
      setChartError(null);
      return;
    }

    const controller = new AbortController();
    chartAbortRef.current = controller;
    const leg1 = selection.leg1;
    const leg2 = selection.leg2;
    const window = createChartRequestWindow(chartTransportRange, SINGLE_RANGE_MS, Date.now());
    const isCurrent = () => !controller.signal.aborted && generation === chartGenerationRef.current;
    setChartLoading(true);
    setChartError(null);
    setChartPayload(null);
    setExactTimeSelection(null);

    void (async () => {
      try {
        if (needsSecondLeg && leg2 && searchResult.query.kind === "combo") {
          const [first, second] = await Promise.all([
            loadMarketCandles(leg1, chartInterval, controller.signal, { purpose: "combo", window }),
            loadMarketCandles(leg2, chartInterval, controller.signal, { purpose: "combo", window }),
          ]);
          if (!isCurrent()) return;
          const combined = combineLoadedLegs(first, second, searchResult.query.mode);
          setChartPayload("kind" in combined
            ? { kind: "spot-combo", result: combined }
            : { kind: "perp-combo", result: combined });
          return;
        }
        const leg = await loadMarketCandles(leg1, chartInterval, controller.signal, { window });
        if (isCurrent()) setChartPayload({ kind: "single", leg });
      } catch (error) {
        if (isCurrent() && !isAbortError(error)) {
          setChartError(error instanceof Error ? error.message : "K线数据加载失败");
        }
      } finally {
        if (isCurrent()) setChartLoading(false);
      }
    })();
    return () => controller.abort();
  }, [chartInterval, chartTransportRange, chartRetry, searchResult.query, selection.leg1, selection.leg2]);

  useEffect(() => () => {
    oiAbortRef.current?.abort();
    detailAbortRef.current?.abort();
    impactAbortRef.current?.abort();
    premiumIndexAbortRef.current?.abort();
    chartAbortRef.current?.abort();
  }, []);

  const singleSpotChart = !comboMode && selection.leg1?.kind === "spot";
  const activeChartRange = normalizeChartRange(chartInterval, chartRange, singleSpotChart);
  const visiblePerpCombo = useMemo(
    () => chartPayload?.kind === "perp-combo" ? filterAlignedRange(chartPayload.result, activeChartRange) : null,
    [activeChartRange, chartPayload],
  );
  const visibleSpotCombo = useMemo(
    () => chartPayload?.kind === "spot-combo" ? filterAlignedRange(chartPayload.result, activeChartRange) : null,
    [activeChartRange, chartPayload],
  );
  const visibleSinglePerp = useMemo(
    () => chartPayload?.kind === "single" && chartPayload.leg.kind === "perp"
      ? filterSinglePerp(chartPayload.leg.original, activeChartRange)
      : null,
    [activeChartRange, chartPayload],
  );
  const visibleSingleSpot = useMemo(
    () => chartPayload?.kind === "single" && chartPayload.leg.kind === "spot"
      ? filterSingleSpot(chartPayload.leg.original, activeChartRange)
      : null,
    [activeChartRange, chartPayload],
  );

  const rangeOptions: ArbitrageChartRange[] = chartInterval === "1m"
    ? ["1d", "4h"]
    : singleSpotChart
      ? ["all", "1y", "6m", "1m", "1d"]
      : ["all", "3y", "1y", "6m", "1m", "1d"];

  const onExactTimeSelectionChange = useCallback((next: ChartTimeSelection | null) => {
    setExactTimeSelection(next);
  }, []);
  const exactPerpCombo = useMemo(() => {
    if (!visiblePerpCombo || !exactTimeSelection) return visiblePerpCombo;
    return {
      ...visiblePerpCombo,
      candles: filterInChartTimeSelection(visiblePerpCombo.candles, exactTimeSelection),
      fundingRates: filterTimedInChartTimeSelection(visiblePerpCombo.fundingRates, exactTimeSelection),
      ...(visiblePerpCombo.firstQuoteTurnover ? { firstQuoteTurnover: filterTimedInChartTimeSelection(visiblePerpCombo.firstQuoteTurnover, exactTimeSelection) } : {}),
      ...(visiblePerpCombo.secondQuoteTurnover ? { secondQuoteTurnover: filterTimedInChartTimeSelection(visiblePerpCombo.secondQuoteTurnover, exactTimeSelection) } : {}),
      ...(visiblePerpCombo.dashboardFundingRates ? { dashboardFundingRates: filterTimedInChartTimeSelection(visiblePerpCombo.dashboardFundingRates, exactTimeSelection) } : {}),
    };
  }, [exactTimeSelection, visiblePerpCombo]);
  const exactSpotCombo = useMemo(() => {
    if (!visibleSpotCombo || !exactTimeSelection) return visibleSpotCombo;
    return { ...visibleSpotCombo, points: filterInChartTimeSelection(visibleSpotCombo.points, exactTimeSelection), funding: filterTimedInChartTimeSelection(visibleSpotCombo.funding, exactTimeSelection) };
  }, [exactTimeSelection, visibleSpotCombo]);

  const selectMarket = (market: ArbitrageMarket) => {
    setExactTimeSelection(null);
    setChartRange((current) => normalizeChartRange(chartInterval, current, !comboMode && market.kind === "spot"));
    setSelection((current) => transitionSelection(current, { type: "click", market, combo: comboMode }));
  };

  const applyCustomNotional = () => {
    const parsed = Number(customNotional);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setImpactNotional(parsed);
    setEditingCustomNotional(false);
  };

  const applyPremiumIndexCustomNotional = () => {
    const parsed = Number(premiumIndexCustomNotional);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setPremiumIndexNotional(parsed);
    setEditingPremiumIndexCustom(false);
  };

  const toggleExchange = (exchange: ArbitrageExchange) => {
    setExcludedExchanges((current) => {
      const next = new Set(current);
      if (next.has(exchange)) next.delete(exchange);
      else next.add(exchange);
      return next;
    });
  };

  const queryStatus = (() => {
    if (!query.trim()) return "输入币种或关键词开始搜索；使用 BTC-ETH 或 BTC/USDT 可进入双腿模式。";
    if (!querySettled) return "正在筛选现货与永续市场…";
    if (searchResult.query.kind === "invalid") return "组合查询只能包含一个 “-” 或 “/”，且左右两侧都要有关键词，例如 BTC-ETH 或 BTC/USDT。";
    if (perpUniverseState === "loading" || spotUniverseState === "loading") return "市场列表仍在后台加载，结果会自动补充。";
    if (excludedExchanges.size === ALL_EXCHANGES.length) return "已排除全部交易所，请重新勾选至少一个交易所。";
    if (searchResult.markets.length === 0) return marketFilter !== "all"
      ? `没有找到与“${query.trim()}”匹配的${marketFilter === "spot" ? "现货" : "永续"}市场，请尝试其他关键词或切换只看模式。`
      : `没有找到与“${query.trim()}”匹配的市场，请尝试币种简称或调整现货报价币。`;
    return null;
  })();

  const selectedTitle = selection.leg1
    ? selection.leg2 && searchResult.query.kind === "combo"
      ? `${selection.leg1.source.exchange} ${marketDisplaySymbol(selection.leg1)} ${searchResult.query.mode === "spread" ? "−" : "÷"} ${selection.leg2.source.exchange} ${marketDisplaySymbol(selection.leg2)}`
      : `${selection.leg1.source.exchange} ${marketDisplaySymbol(selection.leg1)}`
    : "";

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-700 bg-gray-800/70 p-3 sm:p-4" aria-label="套利市场搜索">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex shrink-0 flex-col gap-1 text-[11px] font-medium text-gray-400">
            现货报价币
            <select
              value={spotQuote}
              onChange={(event) => setSpotQuote(event.target.value as SpotQuoteFilter)}
              className="h-[44px] min-w-28 rounded-lg border border-gray-700 bg-gray-900 px-3 text-sm font-medium text-gray-200 outline-none transition-colors hover:border-gray-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            >
              {SPOT_QUOTE_FILTERS.map((value) => <option key={value} value={value}>{QUOTE_LABELS[value]}</option>)}
            </select>
          </label>
          <div className="min-w-0 flex-1">
            <label htmlFor="arbitrage-market-search" className="sr-only">搜索现货与永续市场</label>
            <div className="relative">
              <svg aria-hidden="true" className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                id="arbitrage-market-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 BTC；或输入 BTC-ETH、BTC/USDT 选择两条腿"
                className="h-[44px] w-full rounded-lg border border-gray-700 bg-gray-900 pl-10 pr-10 text-sm text-white placeholder:text-gray-600 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-gray-500 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">✕</button>}
            </div>
          </div>
          <div className="flex shrink-0 gap-2" role="group" aria-label="只看市场类型">
            <button
              type="button"
              aria-pressed={marketFilter === "spot"}
              onClick={() => setMarketFilter((current) => current === "spot" ? "all" : "spot")}
              className={`h-[44px] rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${marketFilter === "spot" ? "border-emerald-600/70 bg-emerald-600/15 text-emerald-200" : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-gray-200"}`}
            >
              只看现货
            </button>
            <button
              type="button"
              aria-pressed={marketFilter === "perp"}
              onClick={() => setMarketFilter((current) => current === "perp" ? "all" : "perp")}
              className={`h-[44px] rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${marketFilter === "perp" ? "border-indigo-600/70 bg-indigo-600/15 text-indigo-200" : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-gray-200"}`}
            >
              只看永续
            </button>
          </div>
        </div>
        <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500" aria-live="polite">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="按交易所筛选">
            {ALL_EXCHANGES.map((exchange) => {
              const excluded = excludedExchanges.has(exchange);
              return (
                <button
                  key={exchange}
                  type="button"
                  aria-pressed={!excluded}
                  onClick={() => toggleExchange(exchange)}
                  className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${excluded ? "border-gray-800 bg-gray-900/60 text-gray-600 line-through" : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white"}`}
                >
                  {exchange}
                </button>
              );
            })}
          </div>
          <span>Perp：{perpUniverseState === "loading" ? "加载中" : perpUniverseState === "error" ? "不可用" : "已就绪"}</span>
          <span>Spot：{spotUniverseState === "loading" ? "加载中" : spotUniverseState === "error" ? "不可用" : "已就绪"}</span>
          {validSearch && searchResult.markets.length > 0 && (
            <>
              <span className="text-gray-400">{searchResult.markets.length} 个匹配市场</span>
              <button
                type="button"
                onClick={() => setRefreshTick((tick) => tick + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-600 bg-gray-900 px-2 py-0.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                title="按当前选择重新获取并计算表格数据"
              >
                <svg aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4.5 9a7.5 7.5 0 0112.6-3.6l2.4 2.6M19.5 15a7.5 7.5 0 01-12.6 3.6l-2.4-2.6" />
                </svg>
                刷新
              </button>
            </>
          )}
          {(perpUniverseState === "error" || spotUniverseState === "error") && <span className="text-amber-400">部分市场源不可用，仍可使用已加载结果。</span>}
        </div>
      </section>

      {queryStatus && (
        <div className={`rounded-lg border px-4 py-5 text-sm ${searchResult.query.kind === "invalid" && querySettled ? "border-amber-700/60 bg-amber-950/20 text-amber-300" : "border-gray-800 bg-gray-900/45 text-gray-500"}`} role="status">
          {queryStatus}
        </div>
      )}

      {validSearch && searchResult.markets.length > 0 && (
        <>
          {comboMode && (
            <div className="flex flex-col gap-2 rounded-lg border border-violet-500/25 bg-violet-950/15 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">按点击顺序选腿：</span>
                <span className={`rounded px-2 py-1 ${selection.leg1 ? "bg-indigo-500/20 text-indigo-200" : "border border-dashed border-gray-600 text-gray-500"}`}>腿1 · {selection.leg1 ? `${selection.leg1.source.exchange} ${marketDisplaySymbol(selection.leg1)}` : "先选择被减数 / 分子"}</span>
                <span className={`rounded px-2 py-1 ${selection.leg2 ? "bg-fuchsia-500/20 text-fuchsia-200" : "border border-dashed border-gray-600 text-gray-500"}`}>腿2 · {selection.leg2 ? `${selection.leg2.source.exchange} ${marketDisplaySymbol(selection.leg2)}` : "再选择减数 / 分母"}</span>
              </div>
              <span className="text-gray-600">选满两腿后，第三次点击会被忽略；先点已选腿可移除。</span>
            </div>
          )}

          <ArbitrageMarketTable
            rows={tableRows}
            selectedLeg1Id={selection.leg1 ? String(marketId(selection.leg1)) : null}
            selectedLeg2Id={selection.leg2 ? String(marketId(selection.leg2)) : null}
            comboMode={comboMode}
            detailLoading={detailLoading}
            detailErrors={detailErrors}
            impactLoading={impactLoading}
            impactErrors={impactErrors}
            impactResults={impactResults}
            spreadMode={spreadMode}
            onSpreadModeChange={setSpreadMode}
            impactNotional={impactNotional}
            impactNotionalPresets={IMPACT_NOTIONAL_PRESETS as readonly number[]}
            customNotional={customNotional}
            editingCustomNotional={editingCustomNotional}
            onPresetChange={(value) => {
              if (value === "custom") {
                setCustomNotional(String(impactNotional));
                setEditingCustomNotional(true);
              } else {
                setEditingCustomNotional(false);
                setImpactNotional(Number(value));
              }
            }}
            onCustomNotionalChange={setCustomNotional}
            onApplyCustomNotional={applyCustomNotional}
            premiumIndexNotional={premiumIndexNotional}
            premiumIndexNotionalPresets={PREMIUM_INDEX_NOTIONAL_PRESETS as readonly number[]}
            premiumIndexCustomNotional={premiumIndexCustomNotional}
            editingPremiumIndexCustom={editingPremiumIndexCustom}
            onPremiumIndexPresetChange={(value) => {
              if (value === "custom") {
                setPremiumIndexCustomNotional(String(premiumIndexNotional));
                setEditingPremiumIndexCustom(true);
              } else {
                setEditingPremiumIndexCustom(false);
                setPremiumIndexNotional(Number(value));
              }
            }}
            onPremiumIndexCustomNotionalChange={setPremiumIndexCustomNotional}
            onApplyPremiumIndexCustomNotional={applyPremiumIndexCustomNotional}
            premiumIndexMode={premiumIndexMode}
            onPremiumIndexModeChange={setPremiumIndexMode}
            premiumIndexLoading={premiumIndexLoading}
            premiumIndexErrors={premiumIndexErrors}
            onSelect={(row) => selectMarket(row.market)}
          />
        </>
      )}

      {selection.leg1 && (!comboMode || selection.leg2) && (
        <section className="rounded-lg border border-gray-700 bg-gray-800 p-3 sm:p-4" aria-labelledby="arbitrage-chart-title">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h2 id="arbitrage-chart-title" className="truncate text-sm font-semibold text-white">{selectedTitle}</h2>
              <p className="mt-1 text-xs text-gray-500">{chartPayload?.kind === "perp-combo" ? `${visiblePerpCombo?.candles.length ?? 0} 个共同时间点` : chartPayload?.kind === "spot-combo" ? `${visibleSpotCombo?.points.length ?? 0} 个共同时间点` : "单市场原始图表"}</p>
              <p className="mt-1 text-xs text-cyan-300/80">拖动选择精确 UTC 区间；点击 K 线，方向键移动，Shift + 方向键扩展。</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {chartPayload?.kind !== "spot-combo" && (
                <div className="mr-1 inline-flex rounded bg-gray-900/70 p-0.5" aria-label="成交数据类型">
                  <button type="button" aria-pressed={!showBaseVolume} onClick={() => setShowBaseVolume(false)} className={`rounded px-2 py-1 text-xs ${!showBaseVolume ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-300"}`}>成交额</button>
                  <button type="button" aria-pressed={showBaseVolume} onClick={() => setShowBaseVolume(true)} className={`rounded px-2 py-1 text-xs ${showBaseVolume ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-300"}`}>成交量</button>
                </div>
              )}
              <div className="mr-1 flex flex-wrap gap-1">
                {rangeOptions.map((range) => (
                  <button key={range} type="button" aria-pressed={activeChartRange === range} onClick={() => { setExactTimeSelection(null); setChartRange(range); }} className={`rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 ${activeChartRange === range ? "bg-gray-600 text-white" : "bg-gray-900 text-gray-500 hover:bg-gray-700 hover:text-gray-300"}`}>{range === "all" ? "全部" : range}</button>
                ))}
              </div>
              {(["1w", "1d", "4h", "1h", "5m", "1m"] as SearchChartInterval[]).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  aria-pressed={chartInterval === interval}
                  onClick={() => {
                    if (interval === chartInterval) return;
                    chartAbortRef.current?.abort();
                    chartGenerationRef.current += 1;
                    setChartPayload(null);
                    setChartLoading(true);
                    setChartError(null);
                    setExactTimeSelection(null);
                    setChartInterval(interval);
                    setChartRange((current) => normalizeChartRange(interval, current, singleSpotChart));
                  }}
                  className={`rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${chartInterval === interval ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200"}`}
                >
                  {interval}
                </button>
              ))}
              <button type="button" onClick={() => { setExactTimeSelection(null); setSelection(EMPTY_SELECTION); }} aria-label="关闭图表" className="ml-1 rounded bg-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-600 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">✕</button>
            </div>
          </div>

          {chartLoading ? (
            <div className="flex h-[520px] items-center justify-center" role="status"><div className="text-center"><div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-gray-700 border-b-violet-400 motion-reduce:animate-none" /><p className="text-sm text-gray-400">正在加载并对齐K线…</p></div></div>
          ) : chartError ? (
            <div className="flex h-[520px] items-center justify-center" role="alert"><div className="text-center"><p className="text-red-400">K线加载失败</p><p className="mt-1 max-w-md text-sm text-gray-500">{chartError}</p><button type="button" onClick={() => { setExactTimeSelection(null); setChartRetry((current) => current + 1); }} className="mt-4 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">重试</button></div></div>
          ) : chartPayload?.kind === "single" && chartPayload.leg.kind === "perp" && visibleSinglePerp && visibleSinglePerp.candles.length > 0 ? (
            <><SearchCandlesChart symbol={visibleSinglePerp.symbol} exchange={visibleSinglePerp.exchange} exchangeColor={chartPayload.leg.market.source.exchangeColor} interval={chartInterval} candles={visibleSinglePerp.candles} fundingRates={visibleSinglePerp.fundingRates} showVolume={showBaseVolume} provenance={chartPayload.leg.original.provenance} timeSelection={exactTimeSelection} onTimeSelectionChange={onExactTimeSelectionChange} /><SingleMarketAnalyticsDashboard candles={visibleSinglePerp.candles} funding={visibleSinglePerp.fundingRates} selection={exactTimeSelection} marketLabel={`${visibleSinglePerp.exchange} ${visibleSinglePerp.symbol} Perp`} marketKind="perp" /></>
          ) : chartPayload?.kind === "single" && chartPayload.leg.kind === "spot" && visibleSingleSpot && visibleSingleSpot.candles.length > 0 ? (
            <><SpotSearchCandlesChart exchange={visibleSingleSpot.exchange} symbol={visibleSingleSpot.symbol} interval={chartInterval} candles={visibleSingleSpot.candles} showBaseVolume={showBaseVolume} provenance={chartPayload.leg.original.provenance} timeSelection={exactTimeSelection} onTimeSelectionChange={onExactTimeSelectionChange} /><SingleMarketAnalyticsDashboard candles={visibleSingleSpot.candles} selection={exactTimeSelection} marketLabel={`${visibleSingleSpot.exchange} ${visibleSingleSpot.symbol} Spot`} marketKind="spot" /></>
          ) : chartPayload?.kind === "perp-combo" && visiblePerpCombo && visiblePerpCombo.candles.length > 1 ? (
            <ComboSearchCandlesChart data={visiblePerpCombo} interval={chartInterval} timeRange={activeChartRange} onTimeRangeChange={(range) => { setExactTimeSelection(null); setChartRange(normalizeChartRange(chartInterval, range, singleSpotChart)); }} showVolume={showBaseVolume} onToggleVolume={() => setShowBaseVolume((current) => !current)} timeSelection={exactTimeSelection} onTimeSelectionChange={onExactTimeSelectionChange} />
          ) : chartPayload?.kind === "spot-combo" && visibleSpotCombo && visibleSpotCombo.points.length > 1 ? (
            <SpotContainingCombinationChart result={visibleSpotCombo} timeSelection={exactTimeSelection} onTimeSelectionChange={onExactTimeSelectionChange} />
          ) : (
            <div className="flex h-[520px] items-center justify-center" role="status"><div className="text-center"><p className="text-gray-400">当前区间没有足够的重叠数据</p><p className="mt-1 text-sm text-gray-600">可尝试更长历史范围或其他K线周期。</p></div></div>
          )}
        </section>
      )}

      {selection.leg1 && selection.leg2 && chartPayload?.kind === "spot-combo" && (
        exactSpotCombo && <MixedAnalyticsDashboard key={`${String(marketId(chartPayload.result.leg1))}:${String(marketId(chartPayload.result.leg2))}`} result={exactSpotCombo} range="all" initialTailTrim={0} exactSelection={exactTimeSelection} />
      )}
      {selection.leg1 && selection.leg2 && chartPayload?.kind === "perp-combo" && (
        exactPerpCombo && <MixedAnalyticsDashboard key={`${chartPayload.result.firstExchange}:${chartPayload.result.firstSymbol}:${chartPayload.result.secondExchange}:${chartPayload.result.secondSymbol}`} result={exactPerpCombo} range="all" initialTailTrim={0} exactSelection={exactTimeSelection} />
      )}
    </div>
  );
}
