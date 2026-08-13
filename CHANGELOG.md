# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Maintainers**: full per-version detail lives in [`.agents/CHANGELOG.md`](./.agents/CHANGELOG.md)
> (split into `versions-v3.md` / `versions-v2.md` / `versions-v1.md` + feature deep-dives).
> This file is the compact, human-facing summary — keep it in sync with `AGENTS.md`.

---

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [3.5.2] - 2026-08-08

### Fixed
- **Screener templates silently matched 0 stocks**: TradingView's `change` field IS the percent change for NSE; `change_percent` is null/unsupported as column, filter, and sort key (probe `change_percent > 1` → 0 rows). ~60 templates using `change_percent` all matched nothing; `getTopMovers("gainers")` returned `[]`.
- **"Short Term Breakouts" template rewritten** to a validated TradingView-native proxy: `change > 0` + `relative_volume_10d_calc > 1` + `Perf.5D > 3` → **250 stocks matched (was 0)**, 18/20 overlap with Chartink's list. `Perf.5D` field added to `FILTER_FIELDS` + FilterBuilder.
- **Mass-fix** `change_percent` → `change` across all ~57 remaining template filter groups.
- **`getTopMovers`** filters now use `change` (gainers > 3%, losers < -3%, active volume > 1M).
- **Advanced route normalization**: `percentChange ?? change` (was ₹-based formula); TV `change` is already %.
- **UI change-field semantics**: `change` labeled "Change (%)" (was ₹), ₹ amount derived from % in results table (SBIN `+12.2 +1.12%` verified), % Change column sortable.

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]

### Added
- **SSE live prices wired into Portfolio & Watchlist** (ph21 carry-forward): `HoldingsTable` shows live price/value/P&L/returns overlay + green "● Live" badge; Watchlist uses SSE quote overlay (`liveQuoteFor`) + badge; dashboard `MarqueeBanner` refreshes every 30s. `useLivePrices` hardened (stable callbacks via `symbolsRef`, no in-place `.sort()`, no redundant setState on empty) — fixes the "Maximum update depth exceeded" infinite loop on empty watchlists.
- 4 new hook tests (`lib/__tests__/useLivePrices.test.ts`): empty list, no-loop on fresh array refs, SSE price event, connected→isLive.

### Fixed
- **Performance tab target/SL showing ₹0.00**: prod AI fails (Netlify `OPENROUTERKEY` missing) → `getDefaultRecommendation()` wrote literal `0`s, overwriting price-based tracker defaults. AI fallback is now price-based (`price*1.1` target / `price*0.95` SL, guarded `price>0`); `normalizeRecommendation` no longer persists literal 0. Backfill script `scripts/backfill-recommendation-targets.ts` fixed 149 existing trackers (local DB; prod pending).
- **History tab bare "🟡 %" cards** (legacy null `aiRecommendation`/`confidence`): `top-stocks` API coalesces to `"HOLD"` / `0`; HistoryTab renders "—" when confidence is null.
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
  - Run trigger source tracking: `DailyRecommendationRun.triggeredBy` (`system`/`admin`) + Admin Run History Manual/System badge.
  - Today's Picks BUY/SELL filter — only actionable runs surface; All/Buy/Sell pills (no HOLD).
- 24 new tests (cron parser weekday ranges + performance service lifecycle/archival) + 21 rec-service tests (triggeredBy, BUY/SELL).

