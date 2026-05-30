
## Wave 1, Task 3 - CrossExchangeSearch.tsx combo filtering

- Added imports: `parseComboSearch, isComboSearch` from `@/lib/combo`.
- Modified `filteredRates` useMemo to branch on combo search vs normal search.
- Combo search logic: `parseComboSearch(searchTerm)` returns `{ keyword1, keyword2, mode }`; if `mode` and both keywords are non-empty, filter with OR condition (`symbol.includes(keyword1) || symbol.includes(keyword2)`).
- Normal search: falls back to existing `filterByKeyword(allRates, searchTerm)`.
- Sort logic is unchanged and applied after filtering via `sortedRates` useMemo.
- Empty-state messages already use `searchTerm` directly, so they naturally work for combo searches (e.g. "没有找到包含 \"BTC-ETH\" 的交易对").
- `bun typecheck` passed successfully.

## Wave 1, Task 4 - CrossExchangeSearch.tsx combo selection state

- Added import: `ComboSelection` type from `@/lib/combo`.
- Added state: `comboSelection` with `{ first: null, second: null, mode: null }` after `selectedRate`.
- Added derived state: `isComboMode` via `useMemo`, true when all three fields are non-null.
- Added helper: `isSameRate(a, b)` checks exchange + symbol equality.
- Modified `handleRowClick` to branch on `isComboSearch(searchTerm)`:
  - Case A: clicked first → deselect first, promote second to first if exists.
  - Case B: clicked second → deselect second, keep first.
  - Case C: nothing selected → set as first (parses mode from search term).
  - Case D: first selected, second null → set as second.
  - Case E: both selected, clicked third → ignore.
- Single-select path is completely untouched: existing logic runs only when `!isComboSearch(searchTerm)`.
- `handleRowClick` dependency array updated to include `searchTerm` and `comboSelection`.
- `bun typecheck` passed successfully.

## Wave 2, Task 5 - CrossExchangeSearch.tsx parallel dual-fetch for combo selections

- Added imports: `alignComboData, type ComboCandleResult` from `@/lib/combo`.
- Added state: `comboChartData` (`ComboCandleResult | null`) after `chartFundingRates`.
- Created `fetchComboCandles` as `useCallback` with deps `[searchTerm]`:
  - Accepts `first`, `second`, `interval`, `signal`.
  - Uses `Promise.all([fetchSearchCandles(first, ...), fetchSearchCandles(second, ...)])` for parallel fetching.
  - After both resolve, calls `parseComboSearch(searchTerm).mode` to get mode, then `alignComboData(firstResult, secondResult, mode)`.
  - Sets `comboChartData` on success, clears on error (unless aborted).
  - Uses shared `chartLoading` state (set to true at start, false at end).
- Modified interval change `useEffect` to handle combo mode:
  - If `isComboMode && comboSelection.first && comboSelection.second`: abort previous, create new `AbortController`, clear single chart states, call `fetchComboCandles`.
  - Else if `selectedRate`: keep existing single-fetch logic unchanged.
  - Dependencies updated to `[selectedRate, chartInterval, comboSelection, isComboMode, fetchComboCandles]`.
- Added useEffect to watch `comboSelection.second`:
  - When `first`, `second`, and `mode` are all set, aborts previous request and calls `fetchComboCandles`.
  - Dependencies: `[comboSelection.second, comboSelection.mode, chartInterval]`.
- Added useEffect to clear combo data when `comboSelection.second` becomes null.
- AbortController properly cancels both parallel fetches because `fetchSearchCandles` receives the same shared `AbortSignal`.
- `bun typecheck` passed successfully.

## Wave 2, Task 6 - ComboSearchCandlesChart.tsx component creation

- Created `src/components/search/ComboSearchCandlesChart.tsx` copying ECharts setup pattern from `SearchCandlesChart.tsx`.
- Props: `data: ComboCandleResult`, `interval`, `timeRange`, `onTimeRangeChange`, `showVolume`, `onToggleVolume`.
- Title format: `{firstSymbol} ({firstExchange}) {separator} {secondSymbol} ({secondExchange}) [{modeLabel}]` where separator is `-` for spread and `/` for ratio.
- Candlestick series uses computed combo open/close values with `high = Math.max(open, close)` and `low = Math.min(open, close)` since ECharts candlestick requires all four values.
- Color scheme: purple (`#8b5cf6`) for bullish, red (`#ef4444`) for bearish to visually distinguish combo charts from single-exchange charts.
- Turnover sub-chart shows `quoteVolume` (which is already `Math.min(first, second)` from `alignComboData`). Toggle button switches between volume and turnover via `showVolume` prop.
- Funding rate sub-chart shows the *difference* (`annualizedRate * 100`) between first and second exchange funding rates. Hidden entirely when `fundingRates` is empty or interval is `1m` (collapses to 2-subplot layout).
- Grid layout: 3-subplot → candlestick 50%, turnover 18%, funding 8% (with top padding for title); 2-subplot → candlestick 62%, turnover 18%.
- Tooltip custom formatter shows: title + date/time, Spread/Ratio close value, open/close prices, turnover/volume, and funding rate difference (annualized + raw).
- Price formatting: spread uses `$X.XX`, ratio uses 4-6 decimal places without prefix.
- Added `dataZoom` with both `inside` and `slider` types linking all visible subplots (not present in original `SearchCandlesChart.tsx` but specified in task requirements).
- `timeRange` and `onTimeRangeChange` props are accepted for API compatibility but filtering is handled upstream by the parent component.
- `bun typecheck` passed successfully.

