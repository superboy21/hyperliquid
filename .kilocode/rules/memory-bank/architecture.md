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

Beyond the generic template, this project pipelines shared registries → canonical adapters → pages/components → strict proxy / direct-first transport fallback. Bybit is the current reference example (Bitget, OKX, Gate, and Binance follow the same adapter shape).

1. **Shared registries and contracts** — `src/lib/types.ts` defines the canonical rows (`CanonicalFundingRateRow`, `CanonicalFundingHistoryPoint`, `CanonicalCandlePoint`) and `ExchangeId`/`TransportMode` unions every adapter normalizes into; `src/lib/order-book-impact.ts` is the shared impact-depth registry (`resolveSpotImpactDepth` / `resolvePerpImpactDepth`; Bybit: spot 50/200, perp 100/500) consumed by `impact-price.ts` and `spot-impact-price.ts`.
2. **Canonical adapters** (`src/lib/adapters/*`) — each exchange adapter converts venue-native payloads into canonical rows and owns its transport: a bounded FIFO scheduler with a per-exchange controlled-throughput profile (Bybit `BYBIT_SCHEDULER_PROFILE`: max 2 in-flight requests, 100ms minimum start spacing — at most 10 starts/sec, deliberately far below Bybit's 600 requests/5 seconds/IP public cap; Bitget: single concurrency, 250ms minimum starts) plus jitter, timeout/retry bounds, Retry-After honoring, envelope validation, and abort propagation. Bybit (`src/lib/adapters/bybit.ts`) pages and caches V5 instruments-info (Trading USDT LinearPerpetuals), issues one bulk linear tickers call (funding/L1/OI/volume), lazily walks 30-day funding history with interval-aware windows — one V5 request holds up to 200 rows and the window is capped at a conservative 90 days, so the 30-day detail history costs 1 request for 4h/8h/1d funding and 4 for 1h — with one-request latest-settlement hydration keyed by raw symbol, paginates V5 klines into ascending normalized candles, and fetches order books on demand. Module-level TTL caches (settled funding history 5m, candles 120s) are keyed by raw symbol/interval, serve a request only when the cached range strictly contains it, return defensive copies, and never write on abort or failure; current ticker vs settled history semantics stay separate. Exact raw symbols (`BTCUSDT`) are the transport identity; spot and perp categories namespace identical symbols, so pages keep kind-qualified market IDs.
3. **Pages/components** — `/funding`, `/search` (perp), and `/spot_perp_arbitrage` consume canonical rows through domain libs (`src/lib/search.ts`, `src/lib/search-candles.ts`, `src/lib/spot-search.ts`, `src/lib/spot-perp-arbitrage/`) with progressive per-exchange detail lanes (`src/lib/search-detail-lanes.ts`: Bybit independent detail rows at concurrency 2, all other lanes unchanged, single-symbol funding-history pagination stays sequential), on-demand charts, and 5-minute funding-list refreshes. `/search` keeps full price candle history for Bybit charts but bounds only the Bybit funding overlay to the latest 90 days, so missing historical samples render as chart gaps rather than fabricated zeros; combo and mixed charts preserve observed-zero vs missing semantics. The standalone `/spotsearch` page was removed; `/spot_perp_arbitrage` remains the consumer of the shared spot data layer (`/api/spot/[exchange]`, `src/lib/spot-*`) and reuses the moved `src/components/spot-perp-arbitrage/SpotSearchCandlesChart.tsx` for single-market spot charts.
4. **Strict proxy / direct-first fallback** — browser calls go direct to the exchange public API first (user IP bypasses cloud egress blocks); only transient/network/CORS/geo failures fall back to a strict, allowlisted same-origin proxy route (e.g. `/api/bybit`), which validates every parameter before forwarding and passes the upstream V5 envelope through unchanged so the adapter parses direct and proxied responses identically. Funding-history windows up to 90 days are permitted under strict validation (paired timestamps, positive safe integers, allowlisted parameters). Validation and business errors never fall back.
