# Exchange Funding Rate Monitor

A multi-exchange funding rate and market monitoring toolkit covering Hyperliquid, Gate.io, Binance, Lighter, and OKX.

## Features

- **Multi-exchange monitoring**: Track funding rates, prices, 24h change, quote volume, open interest, and notional value across five exchanges.
- **Cross-exchange search**: Search symbols across Hyperliquid, Gate.io, Binance, Lighter, and OKX with shared sorting and progressive detail loading.
- **Historical analysis**: View 30-day funding history, candles, historical volatility, latest settled funding, and rolling funding averages.
- **Shared monitor UI**: Reuse the same `ExchangeFundingMonitor` experience across exchange-specific pages for consistent filtering, stats, and chart behavior.
- **Native-first integrations**: Keep exchange-specific adapters and route handlers aligned with the actual upstream APIs.
- **OKX native-only transport**: OKX is wired only through native routes; `/api/okx/ccxt` is retired and returns `410 Gone`.

## Technology Stack

- **Framework**: Next.js 16 (React 19)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Charts**: ECharts 6
- **Data Fetching**: Native fetch plus exchange-specific adapters/services
- **Package Manager**: Bun / npm scripts supported in the repository

## Supported Exchanges

| Exchange | Coverage |
| --- | --- |
| **Hyperliquid** | Perpetuals, HIP-3 assets, historical funding, candles, latest settled funding |
| **Gate.io** | USDT perpetuals, category filtering, historical funding, candles |
| **Binance** | USDT perpetuals, category filtering, open interest/notional metrics, candles |
| **Lighter** | Perpetuals across crypto/equities/ETF-FX-commodities, settled funding support |
| **OKX** | SWAP perpetuals, native-only transport, search integration, settled funding hydration |

## OKX Native-Only Notes

- `src/lib/exchange-flags.ts` always returns `okx: "native"`.
- `src/app/api/okx/ccxt/route.ts` is intentionally retired and responds with `410 Gone`.
- `src/lib/adapters/okx.ts` provides the native canonical rates/detail mapping used by both the funding page and search detail pipeline.
- OKX search detail requests now propagate `AbortSignal` through native history/candle/funding snapshot fetches so cancelled requests stop cleanly.

## Search Integration Notes

- `src/lib/search.ts` includes OKX in `fetchAllRates()` alongside Hyperliquid, Gate.io, Binance, and Lighter.
- Cross-exchange search uses the shared detail model for:
  - latest settled funding rate
  - 1d / 7d / 30d funding averages
  - historical volatility
  - bid-ask spread
- `src/components/search/CrossExchangeSearch.tsx` includes OKX styling and shared empty-state handling.

## Transport Modes

- **Binance**: defaults to `ccxt`, keeps native fallback
- **Gate.io**: defaults to `native`, still supports transport switching
- **Hyperliquid**: native
- **Lighter**: native
- **OKX**: native-only

## Project Structure

```text
src/
├── app/
│   ├── funding/                         # Exchange funding monitor page
│   ├── search/                          # Cross-exchange search page
│   ├── api/
│   │   ├── binance/                     # Binance API routes
│   │   ├── gate/                        # Gate.io API routes
│   │   ├── lighter/                     # Lighter API routes
│   │   └── okx/                         # OKX native API routes (+ retired ccxt route)
│   └── page.tsx                         # Homepage
├── components/
│   ├── funding/                         # Shared and exchange-specific funding monitors/charts
│   └── search/                          # Cross-exchange search UI
├── lib/
│   ├── adapters/                        # Canonical exchange adapters
│   ├── normalizers/                     # Exchange normalization helpers
│   ├── search.ts                        # Cross-exchange search orchestration
│   └── types.ts                         # Shared funding/search types
└── ...
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) or npm
- Node.js 18+

### Installation

```bash
bun install
```

or

```bash
npm install
```

### Development

```bash
bun dev
```

or

```bash
npm run dev
```

### Build

```bash
bun run build
```

or

```bash
npm run build
```

### Start Production Server

```bash
bun start
```

or

```bash
npm run start
```

## Available Scripts

- `bun dev` / `npm run dev` - start development server
- `bun run build` / `npm run build` - build for production
- `bun start` / `npm run start` - start production server
- `bun run lint` / `npm run lint` - run ESLint
- `bun run typecheck` / `npm run typecheck` - run TypeScript type checking

## Data and UI Notes

- Funding pages refresh automatically every 300 seconds.
- Shared monitor pages support sorting by funding rate, price, 24h change, quote volume, and notional/open-interest-derived metrics.
- Chart/detail views surface historical candles, funding history, latest settlement, and derived volatility/funding averages.
- Hyperliquid uses conservative settlement hydration; OKX detail uses native funding history, history candles, and native funding snapshot endpoints.

## Release Notes

### v2026.04.15

- Added OKX search detail support through the shared canonical search pipeline.
- Updated search UI for OKX result styling and safe empty-state rendering.
- Fixed Gate chart effect dependencies to keep lint/build verification clean.
- Updated README and project notes for OKX native-only transport, search integration, and related release documentation.

## Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add some amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

## License

This project is licensed under the MIT License. See `LICENSE` for details.

## Disclaimer

This tool is for informational purposes only. Trading cryptocurrencies and related assets involves significant risk and may not be suitable for all investors. Always do your own research before making trading decisions.

## Acknowledgments

- Hyperliquid and the supported exchanges for their public market data APIs
- The open-source Next.js, React, TypeScript, and Tailwind CSS communities
- Contributors and maintainers of this repository