## Wave 2, Task 8 - CrossExchangeSearch.tsx integrate ComboSearchCandlesChart

- Added import: `ComboSearchCandlesChart` from `"./ComboSearchCandlesChart"`.
- Added state: `showVolume` (`boolean`, default `false`) to support the volume/turnover toggle in combo mode.
- Added derived state: `filteredComboChartData` via `useMemo`, mirroring the existing `filteredChartData` pattern:
  - Filters `comboChartData.candles` and `comboChartData.fundingRates` by `chartRange` using `RANGE_MS` cutoff.
  - Returns `null` when `comboChartData` is null, returns unfiltered data when `chartRange === "all"`.
- Modified chart rendering container condition from `{selectedRate && (...)}` to `{(selectedRate || isComboMode) && (...)}` so combo charts render even when no single rate is selected.
- Modified chart header title to conditionally show combo info:
  - Combo mode: purple dot + `{firstExchange} {firstSymbol} {-|/} {secondExchange} {secondSymbol}` + filtered candle count.
  - Single mode: existing exchange dot + name + candle count (unchanged).
- Modified interval button click handler to block 1m in combo mode:
  - When `isComboMode && iv === "1m"`: clears `comboSelection` and `comboChartData`, then returns early.
  - This satisfies the "clears combo" requirement from the expected outcome.
- Modified close (✕) button handler to clear BOTH single and combo states:
  - `setSelectedRate(null)`, `setChartCandles([])`, `setChartFundingRates([])`, `setComboSelection({ first: null, second: null, mode: null })`, `setComboChartData(null)`.
- Modified chart body rendering:
  - `chartLoading`: shared loading spinner (unchanged).
  - `isComboMode && comboChartData`: renders `<ComboSearchCandlesChart data={filteredComboChartData ?? comboChartData} interval={chartInterval} timeRange={chartRange} onTimeRangeChange={setChartRange} showVolume={showVolume} onToggleVolume={() => setShowVolume((v) => !v)} />`.
  - `selectedRate && chartCandles.length > 0`: renders `<SearchCandlesChart ... />` with existing props unchanged.
  - Else: empty state "暂无K线数据".
- Preserved all existing single-chart functionality; `SearchCandlesChart.tsx` was not modified.
- `bun typecheck` passed successfully.

## Wave 3, Tasks 9-11 - CrossExchangeSearch.tsx combo UI polish

### Task 9 - Dual-highlight row styling
- In the `sortedRates.map` callback, added three booleans using existing `isSameRate` helper:
  - `isFirstSelected` = `isSameRate(comboSelection.first, rate)`
  - `isSecondSelected` = `isSameRate(comboSelection.second, rate)`
  - `isNormalSelected` = `isSameRate(selectedRate, rate)`
- Modified `<tr>` className to apply highlights in priority order:
  - `isNormalSelected || isFirstSelected` → `bg-blue-900/40 hover:bg-blue-900/50` (same blue as existing single-select)
  - `isSecondSelected` → `bg-purple-900/40 hover:bg-purple-900/50 ring-1 ring-purple-500/50`
  - otherwise → `hover:bg-gray-700/50`
- No badges or numbers added (user chose color-only).

### Task 10 - Auto-clear on search term change
- Added a `useEffect` with dependency `[searchTerm]` placed after the "clear combo chart when second removed" effect:
  - Clears `comboSelection` and `comboChartData`
  - Clears `selectedRate`, `chartCandles`, `chartFundingRates`
  - Aborts any in-flight fetch via `chartAbortRef.current` and nulls the ref
- This ensures both combo and single selections are wiped when the user modifies the search box.

### Task 11 - Empty intersection and error handling
- Added state: `comboError: string | null` initialized to `null`.
- Updated `fetchComboCandles`:
  - On success: `setComboError(null)`
  - On error (non-abort): `setComboError("数据获取失败，无法生成组合图")` + `setComboChartData(null)`
- Restructured chart body rendering to branch on `isComboMode` first:
  1. `comboError` present → show red error message in chart area.
  2. `!comboChartData || comboChartData.candles.length === 0` → show "两个交易对无重叠数据"
  3. `comboChartData.candles.length === 1` → show "数据点不足，无法绘制蜡烛图"
  4. Otherwise → render `<ComboSearchCandlesChart ... />`
- Single-chart branch (`selectedRate && chartCandles.length > 0`) remains unchanged.
- `bun typecheck` passed successfully.
