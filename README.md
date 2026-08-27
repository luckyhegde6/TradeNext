# TradeNext — Smart NSE Analytics & Portfolio Manager

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)
[![Quality Gate](https://github.com/luckyhegde6/TradeNext/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/luckyhegde6/TradeNext/actions/workflows/quality-gate.yml)
[![Playwright Tests](https://github.com/luckyhegde6/TradeNext/actions/workflows/playwright.yml/badge.svg)](https://github.com/luckyhegde6/TradeNext/actions/workflows/playwright.yml)
[![Security Scan](https://github.com/luckyhegde6/TradeNext/actions/workflows/security.yml/badge.svg)](https://github.com/luckyhegde6/TradeNext/actions/workflows/security.yml)
[![Playwright Report](https://img.shields.io/badge/Playwright-Report-blue?logo=playwright&logoColor=white)](https://luckyhegde6.github.io/TradeNext/)

[![Next.js](https://img.shields.io/badge/Next.js-16.3.1-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7.9.1-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL/TimescaleDB](https://img.shields.io/badge/PostgreSQL%20·%20TimescaleDB-316192?logo=postgresql&logoColor=white)](https://www.timescale.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.2.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Jest](https://img.shields.io/badge/Jest-30.2.0-C21325?logo=jest&logoColor=white)](https://jestjs.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Live demo: **https://tradenext6.netlify.app** · Telegram bot: **@tradenext6Bot**

TradeNext is a Next.js 16 application for **NSE (India) market data, portfolio management, capital-gains tax,
F&O analytics, dividends, rebalancing, alerts, swing signals, and AI-driven daily recommendations** — backed by
PostgreSQL/TimescaleDB and deployed on Netlify as a persistent server with an in-process cron daemon.

---

## Feature Highlights

| Area | What you get |
|------|--------------|
| **Market Data** | Live NSE quotes & indices, corporate actions (dividends/bonus/splits), financial results, news, calendar, historical OHLCV |
| **Screener** | 2,000+ NSE stocks · 40+ filter fields · 98 TradingView templates + 117-entry Chartink registry · backtest engine · CSV export |
| **Portfolio** | Holdings P&L with live SSE prices, transactions, CSV import/export, tax reports (ST/LT), rebalancer, risk metrics (Sharpe, beta, max DD) |
| **AI Recommendations** | Daily picks from Chartink + TradingView hybrid scan, analyzed by an AI agent (OpenRouter) with confidence/target/SL, performance tracking + archival |
| **IPOs & Events** | IPO issue details — **Issue Size: shares per lot + ₹ per lot** — plus AI IPO analysis rendered as a JSON report (GMP, peers, risk matrix, strategy) and an **NSE events feed** (listing ceremonies etc.) on the dashboard |
| **Alerts & Telegram** | Price alerts, multi-condition rules, channels, event history, and **@tradenext6Bot** real-time delivery with rate limiting & user verification |
| **Platform** | Role-based auth (join-request flow), admin console (users, cron, workers, monitoring, AI config, DB health), background jobs, audit logging, MCP API |

## Verified Features

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | ✅ Working | Join request → admin approve → login (default password via `DEFAULT_PASSWORD` env) |
| Admin Console | ✅ Working | Users, sessions, cron, workers, AI config, monitoring, dividends |
| Telegram Bot | ✅ Working | @tradenext6Bot — real-time alerts, subscriptions, rate limiting |
| Portfolio | ✅ Working | Holdings, live prices, P&L, analytics (14 tabs), rebalancer, tax |
| Markets Overview | ✅ Working | NIFTY 50, BANK, IT, MIDCAP, SMALLCAP, AUTO, PHARMA |
| Corporate Actions | ✅ Working | Dividend (₹) and Yield (%) display correctly |
| Calendar | ✅ Working | Month view with corporate actions |
| Stock Screener | ✅ Working | 2,000+ stocks, multiple filters, backtest, templates |
| Advanced Screener | ✅ Working | Chartink·117 / TradingView·98 templates, unified runner, per-template runs |
| Recommendations | ✅ Working | Today's Picks, History, Performance tracking, Dividends, Subscribe |
| Swing Trading Signals | ✅ Working | 34 swing screeners · family segregation (momentum/breakout/trend/…) · AI LONG/SHORT/OBSERVE with targets |
| F&O Analytics | ✅ Working | Positions dashboard, option chain (NSE v3), expiries, Greeks, P&L summary |
| IPOs | ✅ Working | Issue Size (shares per lot + ₹ per lot), AI IPO analysis as JSON report (GMP/peers/risk/strategy) |
| NSE Events Feed | ✅ Working | Dashboard widget below Corporate Announcements (PAST/UPCOMING pills, thumbnails) |
| Alerts | ✅ Working | Multi-tab: Simple, Rules, Channels, Events, Telegram Bot |
| Watchlist | ✅ UI Ready | Empty state (expected) |
| Session Management | ✅ Working | Admin can view/invalidate sessions |
| Web Vitals | ✅ Working | Core Web Vitals monitoring |

---

## Quick Start

```bash
# Install dependencies
npm install

# Start local database (Docker)
npm run db:up

# Run migrations
npx prisma migrate dev

# Seed database
npx prisma db seed

# Start dev server
npm run dev
```

Visit **http://localhost:3000**.

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

> These are **public sandbox credentials** for trying the live site (also configured via
> `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `DEMO_PASSWORD` env vars). Never use them for real accounts.
> New users sign up via the **Join Request** flow — an admin approves, and the applicant receives the
> default password configured in the `DEFAULT_PASSWORD` env var (never hardcoded in the repo).

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router, Node.js runtime for Prisma/auth) |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL / TimescaleDB |
| Backup DB | SQLite (sql.js, in-memory, pure-JS) — DB outage resilience |
| Auth | NextAuth.js (httpOnly cookies, RBAC) |
| Testing | Jest 30 + Testing Library + Playwright (e2e) |
| Logging | pino structured logs → `logs/` dir |
| Deployment | Netlify (persistent server + in-process node-cron daemon) |

## Commands

```bash
# Development
npm run dev              # Dev server (port 3000)
npm run local            # Full local dev (cross-platform)

# Building
npm run build            # Migrations + Next.js build
npm run quickbuild       # Next.js build only

# Testing
npm run test             # Jest unit/component tests
npm run test:watch       # Watch mode
npm run test:e2e         # Playwright full suite (Chromium/Firefox/WebKit + Mobile)
npm run test:e2e:ui      # Playwright interactive UI mode — `npx playwright test --ui` (watch/filter/step/re-run)
npx playwright test --headed    # Run tests in a visible browser window (watch Playwright drive the site)
npx playwright show-report   # Open last Playwright HTML report (results + traces)

# Database
npm run db:up / npm run db:down   # Docker Postgres/TimescaleDB
npx prisma studio                 # DB browser

# Lint / typecheck
npm run lint             # ESLint
npx tsc --noEmit         # Typecheck production files

# Dev checks (scripts/dev-checks/)
node scripts/dev-checks/check-db.js
node scripts/dev-checks/check-schema.js
node scripts/dev-checks/test-auth.js
```

## Testing

- **Unit/component** (Jest, `lib/__tests__/`, 709 passing / 4 skipped): services (screener engine, technical
  analysis, backtest, recommendations, chartink unified runner, cron ledger + in-process daemon, IPO report/issue
  size, NSE events, swing agent, tax, logger paths, …). The 4 skips are intentional client-cache IndexedDB tests.
- **E2E** (`e2e/`, 89 tests, 5 Playwright projects): login, nav, home, screener + advanced screener,
  recommendations, portfolio, watchlist, alerts, profile, responsive. CI: `.github/workflows/playwright.yml`
  (TimescaleDB service, migrate + seed, HTML report artifact 30 days).
- **Live Playwright report**: [Latest report on GitHub Pages](https://luckyhegde6.github.io/TradeNext/) —
  auto-published on every green `main` push (results + trace viewer).
- **Debugging with the Playwright UI** — whenever an error/issue surfaces, run the suite in **interactive UI mode**
  (`npm run test:e2e:ui`, which maps to `npx playwright test --ui`) to watch, filter, step through, and re-run
  individual specs while the dev server is up. This is the recommended way to **visually verify** a fix, reproduce a
  failing flow, test edge cases, and **enhance the user experience** before committing. After any run, open the HTML
  **report** (`npx playwright show-report`) to inspect the results, trace viewer, console logs, network calls, and
  per-step screenshots — use the trace to diagnose why a spec failed. See the [playwright-e2e skill](../../.opencode/skills/playwright-e2e/SKILL.md) for the full run/debug/author workflow.
- Details + troubleshooting playbook: `.agents/docs/playwright-e2e.md`.

---

## MCP API (Machine Communication Protocol)

Unified endpoint for external NSE data:

```
POST /api/mcp        # JSON body: { "function": "getStockQuote", "params": {...} }
GET  /api/mcp?function=getStockQuote&symbol=RELIANCE
```

- **29 functions**: quotes, indices, historical OHLCV, gainers/losers, most active, corporate actions,
  corporate info, marquee, deals, announcements, insider trading, events, heatmap, symbols, trends,
  IPO analysis / IPO issue detail / NSE events, F&O option chain / F&O expiries + discovery.
- Optional auth via `x-api-key` header (`MCP_API_KEY` env). Caching: quotes 60s, market 2m, corp actions 5m.
- Discovery: `listFunctions`, `help`, `describe`, `schema` · Full Swagger reference: **/api/openapi**.

## AI & Agent Discovery

TradeNext publishes machine-readable discovery files for LLMs, AI agents, and crawlers:

| File | Purpose |
|------|---------|
| **`/llms.txt`** | Plain-text index of what the site is, its public pages, public APIs (MCP, recommendations, screener), data sources, and boundaries — for LLMs/agents to understand the app (llmstxt.org pattern). |
| **`/robots.txt`** | Crawler rules: allows search engines + LLM crawlers (GPTBot, ClaudeBot, PerplexityBot, …), explicitly allows `/llms.txt`, blocks `/api/`, `/admin/`, `/users/`, and internal/tooling paths. |
| **`/sitemap.xml`** | Public pages only — never includes admin, API, user, or repo-internal files. |
| **`/api/openapi`** | Swagger UI for the full API surface. |

**Production boundary:** the deploy publish dir is `.next` (app output + `public/`). Repo-internal
documentation (`.agents/`, `*.md`, logs) is **never** published to the live site, and `robots.txt`
blocks those paths defensively.

---

## Environment Variables

See `.env.example` for the full list (never commit real secrets — `.env` is gitignored):

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradenext

# Auth
AUTH_SECRET=your-secret-key

# Sandbox credentials (optional — defaults provided)
ADMIN_EMAIL=admin@tradenext6.app
ADMIN_PASSWORD=admin123
DEMO_PASSWORD=demo123

# Server-only: default password for newly approved join-request users
# (env var only — never hardcode the value in code or docs)
DEFAULT_PASSWORD=

# Telegram Bot (server-only — never commit)
# TELEGRAM_SECRET=   Get bot token from @BotFather
# TELEGRAM_CHATID=   Your chat ID from @tradenext6Bot with /start

# Server
PORT=3000
```

## Project Structure

```
/
├── instrumentation.ts       # In-process node-cron daemon (system cron jobs)
├── app/                    # Next.js App Router pages + API routes
│   ├── api/                #   API routes (mcp, screener, recommendations, admin/…)
│   ├── admin/              #   Admin console pages
│   ├── [route]/            #   Dynamic routes
│   └── llms.txt/           #   /llms.txt LLM/agent index
├── lib/                    # Business logic
│   ├── services/           #   Service layer (recommendations, screener, tax, alerts, …)
│   ├── nse/                #   NSE API utilities
│   └── __tests__/          #   Unit tests
├── prisma/                 # Database schema + migrations + seed
├── scripts/                # Build/ingestion/dev-check scripts
├── e2e/                    # Playwright e2e suite
└── .agents/                # AI agent configuration + docs (repo-only, not published)
```

## Documentation

All project documentation lives in this repo — the root-level files below are the primary references.
Each is named with the `@File.md` convention so agents and humans can reference it unambiguously.

| Reference | File | Purpose |
|-----------|------|---------|
| `@README.md` | `README.md` | **This file** — project overview, feature highlights, quick start, credentials, commands, MCP API, agentic-coding guide |
| `@AGENTS.md` | `AGENTS.md` | **Full development guide** — version history (compact), credentials, commands, agent docs map, common patterns, lessons — read this first |
| `@ARCHITECTURE.md` | `ARCHITECTURE.md` | Technical architecture — system overview, DB schema, API structure, caching, security, deployment |
| `@USAGE.md` | `USAGE.md` | Step-by-step setup & usage guide (clone, env, DB, migrations, seed, dev server, tests) |
| `@SETUP.md` | `SETUP.md` | Prisma Postgres setup guide (starter-template legacy) |
| `@DOCKER_ENV_SETUP.md` | `DOCKER_ENV_SETUP.md` | Docker Compose environment-variable configuration |
| `@PRD.md` | `PRD.md` | Product requirements document — personas, features, roadmap |
| `@TODO.md` | `TODO.md` | Implementation checklist — features tracked by sprint/version |
| `@TODO_ENHANCEMENTS.md` | `TODO_ENHANCEMENTS.md` | Future enhancement ideas |
| `@TODO-PENTESTING.md` | `TODO-PENTESTING.md` | Security/penetration-testing checklist + findings log |
| `@TODO-PERF-TESTING.md` | `TODO-PERF-TESTING.md` | Performance-testing checklist + findings log |
| `@CHANGELOG.md` | `CHANGELOG.md` | Compact version-history index → per-minor detail in `.agents/changelog/` |
| `@BUGS.md` | `BUGS.md` | Human-readable bug tracker (mirrors GitHub issues) |
| `@HANDOFF.md` | `HANDOFF.md` | Agent orchestration state — read at every session start |
| `@Primer.md` | `Primer.md` | Session tracking — current project status + session history |
| `@Lessons.md` | `Lessons.md` | Rules & corrections learned by agents — read before every commit |
| `@agent-memory.md` | `agent-memory.md` | Activity log of all agent work |
| `@SECURITY.md` | `SECURITY.md` | Security policy (GitHub template) |
| `@VERIFICATION_REPORT.md` | `VERIFICATION_REPORT.md` | Feature verification report |
| `@README_Netlify_template.md` | `README_Netlify_template.md` | Legacy Netlify starter-template README |

Deeper subsystem documentation (recommendations engine, tasks/cron/workers, monitoring & logging,
alerts, playwright-e2e, DB-migration ledger) lives in `.agents/docs/`.

---

## Agentic Coding

TradeNext is built for **AI-assisted, agent-driven development** — most features are implemented by AI
agents (OpenCode/Claude Code) following a strict memory + documentation discipline.

### Launch

```bash
npm install -g opencode
opencode --web            # Launch web UI (recommended)
```

### Read order at session start

Every agent session begins by reading the orchestration state, then resumes from **files, never
conversation memory**:

1. `@HANDOFF.md` — current orchestration state (status, active handoff, feature in flight)
2. `.agents/handoffs/active/latest.md` — live resume context from the previous session
3. `@Primer.md` — project status + session history
4. `@Lessons.md` — rules & corrections (read before every commit)
5. `.agents/session-todos.md` — current session todo list

Full rule set: `.agents/RULES.md` (master operating rules), `.agents/SOUL.md` (identity & principles),
`.agents/rules/` (coding standards, checklist, memory rules).

### How the `.agents/` system works

| Area | Location | What it does |
|------|----------|--------------|
| **Rules** | `.agents/rules/` | Hard contracts: engineering checklist, coding standards, session memory rules, pre-commit workflow |
| **Memory** | `@HANDOFF.md` → `.agents/handoffs/active/latest.md` → `@Primer.md` → `@Lessons.md` → `@agent-memory.md` | Handoff = files, not prose; every session archives `decisions.md` + `flow.md` to `.agents/sessions/` |
| **Skills** | `.opencode/skills/` + `.agents/skills/` | Specialized workflows (docs-updater, bug-finder, ux-enhancer, wiki-creator, playwright-e2e, nse-integration) |
| **Agents** | `.agents/agents/` | Expert profiles (doc-writer, bug-hunter, ux-designer, wiki-publisher, …) — matrix in `.agents/AGENT-SKILL-MATRIX.md` |
| **Commands** | `.agents/commands/` | `/command` templates (plan, code-review, tdd, handoff, self-learn, review-diff, docs-update, …) |
| **MCP servers** | `opencode.json` | Context7 (docs), GitHub Search, Prisma Local/Remote, Playwright |
| **Git hooks** | `.githooks/` | Versioned pre-commit/post-commit/pre-push — blocks secrets, warns on main, checks tsc errors |

### Agentic workflow (what agents do)

1. **Read the docs first** — never assume file paths/API shapes; grep/read the actual repo.
2. **Think before coding** — state assumptions, surface tradeoffs, ask when unclear (`.agents/SOUL.md`).
3. **Keep changes surgical** — minimum code that solves the problem; touch only what the request needs.
4. **Write tests** — Jest unit tests in `lib/__tests__/`, Playwright e2e in `e2e/` for UI changes.
5. **Update documentation after every implementation** — @AGENTS.md version table row + `.agents/CHANGELOG.md`
   bullets, `@Primer.md`, `@agent-memory.md`, `@Lessons.md` (new lesson if a pattern/bug was discovered).
6. **Verify before claiming** — `npx tsc --noEmit`, `npm run test`, `npm run lint` after any change.
7. **Pre-commit discipline** — read `@Lessons.md`, run `.agents/pre-commit-workflow.md` + hygiene checklist,
   then commit on explicit user request only (agents never auto-push/deploy/merge).

Docs for agents: `@ARCHITECTURE.md` + `docs/architecture.html` (interactive Mermaid diagrams),
`.agents/docs/` (subsystem deep-dives). See also the `docs-workflow` skill
(`.opencode/skills/docs-workflow/SKILL.md`) for how documentation updates are made.

## License

MIT