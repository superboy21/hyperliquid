# CCXT Migration Roadmap Without Changing Business Semantics

## TL;DR
> **Summary**: Introduce CCXT as a new transport layer only where it can reproduce existing exchange outputs exactly, while preserving all current business semantics through an explicit adapter boundary and exchange-native fallbacks.
> **Deliverables**:
> - Canonical exchange-domain contract for search page and exchange pages
> - Semantics lock file/matrix for current definitions
> - CCXT-backed adapters for low-risk surfaces first
> - Native fallback policy for unsupported or ambiguous fields
> - Validation and rollback path for each migration wave
> **Effort**: Large
> **Parallel**: YES - 5 waves
> **Critical Path**: 1 → 2 → 3/4 → 5 → Final Verification

## Context
### Original Request
User asked for a migration roadmap that does **not** change business semantics while evaluating whether the webapp can move from direct exchange APIs to CCXT.

### Interview Summary
- Research-only request; no code changes yet.
- Existing business rules must remain intact, especially around predicted funding, latest settlement, average rate, search-page lazy loading, and page-to-page semantic consistency.
- Prior research established that Binance and Gate.io are good CCXT candidates, while Hyperliquid and Lighter have important unified-API gaps.
- Repo currently has `typecheck`, `lint`, and `build`, but no automated test suite or CI coverage for integration behavior.

### Metis Review (gaps addressed)
- Guardrail: do not treat this as a “replace endpoints with CCXT” task; treat it as a “preserve outputs while swapping selected transports” task.
- Guardrail: preserve current semantics with evidence snapshots before changing any adapter.
- Scope control: explicitly separate transport migration from business-rule refactors.
- Risk control: require rollback toggles and side-by-side verification because current repo lacks automated contract tests.

## Work Objectives
### Core Objective
Adopt CCXT where it safely reduces transport-specific code, without changing the current meaning, timing, formatting, or derivation of user-visible funding metrics across Binance, Gate.io, Hyperliquid, and Lighter.

### Deliverables
- Semantic baseline matrix covering every user-visible metric and its current source/derivation
- Canonical internal exchange adapter contract consumed by both funding pages and search page
- CCXT candidate matrix per exchange/field with approved fallback rules
- Phased rollout plan with validation, rollback, and release gates

### Definition of Done (verifiable conditions with commands)
- A single internal contract exists for exchange data consumed by both `src/lib/search.ts` and exchange page adapters.
- Every migrated field has an explicit source mapping: `CCXT`, `native`, or `native-required`.
- Search page and exchange pages produce matching values for latest settlement and average rate per exchange under identical fixtures/manual checks.
- Predicted funding behavior remains unchanged for all exchanges where it currently exists.
- `npm run typecheck`, `npm run lint`, and `npm run build` all pass after each rollout wave.

### Must Have
- No business-semantic drift
- Explicit exchange-specific fallbacks
- Side-by-side comparison capability during rollout
- Verification artifacts for every migration wave
- Clear rollback strategy

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT rewrite annualization logic without proving equivalence first
- Must NOT force Hyperliquid or Lighter onto CCXT-only paths where unified support is incomplete
- Must NOT merge search-page and exchange-page semantics by assumption; prove parity per metric
- Must NOT remove native endpoints before side-by-side validation passes
- Must NOT introduce “best effort” replacements for predicted funding, latest settlement, or funding interval semantics

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + existing `npm run typecheck`, `npm run lint`, `npm run build`; implementation should add focused adapter/contract tests before major cutovers
- QA policy: Every task includes agent-executed scenarios and evidence capture
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.

Wave 1: semantics inventory and canonical-contract design
Wave 2: shared adapter boundary and verification harness
Wave 3: low-risk CCXT adoption for Binance and Gate.io
Wave 4: partial/hybrid handling for Hyperliquid and Lighter
Wave 5: rollout controls, cleanup, and default-on enablement

