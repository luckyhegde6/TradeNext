# AGENTS.md - TradeNext Development Guide

> **Read this first.** TradeNext is a Next.js 16 + TypeScript + Prisma 7 + PostgreSQL (TimescaleDB) app for NSE (India) market data, portfolio management, capital gains tax, F&O analytics, dividends, rebalancing, alerts, and AI-driven daily recommendations. Deployed on Netlify (serverless).
>
> **Agentic operating model:** `.agents/RULES.md` (must-read on first session) + `.agents/SOUL.md` (identity). Full history & legacy docs live in `.agents/CHANGELOG.md`.

## Version History (compact — full detail in `.agents/CHANGELOG.md`)

| Ver | Date | Summary |
|-----|------|---------|
| **v3.5.3** | Aug 8 2026 | Playwright E2E suite (`e2e/`, 89 tests): cross-browser (Chromium/Firefox/WebKit @1440×900) + Mobile Chrome (Pixel 5) + auth-storage projects; regression guard for the v3.5.2 screener fix; nav/auth/portfolio/watchlist/alerts/profile/responsive specs; CI workflow `.github/workflows/playwright.yml` (timescale service + migrate/seed); docs `.agents/docs/playwright-e2e.md` + `playwright-e2e` skill (machine + human); README badge; root causes: Firefox `xl` nav needs >1280px viewport, WebKit drops `fill()` on controlled number inputs, single-threaded dev-server load → serial nav + `noWaitAfter` + retries |
| **v3.5.2** | Aug 8 2026 | Screener fix: TradingView `change` field IS % change on NSE (`change_percent` null/unsupported → ~60 templates silently matched 0). "Short Term Breakouts" rewritten to validated TV-native proxy (`change>0, relative_volume_10d_calc>1, Perf.5D>3`) → **250 stocks (was 0), 18/20 Chartink overlap**; mass-fix all 57 `change_percent`→`change` template args; `Perf.5D` added to FILTER_FIELDS; `getTopMovers` gainers/losers/active filters fixed; advanced-route `percentChange ?? change`; UI `change` labeled "Change (%)" with ₹ derived from % |
| **v3.5.1** | Aug 7 2026 | Post-merge carry-forward: Performance tab target/SL ₹0.00 fix (AI fallback now price-based `price*1.1`/`price*0.95` in `recommendation-agent.ts`; `normalizeRecommendation` no longer persists literal 0), backfill script `scripts/backfill-recommendation-targets.ts` (local run fixed 149 trackers), SSE live prices wired into HoldingsTable + Watchlist (+ ● Live badge, MarqueeBanner 30s refresh), `useLivePrices` infinite-loop fix (`symbolsRef` stable callbacks), HistoryTab/top-stocks null-coalescing (no more bare "🟡 %"), 4 new hook tests (317 total) |
| **v3.5.0** | Aug 7 2026 | Recommendation Performance Tracking & Archival: 3-status lifecycle (`tracking → target_achieved/stop_loss_hit → archived` 360d), 4 PM IST Mon–Fri SYSTEM perf-check cron (`30 10 * * 1-5`), `RecommendationArchive` snapshot table + `DailyRecommendationStock.trackerId` SetNull, weekday cron parser support, `triggeredBy: system`, categories extended to `btst|short|swing|medium|long`, public Performance tab (dynamic columns, sort, filters, pagination), sort-enum fix (10 keys), 24 new tests + session follow-up: `DailyRecommendationRun.triggeredBy` (`system`/`admin`) + Run History Manual/System badge, Today's Picks BUY/SELL filter (All/Buy/Sell pills), AI monitoring persistence fix (awaited `trackAiCall` + `memory\|database\|hybrid` reads), 21 rec-service tests (312 total) |
| **v3.4.3** | Aug 6 2026 | Subsystem architecture docs in `.agents/docs/` (recs engine, tasks/cron/workers, monitoring, alerts) with Mermaid diagrams + Agent Hints |
| **v3.4.2** | Aug 6 2026 | Versioned `.githooks/` (pre-commit/post-commit/pre-push, `core.hooksPath`); gardenify docs port: `.agents/linear-history.md`, `code-hygiene.md`, `documentation-standards.md`; RULES/SOUL operating model |
| **v3.4.1** | Aug 6 2026 | Prod fixes: `runInChunks()` txn-timeout fix, top-50 rec cap (`rankAndCapRecommendations`), Telegram live prices + always-broadcast, History predicted-vs-current, AI monitoring DB persistence, DB logs tab, marketCap plumbing |
| **v3.4.0** | Jul 22 2026 | Telegram bot admin (`/admin/telegram` 5 pages), user Profile page, Telegram column on admin users, direct alert delivery to linked users |
| **v3.3.1** | Jul 21 2026 | Bug fixes: dividends tab 500 (raw SQL camelCase `"tradeDate"`), AI admin redesign (4 actions), history tab rewritten (top-20 dedup), Prisma createMany fix |
| **v3.3.0** | Jul 19 2026 | Phase 5: Daily recommendations engine (Chartink + TradingView hybrid, 7 screeners, dedup), AI agent (OpenRouter, BUY/HOLD/SELL + confidence/target/SL), 8 Prisma models, cron jobs (10AM IST gen, 3:30PM IST perf), public APIs, tabbed UI, self-heal AI (circuit breaker, fallback chain), self-improve (prediction tracking), unified audit logging, Telegram `/daily-recommendations` |
| **v3.2.0** | Jul 18 2026 | Phase 4: Telegram bot (@tradenext6Bot, commands, rate limit, verification, broadcast), corp actions price/yield fix, rebalancer client-import fix (`rebalancerTypes.ts`) |
| **v3.1.0** | Jul 18 2026 | Risk metrics (Sharpe, max DD, vol, CAGR, beta vs NIFTY 50, win rate), benchmark overlay, compare chart |
| **v3.0.0** | Jul 18 2026 | CSV export (FY report + detailed P&L), portfolio value history service, P&L timeline chart |
| **v2.2.0** | Jul 18 2026 | Admin alert config (Secret AES-256-GCM, DeliveryLog, channels/events APIs), screener templates 25→98 (9 categories) |
| **v2.1.0** | Jul 17 2026 | Enterprise alert engine: AlertChannel/AlertRule/AlertEvent models, email/webhook delivery, delivery manager, 7 API routes, 17 tests |
| **v1.16.1** | Jul 18 2026 | Code hygiene & artifact cleanup docs (Playwright snapshots) |
| **v1.16.0** | Jul 16 2026 | Advanced screener: filter grammar (40+ fields), technical analysis lib, backtest engine, TradingView `advancedScan`, 10 APIs, FilterBuilder/BacktestDialog UI, 45 tests, Chartink reverse-engineered |
| **v1.15.0** | Jul 16 2026 | Agent handoff system (`.agents/handoffs/`), 6 agent profiles, self-learning loop, `/handoff` `/self-learn` `/review-diff` commands |
| **v1.14.0** | Mar 27 2026 | MCP API `/api/mcp` — 22 functions for external NSE data, optional `x-api-key`, discovery functions |
| **v1.13.0** | Mar 27 2026 | Corporate action alerts (dividend/bonus/split/rights/buyback/meeting) |
| **v1.12.x** | Mar 27 2026 | Netlify build fix (secrets omit paths), cache-control headers, lazy loading, web vitals, worker auto-start fix |
| **v1.11.x** | Mar 21 2026 | Worker task mgmt (run now/retry/cancel/delete), GA4 + SEO (JSON-LD, sitemap, robots, metadata) |
| **v1.10.x** | Mar 20 2026 | Screener enhancement (live TradingView, quick/basic/advanced filters), corp actions dedup + NSE field fix, serverless DB logging (`ServerLog`, `db-logger.ts`), worker cache key + logger security fixes |
| **v1.9.x** | Mar 18-19 2026 | Secure join-request flow (RBAC), notifications page, Netlify Blobs logging, worker engine + NSE sync, build fixes |
| **v1.8.x** | Mar 14-16 2026 | Security (httpOnly cookies, no localStorage, CSRF, session tracking), Netlify 502 fix (minimal middleware, no NextAuth), Prisma 7 adapter |
| **v1.7.0** | Mar 13 2026 | Cron config mgmt, background workers, calendar view, TradingView links, worker logging |
| **v1.6.x** | Mar 13 2026 | Historical NSE sync, financial results tab, corp actions price/yield fix, stock list sync |
| **v1.5.0** | Mar 13 2026 | Live site tested — core features verified |
| **v1.4.0** | Mar 2026 | Enhanced corp actions (yield, sorting, filtering, pagination) |
| **v1.3.0** | Mar 2026 | Corp actions management (dividends, splits, bonus, rights, buybacks) |
| **v1.2.0** | Mar 2026 | Analytics service, alert service, demo seeding, portfolio analytics |
| **v1.1.0** | Mar 2026 | Stock recommendations, user alerts, audit logging, rate limiting, admin holdings |
| **v1.0.0** | Mar 2026 | Initial release |

