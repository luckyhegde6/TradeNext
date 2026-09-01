# TradeNext - UX Analysis & Bugs

> **Bug tracking convention**: every open bug gets a GitHub issue on [luckyhegde6/TradeNext/issues](https://github.com/luckyhegde6/TradeNext/issues). This file is the human-readable tracker — fix bugs one by one, close the issue, then mark the row ✅ here.

---

## 🐞 Open Bugs (Priority Order)

| # | Issue | Severity | GitHub | Status |
|---|-------|----------|--------|--------|
| 1 | **Prod: Server Log Files tab empty on `/admin/utils/monitoring`** — FS-based log tab can't work on serverless (no persistent FS). **DB Logs tab is now populated** (624 entries Aug 7-10, verified 2026-08-10) — persistence path fixed by v3.5.0 `trackAiCall` + OPENROUTERKEY deploy. Remaining work: make Server Log Files tab show a serverless-aware notice instead of silent "No log files found" | Medium | [#68](https://github.com/luckyhegde6/TradeNext/issues/68) | Open |
| 2 | **Prod: admin sessions page empty** — `createUserSession` is never called, so `user_sessions` table stays empty; `/admin/sessions` shows Total 0 / Active 0 / Expired 0 / Users 0 (reproduced 2026-08-10 while admin was logged in). **Fix in progress on `fix/prod-issues-68-69`** — wire `createUserSession` into auth `jwt` callback + `invalidateSession` on `signOut` | High | [#69](https://github.com/luckyhegde6/TradeNext/issues/69) | Open |
| 2a | **Admin → Utils → Cron shows no runs on prod** — both system jobs `lastRun:null runCount:0 successCount:0 failureCount:0`, stale `nextRun` (verified 2026-08-11). **ROOT CAUSE**: `CronJob` ledger only written by `spawnCronTask`/resident scheduler (never on serverless); `successCount`/`failureCount` had NO writer. **FIX (2026-08-11)**: `recordCronRun(jobName, success)` wired into `netlify/functions/run-cron-background.ts` (success+failure) + admin PATCH runNow/retry (skips cronJobId-linked tasks). Committed on `fix/ai-config-cron-ledger`. **Needs deploy + scheduled run to verify ledger populates.** | Medium | — | Open (fix committed, deploy pending) |
| 3 | **Recommendations data stale (~22 days)** — "Last updated: 19/7/2026" on prod (verified 2026-08-10); daily rec cron not producing successful runs since Jul 19. **ROOT CAUSE (2026-08-11)**: `analyzeStocks(aiInput)` called with NO AI config (env-only default → DB `ai_config` Secret never reached pipeline) + `DEFAULT_MODEL`/`AVAILABLE_MODELS` pointed at nonexistent OpenRouter models (`tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free` → HTTP 404) → prod all-HOLD runs → BUY/SELL-filtered public page stale. **FIX**: shared `loadConfig()` (DB Secret > env, lazy prisma) + pipeline passes config; `DEFAULT_MODEL` → `nvidia/nemotron-3-ultra-550b-a55b:free` + refreshed catalog. Committed on `fix/ai-config-cron-ledger`. **Needs deploy + prod rerun to verify BUY/SELL picks.** | High | — | Open (fix committed, deploy pending) |
| 3a | **Monitoring: Rate Limits tab 500 (transient)** — `/api/admin/monitoring?type=rate-limits` threw 500 once during cold start (2026-08-10); immediate direct fetch returned 200 `"[]"` — intermittent cold-start flake, monitor | Low | — | Open |
| 4 | **History cards render bare "🟡" + "%"** for ~600/643 stocks — `recommendation`/`confidence` null in DB (AI fell back to HOLD without persisting) | Medium | — | Open |
| 5 | **643 recommendations too many** — cap to top 50 (`rankAndCapRecommendations` implemented locally, needs deploy) | Medium | — | Open |
| 6 | ~~NSE Large Deals API returns empty data~~ (`/api/nse/deals`) — **RESOLVED** via `mode` param | High | [#70](https://github.com/luckyhegde6/TradeNext/issues/70) | Resolved |
| 7 | INDIA VIX shows "0 +0%" on markets page | Medium | — | Open |
| 8 | No user profile management page reachable from header | Medium | — | Open |
| 9 | Demo user shows 2 portfolios in admin panel (seed upsert duplicates) | Low | — | Open |
| 10 | Portfolio page brief "Loading..." flash (UX polish) | Low | — | Open |
| 11 | **Prod: MCP `getHistoricalData` 500 — `public.backtest_history` table missing** (live-verified 2026-08-14). Backtest chain (`backtestDataService`) unconditionally queries the temp table → "relation does not exist" on prod; local works because local DB was fully migrated. **FIX (v3.10.0 PR #91)**: lazy `CREATE TABLE IF NOT EXISTS` (`ensureBacktestHistoryTable` in `backtestDataService.ts` — memoized, retried on failure, chain degrades to daily_prices/NSE instead of throwing; NO migration ever created the table, so migrate-deploy cannot fix it). **Deployed (v3.10.0 PR #91, 2026-08-14)\*\* — missing-table 500 eliminated live (500 now only on total source exhaustion); full recovery needs `daily_prices` >= 50 bars/symbol (backfill auto Mon-Fri 06:31 IST / manual trigger executed) | Medium | — | Open (deployed; verify post-backfill) |
| 12 | **Prod: swing indicators render "—" — `daily_prices` has 0–1 rows per pick** (live-verified 2026-08-14). market-sync (v3.6.0) syncs the stock LIST, not prices; indicators need ≥2 bars (momentum 10/20). **FIX (v3.10.0)**: new historical-price sync job (service + market-sync step + background action + `scripts/backfill-daily-prices.ts`) upserts N-day EQ bars idempotently — **deployed + prod backfill manually triggered 2026-08-14 (user-approved); else auto via market-sync step 4 Mon-Fri 06:31 IST** | High | — | Open (deployed; verify indicators post-backfill) |
| 13 | **Prod: Prisma Compute "Deploy failed" false alarm — `P1001 Can't reach database server at db.prisma.io:5432`** (repeated #21 on main, e.g. reported 4h ago, 0s duration). Netlify deploys are HEALTHY (verified 2026-09-02: latest `main` deploy `state: ready`, `error_message: null`; build = `prisma generate && quickbuild`, no `migrate deploy`). The failing "Deploy" is Prisma Compute's **auto-schema-apply sandbox** running `migrate deploy` in a network-isolated sandbox that cannot reach the direct-TCP `db.prisma.io:5432` host (Accelerate is a query proxy; DDL needs direct TCP). **Verified: prod DB is fully migrated** (`prisma migrate status` from local via Accelerate = `36 migrations ... Database schema is up to date!` → **ZERO pending**) so auto-apply has nothing to do → pure false alarm. **FIX (user-approved 2026-09-02)**: in Prisma Console → DB → **toggle OFF "apply schema changes automatically"** (auto schema-apply) so Compute stops running `migrate deploy`; new migrations applied via v3.20.5 runbook (`npx prisma migrate deploy` + `DIRECT_URL` from an env with DB egress, e.g. as done for `intelligence_cache`). No repo/code change required. | Medium | — | Open (user applies Console toggle) |

---

## Navigation Analysis

### Pages Tested
| Page | URL | Status |
|------|-----|--------|
| Home/Dashboard | / | ✅ Working |
| Markets | /markets | ✅ Working |
| Analytics | /markets/analytics | ✅ Working |
| Portfolio | /portfolio | ✅ Working |
| Community | /posts | ✅ Working |
| Contact | /contact | ✅ Working |
| Admin Overview | /admin/utils | ✅ Working |
| User Management | /admin/users | ✅ Working |
| Screener | /markets/screener | ✅ Working (NEW) |
| Alerts | /alerts | ✅ Working (NEW) |
| Admin Alerts | /admin/alerts | ✅ Working (NEW) |
| Stock Detail | /company/{ticker} | ✅ Working (NEW) |

### Role-Based Navigation
| Role | Admin Links Visible | Protected Routes |
|------|---------------------|------------------|
| Admin | ✅ Yes | ✅ Protected |
| Demo User | ❌ No | ✅ Protected |
| Unauthenticated | ❌ No | ✅ Redirects to login |

---

## ✅ Resolved Bugs

| # | Issue | Root Cause | Fix | GitHub |
|---|-------|-----------|-----|--------|
| R1 | Demo portfolio not showing on /portfolio | Stale server cache | Restarted dev server; demo portfolio shows 5 holdings (seed restored in Ph9 #34) | [#74](https://github.com/luckyhegde6/TradeNext/issues/74) |
| R2 | Company page 52W high/low, volume, change showing "-" / "NaN" | Missing DB calculations | Now calculated from database | [#75](https://github.com/luckyhegde6/TradeNext/issues/75) |
| R3 | NIFTY 50 change showing long decimals | Unrounded float math | Rounded to 2 decimals | [#76](https://github.com/luckyhegde6/TradeNext/issues/76) |
| R4 | User APIs returned 500 errors (watchlist/notifications/subscriptions) | `parseInt(session.user.id)` failed with NextAuth string IDs | Switched to `Number(session.user.id)` | [#77](https://github.com/luckyhegde6/TradeNext/issues/77) |
| R5 | Non-admin access to `/admin/utils/ingest-csv` | Missing auth check | Added NextAuth session redirect | [#78](https://github.com/luckyhegde6/TradeNext/issues/78) |
| R6 | Public API exposed admin endpoint | `BulkDealsTable` called `/api/admin/ingest/deals` | Created public `/api/deals` + updated table | [#73](https://github.com/luckyhegde6/TradeNext/issues/73) |
| R7 | Admin CSV upload page access control | — | ✅ FIXED (admin role gate) | [#79](https://github.com/luckyhegde6/TradeNext/issues/79) |
| R8 | NSE charting multi-timeframe | — | ✅ FULLY INTEGRATED (native 1D/1M/3M/6M/1Y charts) | [#80](https://github.com/luckyhegde6/TradeNext/issues/80) |

---

## 🔧 New Features Added

### Technical Indicators
- RSI (14), MACD (12,26,9), Bollinger Bands (20,2), SMA Crossover (20 & 50)
- Optional overlay on price chart with multi-select indicator selector

### Stock Screener
- Filter by sector, price range, P/E ratio, volume, % change
- Sort by symbol, price, change, volume, market cap
- Saved screens feature (user-specific)
- 52 Nifty 50 stocks with historical data

### Price Alerts
- Create/manage price alerts from /alerts page
- Admin can view all user alerts at /admin/alerts
- Alert types: Price Above, Price Below

### CSV Import
- Import transactions from CSV/Excel
- Supports multiple broker formats

### Market News
- India tab (NSE corporate announcements)
- Global tab (TradingView news)
- 8-hour cache based on market timing
- Accessible at /news/market

### Analytics Page
- Corporate Announcements tab (NSE: /api/corporate-announcements)
- Corp Events tab (NSE: /api/event-calendar) - Shows table format
- Dividends/Splits/Bonus tab (NSE: /api/corporates-corporateActions)
- Insider Trading tab (NSE: /api/corporates-pit) - Insider Trading PIT

---

## UX Observations

1. Clean, professional UI with consistent styling and dark mode support
2. Real-time market data integration working well
3. Portfolio P&L calculations appear accurate
4. Role-Based Access Control properly implemented
5. Admin dashboard provides useful overview metrics
6. Full responsiveness across mobile, tablet, and desktop

### Areas for Improvement
1. Add loading skeletons instead of spinners
2. Implement toast notifications for user actions
3. Add empty states with better CTAs
4. Mobile responsiveness testing needed
5. Add search/filter on Markets page
6. Portfolio could benefit from more chart types

---

## Archived Bugs — March 2026

> ✅ All archived bugs below are now tracked as closed GitHub issues (see links).

### NSE Large Deals API Returns Empty Data (Resolved — High Priority) → [#70](https://github.com/luckyhegde6/TradeNext/issues/70)
- **Date**: 2026-03-09
- **Issue**: `/api/nse/deals` returns 0 records from NSE API
- **Root Cause**: NSE API format may have changed or requires different parameters (missing `mode` param)
- **Steps to Reproduce**:
  1. Go to `/markets/analytics`
  2. Click "Bulk Deals" or "Block Deals"
  3. Click "NSE Live" toggle
  4. Observe empty table with 0 records
- **Expected**: Data should display from NSE API
- **Actual**: Empty table
- **Fix**: Added `mode` parameter (commit `d1ea270`, PR #49 `ph16`)
- **Note**: Previously tracked as open bug #6 in the top table — now resolved.

### BulkDealsTable TypeScript Errors (Resolved — code moved on) → [#71](https://github.com/luckyhegde6/TradeNext/issues/71)
- **Date**: 2026-03-09
- **Issue**: Type errors in `app/components/analytics/BulkDealsTable.tsx` (implicit any, keyof mismatch)
- **Fix**: Event handler + row key types corrected (commit `d1ea270`, PR #49 `ph16`)
- **Status**: Superseded by later screener/analytics refactors; typecheck clean.

### Admin CSV Upload Page Access Control (FIXED) → [#72](https://github.com/luckyhegde6/TradeNext/issues/72)
- **Date**: 2026-03-09
- **Fix**: Added NextAuth session check - redirects non-admin users (commit `5f22a03`, PR #60 `Ph17`)

### Public API Exposing Admin Endpoint (FIXED) → [#73](https://github.com/luckyhegde6/TradeNext/issues/73)
- **Date**: 2026-03-09
- **Fix**: Created public `/api/deals` endpoint; updated BulkDealsTable (commit `1bbbbf8`, PR #36 `ph11`)

---

## Recommended Analytics & Portfolio Features

See PRD.md for detailed feature recommendations.
