# Plan: Update Exchange Category Lists

## Context
User wants to update category lists for newly listed futures contracts on Binance and Gate.io. These contracts are already showing on the page but are incorrectly categorized.

## Changes Required

### 1. Binance - Update STOCKS Array
**File**: `src/components/funding/BinanceFundingMonitor.tsx`
**Line**: ~129-135

Add `PAYP` to the STOCKS array (PayPal stock contract).

**Before**:
```typescript
const STOCKS = [
  "TSLA", "MSTR", "AMZN", "AAPL", "NVDA", "EWY", "EWJ", "QQQ", "SPY", "META", "GOOGL", "MSFT", "NFLX", "AMD", "INTC", "COIN",
  "BABA", "TSM", "JPM", "V", "MA", "DIS", "PYPL", "UBER", "ABNB", "SOFI", "PLTR", "HOOD", "RIVN", "LCID", "NIO",
  "XOM", "CRCL", "PFE", "JNJ", "UNH", "HD", "WMT", "COST", "TGT", "NKE", "SBUX", "MCD", "KO", "PEP",
  "QQQX", "TQQQ", "SPXL", "SOXL", "TNA", "UVXY", "VIX", "TLT", "IEF", "LQD", "HYG", "EMB",
  "MSTRX", "COINX", "NVDAX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX",
];
```

**After**:
```typescript
const STOCKS = [
  "TSLA", "MSTR", "AMZN", "AAPL", "NVDA", "EWY", "EWJ", "QQQ", "SPY", "META", "GOOGL", "MSFT", "NFLX", "AMD", "INTC", "COIN",
  "BABA", "TSM", "JPM", "V", "MA", "DIS", "PYPL", "UBER", "ABNB", "SOFI", "PLTR", "HOOD", "RIVN", "LCID", "NIO",
  "XOM", "CRCL", "PFE", "JNJ", "UNH", "HD", "WMT", "COST", "TGT", "NKE", "SBUX", "MCD", "KO", "PEP",
  "QQQX", "TQQQ", "SPXL", "SOXL", "TNA", "UVXY", "VIX", "TLT", "IEF", "LQD", "HYG", "EMB", "PAYP",
  "MSTRX", "COINX", "NVDAX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX",
];
```

### 2. Gate.io - Update 股票/指数 Category
**File**: `src/app/api/gate/futures/usdt/tickers/route.ts`
**Line**: ~30

Add `PAYP`, `GVZ`, `EWY` to the 股票/指数 array.

**Before**:
```typescript
"股票/指数": ["BABA", "TSLA", "NVDA", "AAPL", "AMZN", "META", "MSFT", "GOOGL", "NFLX", "INTC", "AMD", "COIN", "MSTR", "SPY", "QQQ", "JPM", "TSM", "SPX500", "NAS100", "US30", "TSLAX", "MSTRX", "SPYX", "COINX", "NVDAX", "QQQX", "CRCLX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX", "TLT", "AGG", "EURUSD", "GBPUSD", "HK50", "HKCHKD", "BVIX", "EVIX", "TW88"],
```

**After**:
```typescript
"股票/指数": ["BABA", "TSLA", "NVDA", "AAPL", "AMZN", "META", "MSFT", "GOOGL", "NFLX", "INTC", "AMD", "COIN", "MSTR", "SPY", "QQQ", "JPM", "TSM", "SPX500", "NAS100", "US30", "TSLAX", "MSTRX", "SPYX", "COINX", "NVDAX", "QQQX", "CRCLX", "AAPLX", "GOOGLX", "ORCLX", "TQQQX", "PLTRX", "METAX", "AMZNX", "HOODX", "TLT", "AGG", "EURUSD", "GBPUSD", "HK50", "HKCHKD", "BVIX", "EVIX", "TW88", "PAYP", "GVZ", "EWY"],
```

## Verification
- Run `lsp_diagnostics` on both files
- Verify no TypeScript errors
