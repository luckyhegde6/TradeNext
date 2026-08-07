# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Maintainers**: full per-version detail lives in [`.agents/CHANGELOG.md`](./.agents/CHANGELOG.md)
> (split into `versions-v3.md` / `versions-v2.md` / `versions-v1.md` + feature deep-dives).
> This file is the compact, human-facing summary — keep it in sync with `AGENTS.md`.

---

## [Unreleased]

### Fixed
- Prod bugs tracked as issues [#68](https://github.com/luckyhegde6/TradeNext/issues/68) (monitoring logs empty on serverless) and [#69](https://github.com/luckyhegde6/TradeNext/issues/69) (admin sessions never persisted).

---

## [3.5.0] - 2026-08-07

### Added
- **Recommendation Performance Tracking & Archival** (ph20):
  - 3-status lifecycle (`tracking → target_achieved/stop_loss_hit → archived`); removed 30-day expiry.
  - 4 PM Mon–Fri SYSTEM-triggered performance check cron (`recommendation_performance`, `30 10 * * 1-5` IST) + `ensureRecommendationCrons()` self-healing registration.
  - Public **Performance tab** on `/recommendations` with dynamic/cached columns + localStorage column toggles, sortable headers, filters, server-side pagination.
  - 360-day archival into new `RecommendationArchive` table (`daily_recommendation_stocks` survive via `SetNull`).
  - `timeHorizon` extended to 5 values (`btst | short | swing | medium | long`); backfill script maps legacy rows.
  - Shared weekday-range cron parser (`lib/cron-parser.ts`); `triggeredBy: "system"` worker-task marking + audit actions.
- 24 new tests (cron parser weekday ranges + performance service lifecycle/archival).

### Fixed
- Performance API sort enum widened to 10 keys — UI column sorts (entry/current/target/SL/days) no longer return HTTP 400.

## [3.4.3] - 2026-08-06

### Added
- Subsystem architecture docs in `.agents/docs/` (recommendations engine, tasks/cron/workers, monitoring, alerts) with Mermaid diagrams + Agent Hints.

## [3.4.2] - 2026-08-06

### Added
- Versioned `.githooks/` (pre-commit/post-commit/pre-push, `core.hooksPath`).
- Gardenify docs port: `.agents/linear-history.md`, `code-hygiene.md`, `documentation-standards.md`.
- RULES/SOUL agentic operating model.

## [3.4.1] - 2026-08-06

### Fixed
- `runInChunks()` txn-timeout fix for large daily-recommendation batches.
- Top-50 recommendation cap (`rankAndCapRecommendations`).
- Telegram live prices + always-broadcast.
- History tab predicted-vs-current display.
- AI monitoring DB persistence; DB logs tab; `marketCap` plumbing.

## [3.4.0] - 2026-07-22

### Added
- Telegram bot admin (`/admin/telegram`, 5 pages).
- User Profile page; Telegram column on admin users.
- Direct alert delivery to linked users.

## [3.3.1] - 2026-07-21

### Fixed
- Dividends tab 500 (raw SQL camelCase `"tradeDate"`).
- AI admin redesign (4 actions).
- History tab rewritten (top-20 dedup); Prisma `createMany` fix.

## [3.3.0] - 2026-07-19

### Added
- **Daily Recommendations Engine** (Phase 5): 7 Chartink + TradingView hybrid screeners, dedup, top-50 rank.
- AI agent (OpenRouter): BUY/HOLD/SELL + confidence/target/SL; circuit breaker + fallback chain; prediction tracking.
- 8 Prisma models; 10AM IST generation + 3:30PM IST performance cron jobs.
- Tabbed UI (`/recommendations`), public APIs, Telegram `/daily-recommendations`, unified audit logging.

## [3.2.0] - 2026-07-18

### Added
- **Telegram Bot** (@tradenext6Bot): commands, rate limiting, verification, broadcast, alert routing.
- Corp actions price/yield fix; rebalancer client-import fix (`rebalancerTypes.ts`).
- Tax reports, portfolio value history, P&L timeline, dividend calendar, SSE live prices, F&O services/API.

## [3.1.0] - 2026-07-18

### Added
- Risk metrics (Sharpe, max drawdown, volatility, CAGR, beta vs NIFTY 50, win rate).
- Benchmark overlay + compare chart.

## [3.0.0] - 2026-07-18

### Added
- CSV export (FY report + detailed P&L), portfolio value history service, P&L timeline chart.

## [2.2.0] - 2026-07-18

### Added
- Admin alert config (Secret AES-256-GCM, DeliveryLog, channels/events APIs).
- Screener templates 25 → 98 (9 categories).

## [2.1.0] - 2026-07-17

### Added
- Enterprise alert engine: `AlertChannel` / `AlertRule` / `AlertEvent` models, email/webhook delivery, delivery manager, 7 API routes, 17 tests.

## [1.16.1] - 2026-07-18

### Fixed
- Code hygiene & artifact cleanup docs (Playwright snapshots).

## [1.16.0] - 2026-07-16

### Added
- **Advanced Screener**: filter grammar (40+ fields), technical analysis lib, backtest engine, TradingView `advancedScan`, 10 APIs, FilterBuilder/BacktestDialog UI, 45 tests, Chartink reverse-engineered.

## [1.15.0] - 2026-07-16

### Added
- Agent handoff system (`.agents/handoffs/`), 6 agent profiles, self-learning loop, `/handoff` `/self-learn` `/review-diff` commands.

## [1.14.0] - 2026-03-27

### Added
- MCP API `/api/mcp` — 23 functions for external NSE data, optional `x-api-key`, discovery functions.

## [1.13.0] - 2026-03-27

### Added
- Corporate action alerts (dividend/bonus/split/rights/buyback/meeting).

## [1.12.x] - 2026-03-27

### Fixed
- Netlify build fix (secrets omit paths), cache-control headers, lazy loading, web vitals, worker auto-start fix.

## [1.11.x] - 2026-03-21

### Added
- Worker task mgmt (run now/retry/cancel/delete); GA4 + SEO (JSON-LD, sitemap, robots, metadata).

## [1.10.x] - 2026-03-20

### Added
- Screener enhancement (live TradingView, quick/basic/advanced filters); corp actions dedup + NSE field fix.
- Serverless DB logging (`ServerLog`, `db-logger.ts`); worker cache key + logger security fixes.

## [1.9.x] - 2026-03-18/19

### Added
- Secure join-request flow (RBAC), notifications page, Netlify Blobs logging, worker engine + NSE sync, build fixes.

## [1.8.x] - 2026-03-14/16

### Changed
- Security: httpOnly cookies, no localStorage, CSRF, session tracking; Netlify 502 fix (minimal middleware, no NextAuth); Prisma 7 adapter.

## [1.7.0] - 2026-03-13

### Added
- Cron config management, background workers, calendar view, TradingView links, worker logging.

## [1.6.x] - 2026-03-13

### Added
- Historical NSE sync, financial results tab, corp actions price/yield fix, stock list sync.

## [1.5.0] - 2026-03-13

### Added
- Live site tested — core features verified.

## [1.4.0] - 2026-03

### Added
- Enhanced corp actions (yield, sorting, filtering, pagination).

## [1.3.0] - 2026-03

### Added
- Corp actions management (dividends, splits, bonus, rights, buybacks).

## [1.2.0] - 2026-03

### Added
- Analytics service, alert service, demo seeding, portfolio analytics.

## [1.1.0] - 2026-03

### Added
- Stock recommendations, user alerts, audit logging, rate limiting, admin holdings.

## [1.0.0] - 2026-03

### Added
- Initial release.

---

## Historical (2025-12 → 2026-02)

Pre-1.0 milestones captured in commit history and `.agents/CHANGELOG.md`:
multi-timeframe index charts, responsive breadcrumbs/header, NSE market data ingestion,
auth + user management, admin utilities, Docker/Postgres setup. (Previously listed as
repeated "Initial release features" entries — consolidated here.)