> New version entry template — every change adds a row + detail bullets in `.agents/CHANGELOG.md`:
> `**vX.Y.Z** — <Title> (<Date>): <one-line summary> + Files Created/Modified + root cause or feature description`

---

## Credentials & Testing

| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

- **Live site**: https://tradenext6.netlify.app/ · **Bot**: @tradenext6Bot

## Commands

```bash
npm run dev              # Dev server (port 3000)
npm run local            # Full local dev (cross-platform)
npm run build            # Migrations + Next.js build
npm run quickbuild       # Next.js build only
npm run test             # Jest — RUN ALONE, never chained with ';' (Windows quirk)
npm run test:watch       # Watch mode
npm run test:e2e         # Playwright e2e — full suite (all browsers/projects) against dev server on :3000
npm run test:e2e:ui      # Playwright UI mode (watch/filter/step)
npx playwright show-report   # Open last Playwright HTML report
npx playwright show-trace test-results/<dir>/trace.zip   # View a trace
npm run lint             # ESLint
npx tsc --noEmit         # Typecheck production files
npx prisma generate      # Regenerate client after schema change
npx prisma migrate dev --name <name>   # Dev migration (safe)
npx prisma db push       # Schema sync (safe)
npx prisma studio        # DB browser
git config core.hooksPath .githooks    # Enable versioned hooks (fresh clone)
```