### Dependency Matrix (full, all tasks)
- 1 blocks all other tasks
- 2 depends on 1; blocks 3-8
- 3 depends on 1; informs 5-8
- 4 depends on 1 and 2; blocks 5-8
- 5 depends on 2, 3, 4
- 6 depends on 2, 3, 4
- 7 depends on 2, 3, 4
- 8 depends on 2, 3, 4
- 9 depends on 5-8
- 10 depends on 9

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → deep, writing, unspecified-high
- Wave 2 → 2 tasks → deep, unspecified-high
- Wave 3 → 2 tasks → deep, quick
- Wave 4 → 2 tasks → deep, ultrabrain
- Wave 5 → 2 tasks → unspecified-high, writing

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Lock Current Business Semantics Into a Baseline Matrix

  **What to do**: Create a source-of-truth matrix for every user-visible metric on the funding pages and search page: predicted funding, latest settlement, average rate (1 day), current funding, funding interval, mark/index/last price, open interest, bid/ask, annualized values, and category labels. For each exchange, record the current source file, current upstream endpoint, derivation rule, null/blank behavior, ordering assumptions, and page consumers. Include explicit notes for Hyperliquid HIP-3 handling, Gate indicative funding, Binance latest-settlement ordering, and Lighter rate-scale/sign conversions.
  **Must NOT do**: Must NOT simplify two distinct business definitions into one “normalized” rule unless both are already identical in production.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Requires repository-wide synthesis of current semantics and hidden coupling.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['git-master']` - No git work needed.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2,3,4,5,6,7,8,9,10] | Blocked By: []

  **References**:
  - Pattern: `src/lib/search.ts` - Current cross-exchange search semantics and detail-loading rules
  - Pattern: `src/components/search/CrossExchangeSearch.tsx` - Search-page formatting and lazy-load behavior
  - Pattern: `src/components/funding/ExchangeFundingMonitor.tsx` - Shared exchange-page row/detail contract
  - Pattern: `src/components/funding/FundingMonitor.tsx` - Hyperliquid page mapping
  - Pattern: `src/components/funding/GateFundingMonitor.tsx` - Gate page mapping and indicative funding behavior
  - Pattern: `src/components/funding/BinanceFundingMonitor.tsx` - Binance page mapping and settlement handling
  - Pattern: `src/components/funding/LighterFundingMonitor.tsx` - Lighter page mapping and special conversions
  - API/Type: `src/lib/types.ts` - Shared normalized interfaces and helpers

  **Acceptance Criteria**:
  - [ ] A checked-in artifact documents every user-visible metric by exchange and consumer surface.
  - [ ] Every metric row is labeled as `exact-match required`, `native-required`, or `CCXT-candidate`.
  - [ ] All currently known special cases are explicitly documented.

  **QA Scenarios**:
  ```
  Scenario: Baseline matrix completeness
    Tool: Bash
    Steps: Run repository validation commands after adding baseline artifact; inspect artifact for all 4 exchanges and all required metrics.
    Expected: Artifact covers Binance, Gate.io, Hyperliquid, and Lighter with no missing required metric rows.
    Evidence: .sisyphus/evidence/task-1-semantics-baseline.txt

  Scenario: Drift-risk detection
    Tool: Bash
    Steps: Compare documented derivations against current source files and confirm each special-case rule has a corresponding row.
    Expected: No undocumented special-case metric remains in source files.
    Evidence: .sisyphus/evidence/task-1-semantics-baseline-error.txt
  ```

  **Commit**: YES | Message: `docs(migration): lock current funding semantics baseline` | Files: [`docs or config artifact for migration baseline`, `optional supporting notes`]

- [ ] 2. Define a Canonical Internal Exchange Contract Shared by Search and Exchange Pages

  **What to do**: Design and introduce one internal adapter contract that both `src/lib/search.ts` and all exchange page adapters consume. The contract must represent raw values and semantic metadata separately: funding source type, funding interval, settlement timestamp, predicted-vs-settled provenance, symbol identity, market identity, and display-null policy. Preserve per-exchange semantics by encoding them explicitly rather than flattening them away.
  **Must NOT do**: Must NOT hide exchange-specific ambiguity inside generic field names without provenance metadata.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: This is the core architectural seam for a safe migration.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['refactor']` - Executor should follow explicit design, not freeform refactoring.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [4,5,6,7,8,9,10] | Blocked By: [1]

  **References**:
  - Pattern: `src/lib/types.ts` - Existing normalized types to extend or replace
  - Pattern: `src/lib/normalizers/index.ts` - Existing normalization entry point
  - Pattern: `src/lib/normalizers/hyperliquid.ts` - Example of exchange-specific normalization
  - Pattern: `src/lib/normalizers/gateio.ts` - Example of interval-aware normalization
  - Pattern: `src/lib/normalizers/binance.ts` - Existing Binance utility/normalizer layer
  - Pattern: `src/lib/search.ts` - Current duplicate mapping path to eliminate

  **Acceptance Criteria**:
  - [ ] One internal contract is defined and used as the target shape for all exchanges.
  - [ ] Contract includes provenance fields for predicted/current/settled values and funding interval semantics.
  - [ ] Contract can represent Hyperliquid HIP-3 and Lighter market-id requirements without lossy mapping.

  **QA Scenarios**:
  ```
  Scenario: Contract supports all required semantics
    Tool: Bash
    Steps: Run typecheck against the new contract and adapter stubs or implementations.
    Expected: Type system accepts all four exchange adapters without `any`-based escape hatches for semantic fields.
    Evidence: .sisyphus/evidence/task-2-canonical-contract.txt

  Scenario: Provenance gap detection
    Tool: Bash
    Steps: Review adapter compile failures or assertions for any metric that cannot be represented by the contract.
    Expected: Any unsupported semantic causes a clear failure rather than silent field-dropping.
    Evidence: .sisyphus/evidence/task-2-canonical-contract-error.txt
  ```

  **Commit**: YES | Message: `feat(data): add canonical exchange contract` | Files: [`src/lib/types.ts`, `src/lib/normalizers/**`, `supporting contract files`]

