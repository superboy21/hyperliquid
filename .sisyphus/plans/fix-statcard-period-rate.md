# Fix FundingStatCard "当前:" to "周期:" with correct per-period rate

## Context

The `FundingStatCard` component shows "当前：" followed by `formatFundingRate(rate)`. For Lighter, `formatFundingRate` does `rate / 8 * 100`, but `rate` is already an hourly average — the `/8` produces incorrect values.

**User example**: 最高资金费率(7天) +10.51%, 当前：0.0150% — the 0.0150% is wrong.

## Root Cause

`formatFundingRate(rate)` applies exchange-specific formatting (e.g., Lighter's `/8` divide) to a rate value that's already an hourly average from `getFundingStats`. This double-converts for Lighter.

## Fix

### File: `src/components/funding/ExchangeFundingMonitor.tsx`

**In `FundingStatCard` component (lines 133-146):**

Replace:
```tsx
const annualizedStr = formatStatCardAnnualizedRate
  ? formatStatCardAnnualizedRate(rate, fundingIntervalSeconds)
  : formatAnnualizedRate(rate, fundingIntervalSeconds);
const isPositive = !annualizedStr.startsWith("-");

return (
  <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
    <p className="text-xs text-gray-400">{title}</p>
    <p className={`mt-2 font-mono text-lg font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {annualizedStr}
    </p>
    <p className="mt-1 text-xs text-gray-500">当前：{formatFundingRate(rate)}</p>
  </div>
);
```

With:
```tsx
const annualizedStr = formatStatCardAnnualizedRate
  ? formatStatCardAnnualizedRate(rate, fundingIntervalSeconds)
  : formatAnnualizedRate(rate, fundingIntervalSeconds);
const isPositive = !annualizedStr.startsWith("-");

// Derive per-settlement-period rate from the annualized value
const annualizedPctNum = parseFloat(annualizedStr.replace(/[^0-9.eE+\-]/g, "")) || 0;
const settlementsPerYear = 8760 / fundingIntervalSeconds;
const perPeriodRate = annualizedPctNum / settlementsPerYear;
const perPeriodStr = Math.abs(perPeriodRate) < 0.001
  ? `${perPeriodRate >= 0 ? "+" : ""}${perPeriodRate.toFixed(6)}%`
  : `${perPeriodRate >= 0 ? "+" : ""}${perPeriodRate.toFixed(4)}%`;

return (
  <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
    <p className="text-xs text-gray-400">{title}</p>
    <p className={`mt-2 font-mono text-lg font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {annualizedStr}
    </p>
    <p className="mt-1 text-xs text-gray-500">周期：{perPeriodStr}</p>
  </div>
);
```

## Verification

**Formula**: `perPeriodRate = annualizedPct / (8760 / fundingIntervalSeconds)`

| Exchange | Annualized | Interval | Per-period | Expected |
|----------|-----------|----------|------------|----------|
| Lighter | 10.51% | 3600s (1h) | 10.51/8760 = 0.12% | 0.12% ✓ |
| Binance | 10.95% | 28800s (8h) | 10.95/1095 = 1.00% | 1.00% ✓ |
| Hyperliquid | 50% | 3600s (1h) | 50/8760 = 0.571% | 0.571% ✓ |

## Changes Summary

- Label: "当前：" → "周期："
- Computation: derive from annualized value, not from raw rate via `formatFundingRate`
- Applies to ALL exchanges (single component)
- `formatFundingRate` prop no longer used in FundingStatCard (can be removed from props later if desired)

## QA

- Build: `npm run build` must pass
- Lighter: stat card "周期" shows correct per-hour rate (e.g., ~0.12% for +10.51% annualized)
- Binance: stat card "周期" shows correct per-8h rate
- Hyperliquid/Gate: stat card "周期" shows correct per-period rate