## Key Libraries

| Category | Library |
|----------|---------|
| Framework | Next.js 16 (App Router, nodejs runtime for Prisma/auth) |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL/TimescaleDB |
| Testing | Jest 30 + Testing Library + Playwright |
| HTTP | node-fetch, SWR |
| Validation | Zod 4.x |
| Logging | pino (via `@/lib/logger`) |

---

## Agent Documentation Files

| File | Purpose |
|------|---------|
| `.agents/RULES.md` | Master agentic operating rules — read on first session / fresh clone |
| `.agents/SOUL.md` | Agent identity & principles — how agents think, behave, communicate |
| `.agents/CHANGELOG.md` | Version-history index → detail subfiles in `.agents/changelog/` (versions-v3/v2/v1, screener, corp-actions, serverless-logging, security-workers) |
| `.agents/rules/session-memory-rules.md` | Session/memory/handoff maintenance + git guidelines + token efficiency |
| `.agents/rules/checklist.md` | Engineering guardrail checklist (v1.2) — hard contract for all changes |
| `.agents/rules/README.md` | Coding standards index (TS rules, imports, naming, errors, security) |
| `Primer.md` | Session tracking - read at start of every session |
| `agent-memory.md` | Activity log - tracks all agent work |
| `Lessons.md` | Rules & corrections - read before every commit |
| `HANDOFF.md` | Root orchestration state - read at start of every session |
| `.agents/session-todos.md` | Current session todo list - maintained during session |
| `.agents/sessions/` | Archived completed sessions (YYYY-MM-DD-<hash>.md) |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist - run before every commit |
| `.agents/security-checklist.md` | Security checklist - run before every commit |
| `.agents/linear-history.md` | Git flow & branching strategy (warn-only main) |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code style) |
| `.agents/documentation-standards.md` | Documentation standards |
| `.agents/docs/` | Subsystem deep-dives (recommendations, tasks/cron/workers, monitoring, alerts, playwright-e2e) — read before editing those subsystems |
| `.agents/AGENT-SKILL-MATRIX.md` | Agent ↔ Skill ↔ Command mapping matrix |
| `.agents/handoffs/active/latest.md` | Current session handoff state |
| `.agents/handoffs/flow/` | Handoff flows: session-cycle, agent-to-agent, agent-to-human, error-recovery |

**Read order at session start:** `HANDOFF.md` → `.agents/handoffs/active/latest.md` → `Primer.md` → `Lessons.md` → `.agents/session-todos.md`. (See `.agents/rules/session-memory-rules.md`.)

## Agent Operating Model (gardenify pattern)

