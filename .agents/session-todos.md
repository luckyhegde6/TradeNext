# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-06) — NSE Historical Data for Backtesting + Cache/DB-Sync Refactor + HTML Architecture Docs

**Design decisions (from user):**
- Backtest path: memory cache (24h) → temp table `BacktestHistory` → main `daily_prices` (read-only) → NSE live. **Never writes NSE-fetched bars into main DB** (age-pruned temp table instead).
- Widened scope (all other NSE fetches): cache-first (NodeCache front layer) → MarketCache DB → NSE live → DB sync (reduces DB ops; DB stays in sync).
- Deliverables: unit tests, API + swagger + skill + MCP updates, and an HTML architecture doc (sequence/ER/sync-flow diagrams, troubleshooting, agentic flow, improvements).

### In Progress
- [x] Prisma: add `BacktestHistory` temp table model (schema.prisma L925) — migrated via `prisma db push` (non-destructive; `migrate dev` blocked by drift) + `npx prisma generate` → LSP errors cleared
- [x] `lib/cache.ts`: add `historicalCache` 24h TTL instance + metrics (DONE)
- [x] `lib/nse-api.ts`: add `fetchSecurityWiseHistoricalData()` + `securityWiseBarsToOHLCV()` (DONE)
- [x] `lib/services/backtestDataService.ts`: memory → temp table → daily_prices → NSE chain + age-prune (DONE)
- [x] `app/api/backtest/run/route.ts`: wire to `getBacktestData()` + `dataSource` in response (DONE)
- [x] `lib/market-cache.ts`: add NodeCache front layer to `getOrFetchNseData` + `forceRefreshCache` + `clearCache` (DONE)
- [x] `app/api/mcp/route.ts`: add `getHistoricalData` function (type L21/list/desc/schema/handler L312/POST L705/GET L849) (DONE — was fully wired)
- [x] Agentic framework: `.agents/RULES.md` + `.agents/SOUL.md` + `.agents/rules/session-memory-rules.md`; wired into rules README + AGENTS.md doc table
- [x] AGENTS.md context optimization: 1401 → 249 lines; version history + legacy docs moved to `.agents/CHANGELOG.md` index → `.agents/changelog/` subfiles (versions-v3/v2/v1, screener, corp-actions, serverless-logging, security-workers); behavioral guidelines (think-first/simplicity/surgical/goal-driven) folded into RULES.md §0
- [x] Unit tests: `lib/__tests__/nse-api.test.ts` (mapper w/ CA + BL rows) + `lib/__tests__/backtestDataService.test.ts` (cache-ordering: memory hit = 0 DB ops, daily_prices read-only, temp-only upsert, prune >30d, NSE fallback) — 286 tests pass (23 suites), prod files tsc clean
- [x] Handoff infra: `.agents/handoffs/flow/agent-to-human.md` (new), indexed in handoffs README + session-memory-rules §4 + AGENTS.md doc table
- [x] Strict git rules: RULES.md §6 + `.agents/linear-history.md` + session-memory-rules §6 — NEVER commit main without permission; branch + PR always
- [x] Skills: NSE historical endpoint + field mapping added to `.opencode/skills/nse-integration/SKILL.md` + `.agents/skills/nse-integration.md`
- [x] AGENTS.md: NSE Endpoints table (historicalOR row) + MCP list (23 fns) — already present from earlier work, verified
- [x] README.md: MCP function count updated (22 → 23)
- [x] `app/api/openapi/route.ts`: swagger — MCP enum + historical from/to params + `getHistoricalData` + backtest /run route w/ `dataSource`
- [x] HTML architecture doc: `docs/architecture.html` (Mermaid: system overview, backtest chain, 3 sequence diagrams, ER, sync/lifecycle flows, caching table, MCP, troubleshooting, agentic model, improvements)
- [x] Final: `npm run test` (alone — 286 pass, 23 suites) + `npx tsc --noEmit` (all changed prod files clean); `git status` — no junk/secrets
- [ ] Commit on **feat/backtest-historical-cache** branch (never `main` without explicit permission)

### Carried Forward (from ph19)
- [ ] Deploy to Netlify + verify prod (recommendations stale-data fix, Telegram updates, history prices, DB logs tab)
- [ ] Verify prod daily cron runs (10:00 AM IST) after deploy
- [ ] Re-seed demo holdings on prod
- [ ] Wire live-price SSE hooks into Portfolio/Watchlist tables
- [ ] Persist default `HOLD` label when AI analysis falls back (bare "🟡 %" history cards)
- [ ] F&O Analytics UI (services + API done, UI pending)
