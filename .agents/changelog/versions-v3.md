# Version History v3

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). Latest versions in [versions-v3.14.md](./versions-v3.14.md).
>
> **Per-minor index** — full detail lives in the per-minor file for each minor version.
> Load only the file you need; never the whole directory.

## Per-minor files

| File | Contents |
|------|----------|
| [versions-v3.14.md](./versions-v3.14.md) | **v3.14.0** — Swing signal persistence + performance tracking (45-day expiry, direction-aware targets/stops) + worker-logs tab + spec-driven development workflow |
| [versions-v3.13.md](./versions-v3.13.md) | **v3.13.0** — DB-backed Swing AI analysis job: durable `SwingAnalysisJob` replaces the volatile cache-only fire-and-forget (pre-scan DB lookup, atomic `updateMany` claim, supersede-abort, stale recovery 45 min / 2 attempts, cron-daemon 60s resync drain) |
| [versions-v3.12.md](./versions-v3.12.md) | **v3.12.0** — Swing tab prod failure FIX (request-time split — async AI analysis; Netlify 30s request wall) + prod-stability batch (perf live-price fallback, prod `daily_prices` backfill 21,195 bars, heartbeat-aware reaper, Prisma query timeout, worker-logger tmpdir fallback, error serialization) |
| [versions-v3.11.md](./versions-v3.11.md) | **v3.11.0–v3.11.3** — in-process node-cron daemon (replaces Netlify scheduled functions) + `daysTracked` 500 fix + carried v3.10.1 batch · no-fake-HOLD Today's Picks (partial persistence) · `recommendationsCache` globalThis singleton · full serverless purge (persistent-server reality, Blob logging removed, DataFetcher test un-skip) |
| [versions-v3.10.md](./versions-v3.10.md) | **v3.10.0** — historical-price sync job into `daily_prices` (Swing indicators "—" fix) + `backtest_history` prod-gap FIX (lazy DDL `ensureBacktestHistoryTable`) |
| [versions-v3.9.md](./versions-v3.9.md) | **v3.9.0–v3.9.1** — Swing Trading Signals tab (34 swing screeners, family segregation, AI LONG/SHORT/OBSERVE) + NSE chart buttons + `analysisStatus` honesty fix |
| [versions-v3.8.md](./versions-v3.8.md) | **v3.8.0** — AI pre-flight gate + cron spawn dedup + stale-task reaping + cron-ledger dedupe + 8192 maxTokens default + `getPromptTimeoutMs` |
| [versions-v3.7.md](./versions-v3.7.md) | **v3.7.0–v3.7.3** — F&O Analytics UI + NSE option-chain-v3 migration + MCP `getOptionChain`/`getFoExpiries` · BUY/SELL-only Telegram broadcast + AI connection-test cron · Netlify secrets-scan fix + credential-literal masking |
| [versions-v3.6.md](./versions-v3.6.md) | **v3.6.0–v3.6.4** — password-reset-request auth flow + daily market-sync cron + zeroed-dividend-cards fix · recs-tab default sorts + perf price bridge + AI context enrichment + pen/perf plans · dividend TZ fix · page redesign + IPO issue size + NSE events feed + AI IPO report v2 (JSON) + MCP/Telegram |
| [versions-v3.5.md](./versions-v3.5.md) | **v3.5.0–v3.5.7** — perf tracking/archival + backfill · target/SL ₹0 fix + SSE wiring · TV `change`=% fix · Playwright e2e suite + CI · stale-recs AI config + cron ledger · Chartink capture → DB · Chartink 117-registry + TV fallback · auth join fix + server logs + credentials hygiene + llms.txt |
| [versions-v3.4.md](./versions-v3.4.md) | **v3.4.0–v3.4.3** — Telegram bot admin + user Profile · prod fixes (chunk timeout, top-50 cap, AI monitoring persistence) · subsystem architecture docs + versioned `.githooks` |
| [versions-v3.3.md](./versions-v3.3.md) | **v3.3.0–v3.3.1** — daily recommendations engine (Chartink + TradingView hybrid, AI agent) + self-heal AI + audit logging |
| [versions-v3.2.md](./versions-v3.2.md) | **v3.2.0** — Telegram bot (@tradenext6Bot) + corp-actions price/yield fix |
| [versions-v3.1.md](./versions-v3.1.md) | **v3.1.0** — risk metrics (Sharpe, max DD, beta, win rate) + benchmark overlay |
| [versions-v3.0.md](./versions-v3.0.md) | **v3.0.0** — CSV export + portfolio value history + P&L timeline chart |

## Legacy major indexes

| File | Contents |
|------|----------|
| [versions-v2.md](./versions-v2.md) | v2 per-minor index → [versions-v2.2.md](./versions-v2.2.md) · [versions-v2.1.md](./versions-v2.1.md) |
| [versions-v1.md](./versions-v1.md) | v1 per-minor index → [versions-v1.16.md](./versions-v1.16.md) … [versions-v1.8.md](./versions-v1.8.md) |