- **Memory layout**: `HANDOFF.md` (orchestration) → `latest.md` (live resume) → `Primer.md` (status) → `Lessons.md` (corrections) → `agent-memory.md` (activity log).
- **Handoff = files, not prose**: update `.agents/session-todos.md`, archive to `.agents/sessions/YYYY-MM-DD-<hash>.md`, update `HANDOFF.md` + `Primer.md`. Next agent resumes from files, never conversation memory.
- **Self-healing**: verify before claiming — `npx tsc --noEmit`, `npm run test`, `npm run lint` after any change. Trust the repo over memory (re-read files).
- **Anti-hallucination**: every claim traces to a commit, tracked doc, passing test, or verified live check. Never invent file paths/API shapes — grep/read first.
- **Token efficiency**: small targeted reads; index files (AGENTS.md, Lessons.md) over full dumps; read slices by offset/limit; keep session-todos short (archives absorb history).

## Git Hooks (versioned in `.githooks/`)

```bash
git config core.hooksPath .githooks
```
- `.githooks/pre-commit` — WARN on main/master; BLOCK hardcoded secrets + staged `.env`; WARN console.log, junk artifacts, tsc errors.
- `.githooks/post-commit` — checkpoint log to `.agents/handoffs/checkpoint.log` (gitignored).
- `.githooks/pre-push` — WARN on main/master.
- Never bypass with `git commit --no-verify` unless intentional.

## Plugins & MCP (how agents extend TradeNext)

`.opencode/opencode.json`: plugins `opencode-helicone-session`, `opencode-wakatime`; MCP: Context7 (library docs), Playwright (UI testing — agentic browser automation for exploratory checks; scripted regression guards live in the `playwright-e2e` skill/`e2e/` suite), gh_grep (code search), sequential-thinking, memory (knowledge graph), chrome-devtools (performance/Lighthouse/network), filesystem.

## Skills, Agents & Commands (extensible system)

TradeNext uses a layered skills/agents/commands system. Mapping matrix: `.agents/AGENT-SKILL-MATRIX.md`.

| Layer | Location | Notes |
|-------|----------|-------|
| Skills (machine) | `.opencode/skills/<name>/SKILL.md` | YAML frontmatter (`name`, `description`); auto-discovered |
| Skills (human mirror) | `.agents/skills/<name>.md` | Short version + `Source:` footer |
| Agent profiles | `.agents/agents/<name>.md` | Expertise + Workflow + Handoff Triggers |
| Commands | `.agents/commands/<name>.md` | `/command` templates |
| Wiring | `.opencode/opencode.json` | `agent:` + `command:` sections |

**Focused skills** (beyond umbrella `docs-workflow`):

| Skill | Agent | Command | Purpose |
|-------|-------|---------|---------|
| `docs-updater` | doc-writer | `/docs-update` | repo doc updates after every implementation |
| `wiki-creator` | wiki-publisher | `/wiki-publish` | publish GitHub wiki pages (GitHub-renderer-safe mermaid) |
| `bug-finder` | bug-hunter | `/find-bugs` | hunt/reproduce/verify bugs, layer contract audits |
| `ux-enhancer` | ux-designer | `/ux-audit` | UI/UX audit (states/responsive/dark-mode) + enhancement |
| `playwright-e2e` | — | — | committed e2e suite (`e2e/`, `npm run test:e2e`): regression guards, cross-browser (Chromium/Firefox/WebKit) + Mobile Chrome, report/trace diagnostics — see `.agents/docs/playwright-e2e.md` |

**Adding a new skill**: create `.opencode/skills/<name>/SKILL.md` → mirror `.agents/skills/<name>.md` → profile + command → wire `opencode.json` → update matrix + this table.

**GitHub wiki gotchas** (wiki-creator skill): wiki git repo is lazy-created (create first page via web UI before cloning); GitHub's mermaid renderer is stricter — quote ALL labels with specials (`A["text<br/>more"]`, `E3["action: none|buy|sell|paper_trade"]`).

---

## ⚠️ MANDATORY: Code Hygiene & Artifact Cleanup

**Before every commit:** run `git status` and review ALL untracked/modified files. Delete junk: Playwright snapshots (`*.yaml` in root), screenshots, `dev-server.log`/`next-dev.log`. Verify `.gitignore` covers new artifact patterns. Check no secrets/tokens in diff, no dead code or `console.log`. Review diff size.

