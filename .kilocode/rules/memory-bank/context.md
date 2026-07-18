# Active Context: Six-Exchange Funding Monitor and Search

## Current State

**Template Status**: ✅ Active Development - Six-Exchange Funding Monitor and Search

The project now includes funding monitoring and cross-exchange search for Hyperliquid, Gate.io, Binance, OKX, Lighter, and Bitget, with:
- Public market data for perpetual contracts and Hyperliquid HIP-3 markets
- Annualized funding rate display
- 7-day and 30-day historical averages
- Five-minute funding-list refresh, progressive search details, and on-demand charts

## Recently Completed

- [x] Base Next.js 16 setup with App Router
- [x] TypeScript configuration with strict mode
- [x] Tailwind CSS 4 integration
- [x] ESLint configuration
- [x] Memory bank documentation
- [x] Recipe system for common features
- [x] Hyperliquid funding rate monitoring page
- [x] Funding rate display with 5-minute auto-refresh
- [x] Historical funding rate data (30-day view)
- [x] Search and sort functionality
- [x] Statistics dashboard (positive/negative rates, average)
- [x] **HIP-3 asset support** (xyz:gold, xyz:mstr, etc.)
- [x] **Annualized funding rate display** (rate × 1095)
- [x] **7-day and 30-day average annualized funding rates**
- [x] **Fixed HIP-3 predicted funding rates**: Using `premium` field from `fundingHistory` API instead of `fundingRate`
- [x] **Differentiated rate labels**: Standard assets show "预测年化", HIP-3 assets show "最新结算年化"
- [x] **Added all HIP-3 assets from spec**: Total 41 assets including XYZ100, PLATINUM, COPPER, CL, NATGAS, JPY, EUR, URNM, INTC, MU, PLTR, ORCL, HOOD, CRCL, SNDK, RIVN, USAR, TSM, SKHX, SMSN, HYUNDAI
- [x] **Added market data columns**: Mark price, 24h change %, 24h volume, open interest
- [x] **Enhanced sorting**: Added sort by price, 24h change, and open interest
- [x] **OI-weighted average**: Current average annualized rate uses open interest weighted calculation
- [x] **Position value weighted average**: Changed OI-weighted to position value (OI × markPrice) weighted for more accurate representation
- [x] **Added comprehensive README.md**: Project overview, features, technology stack, and getting started guide
- [x] **Lighter rate-limit throttling on Search page**: Split detail fetching into Lighter (concurrency 1, 200ms delay) and non-Lighter (concurrency 4) queues
- [x] **Lighter pagination delays**: Added 100ms sleep between pages in candle and funding history pagination
- [x] **Lighter global request throttle (300ms)**: `lighterFetch` now serialized through a global promise chain with 300ms minimum interval between any two Lighter HTTP attempts — prevents 429s under burst regardless of caller
- [x] **fetchLighterDetail removed redundant fundings call**: latest settlement rate now derived from the already-fetched 30-day funding history (3 calls per symbol instead of 4)
- [x] **2026-07-11 performance review completed**: production build succeeds; identified search-page eager detail/impact requests, Binance full-market OI hydration, chart bundle size, and chart history aggregation as the primary execution-efficiency targets.
- [x] **Lighter search index-price reliability**: Search now uses REST index prices first, merges market-ID keyed WebSocket snapshots, immediately starts bounded retries for unresolved visible matches, caches only complete snapshots, and can serve the last complete snapshot explicitly marked stale after a total live failure.
- [x] **Targeted Lighter index-price completion**: Search requests unresolved market IDs, applies ID-only matching when IDs exist, and the API reports incomplete snapshots until all requested (or all discovered) markets have valid prices.
- [x] **Target-aware Lighter collection timers**: Targeted WebSocket collection now extends only for valid changes to requested market IDs, and targeted `expected` counts match completion/missing semantics.
- [x] **Search result midpoint pricing**: The Search price column switches to “中间价” only for non-empty searches with matches, uses valid positive best bid/ask values, and shows `--` instead of falling back to last price.
- [x] **Search result midpoint premium**: Search-result premium display and sorting now use the validated midpoint against index price, while default and no-result views retain last-price premium.
- [x] **Lighter live midpoint hydration**: Lighter detail results retain the live top bid/ask already fetched for spread calculation, allowing Search midpoint and premium display/sorting to consume detail-cache quotes without restarting rate filtering.
- [x] **Bitget funding and Search architecture completed**: Added canonical V3 UTA list/history/candle/order-book normalization, bounded shared scheduling/retries, exact raw-symbol identity, Funding UI integration, Search result/detail/chart integration, and progressive Bitget request lanes.
- [x] **Bitget Phase 1 review fixes**: Aligned history with V3 `resultList`/`fundingRateTimestamp`, made recent candles the single first request with bounded history fallback, added one-request latest settlement loading, and expanded deterministic scheduler/proxy tests.
- [x] **Bitget semantics**: Scope is online `USDT-FUTURES` perpetuals; each contract's dynamic 1/2/4/8-hour funding interval drives annualization; official turnover and open interest semantics are preserved; `rawSymbol` is mandatory for transport; order-book sizes are base quantities; weekly candles aggregate UTC Monday-based daily candles.
- [x] **Bitget request control**: Browser calls Bitget V3 public endpoints directly because Bitget rejects Cloudflare Workers egress IPs with HTTP 403. The shared FIFO scheduler validates Bitget envelopes and enforces single concurrency, 250ms minimum starts plus jitter, bounded timeout/retries, API error mapping, and abort propagation.
- [x] **2026-07-18 validation**: 80 tests, TypeScript typecheck, ESLint, and production build all pass; an Origin-header probe confirmed Bitget responds with `Access-Control-Allow-Origin: *`.

