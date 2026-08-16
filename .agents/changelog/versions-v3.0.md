# Version History v3.0

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v3.x files: [versions-v3.md](./versions-v3.md).

- **v3.0.0** - Phase 3 Portfolio Quick Wins (July 18, 2026). CSV export + P&L over time chart:
  - **CSV Export API**: `app/api/portfolio/export/route.ts` — Generates FY Report (holdings + transactions summary) and Detailed P&L (per-holding breakdown) as downloadable CSV files. Supports financial year filtering.
  - **Portfolio Value History Service**: `lib/services/portfolioHistoryService.ts` — Reconstructs daily portfolio value from transaction history + DailyPrice data. Processes transactions chronologically, tracks cost basis, forward-fills prices.
  - **Historical Value API**: `app/api/portfolio/history/route.ts` — Serves portfolio value time series for the P&L Over Time chart. Configurable max data points (10-500).
  - **Enhanced PnLChart**: `app/components/PnLChart.tsx` — Two view modes: Overview (original invested vs current) and Timeline (historical portfolio value with invested overlay). Chart.js line chart with dual datasets, dash line for invested baseline.
  - **Wired Buttons**: `app/portfolio/PortfolioClient.tsx` — Download FY Report and Detailed P&L (CSV) buttons now trigger actual API calls with blob download.
  - **Tests**: 190 tests pass, zero regressions. No new TypeScript errors in production code.
  - **Files Created**: `app/api/portfolio/export/route.ts`, `app/api/portfolio/history/route.ts`, `lib/services/portfolioHistoryService.ts`
  - **Files Modified**: `app/components/PnLChart.tsx` (Overview/Timeline toggle), `app/portfolio/PortfolioClient.tsx` (CSV download handlers), `TODO.md` (roadmap update)
