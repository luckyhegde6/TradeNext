# Version History v3.1

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v3.x files: [versions-v3.md](./versions-v3.md).

- **v3.1.0** - Phase 3 Complete — Risk Metrics + Benchmark + Compare Chart (July 18, 2026). All Phase 3 portfolio enhancement features delivered:
  - **Risk Metrics Service**: `lib/services/portfolioRiskMetricsService.ts` — Computes Sharpe Ratio (annualized), Max Drawdown, Annualized Volatility, CAGR, Beta vs NIFTY 50, Win Rate from portfolio value history and IndexClose data.
  - **Risk Metrics API**: `app/api/portfolio/risk-metrics/route.ts` — Serves risk metrics with auth guard, error handling.
  - **RiskMetricsCards UI**: `app/components/RiskMetricsCards.tsx` — 6-card grid with color-coded Sharpe (Excellent/Good/Fair/Poor), Drawdown severity labels, auto-refresh button.
  - **NIFTY 50 Benchmark Overlay**: `app/components/PnLChart.tsx` — Timeline mode now shows NIFTY 50 as amber dashed line, normalized to portfolio baseline. Stats section expanded with benchmark comparison card (Benchmark Return %, Alpha, Data Points).
  - **Compare Chart Overlay**: `app/compare/page.tsx` — Chart.js line chart showing 1-month normalized performance (base 100) for all compared stocks, with color-coded legend and tooltip.
  - **Benchmark in History API**: `lib/services/portfolioHistoryService.ts` — Now returns `benchmark` field with NIFTY 50 close prices and total return for the portfolio date range.
  - **Sector Allocation Chart**: Already implemented (Doughnut chart with % labels and legends). Wired in PortfolioClient.
  - **Tests**: 190 tests pass, zero regressions.
  - **Files Created**: `lib/services/portfolioRiskMetricsService.ts`, `app/api/portfolio/risk-metrics/route.ts`, `app/components/RiskMetricsCards.tsx`
  - **Files Modified**: `app/components/PnLChart.tsx` (NIFTY 50 overlay + stats), `app/compare/page.tsx` (chart section), `app/portfolio/PortfolioClient.tsx` (wired RiskMetricsCards), `lib/services/portfolioHistoryService.ts` (benchmark data), `TODO.md` (mark Phase 3 complete)
