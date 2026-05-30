# Search Page Spread/Ratio Combo Chart

## TL;DR

> **Quick Summary**: Add combo chart support to the search page. When user types `"ETH-BTC"` (spread) or `"ETH/BTC"` (ratio), results for both keywords are mixed. User can click two results sequentially to generate a combo chart with custom candlestick calculations (open=first-second or first/second), min turnover, and funding rate difference. Time-aligned by timestamp intersection.
>
> **Deliverables**:
> - Combo type definitions and parsing utilities (`src/lib/combo.ts`)
> - Data alignment and calculation utility (`alignComboData`)
> - Modified search filtering in `CrossExchangeSearch.tsx`
> - New `ComboSearchCandlesChart.tsx` component
> - Modified row selection UX with dual-highlight colors
>
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 3 waves + Final
> **Critical Path**: Task 1 → Task 2 → Task 5 → Task 6 → Task 7 → F1-F4 → user okay

---

## Context

### Original Request
User wants to add two new search input formats to the search page:
1. `"ETH-BTC"` → **Spread chart**: `open = first.open - second.open`, `close = first.close - second.close`, ignore high/low, turnover = min(first, second), funding rate = first - second
2. `"ETH/BTC"` → **Ratio chart**: `open = first.open / second.open`, `close = first.close / second.close`, ignore high/low, turnover = min(first, second), funding rate = first - second

Cross-exchange time alignment is required.

### Interview Summary
**Key Discussions**:
- **Multi-select UX**: First click highlights item as "first selection", second click highlights as "second selection" and renders combo chart. Clicking selected item deselects it (if first deselected, second becomes first; if second deselected, back to single-select first). No prompt text.
- **Chart title**: Full display e.g. `"ETH (Binance) - BTC (Hyperliquid) [Spread]"`
- **Data alignment**: Candlestick only shows overlapping timestamps (intersection). Funding rate: if one pair lacks data at a timestamp, show empty (no line).
- **Search results**: Two keywords' results mixed together, sorted by current sort rule.
- **Turnover**: Per timestamp, take the smaller `quoteVolume` value between two pairs.
- **Syntax ambiguity**: User confirmed that OKX symbols in search page do NOT contain `-` or `/`, so no disambiguation needed. Simple `-` and `/` parsing is safe.
- **Search change behavior**: When search term changes, ALL selections auto-clear.
- **Same symbol selection**: Allowed (e.g., ETH on Binance vs ETH on Hyperliquid for cross-exchange spread).
- **Visual indicators**: First selection uses existing blue highlight, second selection uses purple/orange border.

**Research Findings**:
- Current state: single-select `selectedRate: SearchExchangeRate | null`
- Data fetch: `fetchSearchCandles(rate, interval, signal) → Promise<SearchCandleResult>`
- `SearchCandleResult`: `{ candles: SearchCandlePoint[], fundingRates: FundingRatePoint[], interval, exchange, symbol }`
- `SearchCandlePoint`: `{ openTime, closeTime, open, high, low, close, volume, quoteVolume }`
- `FundingRatePoint`: `{ time, rate, annualizedRate }`
- 5 exchanges: Hyperliquid, Gate.io, Binance, Lighter, OKX
- `CrossExchangeSearch.tsx`: ~986 lines, handles search input, result list, chart display
- `SearchCandlesChart.tsx`: ECharts with 3 subplots (candlestick, turnover/volume, funding rate)

### Metis Review
**Identified Gaps** (addressed):
- **Disambiguation**: Resolved — user confirmed no symbols contain `-` or `/` in current data.
- **Division by zero in ratio**: Will skip timestamps where second.open === 0.
- **ECharts negative spread values**: Will use `scale: true` and test.
- **1m interval combo**: Excluded from scope — too many API calls (OKX 1m pagination × 2).
- **Funding rate math**: Difference of aggregated averages per candle window is acceptable.
- **Format price for spread/ratio**: Spread needs currency formatting, ratio is unitless — will handle separately.

---

## Work Objectives

### Core Objective
Add spread and ratio combo chart functionality to the search page, allowing users to visualize mathematical combinations of two selected trading pairs.

### Concrete Deliverables
- `src/lib/combo.ts` — Type definitions, search term parsing, data alignment utility
- `src/lib/combo.test.ts` — Unit tests for alignment and calculation logic
- Modified `CrossExchangeSearch.tsx` — Multi-select state, combo search filtering, row click handling
- `src/components/search/ComboSearchCandlesChart.tsx` — Combo chart component
- Modified `SearchCandlesChart.tsx` (or wrapper) — Support combo data rendering

### Definition of Done
- [ ] Typing `"ETH-BTC"` shows mixed results for ETH and BTC
- [ ] Clicking two results shows combo chart with correct title
- [ ] Spread calculation: open = first.open - second.open
- [ ] Ratio calculation: open = first.open / second.open
- [ ] Turnover = min(first.quoteVolume, second.quoteVolume) per timestamp
- [ ] Funding rate = first.annualizedRate - second.annualizedRate
- [ ] Empty intersection shows empty chart without crash
- [ ] Normal search (non-combo) works exactly as before
- [ ] Search term change clears all selections
- [ ] 1m interval does NOT support combo mode

