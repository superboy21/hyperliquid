# Active Context: Next.js Starter Template with Funding Monitor

## Current State

**Template Status**: ✅ Active Development - Funding Monitor with HIP-3 Assets

The project now includes a comprehensive Hyperliquid funding rate monitoring page with:
- Real-time data for perpetual and HIP-3 spot markets
- Annualized funding rate display
- 7-day and 30-day historical averages

## Recently Completed

- [x] Base Next.js 16 setup with App Router
- [x] TypeScript configuration with strict mode
- [x] Tailwind CSS 4 integration
- [x] ESLint configuration
- [x] Memory bank documentation
- [x] Recipe system for common features
- [x] Hyperliquid funding rate monitoring page
- [x] Real-time funding rate display with 30s auto-refresh
- [x] Historical funding rate data (30-day view)
- [x] Search and sort functionality
- [x] Statistics dashboard (positive/negative rates, average)
- [x] **HIP-3 asset support** (xyz:gold, xyz:mstr, etc.)
- [x] **Annualized funding rate display** (rate × 1095)
- [x] **7-day and 30-day average annualized funding rates**

## Current Structure

| File/Directory | Purpose | Status |
|----------------|---------|--------|
| `src/app/page.tsx` | Home page with feature cards | ✅ Ready |
| `src/app/layout.tsx` | Root layout | ✅ Ready |
| `src/app/globals.css` | Global styles | ✅ Ready |
| `src/app/funding/page.tsx` | Funding rate monitor page | ✅ Ready |
| `src/components/funding/FundingMonitor.tsx` | Main funding monitor component | ✅ Ready |
| `src/lib/hyperliquid.ts` | Hyperliquid API service | ✅ Ready |
| `.kilocode/` | AI context & recipes | ✅ Ready |

## Features

### Funding Monitor Features

1. **Real-time Data**: Updates every 30 seconds
2. **HIP-3 Assets**: Shows spot tokens like xyz:gold, xyz:mstr
3. **Annualized Rates**: All rates displayed as annual percentages
4. **Historical Averages**: 7-day and 30-day rolling averages
5. **Sorting Options**: By current rate, 7d avg, 30d avg, volume, name
6. **Statistics Dashboard**: Market overview with key metrics

### API Integration

- `metaAndAssetCtxs`: Perpetual contract funding rates
- `spotMetaAndAssetCtxs`: HIP-3 spot market funding rates
- `fundingHistory`: Historical funding data (up to 30 days)

## Current Focus

The template is ready. Next steps depend on user requirements:

1. What type of application to build
2. What features are needed
3. Design/branding preferences

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
