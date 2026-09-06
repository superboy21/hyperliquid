# Technical Context: Next.js Starter Template

## Technology Stack

| Technology   | Version | Purpose                         |
| ------------ | ------- | ------------------------------- |
| Next.js      | 16.x    | React framework with App Router |
| React        | 19.x    | UI library                      |
| TypeScript   | 5.9.x   | Type-safe JavaScript            |
| Tailwind CSS | 4.x     | Utility-first CSS               |
| Bun          | Latest  | Package manager & runtime       |

## Development Environment

### Prerequisites

- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- Node.js 20+ (for compatibility)

### Commands

```bash
bun install        # Install dependencies
bun dev            # Start dev server (http://localhost:3000)
bun test           # Run Bun test suite
bun run typecheck  # Run TypeScript type checking
bun run lint       # Run ESLint
bun run build      # Production build (also: docker compose build / up -d)
```

## Project Configuration

### Next.js Config (`next.config.ts`)

- App Router enabled
- Default settings for flexibility

### TypeScript Config (`tsconfig.json`)

- Strict mode enabled
- Path alias: `@/*` → `src/*`
- Target: ESNext

### Tailwind CSS 4 (`postcss.config.mjs`)

- Uses `@tailwindcss/postcss` plugin
- CSS-first configuration (v4 style)

### ESLint (`eslint.config.mjs`)

- Uses `eslint-config-next`
- Flat config format

## Key Dependencies

### Production Dependencies

```json
{
  "next": "^16.2.6", // Framework
  "react": "^19.2.3", // UI library
  "react-dom": "^19.2.3", // React DOM
  "echarts": "^6.0.0", // Charts
  "hyperliquid": "^1.7.7", // Hyperliquid SDK (spot/参考)
  "protobufjs": "^8.5.0", // Binary parsing
  "server-only": "^0.0.1", // Server-only guard
  "undici": "^8.1.0" // Runtime fetch + ProxyAgent for server routes
}
```

No CCXT runtime dependency exists anymore (routes, adapter branches, flags, and config entry all removed; `TransportMode` is `"native"`).

### Dev Dependencies

```json
{
  "typescript": "^5.9.3",
  "@types/node": "^24.10.2",
  "@types/react": "^19.2.7",
  "@types/react-dom": "^19.2.3",
  "@tailwindcss/postcss": "^4.1.17",
  "tailwindcss": "^4.1.17",
  "eslint": "^9.39.1",
  "eslint-config-next": "^16.0.0"
}
```

## File Structure

```
/
├── .gitignore              # Git ignore rules
├── package.json            # Dependencies and scripts
├── bun.lock                # Bun lockfile
├── next.config.ts          # Next.js configuration
├── tsconfig.json           # TypeScript configuration
├── postcss.config.mjs      # PostCSS (Tailwind) config
├── eslint.config.mjs       # ESLint configuration
├── public/                 # Static assets
│   └── .gitkeep
└── src/                    # Source code
    └── app/                # Next.js App Router
        ├── layout.tsx      # Root layout
        ├── page.tsx        # Home page
        ├── globals.css     # Global styles
        └── favicon.ico     # Site icon
```

## Technical Constraints

### Starting Point

- Minimal structure - expand as needed
- No database by default (use recipe to add)
- No authentication by default (add when needed)

### Browser Support

- Modern browsers (ES2020+)
- No IE11 support

## Performance Considerations

### Image Optimization

- Use Next.js `Image` component for optimization
- Place images in `public/` directory

### Bundle Size

- Tree-shaking enabled by default
- Tailwind CSS purges unused styles

### Core Web Vitals

- Server Components reduce client JavaScript
- Streaming and Suspense for better UX

## Deployment

### Build Output

- Server-rendered pages by default
- Can be configured for static export

### Environment Variables

- `PROXY_URL` (optional, server routes only): `PROXY_URL > HTTP_PROXY > HTTPS_PROXY > http_proxy > https_proxy`; Node-only `undici.ProxyAgent`, Edge degrades to direct; a configured-proxy failure errors loudly instead of silently going direct
- No `NEXT_PUBLIC_*_TRANSPORT_MODE` flags exist anymore (CCXT modes removed)
- Use `.env.local` for local development; `.env*` files are excluded from the Docker build context — production config goes through runtime environment (e.g. `PROXY_URL: ${PROXY_URL:-}` in `docker-compose.yml`)

### Proxy errors and response caching

- Non-Gate proxy routes use one failure mapping: caller abort `499`, upstream/proxy timeout `504`, and transport failure or malformed successful upstream response `502`; upstream HTTP and exchange business errors keep their mapped status.
- `src/lib/utils/inflight-json-cache.ts` coalesces identical in-flight loads by canonical request key. A caller may abort its own wait without cancelling the shared load. Only successful parsed JSON that passes the route's semantic envelope validation is eligible for completed-value storage; failures and exchange business-error envelopes are never cached.
- Metadata completed values use a 5-minute TTL. Hot bulk live lists use the same coalescer with TTL `0`, so concurrent callers share one load but later calls refetch. There is no completed-value cache for orderbooks, RPI, candles/history, per-symbol live data, or current ticker/funding.