### Must Have
- Combo search parsing for `-` and `/` syntax
- Multi-select UX with visual indicators (blue + purple)
- Timestamp intersection alignment
- Spread and ratio candlestick calculation
- Min turnover per timestamp
- Funding rate difference
- Auto-clear on search change
- Preserve all existing single-select behavior

### Must NOT Have (Guardrails)
- MUST NOT modify normal search behavior when combo syntax is NOT detected
- MUST NOT add URL query parameters or persistence for combo state
- MUST NOT add combo calculations to table rows
- MUST NOT add new chart intervals or time ranges
- MUST NOT add technical indicators to combo charts
- MUST NOT modify per-exchange fetch implementations in `search-candles.ts`
- MUST NOT support more than 2 selections
- MUST NOT support combo mode for 1m interval
- MUST NOT change existing single-chart component props if it causes regression

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test available)
- **Automated tests**: YES (Tests after) — Unit test for `alignComboData`, Agent-Executed QA for UI flows
- **Framework**: bun test
- **If TDD**: Not applicable — complex UI component, tests added after implementation

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **Library/Module**: Use Bash (bun test) — Run unit tests, assert pass/fail

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, utilities, state):
├── Task 1: Combo types and search parsing utility [quick]
├── Task 2: alignComboData data alignment utility [deep]
├── Task 3: Search filtering logic for combo syntax [quick]
└── Task 4: CrossExchangeSearch multi-select state & click handling [deep]

Wave 2 (Core — data fetching, chart component):
├── Task 5: Parallel dual-fetch for combo selections [deep]
├── Task 6: ComboSearchCandlesChart component [deep]
├── Task 7: ECharts combo mode configuration [visual-engineering]
└── Task 8: Combo mode interval switching & time range filtering [deep]

Wave 3 (UI polish & edge cases):
├── Task 9: Dual-highlight row styling (blue + purple) [visual-engineering]
├── Task 10: Auto-clear selections on search change [quick]
└── Task 11: Empty intersection & error boundary handling [deep]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

- **Task 1**: None → Tasks 2, 3, 4, 5, 6
- **Task 2**: None → Tasks 5, 6, F4
- **Task 3**: None → Task 4
- **Task 4**: Tasks 1, 3 → Tasks 5, 9, 10
- **Task 5**: Tasks 1, 2, 4 → Tasks 6, 8
- **Task 6**: Tasks 1, 2, 5 → Tasks 7, 8
- **Task 7**: Task 6 → Task 8
- **Task 8**: Tasks 5, 6, 7 → F1-F4
- **Task 9**: Task 4 → F1-F4
- **Task 10**: Task 4 → F1-F4
- **Task 11**: Tasks 5, 6 → F1-F4

### Agent Dispatch Summary

