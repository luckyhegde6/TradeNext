# Server Log Analysis Skill

Systematic workflow for triaging, cleaning, and formatting TradeNext server logs so agents can read them efficiently.

Source: `.opencode/skills/server-log-analysis/SKILL.md`

## 1. Source map

| Source | Path | Notes |
|--------|------|-------|
| Raw Netlify function logs | Repo root: `29Oct.log`, `15OctProdlog..txt` | `<Mon DD, hh:mm:ss AM>: <hash> [LEVEL] <UTC ISO> \| msg=...` |
| File logs (runtime) | `.next/server_logs/*.log`, `worker_logs/<taskId>.log` | pino pretty; fall back to DB `ServerLog` on serverless |
| DB logs | `ServerLog` table (`source`: nse/worker/ai/api/system/sync/auth) | 7-day retention; primary on serverless |
| HTTP logs | `APIRequestLog` | method/path/status/duration |
| Unified events | `UnifiedEvent` | telegram/ai_agent/screener/system_health/audit |
| Health metrics | `SystemHealthLog` | ai_response_time, screener_duration, delivery_rate, db_query_time, uptime |

Design: `.agents/docs/monitoring-and-logging.md`.

## 2. Line taxonomy

- **Keep**: structured lines with meaningful `msg=`.
- **Drop**: boot noise (`Duration:`, `Memory Usage:`, `Running next.config took`), Web Vitals (unless perf), duplicate mirror uploads, raw auth chatter (keep outcome).
- **Warn-level keep**: Chartink `Live Chartink fetch failed, TV fallback, ... error=Chartink scan HTTP 419`.

## 3. Cleaning protocol

```
1. Extract structured lines (contain `msg=`).
2. Strip noise.
3. Normalize: local prefix + UTC ISO.
4. Group by subsystem: cron/task/ai/chartink/sqlite/auth/db/infra.
5. Write cleaned artifact: logs/2026-10/YYYY-MM-DD-agent-clean.md.
6. Never rewrite raw evidence; cleaned file is additive.
```

## 4. Triage playbook (symptom → first grep)

- "not firing" → `Cron job due, spawning task`, `Recommendations catch-up enqueued`, `cron resync deferred`, `Scheduled cron job`.
- AI all-HOLD/silent → `AI Connection Test`, `Daily recommendation run starting`, `skipAi`, `aiSuccess:false`, OpenRouter 402/429.
- Task stuck/reaped → `Executing task`, `task timed out`, `Reaped by worker`, `task ran past 45 min`.
- DB ops / plan-limit → `Plan limit circuit breaker open`, `fetch failed`, `P6003`, `db_health`, `flushWriteBehind`, degraded mode.
- NSE/market sync → `market_data`, `a is not iterable`, `getIndexStocks`, NSE fetch errors.

## 5. Netlify realities

- Idle suspension ~2h → silent node-cron stop; daemon via `instrumentation.ts` (`CRON_DAEMON_DISABLED=1` opt-out).
- Function gateway ~30s wall → long tasks via worker task queue (async), never in-request.
- File logs ephemeral on serverless → DB layers for durable triage; file logs for local dev.

## 6. Verify before declaring "log reviewed"

1. Re-read raw log for incident window (cross-check UTC vs IST: IST = UTC+5:30).
2. Cleaned artifact written + committed.
3. Root cause → fix landed in same PR; cleaned log committed alongside.

Source: `.opencode/skills/server-log-analysis/SKILL.md`
