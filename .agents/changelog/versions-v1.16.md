# Version History v1.16

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.16.1** - Code Hygiene & Artifact Cleanup (July 18, 2026). Documented cleanup practices for Playwright snapshots, temp files, and pre-commit review:
  - **Lessons.md**: Added "Playwright Snapshot Cleanup & Code Hygiene" lesson with cleanup checklist
  - **AGENTS.md**: Added mandatory "Code Hygiene & Artifact Cleanup" section with checklist and common junk file table
  - **checklist.md**: Added "Cleanup & Code Hygiene" section + Playwright `--filename` warning + cleanup-after-testing instructions
  - **Before Every Commit Checklist**: Added code hygiene step (git status, junk files, secrets, dead code review)

- **v1.16.0** - Advanced Screener & Chartink-Like Scanning (July 16, 2026). Complete Phase 1 of Advanced Screener system:
  - **Filter Grammar Engine**: Created `lib/screener/condition-tree.ts` — recursive `FilterGroup`/`FilterCondition` types, 40+ filter fields, Zod schemas, `getRequiredColumns()`, `createDefaultFilterGroup()`.
  - **Filter Evaluation Engine**: Created `lib/screener/filter-engine.ts` — `evaluateCondition()` (numeric/string operators), `evaluateFilterGroup()` recursive, `applyFilterGroup()`, `validateFilterGroup()`. Fixed `eq`/`neq` overload dispatch using `isNumericField()`.
  - **Technical Analysis Library**: Created `lib/screener/technical-analysis.ts` — `computeSMA()`, `computeEMA()`, `computeRSI()`, `computeMACD()`, `computeBollinger()`, `detectCandlestickPatterns()` (Doji, Hammer, Shooting Star, Marubozu, Spinning Top, Bullish/Bearish Engulfing).
  - **Backtest Engine**: Created `lib/screener/backtest-engine.ts` — OHLCV-based trade simulator with entry via FilterGroup, exit via profit target/stop-loss/trailing stop/max bars, position sizing, performance metrics (win rate, avg win/loss, max drawdown, Sharpe ratio).
  - **TradingView Service Enhanced**: `lib/services/tradingview-service.ts` — `advancedScan()` with dynamic column list, `DEFAULT_COLUMNS` (14), `TECHNICAL_COLUMNS` (32).
  - **Prisma Models**: Added `ScanConfig`, `ScanResult`, `ScanResultItem`, `BacktestRun`, `BacktestTrade` models. Deprecated `ScreenerConfig`, `ScreenerResult`, `SavedScreen`.
  - **Backend APIs**: 10 API routes (`/api/screener/advanced`, `/api/screener/configs`, `/api/screener/configs/:id`, `/api/screener/configs/:id/run`, `/api/screener/export`, `/api/backtest/run`, `/api/backtest/runs`, `/api/backtest/runs/:id`, `/api/screener/templates`, `/api/screener/templates/:id`).
  - **UI Components**: FilterBuilder (recursive condition tree), ScannedResultsTable (sortable/paginated), TemplatesPanel (98 presets, v2.2.0), ScanConfigsManager (inline edit/delete/share), BacktestDialog (metrics + equity curve SVG + trade table).
  - **Chartink Analysis**: Reverse-engineered Chartink's DSL (`POST /screener/process`), API format, and trading pattern categories. Built native equivalent using TradingView directly.
  - **Tests**: 45 tests across 3 suites (filter-engine: 22, technical-analysis: 16, backtest-engine: 7).
  - **Files Created**: 20+ files in `lib/screener/`, `app/api/screener/`, `app/api/backtest/`, `app/components/screener/`.