- **Wave 1**: T1 → `quick`, T2 → `deep`, T3 → `quick`, T4 → `deep`
- **Wave 2**: T5 → `deep`, T6 → `deep`, T7 → `visual-engineering`, T8 → `deep`
- **Wave 3**: T9 → `visual-engineering`, T10 → `quick`, T11 → `deep`
- **FINAL**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. **Combo types and search parsing utility**

  **What to do**:
  - Create `src/lib/combo.ts` with the following exports:
    - `ComboMode` type: `'spread' | 'ratio' | null`
    - `ComboSelection` interface: `{ first: SearchExchangeRate | null; second: SearchExchangeRate | null; mode: ComboMode }`
    - `ComboCandleResult` interface: extends `SearchCandleResult` with `mode: ComboMode`, `firstSymbol`, `firstExchange`, `secondSymbol`, `secondExchange`
    - `parseComboSearch(term: string): { keyword1: string; keyword2: string; mode: ComboMode }` — detects `-` (spread) or `/` (ratio) separator. If neither found, returns `{ keyword1: term, keyword2: '', mode: null }`. Both keywords trimmed and lowercased.
    - `isComboSearch(term: string): boolean` — returns true if term contains exactly one `-` or `/` and both sides are non-empty after trimming.
  - Ensure types are compatible with existing `SearchExchangeRate`, `SearchCandleResult`, `SearchCandlePoint`, `FundingRatePoint` from `src/lib/search.ts` and `src/lib/search-candles.ts`.

  **Must NOT do**:
  - Do NOT add any UI logic or React hooks here — pure utility functions only.
  - Do NOT modify existing type files.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple type definitions and string parsing, no complex logic.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed for new file creation.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 4, 5, 6
  - **Blocked By**: None

  **References**:
  - `src/lib/search.ts:48-65` — `SearchExchangeRate` interface
  - `src/lib/search-candles.ts:16-39` — `SearchCandlePoint`, `FundingRatePoint`, `SearchCandleResult`

  **Acceptance Criteria**:
  - [ ] `parseComboSearch("ETH-BTC")` returns `{ keyword1: "eth", keyword2: "btc", mode: "spread" }`
  - [ ] `parseComboSearch("ETH/BTC")` returns `{ keyword1: "eth", keyword2: "btc", mode: "ratio" }`
  - [ ] `parseComboSearch("BTC")` returns `{ keyword1: "btc", keyword2: "", mode: null }`
  - [ ] `parseComboSearch("  ETH  -  BTC  ")` trims correctly
  - [ ] `isComboSearch("ETH-BTC")` returns true
  - [ ] `isComboSearch("BTC")` returns false
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Parse spread syntax
    Tool: Bash (node REPL)
    Preconditions: File exists at src/lib/combo.ts
    Steps:
      1. Run: node -e "const { parseComboSearch } = require('./src/lib/combo.ts'); console.log(JSON.stringify(parseComboSearch('ETH-BTC')))"
    Expected Result: Output contains {"keyword1":"eth","keyword2":"btc","mode":"spread"}
    Evidence: .sisyphus/evidence/task-1-parse-spread.txt

  Scenario: Parse normal search (non-combo)
    Tool: Bash (node REPL)
    Preconditions: File exists
    Steps:
      1. Run: node -e "const { isComboSearch } = require('./src/lib/combo.ts'); console.log(isComboSearch('BTC'))"
    Expected Result: Output is "false"
    Evidence: .sisyphus/evidence/task-1-parse-normal.txt
  ```

  **Evidence to Capture**:
  - [ ] Screenshot or text output of parse results

  **Commit**: YES
  - Message: `feat(search): add combo chart types and search parsing utility`
  - Files: `src/lib/combo.ts`

---

- [x] 2. **alignComboData data alignment and calculation utility**

  **What to do**:
  - In `src/lib/combo.ts`, implement `alignComboData(first: SearchCandleResult, second: SearchCandleResult, mode: 'spread' | 'ratio'): ComboCandleResult`:
    1. **Timestamp intersection**: Create a Map from `openTime` to `{ first: SearchCandlePoint | null, second: SearchCandlePoint | null }`. Iterate both `candles` arrays and populate. Only keep timestamps present in BOTH arrays.
    2. **Candlestick calculation** (for each overlapping timestamp):
       - Spread mode: `open = parseFloat(first.open) - parseFloat(second.open)`, `close = parseFloat(first.close) - parseFloat(second.close)`, `high` and `low` set to empty string `""` (ignored), `volume = first.volume`, `quoteVolume = min(parseFloat(first.quoteVolume), parseFloat(second.quoteVolume)).toString()`
       - Ratio mode: `open = parseFloat(first.open) / parseFloat(second.open)`, `close = parseFloat(first.close) / parseFloat(second.close)`. If `second.open === "0"` or `second.close === "0"`, SKIP that timestamp (do not include in output). `high` and `low` set to empty string. `quoteVolume = min(...)` same as spread.
    3. **Funding rate alignment**: Create a Map from `time` to `{ first: FundingRatePoint | null, second: FundingRatePoint | null }`. Iterate both `fundingRates` arrays. For timestamps present in BOTH, calculate: `rate = first.rate - second.rate`, `annualizedRate = first.annualizedRate - second.annualizedRate`. For timestamps only in one, do NOT include (show empty line gap as per user requirement).
    4. **Return**: `ComboCandleResult` with combined `candles`, `fundingRates`, `mode`, and metadata fields (`firstSymbol`, `firstExchange`, `secondSymbol`, `secondExchange`).
  - Also create `src/lib/combo.test.ts` with comprehensive unit tests:
    - Spread calculation correctness
    - Ratio calculation correctness
    - Min turnover
    - Timestamp intersection (includes only overlapping)
    - Empty intersection (returns empty arrays)
    - Division by zero in ratio (skips timestamp)
    - Funding rate subtraction
    - Missing funding rate at timestamp (not included)

  **Must NOT do**:
  - Do NOT round or format numbers here — return raw floats/strings as per type definitions.
  - Do NOT handle timezone conversion — assume all timestamps are already aligned to interval boundaries.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex data alignment logic with multiple edge cases (division by zero, empty intersection, missing funding rates). Requires careful implementation and thorough testing.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `ultrabrain`: Not needed — well-defined algorithmic problem.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5, 6, F4
  - **Blocked By**: None (can implement types independently, but should match Task 1's type definitions)

  **References**:
  - `src/lib/search-candles.ts:16-39` — Data types
  - `src/lib/search-candles.ts:676-735` — `fetchSearchCandles` to understand data shape

  **Acceptance Criteria**:
  - [ ] `bun test src/lib/combo.test.ts` passes all 8 test cases
  - [ ] Spread: `[{open:"100",close:"110"},{open:"90",close:"95"}]` - `[{open:"50",close:"55"},{open:"40",close:"42"}]` → `[{open:50,close:55},{open:50,close:53}]`
  - [ ] Ratio: `[{open:"100",close:"110"},{open:"90",close:"95"}]` / `[{open:"50",close:"55"},{open:"0",close:"42"}]` → `[{open:2,close:2}]` (second timestamp skipped due to division by zero)
  - [ ] Turnover: first.quoteVolume="1000", second.quoteVolume="500" → result.quoteVolume="500"
  - [ ] Empty intersection: first has timestamps [1,2], second has [3,4] → result.candles = []
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Spread calculation unit test
    Tool: Bash (bun test)
    Preconditions: combo.test.ts exists
    Steps:
      1. Run: bun test src/lib/combo.test.ts --testNamePattern="spread calculation"
    Expected Result: 1 test passed, 0 failed
    Evidence: .sisyphus/evidence/task-2-spread-test.txt

  Scenario: Empty intersection unit test
    Tool: Bash (bun test)
    Preconditions: combo.test.ts exists
    Steps:
      1. Run: bun test src/lib/combo.test.ts --testNamePattern="empty intersection"
    Expected Result: 1 test passed, 0 failed
    Evidence: .sisyphus/evidence/task-2-empty-test.txt
  ```

  **Evidence to Capture**:
  - [ ] Test output showing all tests pass

  **Commit**: YES
  - Message: `feat(search): add combo data alignment and calculation utility with tests`
  - Files: `src/lib/combo.ts`, `src/lib/combo.test.ts`

