[readme.md](https://github.com/user-attachments/files/26113372/readme.md)
# HyperTools - Hyperliquid Trading Toolkit

A professional trading toolkit for Hyperliquid traders.
Provides real-time funding rate monitoring, advanced position analysis, and arbitrage opportunity detection.

## Key Features

- Real-time Funding Rate Monitoring: Track funding rates for all Hyperliquid perpetual contracts and HIP-3 assets.
- Historical Data Analysis: View 30-day funding rate history with comprehensive statistical metrics.
- Smart Sorting & Filtering: Instantly sort by rate, price, volume, open interest, and 24h change.
- Asset Type Filtering: Seamlessly toggle between standard assets, XYZ-HIP3, and VNTL-HIP3 assets.
- Weighted Average Calculations: Precise open interest weighted average funding rates.
- Responsive Design: Optimized for both desktop and mobile devices.

## Technology Stack

| Category | Technology |
| --- | --- |
| Framework | Next.js 16 (React 19) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| State Management | React Hooks (`useState`, `useEffect`) |
| Data Fetching | Native Fetch API + Hyperliquid SDK |
| Package Manager | Bun |

## Project Structure

```text
src/
├── app/                          # Next.js App Router
│   ├── funding/                  # Funding rate monitor page
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Homepage
├── components/                   # Reusable React components
│   └── funding/
│       └── FundingMonitor.tsx    # Main monitoring logic
├── lib/                          # Utilities & Services
│   └── hyperliquid.ts            # Hyperliquid API integration
└── ...
```

## Key Components

### `FundingMonitor.tsx`

The core UI component responsible for displaying:

- Summary Statistics: Total pairs, HIP-3 count, positive/negative rate distribution.
- Filter Controls: Asset type toggles, search bars, and sorting options.
- Data Table: Real-time funding rates with live updates.
- Historical Chart: Interactive chart for selected assets.
- Education: Explanatory section on how funding rates work.

### `hyperliquid.ts`

The service layer handling all API interactions:

- `getAllFundingRatesWithHistory()`: Fetches rates for all assets.
- `getFundingHistory()`: Retrieves historical data points.
- `getMeta()`: Fetches market metadata.
- Utilities: Formatters for rates, prices, and volumes.

## Getting Started

### Prerequisites

- Bun (Package Manager)
- Node.js 18+ (For development environments)

### Installation

```bash
bun install
```

### Development

Run the local development server:

```bash
bun dev
```

### Production Build

```bash
bun build
```

### Start Production Server

```bash
bun start
```

### Available Scripts

| Command | Description |
| --- | --- |
| `bun dev` | Start development server |
| `bun build` | Build for production |
| `bun start` | Start production server |
| `bun lint` | Run ESLint checks |
| `bun typecheck` | Run TypeScript type checking |

## Features in Detail

### Funding Rate Monitoring

The application tracks two distinct asset classes:

- Standard Perpetual Contracts: Traditional crypto pairs (e.g. `BTC`, `ETH`, `SOL`).
- HIP-3 Assets: Hyperliquid Improvement Proposal 3 assets including:
  - Commodities: `xyz:GOLD`, `xyz:SILVER`, `xyz:PLATINUM`
  - Stocks: `xyz:AAPL`, `xyz:TSLA`, `xyz:NVDA`
  - ETFs: `xyz:SPY`, `xyz:QQQ`
  - Crypto Indexes: `vntl:SEMIS`, `vntl:ROBOT`

### Data Update Frequency

- Real-time: Funding rates refresh automatically every 30 seconds.
- On-Demand: Historical data is calculated only when a specific asset is selected.
- Source: All data is pulled directly from Hyperliquid's public API.

### Sorting Options

- Rate: Current annualized funding rate (high/low).
- Price: Current mark price.
- Change: 24h price change percentage.
- Volume: 24h trading volume.
- OI: Open interest value (position size times price).
- Name: Alphabetical order.

## API Integration

This project leverages Hyperliquid's public endpoints:

- `metaAndAssetCtxs`: Market data and current funding rates.
- `fundingHistory`: Historical rate data.
- `meta`: General market information.

Note: All API calls are made directly to [https://api.hyperliquid.xyz/info](https://api.hyperliquid.xyz/info) without requiring authentication.

## Deployment

Compatible with major hosting platforms:

- Vercel (Recommended for Next.js)
- Netlify
- Docker Containers
- Any Node.js hosting platform

## Contributing

We welcome contributions.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Disclaimer

Important: This tool is for informational purposes only.
Trading cryptocurrencies involves significant risk and may not be suitable for all investors.
Past performance is not indicative of future results.
Always do your own research (DYOR) and consider your financial situation before making any trading decisions.
The authors and contributors are not responsible for any financial losses incurred through the use of this software.

## Acknowledgments

- Hyperliquid for providing the robust public API.
- The open-source Next.js and Tailwind CSS communities.
- All contributors to this project.
