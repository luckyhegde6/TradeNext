# TradeNext Changelog

> Full version history + legacy feature docs (moved here from AGENTS.md 2026-08-06). **AGENTS.md keeps only a compact version table** — this directory is the source of detail.
>
> **Reading guidance**: load only the subfile you need (e.g. v3.x for recent work), never the whole directory.

## Index

| File | Contents |
|------|----------|
| [versions-v3.md](./changelog/versions-v3.md) | v3.7.3 → v3.0.0 (credential-literal masking follow-up — `Lessons.md` + hook block-lists assembled at runtime, pushed direct to main; Netlify secrets-scan build-failure fix — `.githooks` omit path + app hygiene (example telegram token/chatId/code placeholders no longer look like secrets) + live-verify finding: tradenext6.netlify.app stale (v3.6.3/v3.7.x not deployed, deploy on hold); BUY/SELL-only Telegram broadcast + AI connection-test cron w/ fallback probing + audit/status + CI e2e fix; F&O Analytics UI complete + NSE option-chain-v3 migration + MCP getOptionChain/getFoExpiries — 28 functions; IPO Issue Size — shares per lot + ₹ per lot — + NSE events feed + AI IPO report v2 JSON + MCP/Telegram IPO commands; direction-aware target/SL evaluation — ITC SELL bug + Recommendations sidebar/IPOs-status-sections redesign; DividendCalendar timezone fix; password-reset-request auth flow + daily market-sync cron + zeroed-dividend-cards fix; auth join→approve→login fix + server logs `logs/` dir + **`DEFAULT_PASSWORD` env var + credential-masking git hooks + README rewrite + `app/llms.txt`/robots LLM-discovery**; Chartink 117-registry PRIMARY + TV fallback unified runner; Chartink template capture → DB: 3 Prisma models + Playwright capture tool + sync service; AI config plumbing fix + cron ledger fix + session memory infra, Playwright e2e suite, screener `change`=% fix, target/SL ₹0 fix + SSE live prices, recommendation performance & archival, Telegram bot, recommendations engine, risk metrics, CSV export) |
| [versions-v2.md](./changelog/versions-v2.md) | v2.2.0 → v2.1.0 (alert engine, admin alert config, 98 screener templates) |
| [versions-v1.md](./changelog/versions-v1.md) | v1.16.1 → v1.0.0 (advanced screener, agent handoff, MCP API, security, workers) |
| [changelog/screener.md](./changelog/screener.md) | Screener & backtest deep-dive (v1.16.0 FilterBuilder/BacktestDialog, v1.10.0 enhancement) |
| [changelog/corp-actions.md](./changelog/corp-actions.md) | Corporate actions (dedup fix, NSE field fix, enhanced UI, management) |
| [changelog/serverless-logging.md](./changelog/serverless-logging.md) | Serverless logging (ServerLog/db-logger, Netlify Blobs, 502 fix) |
| [changelog/security-workers.md](./changelog/security-workers.md) | Security (cookies/sessions), cron/workers, historical sync, tested features |

---