---

- [x] 3. **Search filtering logic for combo syntax**

  **What to do**:
  - Modify `CrossExchangeSearch.tsx` search filtering:
    - Import `parseComboSearch`, `isComboSearch` from `src/lib/combo.ts`.
    - In the `filteredRates` calculation (currently `filterByKeyword(allRates, searchTerm)`), add a branch:
      - If `isComboSearch(searchTerm)` is true, parse into `keyword1` and `keyword2`.
      - Filter results where `symbol.toLowerCase().includes(keyword1)` OR `symbol.toLowerCase().includes(keyword2)`.
      - Sort still applies normally (by current `sortConfig`).
      - If NOT combo search, use existing `filterByKeyword(allRates, searchTerm)` behavior unchanged.
    - Ensure the `searchTerm.trim()` check and empty-state messages still work correctly for combo searches.

  **Must NOT do**:
  - Do NOT modify `filterByKeyword` function itself — keep it pure for normal searches.
  - Do NOT change the sort behavior — combo results should still respect the current sort config.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple conditional branch in existing filtering logic.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1 (needs `isComboSearch` and `parseComboSearch`)

  **References**:
  - `src/components/search/CrossExchangeSearch.tsx:221` — Current `filteredRates` calculation
  - `src/components/search/CrossExchangeSearch.tsx:168` — `searchTerm` state

  **Acceptance Criteria**:
  - [ ] Typing `"ETH-BTC"` shows results where symbol includes "ETH" OR "BTC"
  - [ ] Typing `"BTC"` still shows only BTC results (normal search unchanged)
  - [ ] Sort order is preserved in combo search
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Combo search shows mixed results
    Tool: Playwright
    Preconditions: Dev server running at localhost:3000/search
    Steps:
      1. Navigate to /search
      2. Click search input, type "ETH-BTC"
      3. Wait for results to load (max 5s)
      4. Assert: page contains text "ETH" and "BTC" in result rows
    Expected Result: At least one ETH result and one BTC result visible
    Failure Indicators: Only ETH or only BTC results shown
    Evidence: .sisyphus/evidence/task-3-combo-search.png

  Scenario: Normal search still works
    Tool: Playwright
    Preconditions: Dev server running
    Steps:
      1. Navigate to /search
      2. Type "BTC" in search input
      3. Assert: results contain BTC, do not contain ETH
    Expected Result: Only BTC-related results shown
    Evidence: .sisyphus/evidence/task-3-normal-search.png
  ```

  **Evidence to Capture**:
  - [ ] Playwright screenshots of combo search results and normal search results

  **Commit**: YES (group with Wave 1)

---

- [x] 4. **CrossExchangeSearch multi-select state and click handling**

  **What to do**:
  - Modify `CrossExchangeSearch.tsx` state management:
    - Keep existing `selectedRate: SearchExchangeRate | null` for normal single-select mode.
    - Add new state: `comboSelection: ComboSelection` (imported from `src/lib/combo.ts`), initialized to `{ first: null, second: null, mode: null }`.
    - Modify `handleRowClick`:
      - If NOT combo search (`!isComboSearch(searchTerm)`): use existing single-select logic unchanged.
      - If IS combo search:
        - Case A: Clicked item is `comboSelection.first` → deselect first. If `second` exists, promote `second` to `first`, clear `second`. If no `second`, clear all.
        - Case B: Clicked item is `comboSelection.second` → deselect second, keep first. Chart reverts to single-select mode for `first`.
        - Case C: Neither first nor second selected → set as `first`.
        - Case D: `first` selected but `second` is null → set as `second`, trigger combo chart fetch.
        - Case E: Both selected, clicked a third item → ignore or treat as deselect of clicked if it matches first/second.
    - Add derived state `isComboMode: boolean` = `comboSelection.mode !== null && comboSelection.first !== null && comboSelection.second !== null`.
    - When `isComboMode` is true, pass combo data to chart instead of single data.
    - Ensure `chartAbortRef` aborts any in-flight fetches when selection changes.

  **Must NOT do**:
  - Do NOT remove or rename `selectedRate` — keep it for normal search backward compatibility.
  - Do NOT modify chart rendering logic here — only state management and click handling.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex state machine with multiple transitions, must preserve existing single-select behavior completely.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Tasks 5, 9, 10
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `src/components/search/CrossExchangeSearch.tsx:178` — `selectedRate` state
  - `src/components/search/CrossExchangeSearch.tsx:407-447` — `handleRowClick`
  - `src/components/search/CrossExchangeSearch.tsx:708` — Row selection highlight logic

  **Acceptance Criteria**:
  - [ ] Normal search click behavior unchanged (click to select, click again to deselect)
  - [ ] Combo search: first click sets `first`, second click sets `second`
  - [ ] Combo search: clicking first again promotes second to first
  - [ ] Combo search: clicking second again clears second, keeps first
  - [ ] Combo search: clicking a third item (not first/second) is ignored
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Combo multi-select state transitions
    Tool: Playwright
    Preconditions: Dev server running, search page loaded
    Steps:
      1. Type "ETH-BTC" in search box
      2. Click first ETH result row → assert row has "first-selected" class/style
      3. Click first BTC result row → assert both rows have selection styles, chart area shows loading or chart
      4. Click ETH row again → assert ETH deselected, BTC becomes first-selected, chart shows single BTC
      5. Click BTC row again → assert all deselected, chart empty
    Expected Result: State transitions match described behavior at each step
    Evidence: .sisyphus/evidence/task-4-state-transitions.png
  ```

  **Evidence to Capture**:
  - [ ] Playwright screenshots of each state transition

  **Commit**: YES (group with Wave 1)

