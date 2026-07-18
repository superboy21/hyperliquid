"use client";

import { ComponentType, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ImpactSpreadResult } from "@/lib/impact-price";
import { FUNDING_THEME_CLASSES, type FundingThemeKey } from "@/components/funding/fundingThemes";
import {
  calculateNotionalWeightedAnnualizedRate,
  defaultAnnualizeFundingRate,
  formatAnnualizedPercentage,
  resolveTopBboSpread,
  type AnnualizeFundingRate,
} from "@/components/funding/fundingMonitorUtils";
import { isAbortLikeError } from "@/lib/utils/abort";

// ==================== Types ====================

export type ChartInterval = "1d" | "4h" | "1h";
export type SortField = "rate" | "name" | "volume" | "price" | "change" | "oi";

export interface ExchangeFundingRate {
  symbol: string;
  rawSymbol?: string;
  marketKey?: string;
  fundingRate: number;
  lastSettlementRate: number;
  settlementHydrationKey?: string;
  markPrice: number;
  lastPrice: number;
  change24h: number;
  quoteVolume: number;
  openInterest: number;
  notionalValue: number;
  oiLoaded?: boolean; // true when OI data has been hydrated (notionalValue is real, not placeholder)
  fundingInterval: number;
  assetCategory: string;
  bestBid?: number;
  bestAsk?: number;
}

export interface IntervalFundingRateItem {
  bucketStartTime: number;
  averageFundingRate: number;
  sampleCount: number;
}

export interface CandleSnapshotItem {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface FundingStats {
  highest: number;
  lowest: number;
  average: number;
}

export interface CategoryConfig {
  label: string;
  borderColor: string;
  bgColor: string;
  dotColor: string;
}

export interface ChartComponentProps {
  selectedCoin: string;
  interval: ChartInterval;
  candles: CandleSnapshotItem[];
  intervalFundingRates: IntervalFundingRateItem[];
  fundingIntervalSeconds: number;
}

export interface DetailData {
  candles: CandleSnapshotItem[];
  intervalFundingRates: IntervalFundingRateItem[];
  hourlyFundingRates30d: IntervalFundingRateItem[];
  bidAskSpread?: number | null;
  latestSettlementRate?: number | null;
}

export interface HydrationPolicy {
  initialCount: number;
  enableScrollHydration: boolean;
  resetOnFilterChange?: boolean;
  initialTargetStrategy?: "fixed-count" | "selected-and-visible";
  initialHydrationCap?: number;
  neighborRadius?: number;
  deferSelectedSettlementToDetail?: boolean;
  boundTargetsToCurrentBatch?: boolean;
  onRowClickHydrate?: (
    clickedSymbol: string,
    filteredRates: ExchangeFundingRate[],
  ) => string[];
}

export interface ExchangeFundingMonitorConfig {
  exchangeName: string;
  exchangeColor: FundingThemeKey;
  categoryConfig: Record<string, CategoryConfig>;
  defaultFilterType: string;
  formatFundingRate: (rate: number) => string;
  formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) => string;
  formatStatCardAnnualizedRate?: (rate: number, fundingIntervalSeconds: number) => string;
  annualizeRate?: AnnualizeFundingRate;
  statCardAnnualizeRate?: AnnualizeFundingRate;
  formatPrice: (price: number) => string;
  formatVolume: (volume: number) => string;
  ChartComponent: ComponentType<ChartComponentProps>;
  fetchRates: () => Promise<ExchangeFundingRate[]>;
  hydrateRates?: (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
    targetSymbols: string[],
    hydrationKey: number,
    signal: AbortSignal,
  ) => Promise<void>;
  hydrateOI?: (
    rates: ExchangeFundingRate[],
    updateRates: (updater: (prev: ExchangeFundingRate[]) => ExchangeFundingRate[]) => void,
  ) => Promise<void>;
  fetchDetailData: (rate: ExchangeFundingRate, interval: ChartInterval, rates: ExchangeFundingRate[], signal: AbortSignal) => Promise<DetailData>;
  fetchImpactSpread?: (rate: ExchangeFundingRate, notional?: number, signal?: AbortSignal) => Promise<ImpactSpreadResult>;
  renderExchangeBadge?: (symbol: string) => ReactNode;
  renderInfoSection?: () => ReactNode;
  renderExtraStatsCard?: (rates: ExchangeFundingRate[]) => ReactNode;
  searchPlaceholder?: string;
  filterFn?: (rate: ExchangeFundingRate, filterType: string) => boolean;
  hydrationPolicy?: HydrationPolicy;
}

// ==================== Constants ====================

const TABLE_ROW_HEIGHT = 41;
const SETTLEMENT_CACHE_TTL_MS = 60000;

const intervalLabels: Record<ChartInterval, string> = {
  "1d": "日线",
  "4h": "4小时线",
  "1h": "1小时线",
};

// ==================== Utility Functions ====================