## Current Structure

| File/Directory | Purpose | Status |
|----------------|---------|--------|
| `src/app/page.tsx` | Home page with feature cards | ✅ Ready |
| `src/app/layout.tsx` | Root layout | ✅ Ready |
| `src/app/globals.css` | Global styles | ✅ Ready |
| `src/app/funding/page.tsx` | Funding rate monitor page | ✅ Ready |
| `src/app/api/bitget/route.ts` | Legacy/diagnostic Bitget proxy (Cloudflare egress is blocked upstream) | ⚠️ Not used by browser adapter |
| `src/components/funding/FundingMonitor.tsx` | Main funding monitor component | ✅ Ready |
| `src/components/funding/BitgetFundingMonitor.tsx` | Bitget funding monitor integration | ✅ Ready |
| `src/lib/hyperliquid.ts` | Hyperliquid API service | ✅ Ready |
| `src/lib/adapters/bitget.ts` | Bitget canonical adapter and shared scheduler | ✅ Ready |
| `.kilocode/` | AI context & recipes | ✅ Ready |

## Features

### Funding Monitor Features

1. **Market Data Refresh**: Funding lists update every 5 minutes; selected history and charts load on demand
2. **HIP-3 Assets**: Supports the current XYZ, Vntl, Para, and Km HIP-3 market groups alongside standard Hyperliquid perpetuals
3. **Annualized Rates**: All rates displayed as annual percentages
4. **Historical Averages**: 7-day and 30-day rolling averages
5. **Sorting Options**: By current rate, 7d avg, 30d avg, volume, name
6. **Statistics Dashboard**: Market overview with key metrics

### API Integration

- `metaAndAssetCtxs`: Perpetual contract funding rates
- `spotMetaAndAssetCtxs`: HIP-3 spot market funding rates
- `fundingHistory`: Historical funding data (up to 30 days)
- Direct `https://api.bitget.com/api/v3/market/*` browser requests for Bitget public market data, scoped to online USDT perpetuals
- Bitget Funding/Search: Canonical rates load with the six-exchange universe; search details progress only after a matching query and charts load when selected

## Current Focus

Bitget Funding and Search integration is complete. Current behavior to preserve includes browser-direct Bitget transport (to avoid Cloudflare Workers 403), the six-exchange universe, five-minute funding refresh, progressive search-detail hydration, on-demand chart history, exact Bitget `rawSymbol` dispatch, and bounded per-exchange request scheduling.

## Quick Start Guide

### To add a new page:

Create a file at `src/app/[route]/page.tsx`:
```tsx
export default function NewPage() {
  return <div>New page content</div>;
}
```

### To add components:

