# Active Context: Cross-Exchange Market Toolkit

## Current State

**Template Status**: ✅ Active Development - Seven-Exchange Perpetual, Spot, and Combination Analysis Toolkit

The project now includes funding monitoring plus perpetual search and Spot+Perp analysis for Hyperliquid, Gate.io, Binance, OKX, Lighter, Bitget, and Bybit, with:
- Public market data for perpetual contracts and Hyperliquid HIP-3 markets
- `/spot_perp_arbitrage` unified seven-exchange Spot+Perp search with source charts, ordered two-leg combinations, and visible-range analytics for Mixed, Perp/Perp, and Spot/Spot; spot lists, candles, books, and Impact depth come from the shared spot data layer (`/api/spot/[exchange]`, `src/lib/spot-*`, `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx`) — the standalone `/spotsearch` page and its `SpotMarketSearch` UI were removed
- Bybit implemented across `/funding`, perpetual `/search`, and `/spot_perp_arbitrage` (spot support enables the arbitrage leg)
- Bybit perp scope: Trading USDT LinearPerpetual instruments via paginated/cacheable metadata and bulk linear tickers (funding/L1/OI/volume), exact raw symbols, variable interval-driven annualization, lazy settled funding history, ascending normalized V5 candles, on-demand depth
- Bybit spot and perp categories namespace identical `BTCUSDT` symbols; spot uses bulk V5 tickers/candles/books, and arbitrage keeps kind-qualified market IDs
- Bybit direct-first public V5 transport with a strict same-origin `/api/bybit` fallback and a globally shared controlled-throughput profile (max 2 in-flight requests, min 100ms between starts, <=10 starts/sec — deliberately far below Bybit's 600 requests/5 seconds/IP public cap); retry/backoff/Retry-After, timeout, FIFO, abort, and envelope guards remain; depth policies are spot 50/200 and perp 100/500
- Bybit request-reduction: settled funding-history windows are interval-aware (one V5 request holds up to 200 rows) and capped at a conservative 90 days, cutting the 30-day detail history to 1 request for 4h/8h/1d funding and 4 for 1h; module-level TTL caches (settled history 5m, candles 120s) use raw-symbol/interval keys with strict range containment, defensive copies, and no writes on abort/failure; current ticker vs settled history semantics stay separate
- Annualized funding rate display
- 7-day and 30-day historical averages
- Five-minute funding-list refresh, progressive search details, and on-demand charts
- Existing indicators/charts retain the established logic: funding lists refresh every 5 minutes, list sampling avoids per-symbol order books, and history/details load on demand
- Intraday Perp funding charts preserve `sampleCount: 0` as a true gap: at 4h/1h/5m, genuinely sparse settlement-bearing candle buckets render as visible markers without zero-fill or interpolation; 1m intentionally keeps the funding pane hidden

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
- [x] **Bitget daily candle window fix**: The initial V3 `candles` request is now clamped to the same inclusive-safe 90-day maximum as history requests, preventing daily/weekly requests from sending the former 99-day span rejected by Bitget.
- [x] **Bitget zero-width pagination fix**: Recent and history candle transport now guarantees `startTime < endTime`, skips ineligible unaligned seams, and widens eligible aligned seams to recover the boundary candle. Canonical detail also preserves funding, settlement, and BBO metrics when only the candle branch fails.
- [x] **2026-07-18 validation**: 88 tests, TypeScript typecheck, ESLint, and production build all pass; live Origin-header probes confirmed Bitget CORS and the corrected XAUUSDT daily request return HTTP 200.
- [x] **Six-exchange Spot Search**: Added Hyperliquid, Gate.io, Binance, Lighter, OKX, and Bitget spot lists with normalized `exchange:marketKey` identity and canonical base/quote pairs.
- [x] **Strict spot facade**: `/api/spot/[exchange]` permits only validated `list`, `candles`, and `book` operations against fixed upstream hosts.
- [x] **Search-gated spot details**: Historical volatility and Top spread load only after a non-empty matching search; Impact depth loads only in Impact mode, with bounded concurrency and cancellation.
- [x] **On-demand spot charts**: Selecting one market loads a two-panel candle plus quote-turnover/base-volume chart with no funding panel.
- [x] **Maximum REST depth limits**: Order books are capped at Hyperliquid 20, Gate.io 100, Binance 5000, Lighter 250, OKX 5000, and Bitget 150 levels.
- [x] **Hyperliquid PURR spot transport fix**: Spot normalization now uses the API-required `PURR/USDC` transport symbol for PURR while retaining `@index` transport symbols for all indexed markets.
- [x] **Spot quote-currency filter**: Spot Search defaults to exact `USDT` pairs and can switch between `USDC`, `U`, `USD1`, `USD`, or all pairs before keyword/detail/Impact filtering.
- [x] **Binance U/USD1 pair parsing**: The concatenated Binance ticker symbols now recognize exact `U` and `USD1` suffixes, retaining markets such as `BTC/U`, `BNB/U`, and `BTC/USD1`.
- [x] **Hyperliquid proxy header fix**: Node proxy requests now normalize header names case-insensitively, preventing duplicate `Content-Type` values that caused Hyperliquid to return text/plain HTTP 415 and the spot facade to report a misleading 502.
- [x] **Impact depth modes**: Spot Search, Perp Search, and Funding default to standard depth (Hyperliquid 20, every other venue 100) and expose an Impact-only toggle for each Spot/Perp venue's maximum REST depth. Switching modes aborts stale work, clears only Impact results, and preserves notional/detail/chart state.
- [x] **Unified Impact VWAP**: Spot, generic Perp, and Bitget Perp now share one quote-notional VWAP implementation that sorts copied bids/asks best-to-worst, preserves partial final-level fills, and never mutates source books.
- [x] **Gate multiplier fail-closed**: Gate Perp Impact converts contract counts with a validated `quanto_multiplier`; missing, invalid, zero, or failed multiplier lookup returns `no_multiplier` and displays `缺少合约乘数` instead of assuming 1.
- [x] **Gate ticker proxy reliability**: The Perp Search Gate ticker route now uses the shared proxy-aware transport for both tickers and contracts with bounded timeouts, eliminating direct Node requests that intermittently exceeded 30 seconds and returned HTTP 500.
- [x] **Six-exchange Spot/Perp analysis**: Added `/spot_perp_arbitrage` with a unified nullable market table, default USDT spot filtering, source single-market charts, and Perp/Perp, Spot/Spot, or mixed combinations.
- [x] **Explicit compact query contract**: Exactly one `-` or `/` creates an ordered two-leg query; selection order defines leg 1/leg 2, and `BTC/USDT` is intentionally parsed as a BTC-to-USDT ratio query rather than exact pair search.
- [x] **Aligned combination analytics**: Two-leg candles use exact timestamp intersection and shorter available history; mixed dashboards consume the visible data-end range and report per-tail trimmed mean/population σ, signed observed funding, and separate Spot/Perp turnover averages.
- [x] **Final Spot/Perp Oracle review**: Final Oracle gate returned GO after legacy Perp parity, positive ratio inputs, progressive BBO projection, result discrimination, data-end range contracts, and chart-range transitions were remediated. Final validation passed: 153 tests, 501 assertions, typecheck, ESLint, production build, and local page/API smoke tests.
- [x] **Arbitrage Binance OI hydration**: `/spot_perp_arbitrage` now mirrors Perp Search's search-gated `hydrateSearchBinanceOpenInterest` flow, replacing Binance's temporary 24h-turnover notional placeholder with actual open interest × mark price through abort/generation-safe immutable updates.
- [x] **Arbitrage default ranking**: Search results on `/spot_perp_arbitrage` now default to 24h quote turnover descending, while retaining sortable table headers.
- [x] **Mixed current-value and mean-gap metrics**: The mixed dashboard now shows the latest visible spread/ratio close and annotates it plus all four ±1σ/±2σ bands with relative distance to the trimmed mean, using `(value - mean) / |mean| × 100` and `--` for a zero/unavailable mean.
- [x] **Two-leg pair dashboards**: `/spot_perp_arbitrage` now shows the visible-range dashboard for Perp/Perp and Spot/Spot, and `/search` shows it for Perp/Perp. Perp pairs use the actual-sample mean of leg 1 annualized funding minus leg 2 and preserve separate turnover means; Spot pairs omit funding and preserve separate Spot turnover means.
- [x] **Dashboard methodology notes**: Every shared combination dashboard now uses compact, chart-legend-style emoji rows to explain visible-range alignment, current-value direction, symmetric tail trimming, population σ, relative-gap formula, composition-specific funding treatment, per-leg turnover averaging, and effective sample counts.
- [x] **OKX 429 resilience**: `/api/okx` preserves upstream status/error and `Retry-After` instead of rewriting 429 to 500; all OKX calls serialize through a 200ms global throttle with bounded 429/5xx retries honoring `Retry-After` (≤60s); funding history pages use the official 400-row max; the full-market funding snapshot is single-flighted with a 10s TTL; Search routes OKX details through a concurrency-1, 200ms-delay lane.
- [x] **Spot-perp arbitrage OKX detail lane**: `SpotPerpArbitrageController` computed `lanes.okx` via `partitionProgressiveDetailRates` but never dispatched it, so OKX perps stayed in `detailLoading` forever (volatility/spread spun, settlement/average rates blank). Added `runBounded(lanes.okx, 1, ..., 200)` to the detail effect, mirroring the Search page.
- [x] **Direct-first spot transport**: `/spotsearch` and `/spot_perp_arbitrage` spot data now fetch exchange public APIs directly from the browser (user's own IP, bypassing Cloudflare Workers egress blocks) with proxy fallback. `buildSpotUpstreamRequest` moved to shared `src/lib/spot-upstream.ts`; new `spotFetch` helper (`src/lib/spot-fetch.ts`) tries direct first and falls back to `/api/spot/[exchange]` on CORS/network failure. Wired into `spot-search.ts` (list/book), `spot-search-candles.ts` (candles), and `spot-impact-price.ts` (book). OKX perp `okxFetch` is now direct-first too (translates `/api/okx?endpoint=...` to `https://www.okx.com/api/v5/...`, proxy only on network/CORS throw), covering impact-price and search-candles OKX calls. Gate.io stays proxy-only because it sends no `Access-Control-Allow-Origin` header (browser direct impossible) and is not blocked on cloud. Validation passed with 175 tests/575 assertions, typecheck, ESLint, and production build.
- [x] **Exchange names no longer searchable**: `filterSpotMarkets` (spotsearch) and `identifiers`/`marketMatches` (arbitrage search) previously matched the exchange name, so searching "hype" surfaced every Hyperliquid market. Removed `row.exchange` / `source.exchange` from the match fields on both pages; tests updated to assert exchange names never match. Perp `/search` was already symbol-only. Validation passed with 175 tests/577 assertions and typecheck.
- [x] **Hyperliquid spot assetCtxs indexed by market index, not position**: `spotMetaAndAssetCtxs` returns 712 asset contexts indexed by spot market index (indices have gaps after delistings) while the spot universe has 321 entries. `normalizeHyperliquid` read `contexts[position]`, so every market after the first index gap (index 71) got the wrong context — e.g. HYPE/USDC (position 105, index 107) showed the dead market at index 105 with 0 volume. Now reads `contexts[marketIndex]` (`market.index ?? position`); test updated with a decoy context at position 1 to catch misalignment. Other consumers (hyperliquid.ts, normalizers/hyperliquid.ts) already index correctly.
- [x] **Exchange exclusion filter on arbitrage search**: `searchArbitrageMarkets` gained a 5th param `excludedExchanges: ReadonlySet<ArbitrageExchange>` (new exported union of the six exchanges), applied to the eligible pool before matching (normal and combo). The arbitrage page renders six toggle chips (Hyperliquid/Gate.io/Binance/Lighter/OKX/Bitget) in the status row below the search box, left of the Perp/Spot readiness text; all on by default, clicking toggles an exchange off/on (excluded shows dimmed with line-through), selection/chart reset on change, and a dedicated message appears when all six are excluded. Validation passed with 176 tests/582 assertions, typecheck, and ESLint.
- [x] **Funding-rate sign coloring in arbitrage table**: the 最新结算费率 / 平均费率（2天/7天/30天）cells in `ArbitrageMarketTable` now color by sign — green-400 for positive, red-400 for negative, gray-400 at zero — matching the perp `/search` page (`rateSignClass` helper; sign is preserved through annualization so raw-value sign matches the displayed value). Null cells stay "--". Validation passed with 176 tests/582 assertions and typecheck.
- [x] **Bybit integration completed (2026-08-09)**: Bybit implemented in `/funding`, perpetual `/search`, `/spotsearch`, and `/spot_perp_arbitrage`. Canonical V5 adapter (paginated/cached Trading USDT LinearPerpetual metadata, bulk linear tickers, lazy 30-day funding history, ascending normalized candles, on-demand books) with exact raw symbols, variable-interval annualization, raw-keyed settlement hydration, direct-first transport with strict same-origin `/api/bybit` fallback, and spot 50/200 + perp 100/500 depth policies. Verified: typecheck, 273 tests/969 assertions, and production build pass.
- [x] **Bybit controlled-throughput experiment (2026-08-09)**: `BYBIT_SCHEDULER_PROFILE` is globally shared by all Bybit traffic — max 2 in-flight requests with min 100ms between starts (<=10 starts/sec), deliberately far below Bybit's 600 requests/5 seconds/IP public cap; retry/backoff/Retry-After, timeout, FIFO, abort, direct-first/proxy fallback, and envelope guards unchanged. Independent Bybit detail rows on `/search` and `/spot_perp_arbitrage` run at concurrency 2 (via `src/lib/search-detail-lanes.ts`); all other exchange lane profiles are unchanged and single-symbol funding-history pagination stays sequential. Validation: targeted 60 tests, full suite 278 tests/983 assertions, typecheck, and production build all pass.
- [x] **Bybit request-reduction optimization (2026-08-09)**: settled funding-history windows are now interval-aware (one V5 request holds up to 200 rows) and capped at a conservative 90 days, cutting the 30-day detail history from 5 requests to 1 for 4h/8h/1d funding and from 5 to 4 for 1h — the controlled scheduler stays at max 2 in-flight with 100ms start spacing, no rate increase. Module-level caches: settled funding history TTL 5m and candles TTL 120s, keyed by raw symbol/interval with strict range containment, defensive copies, and no cache writes on abort/failure; current ticker vs settled history semantics remain separate. `/search` keeps full price candle history but bounds only the Bybit funding overlay to the latest 90 days, so missing historical samples render chart gaps rather than fake zeros; combo and mixed charts preserve observed-zero vs missing semantics. `/api/bybit` permits funding-history windows up to 90 days under strict validation. Verified: live official 30d history query returns retCode 0; full suite 306 tests/1074 assertions, typecheck, and production build pass.
- [x] **Standalone `/spotsearch` removed (2026-08-09)**: removed the standalone spot-search route and its page-only `SpotMarketSearch` component; `/spot_perp_arbitrage` retains all spot functionality through the shared data layer (`/api/spot/[exchange]`, `src/lib/spot-*`, `src/lib/spot-upstream.ts`, `src/lib/spot-fetch.ts`) and the moved `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx`; obsolete `/spotsearch` nav links removed from funding/search/arbitrage pages. Product routes are now `/funding`, `/search`, and `/spot_perp_arbitrage`. Verified: typecheck and production build pass; `/spotsearch` no longer appears as a generated route.
- [x] **Impact spread detail on arbitrage page (2026-08-10)**: In Impact mode, the `/spot_perp_arbitrage` spread cell now shows, below the total impact spread, 买入冲击价差 `(冲击卖价 − BBO 中间价) / BBO 中间价 × 100` and 卖出冲击价差 `(BBO 中间价 − 冲击买价) / BBO 中间价 × 100`. `computeOrderBookImpactDetail` (shared core in `src/lib/order-book-impact.ts`, delegated by `fetchImpactSpreadDetail`/`fetchSpotImpactSpreadDetail` and the Bitget/Bybit adapters) returns `{ bidPrice, askPrice, mid, bboMid, spread, buyImpactSpread, sellImpactSpread }`; the total spread keeps the impact-VWAP mid denominator while the two sub-spreads use the top-of-book BBO mid, so 买入 + 卖出 no longer sums to the total spread by construction. Controller stores `ImpactSpreadDetailResult` per row; table renders the two sub-values via `formatSignedPercent` with `title` tooltips 买入冲击价差/卖出冲击价差. Verified: 172 tests/553 assertions, typecheck, and lint pass (1 pre-existing CrossExchangeSearch warning).

- [x] **Intraday funding settlement markers (2026-08-11)**: Single Perp, Perp/Perp, and Spot/Perp charts now show 4h/1h/5m buckets that contain actual funding samples as explicit markers when the series is genuinely sparse. `showAllSymbol: true` prevents ECharts category-label thinning from hiding isolated observations; unavailable `sampleCount: 0` buckets remain null gaps with no zero-fill or interpolation. Dense series retain the existing line-only presentation, and 1m remains intentionally hidden.

- [x] **Arbitrage chart tooltip refinement (2026-08-12)**: `/spot_perp_arbitrage` source and combination candlestick tooltips now show each candle's `(close − open) / open × 100` change directly below the close. Spread/ratio tooltips no longer repeat the close as a separate `Spread`/`Ratio` row, and missing combination funding displays concise `资金费率差: 无` / `有符号年化资金费率：无` text even when ECharts omits the null series item from axis-tooltip parameters.

- [x] **Local Gate route-cache recovery (2026-08-12)**: The running Next dev process temporarily returned its own HTML 404 page for existing nested Gate API routes even though source files, compiled route modules, and `.next/dev/server/app-paths-manifest.json` entries were present. Restarting the workspace dev process rebuilt the in-memory route registry; `/api/gate/futures/usdt/tickers` and `/contracts` returned 200 again, with the ticker route yielding 900 rows. No application-source route change was required.

- [x] **Intraday Perp/Perp chart-only zero semantics (2026-08-12)**: For 4h/1h/5m funding-difference charts, if exactly one contract has an actual settlement sample and the other has an explicit `sampleCount === 0` bucket, the missing leg contributes a temporary zero to `leg1 − leg2`; both-missing buckets remain gaps. This zero is chart-only: `dashboardFundingRates` still requires two actual samples, 1d/1w remain strict, 1m remains strict/hidden, absent timestamps and malformed data never infer zero, and higher intervals aggregate independently from raw settlement history.

- [x] **Per-leg funding detail in combo tooltip (2026-08-12)**: Valid Perp/Perp funding-difference tooltip points now preserve and display each leg's own annualized and raw settlement rate beneath the difference, formatted on one row as `annualized（raw）` with exchange/symbol labels. A leg that contributed the 4h/1h/5m chart-only temporary zero displays `无结算费率`; unavailable derived points still show only `资金费率差: 无`. Combo funding metadata records only actual observations and never promotes a temporary zero into historical or dashboard data.

## Current Structure

| File/Directory | Purpose | Status |
|----------------|---------|--------|
| `src/app/page.tsx` | Home page with feature cards | ✅ Ready |
| `src/app/layout.tsx` | Root layout | ✅ Ready |
| `src/app/globals.css` | Global styles | ✅ Ready |
| `src/app/funding/page.tsx` | Funding rate monitor page | ✅ Ready |
| `src/app/spot_perp_arbitrage/page.tsx` | Unified seven-exchange Spot/Perp analysis page | ✅ Ready |
| `src/app/api/spot/[exchange]/route.ts` | Strict seven-exchange spot list/candle/book facade (uses shared `spot-upstream` builder) | ✅ Ready |
| `src/lib/spot-upstream.ts` | Shared spot upstream URL/init builder (server proxy + browser direct) | ✅ Ready |
| `src/lib/spot-fetch.ts` | Direct-first spot fetch with proxy fallback | ✅ Ready |
| `src/app/api/bitget/route.ts` | Legacy/diagnostic Bitget proxy (Cloudflare egress is blocked upstream) | ⚠️ Not used by browser adapter |
| `src/app/api/bybit/route.ts` | Strict allowlisted Bybit V5 proxy; direct-first fallback target | ✅ Ready |
| `src/components/funding/FundingMonitor.tsx` | Main funding monitor component | ✅ Ready |
| `src/components/funding/BitgetFundingMonitor.tsx` | Bitget funding monitor integration | ✅ Ready |
| `src/components/funding/BybitFundingMonitor.tsx` | Bybit funding monitor integration | ✅ Ready |
| `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx` | Two-panel spot candle and turnover/volume chart (shared; moved from spotsearch) | ✅ Ready |
| `src/components/spot-perp-arbitrage/` | Unified table/controller, spot-containing charts, and shared combination dashboard | ✅ Ready |
| `src/lib/hyperliquid.ts` | Hyperliquid API service | ✅ Ready |
| `src/lib/adapters/bitget.ts` | Bitget canonical adapter and shared scheduler | ✅ Ready |
| `src/lib/adapters/bybit.ts` | Bybit canonical V5 adapter and shared FIFO scheduler | ✅ Ready |
| `src/lib/search-detail-lanes.ts` | Shared per-exchange detail lane profile (Bybit concurrency 2) | ✅ Ready |
| `src/lib/spot-search.ts` | Spot market normalization, identity, lists, and details | ✅ Ready |
| `src/lib/spot-search-candles.ts` | Spot candle transport and normalization | ✅ Ready |
| `src/lib/spot-impact-price.ts` | Max-depth spot Impact spread requests | ✅ Ready |
| `src/lib/spot-combo.ts` | Spot candle combination utility (not wired to any page UI) | ✅ Ready |
| `src/lib/spot-perp-arbitrage/` | Unified market/query/selection, candle alignment, combination, and analytics domain | ✅ Ready |
| `.kilocode/` | AI context & recipes | ✅ Ready |

## Features

### Funding Monitor Features

1. **Market Data Refresh**: Funding lists update every 5 minutes; selected history and charts load on demand
2. **HIP-3 Assets**: Supports the current XYZ, Vntl, Para, and Km HIP-3 market groups alongside standard Hyperliquid perpetuals
3. **Annualized Rates**: All rates displayed as annual percentages
4. **Historical Averages**: 7-day and 30-day rolling averages
5. **Sorting Options**: By current rate, 7d avg, 30d avg, volume, name
6. **Statistics Dashboard**: Market overview with key metrics

### Spot/Perp Analysis Features

1. **Unified Search**: Seven-exchange Spot+Perp results; Spot defaults to USDT and supports USDC/U/USD1/USD/all
2. **Explicit Ordered Grammar**: One `-` or `/` selects spread or ratio terms, and click order defines both legs (`BTC/USDT` is a ratio query)
3. **Source and Combination Charts**: Source single charts plus legacy Perp/Perp and aligned Spot/Spot or mixed charts
4. **Shorter Exact Overlap**: Combinations intersect exact candle timestamps and use the shorter aligned history
5. **Visible Combination Dashboard**: Mixed, Perp/Perp, and Spot/Spot data-end range statistics with per-tail trimming, population σ, sample-aware funding where applicable, and separate leg turnover means; Perp Search reuses the Perp/Perp dashboard
6. **Analysis Only**: No automated arbitrage execution or order placement

### API Integration

- `metaAndAssetCtxs`: HyperCore perpetual metadata/context and funding rates
- dex-scoped `metaAndAssetCtxs`: HIP-3 perpetual metadata/context and funding rates
- `spotMetaAndAssetCtxs`: HyperCore spot metadata/context (not HIP-3 funding)
- `fundingHistory`: Historical funding data (up to 30 days)
- Direct `https://api.bitget.com/api/v3/market/*` browser requests for Bitget public market data, scoped to online USDT perpetuals
- Bitget Funding/Search: Canonical rates load with the seven-exchange universe; search details progress only after a matching query and charts load when selected
- Direct-first `https://api.bybit.com/v5/*` browser requests for Bybit public market data, scoped to Trading USDT LinearPerpetuals, with a strict same-origin `/api/bybit` fallback on transient/network/CORS/geo failures only (validation and business errors never fall back; proxy parameters are allowlisted)
- Bybit Funding/Search/Spot/Arbitrage: Canonical rates load with the seven-exchange universe; search details progress only after a matching query and charts load when selected

## Current Focus

Funding, perpetual Search, and `/spot_perp_arbitrage` Spot+Perp analysis are complete; the standalone `/spotsearch` page was removed, but the shared spot data layer (lists, candles, books, Impact depth) is preserved as a dependency of the arbitrage page. Preserve direct-first Bybit transport with its strict same-origin `/api/bybit` fallback, browser-direct Bitget perpetual transport, five-minute funding refresh, exact raw-symbol dispatch, bounded request scheduling, search-gated expensive spot detail calls, compact ordered query semantics, exact aligned overlap, and visible-range combination analytics. The Spot/Perp page is analytical only and must not imply automated execution.

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
| 2026-07-18 | Fixed Bitget daily/weekly candle requests exceeding the V3 90-day window by clamping the initial recent request to 90 aligned candles; the reported XAUUSDT request now returns HTTP 200 and validation passes with 81 tests. |
| 2026-07-18 | Fixed Bitget `code=20001` zero-width candle pagination on Funding/Search, recovered eligible aligned boundaries, and added candle-only Search detail degradation so funding averages, settlement, and BBO remain available; Oracle accepted and validation passes with 88 tests. |
| 2026-08-01 | Completed six-exchange Spot Search with strict facade, normalized pair identity, search-gated volatility and Top/Impact spreads, on-demand two-panel charts, max REST depth caps, and PURR special transport. Validation passed: 102 tests, typecheck, lint, production build, and live six-exchange list/candle/book/max-depth smoke. |
| 2026-08-01 | Added an exact quote-currency selector to Spot Search, defaulting to USDT with USDC/U/USD1/USD/all options; excluded markets no longer enter search-gated detail or Impact queues. |
| 2026-08-01 | Fixed Binance concatenated-symbol decomposition for the new U and USD1 quote assets. Live normalization found 47 U markets (including BTC/U and BNB/U) and 31 USD1 markets; focused tests and typecheck pass. |
| 2026-08-01 | Fixed proxy-mode Hyperliquid Spot list failures by deduplicating case-insensitive JSON headers and mapping non-JSON upstream errors before success parsing. Local `/api/spot/hyperliquid?action=list` now returns 200 with 320 markets. |
| 2026-08-01 | Audited Perp Impact depth. Hyperliquid already uses its REST maximum; Gate/Binance/OKX/Lighter/Bitget currently request below their effective maxima. Live probes confirmed Gate futures returns 100 levels and OKX books-full returns 5000 levels for SWAP; adaptive escalation is recommended for bulk Search. |
| 2026-08-01 | Unified Spot/Perp/Bitget Impact math behind one sorted, non-mutating VWAP helper and changed Gate multiplier handling to fail closed with an explicit UI state. Final validation after depth-policy integration passed: 117 tests, typecheck, lint, and production build. |
| 2026-08-01 | Centralized Perp Impact depth at 100 levels where supported, retaining Hyperliquid's 20-level REST cap. Live probes returned 20/20 for Hyperliquid and 100/100 for Gate, Binance, OKX, Lighter, and Bitget. |
| 2026-08-01 | Added standard/max REST Impact depth modes across Spot Search, Perp Search, and Funding. Standard remains HL 20/others 100; maximum limits are market-type specific. Validation passed: 121 tests, typecheck, lint, and production build. |
| 2026-08-02 | Fixed intermittent Gate Perp Search ticker HTTP 500 errors by routing ticker/contract requests through `proxyFetch` with a 10-second bound. Local verification improved from a 30-second 500 to three consecutive HTTP 200 responses in 3.3–4.0 seconds; focused tests and typecheck pass. |
| 2026-08-02 | Completed `/spot_perp_arbitrage`: unified six-exchange Spot+Perp search, default-USDT quote filtering, source and ordered combination charts, exact shorter-history alignment, and visible mixed analytics. `BTC/USDT` is explicitly a ratio query. Final Oracle GO recorded; validation passed with 153 tests/501 assertions, typecheck, ESLint, production build, and local HTTP smoke tests. |
| 2026-08-02 | Fixed Binance持仓价值 on `/spot_perp_arbitrage` by hydrating only matched pending Binance perps and replacing the quote-volume placeholder with actual OI notional. Focused tests, typecheck, scoped ESLint, production build, and live BTCUSDT verification passed; live notional and 24h turnover differed as expected. |
| 2026-08-02 | Changed `/spot_perp_arbitrage` result-table default sorting to 24h quote turnover descending; typecheck and scoped ESLint pass. |
| 2026-08-02 | Added visible-range spread/ratio current value and relative-to-mean percentages for the current value and all four σ bands. Current value remains untrimmed while its reference mean follows the selected per-tail trim. Validation passed with 38 focused tests/139 assertions, typecheck, scoped ESLint, and production build. |
| 2026-08-02 | Extended the shared visible-range dashboard to Perp/Perp and Spot/Spot on `/spot_perp_arbitrage` and Perp/Perp on `/search`. Perp funding uses actual aligned samples of leg 1 minus leg 2, each leg keeps an independent turnover mean, and Spot/Spot omits funding. Validation passed with 165 tests/545 assertions, typecheck, scoped ESLint, and production build. |
| 2026-08-02 | Added responsive, composition-aware calculation notes below every shared combination dashboard, then compacted them into professional emoji-led chart-legend rows. Scoped ESLint, typecheck, and production build pass. |
| 2026-08-03 | Fixed OKX evening 429 outages on Perp Search (midpoint/premium/spread/funding all blank): proxy now preserves upstream status and Retry-After, all OKX calls share a 200ms serial throttle with bounded 429/5xx retries, funding history uses 400-row pages, funding snapshot is single-flighted with a 10s TTL, and OKX details get a concurrency-1/200ms lane. Validation passed with 174 tests/571 assertions, typecheck, ESLint, and production build. |
| 2026-08-03 | Fixed OKX perp details still blank on the spot-perp arbitrage page: the controller computed `lanes.okx` but never dispatched it, so OKX perps never resolved (volatility/spread spun, settlement/average rates blank). Added the missing `runBounded(lanes.okx, 1, ..., 200)` lane. Typecheck, ESLint, and production build pass. |
| 2026-08-03 | Added Spot-only / Perp-only filter buttons next to the `/spot_perp_arbitrage` search box. `searchArbitrageMarkets` gained a `MarketKindFilter` param ("all"/"spot"/"perp") applied after quote filtering; the controller tracks `marketFilter` with toggle buttons (clicking the active one clears the filter), resets selection/chart on filter change, and shows a filter-aware empty-result message. Validation passed with 175 tests/575 assertions, typecheck, ESLint, and production build. |
| 2026-08-03 | Made Spot data (and OKX perp data) direct-first on `/spotsearch` and `/spot_perp_arbitrage` to bypass Cloudflare Workers egress blocks on Binance/OKX/Bitget. Extracted `buildSpotUpstreamRequest` to shared `src/lib/spot-upstream.ts`, added direct-first `spotFetch` with proxy fallback, and converted `okxFetch` to direct-first (proxy only on network/CORS throw). Gate.io stays proxy-only (no CORS headers; not cloud-blocked). Validation passed with 175 tests/575 assertions, typecheck, ESLint, and production build. |
| 2026-08-04 | Removed exchange-name matching from spotsearch (`filterSpotMarkets`) and arbitrage search (`identifiers` in `query.ts`) so queries like "hype" no longer surface all Hyperliquid markets; search now covers pair/assets/raw symbol/market key/ID only. Tests updated to assert exchange names never match. Validation passed with 175 tests/577 assertions and typecheck. |
| 2026-08-04 | Fixed Hyperliquid spot 24h volume showing 0 (e.g. HYPE/USDC): `normalizeHyperliquid` read assetCtxs by universe position instead of market index; `spotMetaAndAssetCtxs` indexes contexts by market index with gaps after delistings (712 ctxs vs 321 universe entries), so all markets after the first gap read the wrong (often dead, 0-volume) context. Now `contexts[marketIndex]`; live API check: HYPE/USDC dayNtlVlm 33.9M. Validation passed with 175 tests/578 assertions and typecheck. |
| 2026-08-04 | Added per-exchange toggle chips to `/spot_perp_arbitrage` (below search box, left of Perp/Spot readiness): all six exchanges on by default, click to exclude/include; `searchArbitrageMarkets` gained `excludedExchanges` param applied before matching. Selection/chart reset on change; dedicated message when all excluded. Validation passed with 176 tests/582 assertions, typecheck, and ESLint. |
| 2026-08-04 | Arbitrage table funding-rate columns (最新结算费率, 平均费率 2d/7d/30d) now colored by sign: green positive / red negative / gray zero, same as the perp `/search` page. Validation passed with 176 tests/582 assertions and typecheck. |
| 2026-08-09 | Completed Bybit integration across `/funding`, `/search`, `/spotsearch`, and `/spot_perp_arbitrage`: canonical V5 adapter (paginated/cached Trading USDT LinearPerpetual metadata, bulk linear tickers, lazy 30-day funding history, ascending normalized V5 candles, on-demand books), exact raw symbols with raw-keyed settlement hydration, variable-interval annualization, direct-first public V5 transport with strict same-origin `/api/bybit` fallback (interval-aware proxy validation, allowlisted parameters), and shared depth policies (spot 50/200, perp 100/500). Verified: typecheck, 273 tests/969 assertions, and production build pass. |
| 2026-08-09 | Bybit controlled-throughput experiment: globally shared `BYBIT_SCHEDULER_PROFILE` caps at 2 in-flight requests with 100ms minimum start spacing (<=10 starts/sec, deliberately far below Bybit's 600 requests/5 seconds/IP public cap); retry/backoff/Retry-After, timeout, FIFO, abort, direct-first/proxy fallback, and envelope guards preserved. Bybit detail lanes run at concurrency 2 on `/search` and `/spot_perp_arbitrage` (`src/lib/search-detail-lanes.ts`); other exchange lanes and single-symbol pagination unchanged. Validation: targeted 60 tests, full suite 278 tests/983 assertions, typecheck, and production build pass. |
| 2026-08-09 | Bybit request-reduction optimization: settled funding-history windows are interval-aware (one V5 request holds up to 200 rows) and capped at a conservative 90 days, cutting the 30-day detail history from 5 to 1 requests for 4h/8h/1d funding and from 5 to 4 for 1h; module TTL caches (settled history 5m, candles 120s) with raw-symbol/interval/range containment, defensive copies, and no writes on abort/failure; current ticker vs settled history semantics stay separate. `/search` retains full price candle history while bounding only the Bybit funding overlay to the latest 90 days (missing samples render chart gaps, never fake zeros; combo/mixed charts preserve observed-zero vs missing semantics); `/api/bybit` permits up-to-90-day history windows under strict validation. Verified: live official 30d history query returns retCode 0; full suite 306 tests/1074 assertions, typecheck, and production build pass. |
| 2026-08-09 | Removed standalone `/spotsearch` page and its page-only `SpotMarketSearch` component; `/spot_perp_arbitrage` retains spot functionality via the shared data layer (`/api/spot/[exchange]`, `src/lib/spot-*`) and the moved `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx`; obsolete `/spotsearch` nav links removed from funding/search/arbitrage pages. Product routes are now `/funding`, `/search`, `/spot_perp_arbitrage`. Verified: typecheck and production build pass. |
| 2026-08-10 | Added Impact spread detail to `/spot_perp_arbitrage`: in Impact mode the spread cell shows, below the total impact spread, 买入冲击价差 `(冲击卖价 − BBO 中间价) / BBO 中间价 × 100` and 卖出冲击价差 `(BBO 中间价 − 冲击买价) / BBO 中间价 × 100`. Shared `computeOrderBookImpactDetail` (`src/lib/order-book-impact.ts`) now returns `{ bidPrice, askPrice, mid, bboMid, spread, buyImpactSpread, sellImpactSpread }`, delegated by `fetchImpactSpreadDetail`/`fetchSpotImpactSpreadDetail` and the Bitget/Bybit adapters; total spread keeps the impact-VWAP mid denominator while the sub-spreads use the top-of-book BBO mid. Controller stores `ImpactSpreadDetailResult`; table renders both sub-values with tooltips 买入冲击价差/卖出冲击价差. Verified: 172 tests/553 assertions, typecheck, and lint pass. |
