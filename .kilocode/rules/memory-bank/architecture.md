# System Patterns: Next.js Starter Template

## Architecture Overview

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout + metadata
│   ├── page.tsx            # Home page
│   ├── globals.css         # Tailwind imports + global styles
│   └── favicon.ico         # Site icon
└── (expand as needed)
    ├── components/         # React components (add when needed)
    ├── lib/                # Utilities and helpers (add when needed)
    └── db/                 # Database files (add via recipe)
```

## Key Design Patterns

### 1. App Router Pattern

Uses Next.js App Router with file-based routing:
```
src/app/
├── page.tsx           # Route: /
├── about/page.tsx     # Route: /about
├── blog/
│   ├── page.tsx       # Route: /blog
│   └── [slug]/page.tsx # Route: /blog/:slug
└── api/
    └── route.ts       # API Route: /api
```

### 2. Component Organization Pattern (When Expanding)

```
src/components/
├── ui/                # Reusable UI components (Button, Card, etc.)
├── layout/            # Layout components (Header, Footer)
├── sections/          # Page sections (Hero, Features, etc.)
└── forms/             # Form components
```

### 3. Server Components by Default

All components are Server Components unless marked with `"use client"`:
```tsx
// Server Component (default) - can fetch data, access DB
export default function Page() {
  return <div>Server rendered</div>;
}

// Client Component - for interactivity
"use client";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### 4. Layout Pattern

Layouts wrap pages and can be nested:
```tsx
// src/app/layout.tsx - Root layout
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

// src/app/dashboard/layout.tsx - Nested layout
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}
```

## Styling Conventions

### Tailwind CSS Usage
- Utility classes directly on elements
- Component composition for repeated patterns
- Responsive: `sm:`, `md:`, `lg:`, `xl:`

### Common Patterns
```tsx
// Container
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

// Flexbox centering
<div className="flex items-center justify-center">
```

## File Naming Conventions

- Components: PascalCase (`Button.tsx`, `Header.tsx`)
- Utilities: camelCase (`utils.ts`, `helpers.ts`)
- Pages/Routes: lowercase (`page.tsx`, `layout.tsx`)
- Directories: kebab-case (`api-routes/`) or lowercase (`components/`)

## State Management

For simple needs:
- `useState` for local component state
- `useContext` for shared state
- Server Components for data fetching

For complex needs (add when necessary):
- Zustand for client state
- React Query for server state

## Project-Specific: Cross-Exchange Market-Data Architecture

Beyond the generic template, this project pipelines shared registries → canonical adapters → pages/components → unified direct-first transport with strict same-origin proxy fallback. Bybit is the reference implementation (Bitget follows the same scheduler + envelope + proxy-eligibility shape; Binance/OKX/Lighter/Spot/Gate/Hyperliquid share the response-level fallback policy via `src/lib/utils/direct-first.ts`).

