# HyperTools - Hyperliquid Trading Toolkit

A professional trading toolkit for Hyperliquid traders, providing real-time funding rate monitoring, position analysis, and arbitrage opportunities.

## Features

- **Real-time Funding Rate Monitoring**: Track funding rates for all Hyperliquid perpetual contracts and HIP-3 assets
- **Historical Data Analysis**: View 30-day funding rate history with statistical metrics
- **Smart Sorting & Filtering**: Sort by rate, price, volume, open interest, and 24h change
- **Asset Type Filtering**: View standard assets, XYZ-HIP3 assets, or VNTL-HIP3 assets separately
- **Weighted Average Calculations**: Open interest weighted average funding rates
- **Responsive Design**: Works on desktop and mobile devices

## Technology Stack

- **Framework**: Next.js 16 (React 19)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **State Management**: React Hooks (useState, useEffect)
- **Data Fetching**: Native Fetch API with Hyperliquid SDK
- **Package Manager**: Bun

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── funding/            # Funding rate monitor page
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Homepage
├── components/             # React components
│   └── funding/            # Funding monitor components
│       └── FundingMonitor.tsx
├── lib/                    # Utility functions and services
│   └── hyperliquid.ts      # Hyperliquid API integration
└── ...
```

## Key Components

### FundingMonitor.tsx
The main component that displays:
- Summary statistics (total pairs, HIP-3 assets, positive/negative rates)
- Filter controls (asset type, search, sorting)
- Data table with real-time funding rates
- Historical chart for selected asset
- Educational section explaining funding rates

### hyperliquid.ts
Service layer for interacting with Hyperliquid APIs:
- `getAllFundingRatesWithHistory()` - Gets funding rates for all assets
- `getFundingHistory()` - Retrieves historical funding rate data
- `getMeta()` - Gets market information
- Utility functions for formatting rates, prices, volumes, etc.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- Node.js 18+ (for development)

### Installation

```bash
bun install
```

### Development

```bash
bun dev
```

### Building for Production

```bash
bun build
```

### Starting Production Server

```bash
bun start
```

## Available Scripts

- `bun dev` - Start development server
- `bun build` - Build for production
- `bun start` - Start production server
- `bun lint` - Run ESLint
- `bun typecheck` - Run TypeScript type checking

## Features in Detail

### Funding Rate Monitoring

The application monitors two types of assets:
1. **Standard Perpetual Contracts**: Traditional crypto perpetuals like BTC, ETH, SOL
2. **HIP-3 Assets**: Hyperliquid Improvement Proposal 3 assets including:
   - Commodities: xyz:GOLD, xyz:SILVER, xyz:PLATINUM, etc.
   - Stocks: xyz:AAPL, xyz:TSLA, xyz:NVDA, etc.
   - ETFs: xyz:SPY, xyz:QQQ, etc.
   - Crypto indexes: vntl:SEMIS, vntl:ROBOT, etc.

### v2026.04.23

- Search page chart: default time range changed to "1y" (was "All") with 1d interval
- Search page chart: fixed Hyperliquid funding history returning no data (restored getFundingHistoryAll pagination)
- Search page chart: fixed Lighter funding history showing only 30 days (restored getFundingHistoryAll with 500+ days available)
- Search page chart: fixed Gate.io funding history showing only 30 days (added from+to dual-parameter pagination for 1000+ days)
- Search page chart: fixed Gate.io API proxy now correctly forwards `from` and `to` parameters
- Search page chart: documented OKX funding history limitation (~90-100 days due to API retention policy)
- Search page chart: documented Hyperliquid API hard limit (500 records/request, ~20-166 days depending on interval)

### v2026.04.22

- Search page chart: added third subplot showing historical average settlement funding rate (annualized) aligned to candle intervals for all 5 exchanges
- Search page chart: tooltip now shows both annualized funding rate (primary, e.g., "+36.50%") and raw hourly rate (secondary, e.g., "0.0042%")
- Search page chart: annualized rate displayed as line chart with exchange-themed color area fill and 0-axis reference line
- Search page chart: time range filter buttons added (All, 3y, 1y, 6m, 1m, 1d) to filter visible chart data client-side without re-fetching
- Search page chart: fixed OKX closeTime being set equal to openTime (causing all OKX funding rates to show as 0)
- Search page chart: fixed OKX realizedRate parsing (now uses realizedRate first, falls back to fundingRate for backward compatibility)
- Search page chart: Lighter funding rate now correctly divided by 100 to convert percentage points to decimal for consistent annualization across all exchanges
- Search page chart: Lighter getFundingHistory now returns raw percentage values (not normalized) matching the funding page

### v2026.04.20

- Search page chart: sub-chart now defaults to turnover (成交额) instead of volume (成交量)
- Added toggle button in sub-chart top-right corner to switch between volume and turnover
- Search page chart: 1w/1d x-axis now shows year prefix on every label for continuous year visibility (e.g., "26/04-20")
- 4h chart: year shown only at year boundaries to keep labels concise

### v2026.04.19

- Fixed Lighter weekly (1w) candles - now aggregates from daily candles due to backend placeholder data after 09/14
- Restriced faded/gray notional value display to Binance only on funding pages
- Rewrote Binance OI hydration to use `openInterest × markPrice` formula with 50-symbol batch parallel requests
- Fixed Cloudflare Workers deployment - moved undici to devDependencies, made proxy.ts edge-runtime safe

### Data Update Frequency

- Funding rates are fetched every 30 seconds via automatic refresh
- Historical data is calculated on-demand when selecting an asset
- All data is sourced directly from Hyperliquid's public API

### Sorting Options

- **Rate**: Current annualized funding rate (highest/lowest first)
- **Price**: Current mark price
- **Change**: 24h price change percentage
- **Volume**: 24h trading volume
- **OI**: Open interest value (position size × price)
- **Name**: Alphabetical order

## API Integration

The project uses Hyperliquid's public API endpoints:
- `metaAndAssetCtxs` - For getting market data and funding rates
- `fundingHistory` - For historical funding rate data
- `meta` - For general market information

All API calls are made directly to `https://api.hyperliquid.xyz/info` without requiring authentication.

## Deployment

This Next.js application can be deployed to:
- Vercel (recommended for Next.js apps)
- Netlify
- Docker containers
- Any Node.js hosting platform

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This tool is for informational purposes only. Trading cryptocurrencies involves significant risk and may not be suitable for all investors. Past performance is not indicative of future results. Always do your own research and consider your financial situation before making any trading decisions.

## Acknowledgments

- Hyperliquid for providing the public API
- The open-source Next.js and Tailwind CSS communities
- All contributors to this project