- [ ] 3. Build a CCXT Capability Matrix and Native-Fallback Policy

  **What to do**: Convert research findings into an executable migration decision table. For each exchange and field, classify the source as one of: `CCXT-approved`, `CCXT-approved-with-native-parity-check`, `native-required`, or `do-not-migrate`. Explicitly mark predicted funding, latest settlement semantics, mark/index OHLCV, open-interest semantics, Lighter funding history, Hyperliquid current funding limitations, and search-specific lazy detail behavior.
  **Must NOT do**: Must NOT label a field “CCXT-approved” if parity cannot be demonstrated from current production behavior.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: This is a decision artifact that drives all implementation waves.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['oracle']` - No separate consultation needed inside this task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [5,6,7,8,9,10] | Blocked By: [1]

  **References**:
  - External: `https://github.com/ccxt/ccxt` - CCXT library
  - Pattern: `src/lib/hyperliquid.ts` - Current Hyperliquid transport and semantics
  - Pattern: `src/lib/gateio.ts` - Current Gate transport and semantics
  - Pattern: `src/lib/lighter.ts` - Current Lighter transport and semantics
  - Pattern: `src/components/funding/BinanceFundingMonitor.tsx` - Current Binance transport orchestration

  **Acceptance Criteria**:
  - [ ] Every user-visible field has a migration disposition.
  - [ ] Hyperliquid and Lighter partial-support risks are documented as hard guardrails.
  - [ ] No field required for current UX remains “TBD”.

  **QA Scenarios**:
  ```
  Scenario: Capability matrix completeness
    Tool: Bash
    Steps: Validate the matrix against the baseline artifact from Task 1.
    Expected: Every baseline metric has exactly one migration disposition.
    Evidence: .sisyphus/evidence/task-3-ccxt-capability-matrix.txt

  Scenario: Unsupported-field escalation
    Tool: Bash
    Steps: Search for any required metric marked as both `CCXT-approved` and `native-required` or left blank.
    Expected: No contradictory or blank dispositions remain.
    Evidence: .sisyphus/evidence/task-3-ccxt-capability-matrix-error.txt
  ```

  **Commit**: YES | Message: `docs(migration): add ccxt capability and fallback matrix` | Files: [`migration decision artifacts`]

