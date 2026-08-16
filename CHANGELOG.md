# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Maintainers**: full per-version detail lives in [`.agents/CHANGELOG.md`](./.agents/CHANGELOG.md).
> v3/v2/v1 detail is split per-minor: `versions-v3.13.md` … `versions-v3.0.md`,
> `versions-v2.2.md` / `versions-v2.1.md`, `versions-v1.16.md` … `versions-v1.8.md`,
> each with its own per-minor index (`versions-v3.md` / `versions-v2.md` / `versions-v1.md`).
> This file is the compact, human-facing index — keep it in sync with `AGENTS.md`.

---

## v3 — Current (2026-07-18 → 2026-08-16)

| Version | Summary | Detail |
|---------|---------|--------|
| **v3.13.0** · Aug 16 | DB-backed Swing AI analysis job — durable `SwingAnalysisJob` replaces the volatile cache-only fire-and-forget (pre-scan DB lookup, atomic claim + supersede-abort, stale recovery 45 min / 2 attempts, cron-daemon drain) | [versions-v3.13.md](./.agents/changelog/versions-v3.13.md) |
| **v3.12.0** · Aug 16 | Swing tab prod failure FIX (request-time split — async AI analysis; Netlify 30s wall) + prod-stability batch (perf live-price fallback, prod `daily_prices` backfill, heartbeat-aware reaper, Prisma query timeout, worker-logger tmpdir fallback, error serialization) | [versions-v3.12.md](./.agents/changelog/versions-v3.12.md) |
| **v3.11.0–v3.11.3** · Aug 15 | In-process node-cron daemon + `daysTracked` 500 fix · no-fake-HOLD Today's Picks (partial persistence) · `recommendationsCache` globalThis singleton · full serverless purge (persistent-server reality, Blob logging removed) | [versions-v3.11.md](./.agents/changelog/versions-v3.11.md) |
| **v3.10.0** · Aug 14 | Historical-price sync into `daily_prices` (Swing indicators "—" fix) + `backtest_history` prod-gap FIX (lazy DDL) | [versions-v3.10.md](./.agents/changelog/versions-v3.10.md) |
| **v3.9.0–v3.9.1** · Aug 13/14 | Swing Trading Signals tab (34 screeners, families, AI LONG/SHORT/OBSERVE) + NSE chart buttons + `analysisStatus` honesty fix | [versions-v3.9.md](./.agents/changelog/versions-v3.9.md) |
| **v3.8.0** · Aug 13 | AI pre-flight gate + cron spawn dedup + stale-task reaping + cron-ledger dedupe + 8192 maxTokens default | [versions-v3.8.md](./.agents/changelog/versions-v3.8.md) |
| **v3.7.0–v3.7.3** · Aug 13 | F&O Analytics UI + NSE option-chain-v3 + MCP `getOptionChain`/`getFoExpiries` · BUY/SELL-only broadcast + AI connection-test cron · Netlify secrets-scan fix + credential-literal masking | [versions-v3.7.md](./.agents/changelog/versions-v3.7.md) |
| **v3.6.0–v3.6.4** · Aug 11/12 | Password-reset auth flow + market-sync cron + dividend-cards fix · recs default sorts + perf price bridge + AI context · dividend TZ fix · page redesign + IPO issue size + NSE events + IPO report v2 (JSON) | [versions-v3.6.md](./.agents/changelog/versions-v3.6.md) |
| **v3.5.0–v3.5.7** · Aug 7–11 | Perf tracking/archival · target/SL ₹0 fix + SSE wiring · TV `change`=% fix · Playwright e2e + CI · AI-config/cron-ledger · Chartink capture → DB · Chartink 117-registry + TV fallback · auth join fix + server logs + credentials hygiene + llms.txt | [versions-v3.5.md](./.agents/changelog/versions-v3.5.md) |
| **v3.4.0–v3.4.3** · Jul 18–Aug 6 | Telegram bot admin + Profile page · prod fixes (chunk timeout, top-50 cap, AI monitoring persistence) · subsystem docs + versioned `.githooks` | [versions-v3.4.md](./.agents/changelog/versions-v3.4.md) |
| **v3.3.0–v3.3.1** · Jul 19–21 | Daily recommendations engine (Chartink + TradingView hybrid, AI agent, BUY/HOLD/SELL + target/SL) + self-heal AI + audit logging | [versions-v3.3.md](./.agents/changelog/versions-v3.3.md) |
| **v3.2.0** · Jul 18 | Telegram bot (@tradenext6Bot) + corp-actions price/yield fix | [versions-v3.2.md](./.agents/changelog/versions-v3.2.md) |
| **v3.1.0** · Jul 18 | Risk metrics (Sharpe, max DD, vol, CAGR, beta vs NIFTY 50, win rate) + benchmark overlay + compare chart | [versions-v3.1.md](./.agents/changelog/versions-v3.1.md) |
| **v3.0.0** · Jul 18 | CSV export (FY report + detailed P&L) + portfolio value history service + P&L timeline chart | [versions-v3.0.md](./.agents/changelog/versions-v3.0.md) |

