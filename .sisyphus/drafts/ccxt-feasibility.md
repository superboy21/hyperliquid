# Draft: CCXT Feasibility

## Requirements (confirmed)
- [research request]: 请帮我研究一下我的这个webapp能不能改成全部用 https://github.com/ccxt/ccxt 来实现，instead of using API from 4 exchanges。
- [deliverable]: 告诉我这么做会有什么利弊。
- [constraint]: 暂时先不要动代码。

## Technical Decisions
- [mode]: Research-only analysis; no implementation or source-code edits.

## Research Findings
- [codebase]: Current app depends on more than funding snapshots: market metadata, open interest, bid/ask, mark/index/last price, candles, settlement history, exchange-specific funding intervals, categories, and custom annualization rules.
- [ccxt-fit]: Binance and Gate.io are strong CCXT fits for standard market/funding/candle data; Hyperliquid and especially Lighter have partial unified funding support.
- [gap]: Predicted/next funding is not safely unified across all 4 exchanges in CCXT.
- [gap]: Hyperliquid lacks unified `fetchFundingRate`; Lighter lacks unified `fetchFundingRate` and `fetchFundingRateHistory` in CCXT.
- [risk]: The app contains substantial exchange-specific semantics outside transport: Hyperliquid HIP-3 handling, Gate classification, Binance delisted filtering, Lighter scale/sign conversions.
- [verification]: Repo has build/lint/typecheck gates, but no automated tests/CI coverage for adapters, routes, or search behavior.

## Open Questions

## Scope Boundaries
- INCLUDE: Current exchange integration patterns, CCXT capability fit, migration pros/cons, likely blockers.
- EXCLUDE: Any production code changes.