- [ ] 4. Add a Parity Verification Harness Before Swapping Any Transport

  **What to do**: Introduce comparison infrastructure that can run old-vs-new adapter outputs side by side for the same symbol/market set and produce machine-readable diffs. This harness must compare raw values, null/blank behavior, timestamps, intervals, and display-ready derived metrics. It should support targeted fixture snapshots for Binance, Gate, Hyperliquid, and Lighter.
  **Must NOT do**: Must NOT allow transport cutover until parity output can be inspected per field.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Requires practical validation scaffolding under low existing test coverage.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['playwright']` - This task is data-contract validation, not browser automation.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [5,6,7,8,9,10] | Blocked By: [1,2]

  **References**:
  - Pattern: `src/lib/search.ts` - Search aggregation output to compare
  - Pattern: `src/components/funding/*FundingMonitor.tsx` - Exchange-page adapter outputs to compare
  - Pattern: `src/lib/utils/funding.ts` - Derived metric helpers that must remain stable
  - Pattern: `package.json` - Existing validation commands

  **Acceptance Criteria**:
  - [ ] Harness can compare native adapter output against candidate CCXT adapter output for each exchange.
  - [ ] Harness emits clear per-field pass/fail results.
  - [ ] A migration wave cannot be marked complete without captured parity evidence.

  **QA Scenarios**:
  ```
  Scenario: Side-by-side adapter comparison
    Tool: Bash
    Steps: Run the harness for one representative market per exchange using current native adapter and a stub or pilot CCXT adapter.
    Expected: Output clearly identifies equal values, tolerated null-equivalent values, and mismatches.
    Evidence: .sisyphus/evidence/task-4-parity-harness.txt

  Scenario: Semantic mismatch escalation
    Tool: Bash
    Steps: Force a known mismatch in a non-production comparison case.
    Expected: Harness reports the mismatch as a blocking failure.
    Evidence: .sisyphus/evidence/task-4-parity-harness-error.txt
  ```

  **Commit**: YES | Message: `test(data): add adapter parity verification harness` | Files: [`comparison harness files`, `supporting fixtures or scripts`]

- [ ] 5. Migrate Binance to CCXT Behind a Feature Flag

  **What to do**: Introduce a Binance CCXT adapter for the fields that can be proven equivalent: markets, symbols, current funding where parity is confirmed, funding history where parity is confirmed, standard OHLCV, and other stable market metadata. Preserve native fallbacks for any field whose current semantics still depend on Binance-specific endpoints or timing semantics. Gate the new path behind a feature flag or equivalent runtime switch and keep side-by-side validation available.
  **Must NOT do**: Must NOT remove Binance-native fallback before parity evidence exists for latest settlement, funding interval, and search-page details.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Binance is the first real cutover and defines the migration pattern.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['git-master']` - Commit hygiene is secondary to semantic safety here.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [9,10] | Blocked By: [2,3,4]

  **References**:
  - Pattern: `src/components/funding/BinanceFundingMonitor.tsx` - Current Binance data orchestration
  - Pattern: `src/app/api/binance/route.ts` - Existing Binance proxy route
  - Pattern: `src/app/api/binance/klines/route.ts` - Existing Binance candles proxy
  - Pattern: `src/lib/search.ts` - Search-page Binance path
  - External: `https://github.com/ccxt/ccxt` - CCXT source and docs

  **Acceptance Criteria**:
  - [ ] Binance can run on native or CCXT-backed transport without changing page outputs.
  - [ ] Latest settlement, funding interval, and average-rate semantics remain unchanged.
  - [ ] Feature flag permits immediate rollback to native path.

  **QA Scenarios**:
  ```
  Scenario: Binance parity pass under flag off/on
    Tool: Bash
    Steps: Run parity harness and app validation with the Binance CCXT flag disabled, then enabled.
    Expected: Validation passes in both modes; parity report shows no blocking semantic drift.
    Evidence: .sisyphus/evidence/task-5-binance-ccxt.txt

  Scenario: Rollback safety
    Tool: Bash
    Steps: Trigger a simulated mismatch or disable the new adapter path.
    Expected: App falls back to native Binance path without breaking build or typecheck.
    Evidence: .sisyphus/evidence/task-5-binance-ccxt-error.txt
  ```

  **Commit**: YES | Message: `feat(binance): add ccxt transport with native fallback` | Files: [`Binance adapter files`, `search/funding consumers`, `feature-flag config`]

- [ ] 6. Migrate Gate.io to CCXT Behind a Feature Flag

  **What to do**: Introduce a Gate.io CCXT adapter for fields with confirmed parity. Preserve Gate-native behavior for indicative funding, dynamic funding intervals, and any classification or route-level behavior that CCXT cannot reproduce exactly. Keep batch hydration and settlement semantics unchanged until parity proof exists.
  **Must NOT do**: Must NOT replace indicative funding semantics with a generic current funding field.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Gate has good CCXT support but still includes important app-owned semantics.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['oracle']` - Prior architectural conclusion is already fixed.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: [9,10] | Blocked By: [2,3,4]

  **References**:
  - Pattern: `src/lib/gateio.ts` - Current Gate client
  - Pattern: `src/app/api/gate/futures/usdt/tickers/route.ts` - Gate tickers proxy with added classification logic
  - Pattern: `src/app/api/gate/futures/usdt/contracts/route.ts` - Gate interval metadata
  - Pattern: `src/app/api/gate/futures/usdt/funding_rate/route.ts` - Gate funding history proxy
  - Pattern: `src/components/funding/GateFundingMonitor.tsx` - Gate page semantics
  - Pattern: `src/lib/search.ts` - Search-page Gate path

  **Acceptance Criteria**:
  - [ ] Gate can run on native or CCXT-backed transport without changing displayed outputs.
  - [ ] Indicative funding semantics remain identical to current production behavior.
  - [ ] Dynamic funding interval handling remains unchanged.

  **QA Scenarios**:
  ```
  Scenario: Gate parity pass under flag off/on
    Tool: Bash
    Steps: Run parity harness and app validation with the Gate CCXT flag disabled, then enabled.
    Expected: No blocking differences for current funding, latest settlement, average rate, or interval-derived displays.
    Evidence: .sisyphus/evidence/task-6-gate-ccxt.txt

  Scenario: Indicative-funding guardrail
    Tool: Bash
    Steps: Compare displayed Gate funding under native and CCXT-backed modes for representative contracts.
    Expected: Any mismatch in indicative funding semantics blocks rollout and preserves native path.
    Evidence: .sisyphus/evidence/task-6-gate-ccxt-error.txt
  ```

  **Commit**: YES | Message: `feat(gate): add ccxt transport with semantic fallback` | Files: [`Gate adapter files`, `proxy or fallback glue`, `feature-flag config`]

- [ ] 7. Keep Hyperliquid Hybrid and Migrate Only Proven-Safe Surfaces

  **What to do**: Introduce CCXT for Hyperliquid only where it is demonstrably equivalent to current behavior, likely limited to market discovery and standard candles if parity holds. Preserve native handling for current/predicted funding semantics, HIP-3-specific paths, and any data surfaced through `metaAndAssetCtxs`, `fundingHistory`, and dex-specific market segmentation that CCXT does not fully replicate.
  **Must NOT do**: Must NOT attempt a full Hyperliquid CCXT cutover.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: Requires precise reasoning about partial migration and semantic boundary placement.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['refactor']` - Executor should follow the bounded hybrid strategy exactly.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [9,10] | Blocked By: [2,3,4]

  **References**:
  - Pattern: `src/lib/hyperliquid.ts` - Native Hyperliquid API usage
  - Pattern: `src/components/funding/FundingMonitor.tsx` - Hyperliquid page mapping and HIP-3 behavior
  - Pattern: `src/components/funding/FundingCandlesChart.tsx` - Hourly-funding chart semantics
  - Pattern: `src/lib/normalizers/hyperliquid.ts` - Hyperliquid normalization
  - Pattern: `src/lib/search.ts` - Search-page Hyperliquid path

  **Acceptance Criteria**:
  - [ ] Hyperliquid remains hybrid by design, with native-required fields explicitly preserved.
  - [ ] No HIP-3 or dex-specific semantics are lost.
  - [ ] Any CCXT use is isolated to fields marked safe in the capability matrix.

  **QA Scenarios**:
  ```
  Scenario: Hyperliquid hybrid boundary verification
    Tool: Bash
    Steps: Run parity harness for Hyperliquid on all fields and confirm only approved-safe fields use CCXT.
    Expected: Native-required fields remain on native implementation paths with no accidental CCXT substitution.
    Evidence: .sisyphus/evidence/task-7-hyperliquid-hybrid.txt

  Scenario: HIP-3 regression guard
    Tool: Bash
    Steps: Validate representative standard, `xyz`, and `vntl` markets through the adapter contract.
    Expected: Category labels, visibility, and funding semantics remain unchanged.
    Evidence: .sisyphus/evidence/task-7-hyperliquid-hybrid-error.txt
  ```

  **Commit**: YES | Message: `feat(hyperliquid): isolate safe ccxt surfaces behind hybrid adapter` | Files: [`Hyperliquid adapter files`, `consumer wiring`, `feature-flag config`]

- [ ] 8. Keep Lighter Hybrid and Native-First for Funding Semantics

  **What to do**: Preserve Lighter-native implementations for funding rates, funding history, settlement calculations, market-id resolution, direction/sign handling, and display formatting. Use CCXT only if parity is proven for non-semantic supporting surfaces such as market discovery or standard candles. Encode Lighter as `native-first` in the migration policy so future contributors cannot accidentally flatten its semantics.
  **Must NOT do**: Must NOT replace Lighter settlement or annualization logic with generic CCXT funding fields.

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: Lighter has the highest semantic-coupling risk and least unified support.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['oracle']` - Architecture decision is already made: native-first for funding semantics.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: [9,10] | Blocked By: [2,3,4]

  **References**:
  - Pattern: `src/lib/lighter.ts` - Native Lighter transport and scale/sign conversions
  - Pattern: `src/app/api/lighter/route.ts` - Lighter proxy route
  - Pattern: `src/components/funding/LighterFundingMonitor.tsx` - Lighter page semantics
  - Pattern: `src/components/funding/LighterFundingCandlesChart.tsx` - Lighter chart semantics
  - Pattern: `src/lib/search.ts` - Search-page Lighter path
  - Pattern: `src/components/search/CrossExchangeSearch.tsx` - Lighter-specific search formatting

  **Acceptance Criteria**:
  - [ ] Lighter funding semantics remain native-first.
  - [ ] Market-id resolution and direction-based sign handling remain intact.
  - [ ] Any CCXT use for Lighter is strictly additive and proven safe.

  **QA Scenarios**:
  ```
  Scenario: Lighter native-first enforcement
    Tool: Bash
    Steps: Run parity harness and inspect adapter configuration for Lighter under migration flags.
    Expected: Funding and settlement paths remain native; CCXT is not used for unsupported semantics.
    Evidence: .sisyphus/evidence/task-8-lighter-native-first.txt

  Scenario: Scale/sign regression guard
    Tool: Bash
    Steps: Compare representative Lighter outputs for predicted funding, latest settlement, and average-rate calculations before and after any supporting-surface migration.
    Expected: No change in sign, scale, or blank/null display behavior.
    Evidence: .sisyphus/evidence/task-8-lighter-native-first-error.txt
  ```

  **Commit**: YES | Message: `feat(lighter): preserve native funding semantics during ccxt adoption` | Files: [`Lighter adapter files`, `fallback policy`, `feature-flag config`]

- [ ] 9. Add Rollout Controls, Runtime Flags, and Observability for Per-Exchange Cutovers

  **What to do**: Add per-exchange feature flags, clear default values, logging/metrics around adapter source selection, parity mismatch reporting, and safe rollback controls. Ensure search-page detail loading still happens only on user action and that adapter selection does not reintroduce background fetch churn.
  **Must NOT do**: Must NOT bundle all exchanges behind one global switch.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Operational safety and rollback are mandatory under low test coverage.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['git-master']` - Operational correctness is the focus.

  **Parallelization**: Can Parallel: YES | Wave 5 | Blocks: [10] | Blocked By: [5,6,7,8]

  **References**:
  - Pattern: `src/lib/search.ts` - Detail-fetch trigger behavior and exchange aggregation
  - Pattern: `src/components/search/CrossExchangeSearch.tsx` - User-triggered loading policy
  - Pattern: `src/lib/utils/abort.ts` - Abort handling behavior to preserve
  - Pattern: `package.json` - Validation commands used before rollout

  **Acceptance Criteria**:
  - [ ] Each exchange can be toggled independently between native and hybrid/CCXT transport.
  - [ ] Observability clearly reports which adapter served each exchange.
  - [ ] Search-page load policy remains user-triggered only.

  **QA Scenarios**:
  ```
  Scenario: Per-exchange toggle safety
    Tool: Bash
    Steps: Enable and disable each exchange migration flag independently while running parity and build validations.
    Expected: Each exchange can roll back independently without affecting others.
    Evidence: .sisyphus/evidence/task-9-rollout-controls.txt

  Scenario: Search-page fetch policy preservation
    Tool: Bash
    Steps: Validate that no new detail fetches occur before a user-triggered search path is exercised.
    Expected: Adapter rollout does not reintroduce proactive loading or abort-noise regressions.
    Evidence: .sisyphus/evidence/task-9-rollout-controls-error.txt
  ```

  **Commit**: YES | Message: `feat(rollout): add per-exchange migration controls` | Files: [`feature-flag config`, `adapter routing`, `observability support`]

- [ ] 10. Remove Redundant Native Transport Only After Stable Parity Evidence

  **What to do**: After enough parity evidence is collected, remove only the native transport pieces that are now fully covered by CCXT-backed adapters, and only for exchanges/fields approved in the capability matrix. Keep native-required routes and semantics in place for Hyperliquid and Lighter, and any Binance/Gate fields still dependent on native behavior. Update contributor documentation to prevent future semantic drift.
  **Must NOT do**: Must NOT delete native code that is still the semantic source of truth for any user-visible metric.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Cleanup must be controlled by migration policy and documented constraints.
  - Skills: `[]` - No extra skill required.
  - Omitted: `['remove-ai-slops']` - This is not style cleanup; it is policy-driven transport reduction.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: [] | Blocked By: [9]

  **References**:
  - Pattern: `src/app/api/binance/route.ts` - Candidate cleanup surface if fully superseded
  - Pattern: `src/app/api/gate/**/route.ts` - Candidate partial cleanup surface if fully superseded
  - Pattern: `src/lib/hyperliquid.ts` - Retain native-required semantics
  - Pattern: `src/lib/lighter.ts` - Retain native-required semantics
  - Pattern: `README.md` - Update migration/contributor guidance

  **Acceptance Criteria**:
  - [ ] Only fully superseded native transport code is removed.
  - [ ] Hyperliquid and Lighter native-required paths remain intact.
  - [ ] Documentation clearly states which exchanges and fields are CCXT-backed vs native-backed.

  **QA Scenarios**:
  ```
  Scenario: Safe cleanup verification
    Tool: Bash
    Steps: Run parity harness, typecheck, lint, and build after removing superseded native transport code.
    Expected: No removed file corresponds to a still-required semantic path.
    Evidence: .sisyphus/evidence/task-10-safe-cleanup.txt

  Scenario: Residual-native dependency detection
    Tool: Bash
    Steps: Search for broken imports or missing fallback routes after cleanup.
    Expected: Build and typecheck pass; no unresolved references remain.
    Evidence: .sisyphus/evidence/task-10-safe-cleanup-error.txt
  ```

  **Commit**: YES | Message: `chore(migration): remove superseded native transports after parity` | Files: [`superseded routes/adapters`, `README.md`, `migration docs`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
- Use one commit per completed migration task or tightly related pair of files when the task is atomic.
- Do not mix semantic-baseline artifacts with transport cutovers in the same commit.
- Cutovers for Binance, Gate, Hyperliquid, and Lighter should each be independently revertible.
- Rollout-control changes should land before default-on behavior changes.

## Success Criteria
- CCXT adoption reduces duplicated transport logic where safe, without changing current user-visible metric meanings.
- Search page and exchange pages continue to agree on latest settlement and average-rate semantics.
- Predicted funding remains sourced and computed exactly as before wherever current behavior depends on exchange-native semantics.
- Hyperliquid remains hybrid and Lighter remains native-first for funding semantics unless future evidence proves otherwise.
- Every exchange can be rolled back independently if parity fails in production validation.