### Fixed
- Performance API sort enum widened to 10 keys — UI column sorts (entry/current/target/SL/days) no longer return HTTP 400.
- AI monitoring rows lost on serverless cold start — `trackAiCall()` now awaited in every AI route `finally` so DB persistence completes before the response; reads merged (`memory|database|hybrid`) with source badge.

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
## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- session clear
- setting up
- small change
- test fix
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- session clear
- setting up
- small change
- test fix
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.07] - 2026-08-07

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- setting up
- small change
- test fix
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- setting up
- small change
- test fix
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- ci(playwright): add workflow-level permissions (CodeQL Medium fix)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix(screener): TradingView change field is % on NSE — fix 57 templates + Short Term Breakouts (v3.5.2)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- session-todos — CodeQL fix pushed, PR #85 has 4 commits [skip ci]
- setting up
- small change
- test fix
- test(e2e): Playwright cross-browser suite 89 tests + CI workflow + docs (v3.5.3)
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- v3.5.2 screener change-percent fix changelog + session update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.10] - 2026-08-10

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- ci(playwright): add workflow-level permissions (CodeQL Medium fix)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix(screener): TradingView change field is % on NSE — fix 57 templates + Short Term Breakouts (v3.5.2)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- persist DB sessions at login and invalidate at signout (#69)
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- session-todos — CodeQL fix pushed, PR #85 has 4 commits [skip ci]
- setting up
- small change
- test fix
- test(e2e): Playwright cross-browser suite 89 tests + CI workflow + docs (v3.5.3)
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update handoff for #69 session-persistence fix [skip ci]
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- v3.5.2 screener change-percent fix changelog + session update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- ci(playwright): add workflow-level permissions (CodeQL Medium fix)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(netlify): omit CI workflow from secrets scan — unblocks prod deploys
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix(screener): TradingView change field is % on NSE — fix 57 templates + Short Term Breakouts (v3.5.2)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- persist DB sessions at login and invalidate at signout (#69)
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- session-todos — CodeQL fix pushed, PR #85 has 4 commits [skip ci]
- setting up
- small change
- test fix
- test(e2e): Playwright cross-browser suite 89 tests + CI workflow + docs (v3.5.3)
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update handoff for #69 session-persistence fix [skip ci]
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- v3.5.2 screener change-percent fix changelog + session update [skip ci]
- versioned git hooks + gardenify docs port (v3.4.2)
## [2026.08.13] - 2026-08-13

### Added
- Initial release features

## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- ci(playwright): add workflow-level permissions (CodeQL Medium fix)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(auth,cron,recs): v3.6.0 password-reset flow + market-sync cron + dividend-cards fix; v3.6.1 recs default sorts + performance price bridge + AI context + pen/perf plans
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(broadcast,ai,cron): v3.7.1 BUY/SELL-only Telegram broadcast + AI connection-test cron (fallback probing + audit + status) + CI e2e fix + analytics side-nav
- feat(db): add chartink screener models migration + migration ledger doc (v3.5.5)
- feat(fo,api): v3.7.0 F&O analytics UI complete + NSE option-chain-v3 migration + MCP getOptionChain/getFoExpiries (28 fns); carry #68 serverless logs notice
- feat(ipos,events,ai): v3.6.4 IPO issue size + NSE events feed + AI IPO JSON report + MCP/Telegram; v3.6.3 direction-aware levels + recs page redesign; carry v3.6.2 dividend TZ fix
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- feat(screener): chartink 117-registry PRIMARY + TV fallback unified runner + DB capture (v3.5.5/v3.5.6)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(ai): pass saved AI config into rec pipeline; record cron runs on serverless
- fix(auth,logs,security): join-approve login fix, logs/ dir + blob mirror, env-only DEFAULT_PASSWORD, llms.txt + robots discovery (v3.5.7)
- fix(dividends): DividendMonthView timezone keying — noon-UTC ex-dates no longer land a day late in IST
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(netlify): omit CI workflow from secrets scan — unblocks prod deploys
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix(screener): TradingView change field is % on NSE — fix 57 templates + Short Term Breakouts (v3.5.2)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- persist DB sessions at login and invalidate at signout (#69)
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- session-todos — CodeQL fix pushed, PR #85 has 4 commits [skip ci]
- setting up
- small change
- test fix
- test(e2e): Playwright cross-browser suite 89 tests + CI workflow + docs (v3.5.3)
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update handoff for #69 session-persistence fix [skip ci]
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- v3.5.2 screener change-percent fix changelog + session update [skip ci]
- version history v3.5.4-v3.5.7 + credential-hygiene rules + session memory (D13-D16)
- versioned git hooks + gardenify docs port (v3.4.2)
## [Unreleased]
- Add CORS, rate limiting, anomaly detection, and admin monitoring
- Add DATABASE_URL to netlify.toml for runtime
- Add Dependabot auto-merge workflow
- Add F-Score calculation tasks and Google Analytics integration (#48)
- Add GitHub Action for Dependabot auto-approval
- Add SECRETS_SCAN_OMIT_PATHS to netlify.toml
- Add comprehensive NSE market analytics, corporate data, and OpenAPI specification.
- Add new stocks and update base prices in seed-stocks script
- Add smart market data caching with market hours logic
- Add task categories (cron, async, regular) to Tasks tab
- Add technical indicators and import utilities with tests
- Bump @eslint/eslintrc from 3.2.0 to 3.3.3
- Bump @types/bcryptjs from 2.4.6 to 3.0.0
- Bump @types/node from 20.19.27 to 25.0.3
- Bump @types/node-cache from 4.1.3 to 4.2.5
- Bump eslint-config-next from 15.1.7 to 16.1.1
- Bump next in the npm_and_yarn group across 1 directory
- Bump postcss from 8.5.2 to 8.5.6
- Bump prisma from 7.0.1 to 7.1.0
- Bump react-dom and @types/react-dom
- Bump tailwindcss from 3.4.17 to 4.1.17
- Bump the npm_and_yarn group across 1 directory with 4 updates
- Bump zod from 4.2.1 to 4.3.4
- Configure Dependabot for npm with monthly updates
- Create SECURITY.md for security policy
- Enhance API error handling and introduce pagination in user and announcements routes
- Enhance AlertPanel with current price fetching and display (#47)
- Enhance build process and improve admin API error handling
- Enhance database query handling and configuration across services
- Enhance error handling and type definitions in index-service and companyService
- Enhance middleware and update dependencies
- Feat8 (#30)
- Fix Prisma - detect Accelerate URL and use accelerateUrl option
- Fix Prisma 7 - use adapter for local, Accelerate for production
- Fix Prisma 7 config and add debug logging for 502
- Fix Prisma Accelerate - pass accelerateUrl option
- Fix Prisma Accelerate config - use extension with prisma+postgres URL
- Fix Prisma fallback - use adapter in catch block
- Fix Redis connection errors and improve database error handling for production
- Fix auth: proper signout, clean session handling
- Fix auth: simplified middleware, working signout
- Fix netlify.toml
- Fix timeout - add ISR caching to homepage, skip DB calls during static generation
- Fix: Add USE_REMOTE_DB to Netlify environment
- Fix: Add explicit cookie configuration for NextAuth session (#39)
- Implement NSE market data ingestion, display, and admin utilities with new database models and APIs.
- Implement comprehensive NSE market data display with dedicated pages, components, and API routes for indices and stocks.
- Implement core application structure, authentication, user management, portfolio features, and API routes.
- Implement core application structure, financial charting, API e… (#35)
- Implement core application structure, fix corporate actions database seeding, and stabilize NextAuth authentication. (#42)
- Implement robust logging with Netlify Blobs, introduce a worker… (#44)
- Implement user session management and admin session overview (#40)
- Initialize application with authentication, user management, and post features using NextAuth and Prisma.
- Introduce market index data service with caching and persistence, and add local development scripts and admin layout.
- Minimal middleware without NextAuth - for Netlify compatibility
- Optimize database queries for user and portfolio statistics with parallel execution (#41)
- Ph12 (#37)
- Ph13 (#38)
- Ph15 (#43)
- Ph16 (#49)
- Ph17 (#60)
- Ph9 (#34)
- Phase 5 — Daily Recommendations Engine + Self-Heal AI + Audit Logging (#62)
- Potential fix for code scanning alert no. 1: Incomplete multi-character sanitization
- Potential fix for code scanning alert no. 8: Workflow does not contain permissions
- Prisma connection with better fallback handling
- Prisma connection, logging, and logout issues
- Prisma updateMany doesn't support compound unique filters
- Refactor Prisma configuration to improve database URL handling
- Refactor TradeNext AI Configuration and Documentation
- Refactor caching strategy and enhance error handling in index-service and stock-service
- Refactor middleware and update configuration for Next.js compatibility
- Remove AI TODO template and update dependencies for improved functionality
- Remove CodeQL analysis steps from GitHub Actions workflow to streamline security checks and focus on security linting.
- Remove DATABASE_URL from netlify.toml
- Remove Next.js plugin from netlify.toml
- Simplify Prisma - use adapter only (requires direct PostgreSQL URL)
- Simplify Prisma client for production - use library engine type
- Simplify auth config for production
- Simplify middleware - remove problematic imports, use Node.js runtime
- Telegram /recommendations using wrong model (#63)
- Telegram bot integration + admin panel + notifications (v3.4.0)
- Temp: disable middleware to test 502
- Trigger deploy with env fix
- Update ESLint configuration, refactor Prisma config, and enhance API error handling
- Update GitHub Actions workflow to exclude specific directories from environment variable checks
- Update Jest configuration, enhance loading components, and improve GitHub Actions workflow
- Update README.md
- Update dependencies and improve Redis handling in the application
- Update package.json
- Update page.tsx
- add /setup page
- add Lesson 40 — production build must include prisma migrate deploy
- add `export const dynamic = "force-dynamic"; // This disables SSG and ISR`
- add alert and analytics services with CRUD operations and market analytics
- add another condition for the env var
- add api route
- add corporate action alerts with new alert types and enhanced n… (#50)
- add crud logic
- add db
- add form logic
- add header with navigation
- add initial migration
- add missing api route
- add more functionality and styling updates
- add new NSE endpoints for corporate announcements, events, insider trading, and market news
- add npm install @netlify/plugin-nextjs
- add nse-integration workflow documentation and API patterns
- add opencode.json to secrets scan omit paths
- add prisma migrate deploy to Netlify build
- add prisma singleton
- add redirect option to signOut function and update session strategy in auth config
- add scripts/check-remote-db.ts to Netlify secrets scan omit paths
- add seeding
- batch DB queries to reduce Prisma Postgres usage (~1.1M queries/month saved)
- build(deps): bump @prisma/adapter-pg from 7.4.2 to 7.8.0 (#54)
- build(deps): bump @tailwindcss/postcss from 4.2.1 to 4.2.4 (#55)
- build(deps): bump bullmq from 5.66.1 to 5.67.2
- build(deps): bump bullmq from 5.70.1 to 5.78.0 (#57)
- build(deps): bump next from 15.5.9 to 16.1.6
- build(deps): bump react-dom from 19.2.3 to 19.2.4
- build(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#58)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#51)
- build(deps): bump the npm_and_yarn group across 1 directory with 6 updates (#56)
- build(deps-dev): bump @eslint/eslintrc from 3.3.4 to 3.3.5 (#53)
- buildfix
- cast PrismaClient instance to unknown type for type safety (#28)
- change latest posts logic
- changeing nvm to 20
- chartfix
- check env var value
- chore(agents): extensible skills/agents/commands system (v3.4.3)
- ci(playwright): add workflow-level permissions (CodeQL Medium fix)
- cleanup
- deployfix
- docs(handoff): mark PR #67 merged into main
- docs(session): mark ph20 commit + PR update complete [skip ci]
- enhance application structure and API responses
- enhance dark mode support for stock recommendations page
- enhance database connection handling with remote support and accelerate extension
- enhance documentation and setup for Prisma integration, admin routes, and environment variables
- enhance portfolio API with cache invalidation and refresh option (#36)
- enhance remote database detection in prisma configuration
- enhance worker engine and alert system with auto-start and real-time checks
- ensure ENCRYPTION_KEY is validated at runtime for secrets encryption (#61)
- feat(auth,cron,recs): v3.6.0 password-reset flow + market-sync cron + dividend-cards fix; v3.6.1 recs default sorts + performance price bridge + AI context + pen/perf plans
- feat(backtest): historical data cache chain + agentic framework (v3.4.3)
- feat(broadcast,ai,cron): v3.7.1 BUY/SELL-only Telegram broadcast + AI connection-test cron (fallback probing + audit + status) + CI e2e fix + analytics side-nav
- feat(db): add chartink screener models migration + migration ledger doc (v3.5.5)
- feat(fo,api): v3.7.0 F&O analytics UI complete + NSE option-chain-v3 migration + MCP getOptionChain/getFoExpiries (28 fns); carry #68 serverless logs notice
- feat(ipos,events,ai): v3.6.4 IPO issue size + NSE events feed + AI IPO JSON report + MCP/Telegram; v3.6.3 direction-aware levels + recs page redesign; carry v3.6.2 dividend TZ fix
- feat(live-prices): wire SSE into portfolio/watchlist + HistoryTab null-guard (v3.5.1)
- feat(recommendations): performance tracking & archival (v3.5.0)
- feat(recommendations): run trigger source + BUY/SELL filter + AI monitoring persistence (v3.5.0 follow-up)
- feat(screener): chartink 117-registry PRIMARY + TV fallback unified runner + DB capture (v3.5.5/v3.5.6)
- fix build error
- fix deploy2
- fix deployment issues
- fix logger
- fix posts
- fix type issue
- fix(ai): pass saved AI config into rec pipeline; record cron runs on serverless
- fix(auth,logs,security): join-approve login fix, logs/ dir + blob mirror, env-only DEFAULT_PASSWORD, llms.txt + robots discovery (v3.5.7)
- fix(dividends): DividendMonthView timezone keying — noon-UTC ex-dates no longer land a day late in IST
- fix(netlify): node-cron dispatch in background fn + dynamic service import
- fix(netlify): omit .githooks from secrets scan + clean example telegram placeholders
- fix(netlify): omit CI workflow from secrets scan — unblocks prod deploys
- fix(recommendations): price-based AI fallback target/SL + backfill script (v3.5.1)
- fix(screener): TradingView change field is % on NSE — fix 57 templates + Short Term Breakouts (v3.5.2)
- fix2
- fix2 (#29)
- fix3
- fix5
- fixed packagelock
- fixing build errors
- fixing build issues
- fixing deploybuild issues
- fixing logout
- fixing preview error
- fixing prod
- fixing scan
- generate prisma client in postinstall
- hide header buttons during setup
- hotfix1
- hoyfix 2
- hoyfix 3
- implement NextAuth.js configuration for authentication and add a new login modal component.
- implement sign-out page and enhance session management with idle timeout
- introduce contact and analysis pages, corporate data tabs, and GitHub Actions workflows for CI/CD and security.
- introduce login modal component, add logging and rate limiting … (#45)
- logotfix2
- logout issue and token version for session invalidation
- logoutfix
- make generate-client graceful on import failure
- mark PR #82 commit/push complete in agent-memory + session-todos [skip ci]
- mark PR #82 merge + prod backfill complete (327 trackers) in session docs [skip ci]
- persist DB sessions at login and invalidate at signout (#69)
- polish setup page
- prod reliability — txn timeout, top-50 cap, telegram live prices, history prices, AI monitoring persistence, DB logs tab
- re-add enforce dynamic
- refine /setup page
- remooving admin seed
- remove excessive Prisma logging on each import
- remove export dynamic
- remove tmp env vars from package.json
- replace middleware with proxy for Netlify compatibility, update configuration for Next.js 16+ (#46)
- revert: restore original netlify.toml build command
- serverless cron trigger for daily recommendations + performance check
- session clear
- session-todos — CodeQL fix pushed, PR #85 has 4 commits [skip ci]
- setting up
- small change
- test fix
- test(e2e): Playwright cross-browser suite 89 tests + CI workflow + docs (v3.5.3)
- testfix1
- testfix2
- turn post list into server component
- update /setup page
- update @types/node to version 25.5.0 in package.json and package-lock.json
- update API documentation to mask demo and admin passwords
- update README
- update USAGE.md
- update agent memory and lessons with 502 fix findings
- update changelog [skip ci]
- update config
- update environment variables and improve user authentication handling
- update handoff for #69 session-persistence fix [skip ci]
- update homepage to load data
- update migration script
- update migration to not fail on build
- update readmE
- update readme
- update readme and usage.md
- update screenshot
- update signOut function to handle redirects and improve navigation
- use quickbuild in GitHub Actions deploy
- v3.5.1 carry-forward session + handoff update [skip ci]
- v3.5.2 screener change-percent fix changelog + session update [skip ci]
- version history v3.5.4-v3.5.7 + credential-hygiene rules + session memory (D13-D16)
- versioned git hooks + gardenify docs port (v3.4.2)