export function getFundingStats(items: IntervalFundingRateItem[]): FundingStats | null {
  if (items.length === 0) return null;
  const rates = items.map((item) => item.averageFundingRate);
  return {
    highest: Math.max(...rates),
    lowest: Math.min(...rates),
    average: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  };
}

export function FundingStatCard({
  title,
  rate,
  fundingIntervalSeconds,
  formatFundingRate,
  formatAnnualizedRate,
  formatStatCardAnnualizedRate,
  annualizeRate = defaultAnnualizeFundingRate,
}: {
  title: string;
  rate: number | null;
  fundingIntervalSeconds: number;
  formatFundingRate: (rate: number) => string;
  formatAnnualizedRate: (rate: number, fundingIntervalSeconds?: number) => string;
  formatStatCardAnnualizedRate?: (rate: number, fundingIntervalSeconds: number) => string;
  annualizeRate?: AnnualizeFundingRate;
}) {
  if (rate === null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <p className="text-xs text-gray-400">{title}</p>
        <p className="mt-2 text-sm text-gray-500">暂无数据</p>
      </div>
    );
  }

  const annualizedStr = formatStatCardAnnualizedRate
    ? formatStatCardAnnualizedRate(rate, fundingIntervalSeconds)
    : formatAnnualizedRate(rate, fundingIntervalSeconds);
  const annualizedPctNum = annualizeRate(rate, fundingIntervalSeconds);
  const isPositive = annualizedPctNum >= 0;

  // Derive per-settlement-period rate from the annualized value
  // annualizedPct = hourlyEquivalent * 8760 for all exchanges
  // perPeriodRate = annualizedPct * fundingIntervalHours / 8760
  const fundingIntervalHours = fundingIntervalSeconds / 3600;
  const perPeriodRate = annualizedPctNum * fundingIntervalHours / 8760;
  const perPeriodStr = `${perPeriodRate >= 0 ? "+" : ""}${perPeriodRate.toFixed(4)}%`;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`mt-2 font-mono text-lg font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
        {annualizedStr}
      </p>
      <p className="mt-1 text-xs text-gray-500">周期：{perPeriodStr}</p>
    </div>
  );
}

// ==================== Main Component ====================

export default function ExchangeFundingMonitor({ config }: { config: ExchangeFundingMonitorConfig }) {
  const {
    exchangeName,
    exchangeColor,
    categoryConfig,
    defaultFilterType,
    formatFundingRate,
    formatAnnualizedRate,
    formatStatCardAnnualizedRate,
    annualizeRate = defaultAnnualizeFundingRate,
    statCardAnnualizeRate,
    formatPrice,
    formatVolume,
    ChartComponent,
    fetchRates,
    hydrateRates,
    hydrateOI,
    fetchDetailData,
    fetchImpactSpread,
    renderExchangeBadge,
    renderInfoSection,
    renderExtraStatsCard,
    searchPlaceholder = "搜索交易对，例如 BTC、ETH",
    filterFn,
  } = config;
  const themeClasses = FUNDING_THEME_CLASSES[exchangeColor];

  // State
  const [fundingRates, setFundingRates] = useState<ExchangeFundingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("oi");
  const [sortDesc, setSortDesc] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<string>(defaultFilterType);
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>("1d");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [candles, setCandles] = useState<CandleSnapshotItem[]>([]);
  const [intervalFundingRates, setIntervalFundingRates] = useState<IntervalFundingRateItem[]>([]);
  const [hourlyFundingRates30d, setHourlyFundingRates30d] = useState<IntervalFundingRateItem[]>([]);
  const [detailBidAskSpread, setDetailBidAskSpread] = useState<number | null>(null);
  const [spreadSource, setSpreadSource] = useState<"top" | "impact">("top");
  const [impactNotional, setImpactNotional] = useState(1000);
  const [impactNotionalCustom, setImpactNotionalCustom] = useState(false);
  const [impactSpread, setImpactSpread] = useState<ImpactSpreadResult>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const impactAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailGenerationRef = useRef(0);
  const detailEffectGenerationRef = useRef(0);
  const hydrationGenerationRef = useRef(0);
  const [hydrationTargetSymbols, setHydrationTargetSymbols] = useState<string[]>([]);
  const [hydrationKey, setHydrationKey] = useState(0);
  const fundingRatesRef = useRef<ExchangeFundingRate[]>([]);
  const selectedCoinRef = useRef<string | null>(null);
  const filteredRatesRef = useRef<ExchangeFundingRate[]>([]);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const settlementCacheRef = useRef<Map<string, { value: number; timestamp: number }>>(new Map());
  const settlementInflightRef = useRef<Map<string, number>>(new Map());

  const getSettlementCacheKey = useCallback((rate: ExchangeFundingRate): string => {
    return rate.settlementHydrationKey ?? rate.symbol;
  }, []);

  const cacheSettlementRate = useCallback((key: string, value: number) => {
    settlementCacheRef.current.set(key, {
      value,
      timestamp: Date.now(),
    });
  }, []);

  const getFreshCachedSettlementRate = useCallback((key: string): number | null => {
    const cached = settlementCacheRef.current.get(key);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp > SETTLEMENT_CACHE_TTL_MS) {
      settlementCacheRef.current.delete(key);
      return null;
    }

    return cached.value;
  }, []);

  const abortDetailForEffect = useCallback((effectGeneration: number) => {
    if (detailEffectGenerationRef.current === effectGeneration) {
      detailAbortRef.current?.abort();
    }
  }, []);

  // Fetch rates
  const handleFetchRates = useCallback(async () => {
    try {
      setError(null);
      const rates = await fetchRates();
      if (rates.length === 0) {
        setError("未能获取到资金费率数据，请稍后重试。");
        return;
      }
      setFundingRates((prev) => {
        const previousSettlementMap = new Map(prev.map((rate) => [rate.symbol, rate.lastSettlementRate]));
        const mergedRates = rates.map((rate) => {
          const previousSettlementRate = previousSettlementMap.get(rate.symbol);
          return previousSettlementRate !== undefined && Number.isFinite(previousSettlementRate)
            ? { ...rate, lastSettlementRate: previousSettlementRate }
            : rate;
        });
        for (const rate of mergedRates) {
          if (Number.isFinite(rate.lastSettlementRate)) {
            cacheSettlementRate(getSettlementCacheKey(rate), rate.lastSettlementRate);
          }
        }
        fundingRatesRef.current = mergedRates;
        return mergedRates;
      });
      setLastUpdate(new Date());

      // Async OI hydration — update notionalValue after initial display
      if (hydrateOI) {
        hydrateOI(fundingRatesRef.current, (updater) => {
          setFundingRates((prev) => {
            const updated = updater(prev);
            fundingRatesRef.current = updated;
            return updated;
          });
        }).catch((err) => {
          console.warn("OI hydration failed:", err);
        });
      }
    } catch (fetchError) {
      console.error("Error fetching data:", fetchError);
      setError("获取数据时发生错误。");
    } finally {
      setLoading(false);
    }
  }, [cacheSettlementRate, fetchRates, getSettlementCacheKey, hydrateOI]);

  useEffect(() => {
    handleFetchRates();
    const interval = setInterval(handleFetchRates, 300000);
    return () => clearInterval(interval);
  }, [handleFetchRates]);

  // Fetch detail data
  const handleFetchDetail = useCallback(
    async (symbol: string, interval: ChartInterval) => {
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      const generation = ++detailGenerationRef.current;
      const isCurrentRequest = () => !controller.signal.aborted && detailGenerationRef.current === generation;

      setDetailLoading(true);
      setDetailError(null);
      setCandles([]);
      setIntervalFundingRates([]);
      setHourlyFundingRates30d([]);
      setDetailBidAskSpread(null);

      try {
        const currentRates = fundingRatesRef.current;
        const selectedRate = currentRates.find((rate) => rate.symbol === symbol);
        if (!selectedRate) {
          throw new Error(`Missing selected funding row for ${symbol}`);
        }
        const detailData = await fetchDetailData(selectedRate, interval, currentRates, controller.signal);
        if (!isCurrentRequest()) return;
        if (detailData.candles.length === 0) {
          setDetailError(`暂时拿不到该资产最近 30 天的${intervalLabels[interval]}数据。`);
          return;
        }
        setCandles(detailData.candles);
        setIntervalFundingRates(detailData.intervalFundingRates);
        setHourlyFundingRates30d(detailData.hourlyFundingRates30d);
        setDetailBidAskSpread(detailData.bidAskSpread ?? null);
        if (Number.isFinite(detailData.latestSettlementRate)) {
          setFundingRates((prev) => {
            const next = prev.map((rate) => {
              if (rate.symbol !== symbol) {
                return rate;
              }

              const latestSettlementRate = detailData.latestSettlementRate as number;
              cacheSettlementRate(getSettlementCacheKey(rate), latestSettlementRate);
              return { ...rate, lastSettlementRate: latestSettlementRate };
            });
            fundingRatesRef.current = next;
            return next;
          });
        }
      } catch (fetchError) {
        if (!isCurrentRequest() || isAbortLikeError(fetchError)) return;
        console.error("Error fetching detail:", fetchError);
        setDetailError("加载图表数据时发生错误。");
      } finally {
        if (isCurrentRequest()) setDetailLoading(false);
      }
    },
    [cacheSettlementRate, fetchDetailData, getSettlementCacheKey],
  );

  useEffect(() => {
    const effectGeneration = ++detailEffectGenerationRef.current;
    if (selectedCoin) {
      void handleFetchDetail(selectedCoin, selectedInterval);
    }
    return () => abortDetailForEffect(effectGeneration);
  }, [abortDetailForEffect, handleFetchDetail, selectedCoin, selectedInterval]);

  // Lazy-load impact spread when toggle switches to "impact"
  useEffect(() => {
    if (spreadSource !== "impact" || !selectedCoin || !fetchImpactSpread) {
      setImpactLoading(false);
      return;
    }

    if (impactAbortRef.current) {
      impactAbortRef.current.abort();
    }
    const controller = new AbortController();
    impactAbortRef.current = controller;

    setImpactSpread(null);
    setImpactLoading(true);
    const selectedRate = fundingRatesRef.current.find((rate) => rate.symbol === selectedCoin);
    if (!selectedRate) {
      setImpactLoading(false);
      return () => controller.abort();
    }

    fetchImpactSpread(selectedRate, impactNotional, controller.signal).then((spread) => {
      if (!controller.signal.aborted) {
        setImpactSpread(spread);
        setImpactLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setImpactLoading(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [spreadSource, selectedCoin, fetchImpactSpread, impactNotional]);

  // Clear impact spread when coin changes
  useEffect(() => {
    setImpactSpread(null);
    setImpactLoading(false);
  }, [selectedCoin]);

  // Filter and sort
  const filteredAndSortedRates = useMemo(() => {
    return fundingRates
      .filter((rate) => {
        const matchesSearch = rate.symbol.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filterFn ? filterFn(rate, filterType) : filterType === "all" || rate.assetCategory === filterType;
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case "rate":
            comparison = Math.abs(b.fundingRate) - Math.abs(a.fundingRate);
            break;
          case "name":
            comparison = a.symbol.localeCompare(b.symbol);
            break;
          case "price":
            comparison = b.lastPrice - a.lastPrice;
            break;
          case "change":
            comparison = b.change24h - a.change24h;
            break;
          case "volume":
            comparison = b.quoteVolume - a.quoteVolume;
            break;
          case "oi":
            comparison = b.notionalValue - a.notionalValue;
            break;
        }
        return sortDesc ? comparison : -comparison;
      });
  }, [fundingRates, searchTerm, sortBy, sortDesc, filterType, filterFn]);

  useEffect(() => {
    fundingRatesRef.current = fundingRates;
  }, [fundingRates]);

  useEffect(() => {
    selectedCoinRef.current = selectedCoin;
  }, [selectedCoin]);

  useEffect(() => {
    filteredRatesRef.current = filteredAndSortedRates;
  }, [filteredAndSortedRates]);

  const filteredOrderKey = useMemo(
    () => filteredAndSortedRates.map((rate) => rate.symbol).join("|"),
    [filteredAndSortedRates],
  );
  const shouldDeferSelectedSettlementToDetail =
    config.hydrationPolicy?.deferSelectedSettlementToDetail
      ?? (config.hydrationPolicy?.initialTargetStrategy ?? "fixed-count") === "selected-and-visible";

  useEffect(() => {
    const currentFilteredRates = filteredRatesRef.current;
    if (!hydrateRates || loading || currentFilteredRates.length === 0) {
      return;
    }

    const rateMap = new Map(currentFilteredRates.map((rate) => [rate.symbol, rate]));
    const selectedSymbol = selectedCoinRef.current;
    const cachedUpdates = new Map<string, number>();
    const symbolsToHydrate: string[] = [];
    const inflightKeys: string[] = [];

    for (const symbol of hydrationTargetSymbols) {
      const rate = rateMap.get(symbol);
      if (!rate) {
        continue;
      }

      if (shouldDeferSelectedSettlementToDetail && selectedSymbol && symbol === selectedSymbol) {
        continue;
      }

      if (Number.isFinite(rate.lastSettlementRate)) {
        continue;
      }

      const cacheKey = getSettlementCacheKey(rate);
      const cachedRate = getFreshCachedSettlementRate(cacheKey);
      if (cachedRate !== null) {
        cachedUpdates.set(symbol, cachedRate);
        continue;
      }

      if (settlementInflightRef.current.has(cacheKey)) {
        continue;
      }

      symbolsToHydrate.push(symbol);
    }

    if (cachedUpdates.size > 0) {
      setFundingRates((prev) => {
        const next = prev.map((rate) =>
          cachedUpdates.has(rate.symbol)
            ? { ...rate, lastSettlementRate: cachedUpdates.get(rate.symbol) as number }
            : rate,
        );
        fundingRatesRef.current = next;
        return next;
      });
    }

    if (symbolsToHydrate.length === 0) {
      return;
    }

    const controller = new AbortController();
    const generation = ++hydrationGenerationRef.current;
    for (const symbol of symbolsToHydrate) {
      const rate = rateMap.get(symbol);
      if (!rate) continue;
      const cacheKey = getSettlementCacheKey(rate);
      settlementInflightRef.current.set(cacheKey, generation);
      inflightKeys.push(cacheKey);
    }
    const releaseInflightKeys = () => {
      for (const key of inflightKeys) {
        if (settlementInflightRef.current.get(key) === generation) {
          settlementInflightRef.current.delete(key);
        }
      }
    };

    void hydrateRates(currentFilteredRates, (updater) => {
      if (controller.signal.aborted || hydrationGenerationRef.current !== generation) return;
      setFundingRates((prev) => {
        if (controller.signal.aborted || hydrationGenerationRef.current !== generation) return prev;
        const next = updater(prev);
        for (const rate of next) {
          if (Number.isFinite(rate.lastSettlementRate)) {
            cacheSettlementRate(getSettlementCacheKey(rate), rate.lastSettlementRate);
          }
        }
        fundingRatesRef.current = next;
        return next;
      });
    }, symbolsToHydrate, hydrationKey, controller.signal).catch((hydrationError) => {
      if (!controller.signal.aborted && !isAbortLikeError(hydrationError)) {
        console.warn("Settlement hydration failed:", hydrationError);
      }
    }).finally(releaseInflightKeys);

    return () => {
      controller.abort();
      releaseInflightKeys();
    };
  }, [
    cacheSettlementRate,
    filteredOrderKey,
    getFreshCachedSettlementRate,
    getSettlementCacheKey,
    hydrateRates,
    hydrationTargetSymbols,
    hydrationKey,
    loading,
    shouldDeferSelectedSettlementToDetail,
  ]);

  const initialCount = config.hydrationPolicy?.initialCount ?? 50;
  const initialHydrationCap = config.hydrationPolicy?.initialHydrationCap ?? initialCount;
  const initialTargetStrategy = config.hydrationPolicy?.initialTargetStrategy ?? "fixed-count";
  const resetOnFilterChange = config.hydrationPolicy?.resetOnFilterChange ?? true;
  const boundTargetsToCurrentBatch = config.hydrationPolicy?.boundTargetsToCurrentBatch ?? false;
  useEffect(() => {
    const hydrationOrderedRates = filteredRatesRef.current;
    if (hydrationOrderedRates.length === 0) {
      setHydrationTargetSymbols([]);
      return;
    }

    const nextTargetSymbols =
      initialTargetStrategy === "selected-and-visible"
        ? (() => {
            const selectedSymbol = selectedCoinRef.current ?? hydrationOrderedRates[0]?.symbol;
            const visibleCount = Math.max(
              1,
              Math.ceil((tableScrollRef.current?.clientHeight ?? TABLE_ROW_HEIGHT) / TABLE_ROW_HEIGHT),
            );
            const visibleSymbols = hydrationOrderedRates
              .slice(0, Math.min(hydrationOrderedRates.length, visibleCount))
              .map((rate) => rate.symbol);

            return Array.from(new Set([
              ...(selectedSymbol ? [selectedSymbol] : []),
              ...visibleSymbols,
            ])).slice(0, initialHydrationCap);
          })()
        : hydrationOrderedRates.slice(0, initialCount).map((rate) => rate.symbol);

    if (!resetOnFilterChange) {
      setHydrationTargetSymbols((prev) => {
        if (prev.length > 0) {
          return prev;
        }

        return nextTargetSymbols;
      });
      return;
    }

    setHydrationTargetSymbols(nextTargetSymbols);
  }, [
    filteredOrderKey,
    initialCount,
    initialHydrationCap,
    initialTargetStrategy,
    resetOnFilterChange,
  ]);

  // Auto-select first coin
  useEffect(() => {
    if (!selectedCoin && filteredAndSortedRates.length > 0) {
      setSelectedCoin(filteredAndSortedRates[0].symbol);
      return;
    }
    if (selectedCoin && !filteredAndSortedRates.some((rate) => rate.symbol === selectedCoin)) {
      setSelectedCoin(filteredAndSortedRates[0]?.symbol ?? null);
    }
  }, [filteredAndSortedRates, selectedCoin]);

  // Stats
  const positiveRates = useMemo(() => fundingRates.filter((rate) => rate.fundingRate > 0).length, [fundingRates]);
  const negativeRates = useMemo(() => fundingRates.filter((rate) => rate.fundingRate < 0).length, [fundingRates]);

  const averageAnnualizedRate = useMemo(
    () => calculateNotionalWeightedAnnualizedRate(filteredAndSortedRates, annualizeRate),
    [annualizeRate, filteredAndSortedRates],
  );
  const averageAnnualizedRateLabel = formatAnnualizedPercentage(averageAnnualizedRate);

  const recent7HourlyFundingRates = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return hourlyFundingRates30d.filter((item) => item.bucketStartTime >= sevenDaysAgo);
  }, [hourlyFundingRates30d]);

  const fundingStats30d = useMemo(() => getFundingStats(hourlyFundingRates30d), [hourlyFundingRates30d]);
  const fundingStats7d = useMemo(() => getFundingStats(recent7HourlyFundingRates), [recent7HourlyFundingRates]);

  const selectedSummary = useMemo(() => {
    if (candles.length === 0) return null;

    const closes = candles.map((candle) => Number(candle.close));
    const highs = candles.map((candle) => Number(candle.high));
    const lows = candles.map((candle) => Number(candle.low));

    // Historical volatility (annualized)
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }

    let historicalVolatility = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const periodVolatility = Math.sqrt(variance);
      const periodsPerYear = selectedInterval === "1d" ? 365 : selectedInterval === "4h" ? 365 * 6 : 365 * 24;
      historicalVolatility = periodVolatility * Math.sqrt(periodsPerYear) * 100;
    }

    // Prefer the current selected-row BBO; the detail snapshot is only a fallback.
    let bidAskSpread: ImpactSpreadResult = null;
    if (spreadSource === "top") {
      const selectedRate = selectedCoin
        ? fundingRates.find((rate) => rate.symbol === selectedCoin)
        : undefined;
      bidAskSpread = resolveTopBboSpread(selectedRate, detailBidAskSpread);
    } else if (spreadSource === "impact") {
      bidAskSpread = impactSpread;
    }

    return {
      latestClose: closes[closes.length - 1],
      highestHigh: Math.max(...highs),
      lowestLow: Math.min(...lows),
      historicalVolatility,
      bidAskSpread,
    };
  }, [candles, selectedInterval, selectedCoin, fundingRates, detailBidAskSpread, impactSpread, spreadSource]);

  const selectedFundingInterval = useMemo(() => {
    if (!selectedCoin) return 28800;
    const selected = fundingRates.find((r) => r.symbol === selectedCoin);
    return selected?.fundingInterval ?? 28800;
  }, [selectedCoin, fundingRates]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDesc((current) => !current);
      return;
    }
    setSortBy(field);
    setSortDesc(true);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className={`mx-auto h-12 w-12 animate-spin rounded-full border-b-2 ${themeClasses.spinner}`} />
          <p className="mt-4 text-gray-400">正在加载 {exchangeName} 资金费率数据...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg className="h-6 w-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p className="mb-4 text-red-400">{error}</p>
          <button
            onClick={handleFetchRates}
            className={`rounded-lg px-4 py-2 text-white transition-colors ${themeClasses.primaryButton}`}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">交易对数量</p>
          <p className="text-2xl font-bold text-white">{fundingRates.length}</p>
        </div>
        {renderExtraStatsCard && renderExtraStatsCard(fundingRates)}
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">正资金费率</p>
          <p className="text-2xl font-bold text-green-400">{positiveRates}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">负资金费率</p>
          <p className="text-2xl font-bold text-red-400">{negativeRates}</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
          <p className="text-sm text-gray-400">当前平均年化（OI 加权）</p>
          <p
            className={`text-lg font-bold ${
              averageAnnualizedRate < 0 ? "text-red-400" : "text-green-400"
            }`}
          >
            {averageAnnualizedRateLabel}
          </p>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(categoryConfig).map(([key, catConfig]) => (
          <button
            key={key}
            onClick={() => setFilterType(key)}
            className={`rounded-lg border px-4 py-2 font-medium transition-colors ${
              filterType === key
                ? `${catConfig.borderColor} ${catConfig.bgColor} text-white`
                : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${catConfig.dotColor}`} />
              {catConfig.label}
              {key !== "all" && (
                <span className="text-xs opacity-70">
                  ({fundingRates.filter((r) => r.assetCategory === key).length})
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Search and sort */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1">
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["rate", "price", "change", "volume", "oi", "name"] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                sortBy === field
                  ? themeClasses.activeControl
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {field === "rate" && "预测费率"}
              {field === "price" && "价格"}
              {field === "change" && "24h 涨跌"}
              {field === "volume" && "24h 成交额"}
              {field === "oi" && "持仓价值"}
              {field === "name" && "名称"}
              {sortBy === field && (sortDesc ? " ↓" : " ↑")}
            </button>
          ))}
        </div>
      </div>

      {/* Last update */}
      {lastUpdate && (
        <div className="text-sm text-gray-500">
          最后更新：{lastUpdate.toLocaleTimeString("zh-CN")}（每 300 秒自动刷新）
        </div>
      )}

      {/* Table and chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
        {/* Table */}
        <div className="min-h-0 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 lg:flex lg:h-full lg:flex-col">
          <div className="border-b border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-white">
              {filterType === "all"
                ? `${exchangeName} 资金费率总览`
                : `${categoryConfig[filterType]?.label ?? filterType} 资金费率`}
            </h2>
            <p className="text-sm text-gray-400">
              共 {filteredAndSortedRates.length} 个交易对
              {searchTerm && `（从 ${fundingRates.length} 个中筛选）`}
            </p>
          </div>
          <div
            ref={tableScrollRef}
            className="max-h-[960px] overflow-x-auto overflow-y-auto lg:min-h-0 lg:flex-1"
            onScroll={config.hydrationPolicy?.enableScrollHydration ?? true ? (e) => {
              const target = e.currentTarget;
              const startIndex = Math.max(0, Math.floor(target.scrollTop / TABLE_ROW_HEIGHT));
              const visibleCount = Math.ceil(target.clientHeight / TABLE_ROW_HEIGHT) + 2;
              const endIndex = Math.min(filteredAndSortedRates.length, startIndex + visibleCount);
              const visibleSymbols = filteredAndSortedRates.slice(startIndex, endIndex).map((rate) => rate.symbol);

              setHydrationTargetSymbols((prev) => {
                if (boundTargetsToCurrentBatch) {
                  return Array.from(new Set([
                    ...(selectedCoinRef.current ? [selectedCoinRef.current] : []),
                    ...visibleSymbols,
                  ]));
                }
                const next = new Set(prev);
                for (const symbol of visibleSymbols) {
                  next.add(symbol);
                }
                return Array.from(next);
              });
            } : undefined}
          >
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-900">
                <tr>
                  <th className="px-3 py-2 text-left text-sm font-medium text-gray-400">交易对</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">价格</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">24h 涨跌</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">预测费率</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">最新结算费率</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">24h 成交额</th>
                  <th className="px-3 py-2 text-right text-sm font-medium text-gray-400">持仓价值</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredAndSortedRates.map((rate) => (
                  <tr
                    key={rate.symbol}
                    onClick={() => {
                      setSelectedCoin(rate.symbol);
                      const symbols = config.hydrationPolicy?.onRowClickHydrate
                        ? config.hydrationPolicy.onRowClickHydrate(rate.symbol, filteredAndSortedRates)
                        : config.hydrationPolicy?.neighborRadius
                          ? (() => {
                              const idx = filteredAndSortedRates.findIndex((r) => r.symbol === rate.symbol);
                              if (idx === -1) return [];
                              const start = Math.max(0, idx - config.hydrationPolicy.neighborRadius);
                              const end = Math.min(filteredAndSortedRates.length, idx + config.hydrationPolicy.neighborRadius + 1);
                              return filteredAndSortedRates.slice(start, end).map((r) => r.symbol);
                            })()
                          : [];
                      if (symbols.length > 0) {
                        setHydrationTargetSymbols((prev) => {
                          if (boundTargetsToCurrentBatch) {
                            return Array.from(new Set([rate.symbol, ...symbols]));
                          }
                          const next = new Set(prev);
                          for (const s of symbols) next.add(s);
                          return Array.from(next);
                        });
                        setHydrationKey((k) => k + 1);
                      }
                    }}
                    className={`cursor-pointer transition-colors hover:bg-gray-700 ${
                      selectedCoin === rate.symbol ? "bg-gray-700/90" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span className="text-xs font-medium text-white">{rate.symbol}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono text-sm text-gray-300">{formatPrice(rate.lastPrice)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`font-mono text-sm ${
                          rate.change24h > 0 ? "text-green-400" : rate.change24h < 0 ? "text-red-400" : "text-gray-400"
                        }`}
                      >
                        {rate.change24h >= 0 ? "+" : ""}
                        {rate.change24h.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-right">
                        <div
                          className={`font-mono font-medium ${
                            rate.fundingRate > 0 ? "text-green-400" : rate.fundingRate < 0 ? "text-red-400" : "text-gray-400"
                          }`}
                        >
                          {formatAnnualizedRate(rate.fundingRate, rate.fundingInterval)}
                        </div>
                        <div className="text-xs text-gray-500">({formatFundingRate(rate.fundingRate)})</div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {Number.isFinite(rate.lastSettlementRate) ? (
                        <div className="text-right">
                          <div
                            className={`font-mono font-medium ${
                              rate.lastSettlementRate > 0 ? "text-green-400" : rate.lastSettlementRate < 0 ? "text-red-400" : "text-gray-400"
                            }`}
                          >
                            {formatAnnualizedRate(rate.lastSettlementRate, rate.fundingInterval)}
                          </div>
                          <div className="text-xs text-gray-500">({formatFundingRate(rate.lastSettlementRate)})</div>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono text-sm text-gray-400">{formatVolume(rate.quoteVolume)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-mono text-sm ${exchangeName === "Binance" && !rate.oiLoaded ? "text-gray-600" : "text-gray-400"}`}>
                        {formatVolume(rate.notionalValue)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAndSortedRates.length === 0 && (
              <div className="p-8 text-center text-gray-500">没有找到匹配的交易对。</div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
          <div className="border-b border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  {selectedCoin ? `${selectedCoin} 近 30 天价格与资金费率` : "选择左侧资产查看图表"}
                </h2>
                {selectedCoin && renderExchangeBadge && renderExchangeBadge(selectedCoin)}
              </div>
              {selectedCoin && (
                <div className="flex gap-2">
                  {(["1d", "4h", "1h"] as ChartInterval[]).map((interval) => (
                    <button
                      key={interval}
                      onClick={() => setSelectedInterval(interval)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selectedInterval === interval
                          ? themeClasses.activeControl
                          : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      {intervalLabels[interval]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="p-4">
            {!selectedCoin ? (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-4 h-16 w-16 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 3v18h18M7 14l3-3 3 2 5-7"
                    />
                  </svg>
                  <p>点击左侧交易对后，这里会显示价格图表和费率表现。</p>
                </div>
              </div>
            ) : detailLoading ? (
              <div className="flex h-[560px] items-center justify-center">
                <div className="text-center">
                  <div className={`mx-auto h-10 w-10 animate-spin rounded-full border-b-2 ${themeClasses.spinner}`} />
                  <p className="mt-4 text-sm text-gray-400">
                    正在加载 {selectedCoin} 的 {intervalLabels[selectedInterval]} 数据...
                  </p>
                </div>
              </div>
            ) : detailError ? (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <p className="text-red-400">{detailError}</p>
                  <button
                    onClick={() => handleFetchDetail(selectedCoin, selectedInterval)}
                    className={`mt-4 rounded-lg px-4 py-2 text-white transition-colors ${themeClasses.primaryButton}`}
                  >
                    重新加载图表
                  </button>
                </div>
              </div>
            ) : candles.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-2">
                  <ChartComponent
                    selectedCoin={selectedCoin}
                    interval={selectedInterval}
                    candles={candles}
                    intervalFundingRates={intervalFundingRates}
                    fundingIntervalSeconds={selectedFundingInterval}
                  />
                </div>

                {selectedSummary && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">结算周期</p>
                      <p className={`mt-2 font-mono text-lg font-bold ${themeClasses.accentText}`}>
                        {selectedFundingInterval / 3600} 小时
                      </p>
                      <p className="mt-1 text-xs text-gray-500">{exchangeName} 合约</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <p className="text-xs text-gray-400">历史波动率(30周期)</p>
                      <p className="mt-2 font-mono text-lg font-bold text-purple-400">
                        {selectedSummary.historicalVolatility.toFixed(2)}%
                      </p>
                      <p className="mt-1 text-xs text-gray-500">年化</p>
                    </div>
                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                       <div className="flex items-center justify-between">
                         <p className="text-xs text-gray-400">当前买卖价差</p>
                         {fetchImpactSpread && (
                           <button
                             type="button"
                             onClick={() => setSpreadSource((prev) => (prev === "top" ? "impact" : "top"))}
                             className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                               spreadSource === "top"
                                 ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                                 : "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                             }`}
                           >
                             {spreadSource === "top" ? "Top" : "Impact"}
                           </button>
                         )}
                       </div>
                       {spreadSource === "impact" && (
                         <div className="mt-2 flex items-center gap-1">
                           <select
                             value={impactNotionalCustom ? "custom" : String(impactNotional)}
                             onChange={(e) => {
                               const v = e.target.value;
                               if (v === "custom") {
                                 setImpactNotionalCustom(true);
                               } else {
                                 setImpactNotionalCustom(false);
                                 setImpactNotional(Number(v) || 1000);
                               }
                             }}
                             className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300"
                           >
                             {[200, 1000, 5000, 10000].map((n) => (
                               <option key={n} value={String(n)}>${n}</option>
                             ))}
                             <option value="custom">自定义</option>
                           </select>
                           {impactNotionalCustom && (
                             <input
                               type="number"
                               min={1}
                               step={1}
                               value={impactNotional}
                               onChange={(e) => {
                                 const v = parseInt(e.target.value, 10);
                                 if (v > 0) setImpactNotional(v);
                               }}
                               className="w-20 rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300"
                               placeholder="USD"
                             />
                           )}
                         </div>
                       )}
                        <p className="mt-2 font-mono text-lg font-bold text-yellow-400">
                          {spreadSource === "impact" && impactLoading ? (
                           <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-yellow-400" />
                         ) : selectedSummary.bidAskSpread === "no_ctVal" ? (
                           "No ctVal"
                         ) : selectedSummary.bidAskSpread === "insufficient" ? (
                           "深度不足"
                         ) : typeof selectedSummary.bidAskSpread === "number" ? (
                           `${selectedSummary.bidAskSpread.toFixed(4)}%`
                         ) : (
                           "--"
                         )}
                       </p>
                      <p className="mt-1 text-xs text-gray-500">(Ask-Bid)/Mid</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  <FundingStatCard
                    title="最高资金费率(7天)"
                    rate={fundingStats7d?.highest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                  <FundingStatCard
                    title="最低资金费率(7天)"
                    rate={fundingStats7d?.lowest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                  <FundingStatCard
                    title="平均资金费率(7天)"
                    rate={fundingStats7d?.average ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                  <FundingStatCard
                    title="最高资金费率(30天)"
                    rate={fundingStats30d?.highest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                  <FundingStatCard
                    title="最低资金费率(30天)"
                    rate={fundingStats30d?.lowest ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                  <FundingStatCard
                    title="平均资金费率(30天)"
                    rate={fundingStats30d?.average ?? null}
                    fundingIntervalSeconds={selectedFundingInterval}
                    formatFundingRate={formatFundingRate}
                    formatAnnualizedRate={formatAnnualizedRate}
                    formatStatCardAnnualizedRate={formatStatCardAnnualizedRate}
                    annualizeRate={statCardAnnualizeRate ?? annualizeRate}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-[560px] items-center justify-center text-gray-400">
                <div className="text-center">
                  <p>暂无可展示的图表数据。</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info section */}
      {renderInfoSection && renderInfoSection()}
    </div>
  );
}