| Junk file | Source | Action |
|-----------|--------|--------|
| `*.yaml` (root) | `npx playwright-cli snapshot` w/o `--filename` | Delete or use `--filename=.playwright-cli/snapshots/` |
| `dev-server.log`, `next-dev.log` | dev server redirect | Delete |
| `screenshot-*.png` | Playwright CLI | Delete or move to `e2e-screenshots/` |
| `worker_logs/` | worker engine logging | Already gitignored |

## ⚠️ MANDATORY: Documentation Update Rule

**Documentation MUST be updated IMMEDIATELY after any implementation. If docs are not updated, the task is NOT complete.**

1. **AGENTS.md** — add compact row to version table + bullets to `.agents/CHANGELOG.md` (files changed, root cause/feature)
2. **Primer.md** — Current Project Status + Session History
3. **agent-memory.md** — activity log entry
4. **Lessons.md** — new lesson if pattern/bug discovered

## Usage

1. **Start of session**: Read `HANDOFF.md` → `latest.md` → `Primer.md` → `Lessons.md` → session-todos
2. **During work**: Log in `agent-memory.md`, update `latest.md` handoff, maintain session-todos
3. **Before commit**: Read `Lessons.md`, run pre-commit workflow + hygiene checklist
4. **End of session**: Update `Primer.md`, archive handoff

---

## Common Patterns

### Caching
```typescript
const cacheConfig = nseCache.stockQuote(symbol);
const data = await enhancedCache.getWithCache(cacheConfig, fetchFn, pollingConfig);
```
- **Market cache** (`lib/market-cache.ts`): NodeCache in-memory front (`mc:` keys, TTL 300/3600s) → DB `market_cache` → NSE. `getOrFetchNseData()` returns `source: "cache"` on memory hit.
- **Backtest data** (`lib/services/backtestDataService.ts`): memory `historicalCache` (24h) → temp table `backtest_history` (fresh ≤24h) → `daily_prices` (read-only) → NSE live + upsert temp. Returns `dataSource: "memory"|"db"|"nse"`. **NSE-fetched bars are NEVER written to main `daily_prices`** (temp table only, pruned at 30d).

### API Fetching
```typescript
const data = await nseFetch("/api/endpoint", "?param=value");   // cookies + caching handled
```

### Background Sync (fire-and-forget, never blocks the response)
```typescript
syncService.syncFinancials(symbol, data).catch(err =>
  logger.error({ msg: "Financial sync failed", symbol, error: err })
);
```

---

## Agent Lessons Learned

### Next.js 16 Runtime
- API routes using Prisma/Node.js/crypto MUST `export const runtime = 'nodejs'`. Auth routes MUST use Node.js. Edge runtime lacks `crypto`.
- Stale build errors → delete `.next` + restart dev server.

### Prisma Best Practices
- `npx prisma generate` after schema changes; `migrate dev --name <name>` for migrations.
- **Prisma Guardrails**: AI agents CANNOT run `migrate reset --force` / `db drop` without explicit user consent (CLI blocks). Safe: `migrate dev`, `db push`, `generate`. If blocked: STOP → INFORM → EXPLAIN → VERIFY → WAIT.
- Raw SQL must use camelCase column names as Prisma maps them (e.g. `"tradeDate"`, NOT `trade_date`). `@@map` table names vs model names differ.
- `createMany()` rejects fields not on the model — only pass model fields.
- Interactive `$transaction` expires in 5s on serverless → use `runInChunks()` bounded-concurrency helper for large batches.

### Session Management
- httpOnly + secure + sameSite:strict cookies; NEVER user data in localStorage (XSS).
- `UserSession` model tracks sessions; `cookies()` from `next/headers` wrapped in try-catch.

