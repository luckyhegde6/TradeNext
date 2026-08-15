# TradeNext — Smart NSE Analytics & Portfolio Manager

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)
[![Playwright Tests](https://github.com/your-org/tradenext/actions/workflows/playwright.yml/badge.svg)](https://github.com/your-org/tradenext/actions/workflows/playwright.yml)

> Live demo: **https://tradenext6.netlify.app** · Telegram bot: **@tradenext6Bot**

TradeNext is a Next.js 16 application for **NSE (India) market data, portfolio management, capital-gains tax,
F&O analytics, dividends, rebalancing, alerts, and AI-driven daily recommendations** — backed by
PostgreSQL/TimescaleDB and deployed on Netlify.

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
| **Platform** | Role-based auth (join-request flow), admin console (users, cron, workers, monitoring, AI config), background jobs, audit logging, MCP API |

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
| Auth | NextAuth.js (httpOnly cookies, RBAC) |
| Testing | Jest 30 + Testing Library + Playwright (e2e) |
| Logging | pino structured logs → `logs/` dir + Netlify Blob store |
| Deployment | Netlify |

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
npm run test:e2e:ui      # Playwright UI mode
npx playwright show-report   # Open last Playwright HTML report

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

- **Unit/component** (Jest, `lib/__tests__/`, 533 passing): services (screener engine, technical
  analysis, backtest, recommendations, chartink unified runner, cron ledger, IPO report/issue size,
  NSE events, tax, logger paths, …).
- **E2E** (`e2e/`, 89 tests, 5 Playwright projects): login, nav, home, screener + advanced screener,
  recommendations, portfolio, watchlist, alerts, profile, responsive. CI: `.github/workflows/playwright.yml`
  (TimescaleDB service, migrate + seed, HTML report artifact 30 days).
- Details + troubleshooting playbook: `.agents/docs/playwright-e2e.md`.

---

## MCP API (Machine Communication Protocol)

Unified endpoint for external NSE data:

```
POST /api/mcp        # JSON body: { "function": "getStockQuote", "params": {...} }
GET  /api/mcp?function=getStockQuote&symbol=RELIANCE
```

- **28 functions**: quotes, indices, historical OHLCV, gainers/losers, most active, corporate actions,
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
├── netlify/                # Netlify functions (cron, background)
└── .agents/                # AI agent configuration + docs (repo-only, not published)
```

## AI-Assisted Development

TradeNext is configured for OpenCode:

```bash
npm install -g opencode
opencode --web            # Launch web UI (recommended)
```

- **MCP servers** (`opencode.json`): Context7 (docs), GitHub Search, Prisma Local/Remote, Playwright.
- **Skills & agents**: `.opencode/skills/` + `.agents/agents/` (docs-updater, bug-finder, ux-enhancer,
  wiki-creator, playwright-e2e, nse-integration) — matrix in `.agents/AGENT-SKILL-MATRIX.md`.
- **Docs**: `ARCHITECTURE.md` + `docs/architecture.html` (interactive Mermaid diagrams), `AGENTS.md`
  (dev guide + compact version history), `.agents/docs/` (subsystem deep-dives).

## License

MIT