## v2 — Pre-v3 (Jul 17–18, 2026)

| Version | Summary | Detail |
|---------|---------|--------|
| **v2.2.0** · Jul 18 | Admin alert config (Secret AES-256-GCM, DeliveryLog, channels/events APIs) + screener templates 25 → 98 (9 categories) | [versions-v2.2.md](./.agents/changelog/versions-v2.2.md) |
| **v2.1.0** · Jul 17 | Enterprise alert engine: `AlertChannel`/`AlertRule`/`AlertEvent` models, email/webhook delivery, delivery manager, 7 API routes, 17 tests | [versions-v2.1.md](./.agents/changelog/versions-v2.1.md) |

## v1 — Foundations (Mar 2026 → Jul 2026)

| Version | Summary | Detail |
|---------|---------|--------|
| **v1.16.0–v1.16.1** · Jul 16/18 | Advanced screener (filter grammar, technical analysis lib, backtest engine, TradingView `advancedScan`, 10 APIs, 45 tests) + code hygiene docs | [versions-v1.16.md](./.agents/changelog/versions-v1.16.md) |
| **v1.15.0** · Jul 16 | Agent handoff system (`.agents/handoffs/`), 6 agent profiles, self-learning loop, `/handoff` `/self-learn` `/review-diff` commands | [versions-v1.15.md](./.agents/changelog/versions-v1.15.md) |
| **v1.14.0** · Mar 27 | MCP API `/api/mcp` — 22 functions for external NSE data, optional `x-api-key`, discovery functions | [versions-v1.14.md](./.agents/changelog/versions-v1.14.md) |
| **v1.13.0** · Mar 27 | Corporate action alerts (dividend/bonus/split/rights/buyback/meeting) | [versions-v1.13.md](./.agents/changelog/versions-v1.13.md) |
| **v1.12.0–v1.12.1** · Mar 27 | Netlify build fix (secrets omit paths), cache-control headers, lazy loading, web vitals, worker auto-start fix | [versions-v1.12.md](./.agents/changelog/versions-v1.12.md) |
| **v1.11.0–v1.11.1** · Mar 21 | Worker task mgmt (run now/retry/cancel/delete); GA4 + SEO (JSON-LD, sitemap, robots, metadata) | [versions-v1.11.md](./.agents/changelog/versions-v1.11.md) |
| **v1.10.0–v1.10.6** · Mar 20 | Screener enhancement (live TradingView, quick/basic/advanced filters); corp actions dedup + NSE field fix; serverless DB logging (`ServerLog`, `db-logger.ts`); worker cache key + logger security fixes | [versions-v1.10.md](./.agents/changelog/versions-v1.10.md) |
| **v1.9.0–v1.9.3** · Mar 18/19 | Secure join-request flow (RBAC), notifications page, Netlify Blobs logging, worker engine + NSE sync, build fixes | [versions-v1.9.md](./.agents/changelog/versions-v1.9.md) |
| **v1.8.1–v1.8.3** · Mar 14/16/18 | Security (httpOnly cookies, no localStorage, CSRF, session tracking); Netlify 502 fix (minimal middleware, no NextAuth); Prisma 7 adapter | [versions-v1.8.md](./.agents/changelog/versions-v1.8.md) |
| **v1.7.0** · Mar 13 | Cron config management, background workers, calendar view, TradingView links, worker logging | — (compact only) |
| **v1.6.x** · Mar 13 | Historical NSE sync, financial results tab, corp actions price/yield fix, stock list sync | — (compact only) |
| **v1.5.0** · Mar 13 | Live site tested — core features verified | — (compact only) |
| **v1.4.0** · Mar 2026 | Enhanced corp actions (yield, sorting, filtering, pagination) | — (compact only) |
| **v1.3.0** · Mar 2026 | Corp actions management (dividends, splits, bonus, rights, buybacks) | — (compact only) |
| **v1.2.0** · Mar 2026 | Analytics service, alert service, demo seeding, portfolio analytics | — (compact only) |
| **v1.1.0** · Mar 2026 | Stock recommendations, user alerts, audit logging, rate limiting, admin holdings | — (compact only) |
| **v1.0.0** · Mar 2026 | Initial release | — (compact only) |

## Historical (2025-12 → 2026-02)

Pre-1.0 milestones captured in commit history and `.agents/CHANGELOG.md`:
multi-timeframe index charts, responsive breadcrumbs/header, NSE market data ingestion,
auth + user management, admin utilities, Docker/Postgres setup.