Create `src/components/` directory and add components:
```tsx
// src/components/ui/Button.tsx
export function Button({ children }: { children: React.ReactNode }) {
  return <button className="px-4 py-2 bg-blue-600 text-white rounded">{children}</button>;
}
```

### To add a database:

Follow `.kilocode/recipes/add-database.md`

### To add API routes:

Create `src/app/api/[route]/route.ts`:
```tsx
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "Hello" });
}
```

## Available Recipes

| Recipe | File | Use Case |
|--------|------|----------|
| Add Database | `.kilocode/recipes/add-database.md` | Data persistence with Drizzle + SQLite |

## Pending Improvements

- [ ] Add more recipes (auth, email, etc.)
- [ ] Add example components
- [ ] Add testing setup recipe

## Session History

| Date | Changes |
|------|---------|
| Initial | Template created with base setup |
| 2026-02-28 | Added Hyperliquid funding monitor with HIP-3 assets, annualized rates, and historical averages |
| 2026-03-01 | Fixed HIP-3 predicted funding rates: using `premium` field from `fundingHistory` API instead of `fundingRate` |
| 2026-03-01 | Differentiated rate labels: standard assets show "预测年化", HIP-3 assets show "最新结算年化" |
| 2026-03-01 | Added all 41 HIP-3 assets from specification list including XYZ100, PLATINUM, COPPER, CL, NATGAS, JPY, EUR, URNM, INTC, MU, PLTR, ORCL, HOOD, CRCL, SNDK, RIVN, USAR, TSM, SKHX, SMSN, HYUNDAI |
| 2026-03-01 | Added market data columns: Mark price, 24h change %, 24h volume, open interest with sorting support |
| 2026-03-01 | Changed weighted average calculation from OI-weighted to position value (OI × markPrice) weighted for more accurate representation |
| 2026-07-02 | Fixed Lighter 429 errors on Search page: throttled Lighter detail fetching (concurrency 1, 200ms delay) and added 100ms pagination delays for candles/funding history |
| 2026-07-02 | Added global Lighter request throttle (300ms min interval) in `lighter.ts` and removed redundant `fundings` call in `fetchLighterDetail` (4→3 calls per symbol) |
| 2026-07-11 | Performance review: prioritize visible-row/on-demand detail loading with TTL cache, constrain Binance OI requests, lazily load ECharts, and replace candle-by-history filtering with a linear aggregation. |
| 2026-07-11 | Hardened Lighter Search index prices with REST hydration, market-ID-first WebSocket snapshots, complete-only short caching/stale fallback, completeness metadata, and immediate bounded partial retries. |
| 2026-07-11 | Corrected targeted Lighter snapshot completion, missing-market tracking, cache eligibility, useful-update timers, and pure React hydration updates. |
| 2026-07-11 | Restricted targeted Lighter collection timer resets to requested-market changes and aligned targeted response `expected` counts with requested IDs. |
| 2026-07-12 | Updated Search results to display and sort by bid/ask midpoint when a search has matches, with strict invalid-data handling and unchanged default pricing. |
| 2026-07-12 | Aligned Search premium display and sorting with midpoint pricing for matched searches, without a last-price fallback when midpoint or index data is invalid. |
| 2026-07-12 | Preserved Lighter order-book top quotes in Search detail cache and prioritized them for midpoint-based price, premium, and sorting calculations. |
| 2026-07-18 | Implemented Bitget Phase 1 transport and normalization, including strict proxy actions/status mapping, scheduler bounds, pagination/caps, weekly candles, quantity semantics, and adapter tests. |
| 2026-07-18 | Fixed Bitget Phase 1 review findings for official V3 history/list fields, recent-first candle pagination, one-request latest settlement, and deterministic abort/retry/proxy coverage. |
| 2026-07-18 | Completed Bitget Funding and Search integration with exact raw-symbol dispatch, dynamic funding intervals, progressive detail lanes, on-demand charts, server proxy scheduling, and six-exchange documentation; validation passed with 62 tests, typecheck, lint, and build. |
| 2026-07-18 | Fixed production Bitget 502 responses caused by upstream HTTP 403 against Cloudflare Workers: switched the browser adapter to direct CORS-enabled Bitget V3 requests, added strict envelope/error handling and direct-URL coverage; validation passed with 80 tests, typecheck, lint, and build. |