### Testing with Playwright (required for UI changes)
1. Start dev server (`npm run local`); test login (demo credentials); verify UI renders; check responsive (375/768/1920); check console errors; **cleanup dev server** (port 3000/3001) after.
2. **Never kill port 4096 (OpenCode web UI)** or DB ports.
3. `npx playwright-cli snapshot --filename=.playwright-cli/snapshots/test.yaml` — ALWAYS use `--filename` to avoid root junk.
4. **Committed e2e suite** (`e2e/`, `npm run test:e2e`) is the regression guard — run it after UI/UX/screener/auth changes and before merge/PR. Deep-dive: `.agents/docs/playwright-e2e.md`.
5. **Browser quirks** (all captured in the config/specs — don't regress):
   - Desktop viewport **1440×900** — Firefox's `hidden xl:flex` header nav needs ≥1280px but Firefox measures scrollbar-inclusive, so the default 1280×720 hides it.
   - **WebKit drops `fill()` on controlled `<input type="number">`** (React restores the old value) — use click → `ControlOrMeta+a` → `Delete` → `pressSequentially()` and verify with `toHaveValue`.
   - The Next dev server is **single-threaded** — heavy TradingView scans starve parallel SSR navigations. `navigation.spec.ts` is serial with `waitForURL` + `noWaitAfter`; `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`.
   - **Never assert live NSE values** (prices/marquee/indices) — `MarqueeBanner` renders `null` when the NSE marquee is slow; assert containers/contracts instead.

### Switch Case Best Practices
Always use block scope `{}` in switch cases to avoid variable hoisting:
```typescript
switch (type) {
  case "alerts": {
    const alerts = await getAnomalyAlerts(50, false);
    return NextResponse.json(alerts);
  }
  default: {
    const data = await getData();
    return NextResponse.json(data);
  }
}
```

---

## AI Safety Guardrails for Prisma

Prisma ORM detects AI agents (Claude Code, Gemini CLI, Qwen Code, Cursor, Aider, Replit) and BLOCKS destructive commands like `prisma migrate reset --force` / `db drop`. When blocked, the agent must: **STOP → INFORM → EXPLAIN (irreversible data loss) → VERIFY (explicit consent) → WAIT** for clear confirmation. Safe commands (generally allowed): `migrate dev`, `db push`, `generate`.

---

## MCP API (Machine Communication Protocol)

Unified endpoint for external NSE data: `POST /api/mcp` (JSON body) or `GET /api/mcp?function=...`. Optional auth via `x-api-key` header (`MCP_API_KEY` env). Response: `{ success, function, data, timestamp }`. Discovery: `listFunctions`, `help`, `describe`, `schema`. **23 functions** (v1.14.0: 22 + `getHistoricalData` added 2026-08-06). Caching: quotes 60s, market 2m, corp actions 5m, company info 1h. Full reference: `app/api/openapi/route.ts` (Swagger) + README.md.

Key functions: `getIndexData`, `getMarketIndices`, `getStockQuote`, `getStockChart`, `getHistoricalData` (symbol, from, to — uses backtest data chain, returns `source` + `ohlcv`), `getGainers`, `getLosers`, `getMostActive`, `getCorporateActions`, `getCorporateInfo`, `getMarquee`, `getDeals`, `getAnnouncements`, `getInsiderTrading`, `getEvents`, `getHeatmap`, `getSymbols`, `getTrends`.

---

## NSE Integration Notes

- Use `nseFetch(path, qs)` from `lib/nse-client.ts` (cookie + cache handled). Server-side proxy only; never call NSE from client.
- **Historical data endpoint**: `GET /api/historicalOR/generateSecurityWiseHistoricalData?from=DD-MM-YYYY&to=DD-MM-YYYY&symbol=SYMBOL&type=priceVolumeDeliverable&series=ALL` → `{ data: SecurityWiseHistoricalRow[] }` (fields: `CH_SYMBOL`, `CH_SERIES` EQ|BL, `mTIMESTAMP`/`CH_TIMESTAMP`, OHLC, `VWAP`, `CH_TOT_TRADED_QTY`, `CH_TOT_TRADED_VAL`, `CH_TOTAL_TRADES`, `COP_DELIV_QTY`, `COP_DELIV_PERC`). Fetcher + OHLCV mapper in `lib/nse-api.ts`; use `parseNseDate`.
- Rate limits respected; retry + backoff; cache with TTL. See `.opencode/skills/nse-integration/SKILL.md` + `.agents/skills/nse-integration.md`.

## Documentation Workflow Skill

- **`docs-workflow`** (`.opencode/skills/docs-workflow/SKILL.md` + `.agents/skills/docs-workflow.md`) — how to create feature plan files (`docs/designDoc/ph<NN>-*.md`), publish GitHub wiki pages (`TradeNext.wiki.git`), and apply the mandatory repo doc updates (AGENTS.md version table, CHANGELOG, TODO, Primer, Lessons, agent-memory, swagger/OpenAPI). Load this skill before any documentation work.
