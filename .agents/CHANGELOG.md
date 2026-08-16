# TradeNext Changelog

> Full version history + legacy feature docs (moved here from AGENTS.md 2026-08-06). **AGENTS.md keeps only a compact version table** — this directory is the source of detail.
>
> **Reading guidance**: load only the subfile you need (e.g. v3.x for recent work), never the whole directory. v3 detail is split per-minor (`versions-v3.13.md` … `versions-v3.0.md`); `versions-v3.md` is a per-minor index.

## Index

| File | Contents |
|------|----------|
| [versions-v3.md](./changelog/versions-v3.md) | v3 per-minor index → [versions-v3.13.md](./changelog/versions-v3.13.md) … [versions-v3.0.md](./changelog/versions-v3.0.md) |
| [versions-v3.13.md](./changelog/versions-v3.13.md) | **v3.13.0** — DB-backed Swing AI analysis job: durable `SwingAnalysisJob` replaces the volatile cache-only fire-and-forget (pre-scan DB lookup, atomic claim + supersede-abort, stale recovery, cron-daemon drain) |
| [versions-v3.12.md](./changelog/versions-v3.12.md) | **v3.12.0** — Swing tab prod failure FIX (request-time split — async AI analysis; Netlify 30s wall) + prod-stability batch (perf live-price fallback, prod `daily_prices` backfill 21,195 bars, heartbeat-aware reaper, Prisma query timeout, worker-logger tmpdir fallback, error serialization) |
| [versions-v3.11.md](./changelog/versions-v3.11.md) | **v3.11.0–v3.11.3** — in-process node-cron daemon + `daysTracked` 500 fix + carried v3.10.1 batch · no-fake-HOLD Today's Picks (partial persistence) · `recommendationsCache` globalThis singleton · full serverless purge (persistent-server reality, Blob logging removed, DataFetcher test un-skip) |
| [versions-v3.10.md](./changelog/versions-v3.10.md) | **v3.10.0** — historical-price sync into `daily_prices` (Swing indicators "—" fix) + `backtest_history` prod-gap FIX (lazy DDL) |
| [versions-v3.9.md](./changelog/versions-v3.9.md) | **v3.9.0–v3.9.1** — Swing Trading Signals tab (34 screeners, families, AI LONG/SHORT/OBSERVE) + NSE chart buttons + `analysisStatus` honesty fix |
| [versions-v3.8.md](./changelog/versions-v3.8.md) | **v3.8.0** — AI pre-flight gate + cron spawn dedup + stale-task reaping + cron-ledger dedupe + 8192 maxTokens default |
| [versions-v3.7.md](./changelog/versions-v3.7.md) | **v3.7.0–v3.7.3** — F&O Analytics UI + NSE option-chain-v3 + MCP `getOptionChain`/`getFoExpiries` · BUY/SELL-only broadcast + AI connection-test cron · Netlify secrets-scan fix + credential-literal masking |
| [versions-v3.6.md](./changelog/versions-v3.6.md) | **v3.6.0–v3.6.4** — password-reset auth flow + market-sync cron + dividend-cards fix · recs default sorts + perf price bridge + AI context · dividend TZ fix · page redesign + IPO issue size + NSE events + IPO report v2 |
| [versions-v3.5.md](./changelog/versions-v3.5.md) | **v3.5.0–v3.5.7** — perf tracking/archival · target/SL fix + SSE wiring · TV `change`=% fix · Playwright e2e + CI · AI-config/cron-ledger · Chartink capture → DB · Chartink 117-registry + TV fallback · auth join fix + server logs + credentials hygiene + llms.txt |
| [versions-v3.4.md](./changelog/versions-v3.4.md) | **v3.4.0–v3.4.3** — Telegram bot admin + Profile page · prod fixes (chunk timeout, top-50 cap, AI monitoring) · subsystem docs + versioned `.githooks` |
| [versions-v3.3.md](./changelog/versions-v3.3.md) | **v3.3.0–v3.3.1** — daily recommendations engine + AI agent + self-heal AI + audit logging |
| [versions-v3.2.md](./changelog/versions-v3.2.md) | **v3.2.0** — Telegram bot (@tradenext6Bot) + corp-actions price/yield fix |
| [versions-v3.1.md](./changelog/versions-v3.1.md) | **v3.1.0** — risk metrics (Sharpe, max DD, beta, win rate) + benchmark overlay |
| [versions-v3.0.md](./changelog/versions-v3.0.md) | **v3.0.0** — CSV export + portfolio value history + P&L timeline chart |
| [versions-v2.md](./changelog/versions-v2.md) | v2.2.0 → v2.1.0 (alert engine, admin alert config, 98 screener templates) |
| [versions-v1.md](./changelog/versions-v1.md) | v1.16.1 → v1.0.0 (advanced screener, agent handoff, MCP API, security, workers) |
| [changelog/screener.md](./changelog/screener.md) | Screener & backtest deep-dive (v1.16.0 FilterBuilder/BacktestDialog, v1.10.0 enhancement) |
| [changelog/corp-actions.md](./changelog/corp-actions.md) | Corporate actions (dedup fix, NSE field fix, enhanced UI, management) |
| [changelog/serverless-logging.md](./changelog/serverless-logging.md) | Serverless logging (ServerLog/db-logger, Netlify Blobs, 502 fix) |
| [changelog/security-workers.md](./changelog/security-workers.md) | Security (cookies/sessions), cron/workers, historical sync, tested features |

---

## Full version history (older)

See [versions-v2.md](./changelog/versions-v2.md) + [versions-v1.md](./changelog/versions-v1.md) + feature deep-dives above.
