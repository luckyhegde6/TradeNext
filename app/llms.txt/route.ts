// app/llms.txt/route.ts
// Serves a machine/LLM-readable index of TradeNext at /llms.txt
// (llmstxt.org pattern). Static content — no credentials, no internal
// paths (.agents/ is NOT published; admin/api/users are off-limits here).

export const dynamic = "force-static";

const LLMS_TXT = `# TradeNext

> Smart NSE (India) market analytics & portfolio manager. Live demo: https://tradenext6.netlify.app

## What this is
TradeNext is a Next.js 16 + TypeScript + Prisma 7 (PostgreSQL/TimescaleDB) application that tracks NSE India
market data, manages portfolios, computes capital-gains tax, runs stock screeners, generates AI-driven daily
recommendations, and delivers alerts via Telegram. Deployed on Netlify. The app fetches NSE data
server-side (never from the browser) through a caching proxy.

## Public pages
- / — dashboard: indices (NIFTY 50, BANKNIFTY, IT, MIDCAP, ...), market marquee, announcements, upcoming corporate actions
- /markets — live market overview
- /markets/screener — stock screener (2,000+ NSE stocks, filter grammar, 98+ templates)
- /markets/screener/advanced — advanced screener + backtest engine + Chartink/TradingView template runs
- /markets/analytics — analytics tabs including financial results
- /markets/calendar — dividend/corporate-action calendar
- /portfolio — holdings, P&L, analytics, CSV export
- /portfolio/tax — capital-gains tax reports (short-term / long-term)
- /portfolio/rebalance — target-allocation rebalancer
- /watchlist — watchlist (auth)
- /alerts — price alerts, alert rules, channels, event history, Telegram bot subscription (auth)
- /recommendations — AI daily picks, history with performance, dividends, Telegram subscribe
- /fo — F&O analytics: positions dashboard, option chain, expiries, Greeks, P&L summary
- /news — market news (India/Global)
- /compare — stock comparison + NIFTY 50 benchmark
- /contact — contact page
- /auth/signin, /auth/join — authentication pages

## Public APIs
- MCP API — POST/GET /api/mcp — 28 functions for external NSE data (quotes, indices, historical OHLCV,
  gainers/losers, most active, corporate actions, corporate info, marquee, deals, announcements, insider
  trading, events, heatmap, symbols, trends, IPO analysis, IPO issue detail, NSE events, F&O option chain,
  F&O expiries, discovery).
  Optional x-api-key (MCP_API_KEY).
  Discovery: listFunctions, help, describe, schema. Full reference: /api/openapi (Swagger UI).
- GET /api/recommendations — latest AI daily recommendations
- GET /api/recommendations/performance — paginated, sortable performance table (cached 15 min)
- GET /api/recommendations/history — past recommendation runs
- POST /api/screener/chartink — run a Chartink template by id (clause-ready registry)
- Advanced screener endpoints under /api/screener/* — filter grammar (40+ fields), templates, backtest, configs

## Data sources
- NSE India (server-side proxy only, rate-limited, cached — see lib/nse-client.ts)
- TradingView advancedScan (live screener universe)
- Chartink screeners (117-entry registry; captured tables persisted in DB with 72h TTL)
- daily_prices (TimescaleDB hypertable, 30d backtest temp table)

## Tech stack
Next.js 16 (App Router) · TypeScript 5.9 (strict) · Tailwind CSS 4 · Prisma 7 + PostgreSQL/TimescaleDB ·
NextAuth.js · Jest 30 + Playwright e2e · pino structured logging · Netlify + PostgreSQL

## Boundaries (IMPORTANT for agents & crawlers)
- /admin/* and /api/admin/* are role-gated private areas — do not index, link, or reference.
- /users/* are user-specific — do not index.
- The .agents/ directory (repo docs, session logs, agent workflows) is NOT published to production and must
  never be referenced from this file or any public endpoint.
- No credentials appear here; demo access is documented in the project README on GitHub.

## Repo documentation (development only — not part of the deployed site)
- README.md — quick start, commands, environment variables
- AGENTS.md — development guide, compact version history, agent operating model
- ARCHITECTURE.md + docs/architecture.html — technical architecture (Mermaid diagrams)
- .agents/docs/ — subsystem deep-dives (recommendation engine, cron/workers, monitoring, alerts, e2e)
`;

export async function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}