---

- [x] 5. **Parallel dual-fetch for combo selections**

  **What to do**:
  - In `CrossExchangeSearch.tsx`, create a new async function `fetchComboCandles(first: SearchExchangeRate, second: SearchExchangeRate, interval: SearchChartInterval, signal: AbortSignal)`:
    - Call `fetchSearchCandles(first, interval, signal)` and `fetchSearchCandles(second, interval, signal)` in parallel via `Promise.all`.
    - On success: call `alignComboData(firstResult, secondResult, mode)` where `mode` comes from `parseComboSearch(searchTerm).mode`.
    - Set result to `comboChartData` state.
    - On error: if NOT `AbortError`, log error and set empty combo data.
  - Modify the interval change effect (currently fetches for `selectedRate`) to also handle combo mode:
    - If `isComboMode`: call `fetchComboCandles(comboSelection.first!, comboSelection.second!, chartInterval, signal)`.
    - If NOT combo mode: keep existing single-fetch logic.
  - Ensure `chartAbortRef` properly aborts both parallel fetches when selection or interval changes.
  - Add `comboChartData: ComboCandleResult | null` state.
  - Set `chartLoading` state appropriately during combo fetch.

  **Must NOT do**:
  - Do NOT modify `fetchSearchCandles` signature or implementation.
  - Do NOT fetch sequentially — must be parallel to minimize latency.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Parallel async fetching with abort handling, integration with existing state and effects.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 8, F3
  - **Blocked By**: Tasks 1, 2, 4

  **References**:
  - `src/lib/search-candles.ts:676` — `fetchSearchCandles` signature
  - `src/components/search/CrossExchangeSearch.tsx:450-485` — Interval change effect
  - `src/components/search/CrossExchangeSearch.tsx:422-426` — AbortController usage

  **Acceptance Criteria**:
  - [ ] Both `fetchSearchCandles` calls execute in parallel (not sequentially)
  - [ ] Abort signal cancels both fetches when selection changes
  - [ ] On success, `comboChartData` is populated with aligned data
  - [ ] On error (one fetch fails), graceful degradation (empty chart or error message)
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Combo fetch parallel execution
    Tool: Playwright + Browser DevTools Network tab
    Preconditions: Dev server running, combo mode active
    Steps:
      1. Type "ETH-BTC", select two results
      2. Open DevTools Network tab
      3. Clear network log, change interval to trigger re-fetch
      4. Assert: two fetch requests start within 100ms of each other (parallel)
    Expected Result: Both /api/* requests visible simultaneously in network log
    Evidence: .sisyphus/evidence/task-5-parallel-fetch.png

  Scenario: Graceful degradation on partial failure
    Tool: Playwright + Network blocking
    Preconditions: Dev server running
    Steps:
      1. Block one exchange's API endpoint in DevTools
      2. Type "ETH-BTC", select two results (one from blocked exchange)
      3. Assert: loading spinner disappears within 10s
      4. Assert: chart area shows error message or empty state (not infinite loading)
    Expected Result: No infinite loading; user sees meaningful feedback
    Evidence: .sisyphus/evidence/task-5-partial-failure.png
  ```

  **Evidence to Capture**:
  - [ ] Network tab screenshot showing parallel requests
  - [ ] Screenshot of error state after partial failure

  **Commit**: YES (group with Wave 2)

---

- [x] 6. **ComboSearchCandlesChart component**

  **What to do**:
  - Create `src/components/search/ComboSearchCandlesChart.tsx`:
    - Accept props: `data: ComboCandleResult`, `interval: SearchChartInterval`, `timeRange: ChartRange`, `onTimeRangeChange`, `showVolume: boolean`, `onToggleVolume`.
    - Reuse ECharts initialization pattern from `SearchCandlesChart.tsx`.
    - Title format: `"{firstSymbol} ({firstExchange}) {separator} {secondSymbol} ({secondExchange}) [{modeLabel}]"` where `separator` is `-` for spread, `/` for ratio, `modeLabel` is `Spread` or `Ratio`.
    - Candlestick data: use `open` and `close` from combo data, `high` and `low` should be handled gracefully (ECharts may need them even if ignored — set `high = max(open, close)`, `low = min(open, close)` to avoid rendering issues, or use a custom series type if needed).
    - Sub-chart 1 (turnover/volume): use combo `quoteVolume` (which is already `min` from alignment).
    - Sub-chart 2 (funding rate): use combo `fundingRates`. If empty or 1m interval, hide this subplot (same as single-chart 1m behavior).
    - Tooltip: show combo values with clear labels e.g. `"Spread: {value}"` or `"Ratio: {value}"`.
    - Colors: use a new distinct color for combo chart (e.g., `#10b981` emerald or derived from both exchange colors). Do NOT use existing single-exchange colors.
    - Axis formatting: reuse existing `formatXAxisLabel` and price formatting from `SearchCandlesChart.tsx`.
    - Spread price formatting: use `$` prefix with appropriate decimal places (spread values may be negative).
    - Ratio price formatting: no currency prefix, show as raw decimal (ratio is unitless).

  **Must NOT do**:
  - Do NOT modify `SearchCandlesChart.tsx` directly — create a separate component to avoid regression risk.
  - Do NOT add new dependencies — reuse existing ECharts setup.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex ECharts component with custom data formatting, multiple subplots, and dynamic title/tooltip.
  - **Skills**: [`/frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for ECharts configuration, color schemes, and responsive chart layout.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 7, 8 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 7, 8, F3
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/components/search/SearchCandlesChart.tsx` — Full ECharts setup pattern (copy structure)
    - Candlestick series config (lines ~200-250)
    - Turnover/volume bar series config (lines ~260-300)
    - Funding rate line series config (lines ~310-350)
    - Tooltip formatter (lines ~400-450)
    - X-axis label formatter (lines ~500-550)

  **Acceptance Criteria**:
  - [ ] Component renders without errors when given valid `ComboCandleResult`
  - [ ] Title shows correct format: "ETH (Binance) - BTC (Hyperliquid) [Spread]"
  - [ ] Candlestick series uses combo open/close values
  - [ ] Turnover sub-chart shows min turnover values
  - [ ] Funding rate sub-chart shows difference values
  - [ ] 1m interval hides funding rate subplot (same as single-chart)
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Combo chart renders with correct title
    Tool: Playwright
    Preconditions: Dev server running, combo mode active with ETH-BTC spread
    Steps:
      1. Select two results for ETH-BTC spread
      2. Wait for chart to load (max 10s)
      3. Screenshot chart title area
      4. Assert: title text contains "ETH (" and "BTC (" and "[Spread]"
    Expected Result: Title matches expected format
    Evidence: .sisyphus/evidence/task-6-chart-title.png

  Scenario: Combo chart candlestick values
    Tool: Playwright + Browser Console
    Preconditions: Combo chart loaded
    Steps:
      1. In browser console, access echarts instance: `document.querySelector('canvas').__echartsInstance`
      2. Extract candlestick series data
      3. Compare first candle open/close with expected spread/ratio values
    Expected Result: Values match alignComboData calculation
    Evidence: .sisyphus/evidence/task-6-candle-values.json
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of full combo chart
  - [ ] Console output of chart data for verification

  **Commit**: YES (group with Wave 2)

---

- [x] 7. **ECharts combo mode configuration**

  **What to do**:
  - In `ComboSearchCandlesChart.tsx`, implement ECharts option configuration:
    - **Grid layout**: Same 3-subplot layout as `SearchCandlesChart.tsx` (candlestick top 55%, turnover middle 25%, funding rate bottom 20%). For 1m interval or empty funding rates, collapse to 2-subplot (candlestick 65%, turnover 35%).
    - **Candlestick series**: 
      - Data format: `[openTime, open, high, low, close]` — since high/low are ignored but ECharts candlestick requires them, set `high = Math.max(open, close)`, `low = Math.min(open, close)` for spread; for ratio use same approach.
      - Color: use distinct combo color (e.g., `#10b981` for up, `#ef4444` for down, or a custom neutral color like `#8b5cf6` purple to indicate it's a computed value, not a real price).
      - ItemStyle: same border/width as single chart.
    - **Turnover bar series**: 
      - Data: `[openTime, quoteVolume]` from combo data.
      - Color: same as single chart (based on candle color for that timestamp).
    - **Funding rate line series**:
      - Data: `[time, annualizedRate]` from combo fundingRates.
      - Color: combo color with area fill.
      - If combo fundingRates is empty, omit this series entirely.
    - **Tooltip**:
      - Custom formatter showing:
        - Date/time
        - Spread/Ratio value (with label)
        - First symbol value (for reference)
        - Second symbol value (for reference)
        - Turnover value
        - Funding rate difference (if available)
      - Format numbers with appropriate precision (spread: 2 decimals + $; ratio: 4-6 decimals, no $).
    - **DataZoom**: Preserve existing slider + inside zoom configuration.
    - **Axis pointer**: Link all subplots.

  **Must NOT do**:
  - Do NOT add new chart features not in single-chart (no MA, Bollinger, etc.).
  - Do NOT change dataZoom or axis configuration beyond what's needed for combo data.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: ECharts configuration, colors, tooltips, and responsive layout.
  - **Skills**: [`/frontend-ui-ux`]
    - `frontend-ui-ux`: ECharts expertise, color scheme design, tooltip formatting.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 6, 8 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Task 6

  **References**:
  - `src/components/search/SearchCandlesChart.tsx:200-600` — Complete ECharts option construction

  **Acceptance Criteria**:
  - [ ] Grid layout matches single-chart proportions
  - [ ] Candlestick renders without console errors
  - [ ] Tooltip shows combo-specific labels
  - [ ] DataZoom works on combo chart
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Tooltip shows combo values
    Tool: Playwright
    Preconditions: Combo chart loaded
    Steps:
      1. Hover over a candlestick in the chart
      2. Screenshot tooltip
      3. Assert: tooltip contains "Spread" or "Ratio" label
      4. Assert: tooltip shows first and second reference values
    Expected Result: Tooltip clearly identifies this as a combo chart with reference values
    Evidence: .sisyphus/evidence/task-7-tooltip.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of tooltip
  - [ ] Screenshot of full chart layout

  **Commit**: YES (group with Wave 2)

---

- [x] 8. **Combo mode interval switching and time range filtering**

  **What to do**:
  - Ensure combo chart respects interval switching:
    - When user clicks interval buttons (1w, 1d, 4h, 1h, 5m, 1m) in combo mode:
      - If 1m selected: show a message or disable combo mode. Combo mode is NOT supported for 1m interval (too many API calls with pagination). Clear combo selections or show "1m 不支持组合图" message.
      - For other intervals: re-fetch both data sources in parallel with new interval, re-align, re-render.
  - Ensure combo chart respects time range filtering:
    - Time range buttons (All, 3y, 1y, 6m, 1m, 1d) should filter combo data client-side exactly like single-chart.
    - The filtering logic should apply to the COMBINED data (already aligned), not to individual sources.
  - Ensure combo chart's `onTimeRangeChange` callback works correctly.

  **Must NOT do**:
  - Do NOT add new time ranges or intervals.
  - Do NOT support 1m combo mode.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Integration of existing interval/time-range logic with combo mode, handling edge cases.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 6, 7 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 5, 6, 7

  **References**:
  - `src/components/search/CrossExchangeSearch.tsx:446-485` — Interval change effect
    - `src/components/search/CrossExchangeSearch.tsx:900-950` — Interval buttons
    - `src/components/search/SearchCandlesChart.tsx:100-150` — Time range filtering logic

  **Acceptance Criteria**:
  - [ ] Switching from 1d to 4h in combo mode re-fetches and re-renders correctly
  - [ ] Clicking 1m interval in combo mode shows unsupported message or clears combo
  - [ ] Time range buttons filter combo data client-side
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Interval switch in combo mode
    Tool: Playwright
    Preconditions: Combo chart active at 1d interval
    Steps:
      1. Click "4h" interval button
      2. Wait for chart to update (max 10s)
      3. Assert: chart title still shows combo format
      4. Assert: candle count changes (4h should have more candles than 1d for same range)
    Expected Result: Combo chart updates with new interval data
    Evidence: .sisyphus/evidence/task-8-interval-switch.png

  Scenario: 1m interval in combo mode blocked
    Tool: Playwright
    Preconditions: Combo chart active
    Steps:
      1. Click "1m" interval button
      2. Assert: combo selections cleared OR message "1m 不支持组合图" visible
      3. Assert: chart returns to single-select mode or shows empty state
    Expected Result: 1m combo mode is explicitly blocked
    Evidence: .sisyphus/evidence/task-8-1m-blocked.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshots of interval switch and 1m blocking

  **Commit**: YES (group with Wave 2)

---

- [x] 9. **Dual-highlight row styling (blue + purple)**

  **What to do**:
  - Modify `CrossExchangeSearch.tsx` result list row rendering:
    - First selection (`comboSelection.first`): use existing blue highlight style (`bg-blue-50` or equivalent).
    - Second selection (`comboSelection.second`): add purple/orange highlight style (e.g., `border-2 border-purple-500` or `bg-purple-50`).
    - Ensure both styles can coexist if first and second are both visible in the list.
    - Update the existing `selectedRate` highlight logic to NOT conflict with combo highlights in normal search mode.
    - The row should still show hover effects and cursor pointer.
    - Consider adding a small badge or text indicator like "①" and "②" next to the symbol, but ONLY if the user chose that option. User chose "different color border" only, so NO numeric badges — just colors.

  **Must NOT do**:
  - Do NOT change row layout or column structure.
  - Do NOT add badges or numbers — user explicitly chose color-only differentiation.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: CSS/Tailwind styling modifications for row highlights.
  - **Skills**: [`/frontend-ui-ux`]
    - `frontend-ui-ux`: Tailwind CSS styling, visual hierarchy.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 10, 11 in Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4

  **References**:
  - `src/components/search/CrossExchangeSearch.tsx:700-720` — Row rendering and selection check
    - `src/components/search/CrossExchangeSearch.tsx:708` — Current selection highlight condition

  **Acceptance Criteria**:
  - [ ] First selected row has blue highlight
  - [ ] Second selected row has purple/orange highlight
  - [ ] Both highlights visible simultaneously when applicable
  - [ ] Normal search mode still uses existing blue highlight (no purple)
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Dual highlight visible
    Tool: Playwright
    Preconditions: Combo search active, two items selected
    Steps:
      1. Select first item → screenshot
      2. Select second item → screenshot
      3. Assert: first row has blue-ish background/border
      4. Assert: second row has purple/orange background/border
    Expected Result: Visual distinction between first and second selection is clear
    Evidence: .sisyphus/evidence/task-9-dual-highlight.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot showing both highlights

  **Commit**: YES (group with Wave 3)

---

- [x] 10. **Auto-clear selections on search change**

  **What to do**:
  - In `CrossExchangeSearch.tsx`, add an effect that watches `searchTerm`:
    - When `searchTerm` changes (and it's a meaningful change, not just the same value):
      - Clear `comboSelection` to `{ first: null, second: null, mode: null }`.
      - Clear `comboChartData` to `null`.
      - If there was an in-flight combo fetch, abort it via `chartAbortRef`.
    - For normal search mode: `selectedRate` should ALSO clear when search term changes (current behavior may or may not do this — verify and ensure consistency).
    - Ensure the clear happens BEFORE new filtering/searching begins.

  **Must NOT do**:
  - Do NOT clear selections when `searchTerm` is updated programmatically within the same render cycle (e.g., initial load).
  - Do NOT prevent user from typing in search box.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple effect addition.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 11 in Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4

  **References**:
  - `src/components/search/CrossExchangeSearch.tsx:168` — `searchTerm` state
    - `src/components/search/CrossExchangeSearch.tsx:330` — Search term effect logic

  **Acceptance Criteria**:
  - [ ] Changing search term from "ETH-BTC" to "ETH-SOL" clears all selections
  - [ ] Changing search term from "ETH-BTC" to "" clears all selections
  - [ ] Chart area becomes empty after search change
  - [ ] Normal search mode also clears `selectedRate` on search change
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Search change clears combo selections
    Tool: Playwright
    Preconditions: Combo mode active with two selections
    Steps:
      1. Select two items for ETH-BTC
      2. Clear search input and type "ETH-SOL"
      3. Assert: no rows have selection highlight
      4. Assert: chart area is empty or shows placeholder
    Expected Result: All selections cleared, chart empty
    Evidence: .sisyphus/evidence/task-10-search-clear.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot before and after search change

  **Commit**: YES (group with Wave 3)

---

- [x] 11. **Empty intersection and error boundary handling**

  **What to do**:
  - In `ComboSearchCandlesChart.tsx`:
    - If `data.candles.length === 0`: render an empty state message like "两个交易对无重叠数据" or "暂无K线数据" instead of trying to render ECharts.
    - If `data.candles.length === 1`: ECharts candlestick may render poorly with only 1 candle. Show the same empty state or a warning "数据点不足，无法绘制蜡烛图".
    - If `data.candles.length >= 2`: render normally.
  - In `CrossExchangeSearch.tsx` combo fetch error handling:
    - If one fetch fails: show an error message in the chart area, e.g., "{exchange} 数据获取失败，无法生成组合图".
    - If both fetches fail: show "数据获取失败".
    - Ensure error messages are dismissible or auto-clear on next selection.
  - Handle the case where `comboSelection.first` and `comboSelection.second` are from the same exchange but different symbols — this should work normally.
  - Handle the case where user selects two items but then changes interval before fetch completes — abort in-flight fetch and show loading state.

  **Must NOT do**:
  - Do NOT retry failed fetches automatically.
  - Do NOT show browser alert() — use inline UI messages only.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Edge case handling and error states across multiple components.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 10 in Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 5, 6

  **References**:
  - `src/components/search/SearchCandlesChart.tsx:50-80` — Empty state handling in single chart

  **Acceptance Criteria**:
  - [ ] Empty intersection shows "无重叠数据" message, no crash
  - [ ] Single candle data shows warning or empty state
  - [ ] Fetch failure shows exchange-specific error message
  - [ ] Error states clear on next successful selection
  - [ ] `bun typecheck` passes

  **QA Scenarios**:
  ```
  Scenario: Empty intersection handling
    Tool: Playwright + Network mocking
    Preconditions: Dev server running
    Steps:
      1. Mock one exchange to return candles with timestamps far in the past
      2. Mock other exchange to return candles with timestamps far in the future
      3. Select both, generate combo chart
      4. Assert: chart area shows "无重叠数据" or similar message
      5. Assert: no JavaScript errors in console
    Expected Result: Graceful empty state, no crash
    Evidence: .sisyphus/evidence/task-11-empty-intersection.png

  Scenario: Fetch failure handling
    Tool: Playwright + Network blocking
    Preconditions: Dev server running
    Steps:
      1. Block one exchange API endpoint
      2. Select two results (one from blocked exchange)
      3. Assert: error message visible within 10s
      4. Assert: loading spinner gone
    Expected Result: Meaningful error message instead of infinite loading
    Evidence: .sisyphus/evidence/task-11-fetch-error.png
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of empty intersection state
  - [ ] Screenshot of fetch error state

  **Commit**: YES (group with Wave 3)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(search): add combo chart types and multi-select state`
- **Wave 2**: `feat(search): add combo data fetching and chart component`
- **Wave 3**: `feat(search): add combo UI styling and edge case handling`
- **Wave FINAL**: `test(search): add combo chart unit tests and QA`

---

## Success Criteria

### Verification Commands
```bash
# Type check
bun typecheck

# Unit tests
bun test src/lib/combo.test.ts

# Build
bun build
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Normal search regression tested
- [ ] Spread and ratio combo flows tested
- [ ] Empty intersection tested
- [ ] Search change auto-clear tested