1. **Shared registries and contracts** — `src/lib/types.ts` defines the canonical rows (`CanonicalFundingRateRow`, `CanonicalFundingHistoryPoint`, `CanonicalCandlePoint`) and the `ExchangeId` union every adapter normalizes into (`TransportMode` is narrowed to `"native"`; no CCXT runtime paths exist); `src/lib/order-book-impact.ts` is the shared impact-depth registry (`resolveSpotImpactDepth` / `resolvePerpImpactDepth`; Bybit: spot 50/200, perp 100/500) consumed by `impact-price.ts` and `spot-impact-price.ts`.
2. **Canonical adapters** (`src/lib/adapters/*`) — each exchange adapter converts venue-native payloads into canonical rows and owns its transport: a bounded FIFO scheduler with a per-exchange controlled-throughput profile (Bybit `BYBIT_SCHEDULER_PROFILE`: max 2 in-flight requests, 100ms minimum start spacing — at most 10 starts/sec, deliberately far below Bybit's 600 requests/5 seconds/IP public cap; Bitget: single concurrency, 250ms minimum starts) plus jitter, timeout/retry bounds, Retry-After honoring, envelope validation, and abort propagation. Bybit (`src/lib/adapters/bybit.ts`) pages and caches V5 instruments-info (Trading USDT LinearPerpetuals), issues one bulk linear tickers call (funding/L1/OI/volume), lazily walks 30-day funding history with interval-aware windows — one V5 request holds up to 200 rows and the window is capped at a conservative 90 days, so the 30-day detail history costs 1 request for 4h/8h/1d funding and 4 for 1h — with one-request latest-settlement hydration keyed by raw symbol, paginates V5 klines into ascending normalized candles, and fetches order books on demand. Module-level TTL caches (settled funding history 5m, candles 120s) are keyed by raw symbol/interval, serve a request only when the cached range strictly contains it, return defensive copies, and never write on abort or failure; current ticker vs settled history semantics stay separate. Exact raw symbols (`BTCUSDT`) are the transport identity; spot and perp categories namespace identical symbols, so pages keep kind-qualified market IDs.
3. **Pages/components** — `/funding` and `/search` consume canonical rows through domain libs (`src/lib/search.ts`, `src/lib/search-candles.ts`, `src/lib/spot-search.ts`, `src/lib/spot-perp-arbitrage/`) with progressive per-exchange detail lanes (`src/lib/search-detail-lanes.ts`: Bybit independent detail rows at concurrency 2, all other lanes unchanged, single-symbol funding-history pagination stays sequential), on-demand charts, and 5-minute funding-list refreshes. `/search` keeps full price candle history for Bybit charts but bounds only the Bybit funding overlay to the latest 90 days, so missing historical samples render as chart gaps rather than fabricated zeros; combo and mixed charts preserve observed-zero vs missing semantics. The standalone `/spotsearch` and `/spot_perp_arbitrage` routes were removed; `/search` is the consumer of the shared spot data layer (`/api/spot/[exchange]`, `src/lib/spot-*`) and reuses `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx` for single-market spot charts.
4. **Unified direct-first / strict-proxy fallback** — every exchange fetches from the browser first (user IP bypasses cloud egress blocks) via the narrow response-level `runDirectFirst` runner (`src/lib/utils/direct-first.ts`), which owns only status policy, caller-abort preservation, and real per-leg client timeouts — never URL building, envelopes, schedulers, or caches. Fallback fires at most once and only for network/CORS/client-timeout, upstream HTTP 403/451, or final 5xx; once any direct attempt observes HTTP 429, that operation remains on the direct leg and the observed rate-limit response stays terminal even if a later retry/backoff times out or fails (Retry-After honored, cancellable). Ordinary 4xx, business-envelope errors, malformed success payloads, and caller aborts never fall back. Same-origin routes (`/api/hyperliquid`, `/api/gate/futures/usdt/*`, `/api/{binance,okx,lighter,bitget,bybit}`, `/api/spot/[exchange]`) pin upstream hosts plus endpoint/parameter allowlists, validate before any upstream I/O, and forward through `proxyFetch`, which may use `PROXY_URL`/`HTTP(S)_PROXY` via `undici.ProxyAgent` on Node (Edge degrades to direct) and fails loudly instead of silently bypassing a configured proxy. Gate server host failover is limited to transport/timeout/malformed-success/selected-5xx failures, never definitive 4xx/429; batch funding fallback is concurrency-bounded and reports per-item errors explicitly. Direct and proxied success payloads share one adapter parse contract (Bitget full `{code,msg,data}` envelope; Bybit full `{retCode,result}` envelope; Hyperliquid/Gate bare JSON with shared enrichment).
5. **Non-Gate proxy failure and cache policy** — non-Gate same-origin routes map caller aborts to `499`, upstream/proxy timeouts to `504`, and transport failures or malformed successful upstream responses to `502` through `src/lib/utils/proxy-error.ts`; exchange HTTP/business errors retain their mapped status and are not converted into cacheable successes. `src/lib/utils/inflight-json-cache.ts` coalesces identical canonical-key loads while keeping caller aborts isolated from the shared loader. Only successfully parsed, semantically valid JSON may become a completed value: metadata is retained for 5 minutes, hot bulk live lists use coalescing only with TTL `0`, and orderbooks, RPI, candles/history, per-symbol live data, current ticker/funding, and exchange business-error envelopes have no completed-value cache.
6. **On-demand live five-level books** — `src/lib/order-book/` isolates typed venue-native target/source identities, strict-mode REST reads, Gate/OKX base-quantity conversion, WS protocol adapters, cumulative five-price projection, and a cancellable session engine. REST polls immediately then 5 seconds after settlement with a 10-second per-request deadline; RPI+WS fallback is `RPI WS → normal WS → RPI REST → normal REST` (unsupported RPI stages are skipped), while REST-only falls back `RPI → normal`; normal-only and rToken policies are unchanged. Adapters own snapshot/delta synchronization, heartbeat, sequence checks and cleanup; the session owns fallback, stale-frame provenance, emission throttling and late-result isolation. `useLiveOrderBook` uses a lazy `useSyncExternalStore` store: SSR/disabled views perform no I/O and the last subscriber disposes resources. The single-chart Controller resolves refreshed selected market metadata before subscribing; `LiveOrderBookPanel` reports actual source and cumulative base units. Real rToken V3 REST replaces neither nor alters the existing Impact-only synthetic BBO path. Adapter test dependencies are injected locally rather than using global module mocks. No new server route, dependency, account authentication or trading operation was introduced.
7. **A/B combined book (`combination.ts`)** — the spread/ratio combination chart owns a second consumer of the same session engine. `buildCombinationOrderBook({ targetA, targetB, stateA, stateB, mode, nowMs })` is a pure function over two `BookSessionState`s: buy = A **asks** + B **bids**, sell = A **bids** + B **asks**. Each direction is an equal-notional double-pointer walk: a segment consumes `min(remainingA, remainingB)` and advances the exhausted leg, so `notionalUsdt` is the shared USD amount and `cumulativeNotionalUsdt` accumulates matched amounts only — never the sum of both legs, and never either leg's full depth. Both sides aggregate duplicate prices and sort best-first before matching; up to five segments per direction are emitted, and a truncated view must not be presented as the full total. Guard rails fail closed per direction without epsilon tricks: non-finite/non-positive prices or quantities, notional overflow or collapse-to-zero, non-advancing balances, and non-finite combination values reject that side only, leaving the other side usable. Quote eligibility is `isUsdQuote` (`src/lib/order-book/quote.ts`): a case-insensitive `includes("USD")` test on the **quote** name, so USDT/USDC/FDUSD/BUSD/TUSD/USD1/USDE are all 1:1 equivalents with no FX conversion, while a base asset containing `USD` never qualifies a non-USD pair; `startsWith` would wrongly reject FDUSD/BUSD/TUSD. Freshness gates each leg at 20s and the inter-leg receipt skew at 10s, both before any matching; past either budget the result is `unavailable`, so the panel stops rendering synthetic tradable values while each single-leg book keeps its last snapshot marked stale. `project.ts` shares the same predicate for explicit-separator symbols and keeps contiguous symbols conservative via a known-USD-suffix list (longest first) rather than inventing a split. The panel owns only presentation and per-leg fallback disclosure; leg swap closes and resets the sessions while an interval change keeps them, and the exported interface shape is fixed so UI work stays a pure consumer.
