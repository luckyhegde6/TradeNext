---
name: server-log-analysis
description: Server-side log triage and cleanup workflow for TradeNext - parse raw Netlify/function logs, strip noise, extract key events, add skills for log-driven debugging
metadata:
  audience: agents
  workflow: observability
---

# Server Log Analysis Skill

Systematic workflow for triaging, cleaning, and formatting TradeNext server logs so agents can read them efficiently and add durable log-analysis capability.

## 1. Source map (where logs live)

| Source | Path | Format | Notes |
|--------|------|--------|-------|
| **Raw Netlify function logs** | Repo root: `29Oct.log`, `15OctProdlog..txt` | text with `<Mon DD, hh:mm:ss AM>: <hash> [LEVEL] <UTC ISO> \| <emoji> <LEVEL> \| msg=...` | Captured from Netlify; UTC ISO inside structured lines |
| **File logs (runtime)** | `.next/server_logs/*.log`, `worker_logs/<taskId>.log` | pino pretty | Fall back to DB `ServerLog` when FS unavailable (serverless) |
| **DB logs** | `ServerLog` table (`source`: nse\|worker\|ai\|api\|system\|sync\|auth) | rows | Primary on serverless; 7-day retention |
| **HTTP logs** | `APIRequestLog` | rows | method/path/status/duration |
| **Unified events** | `UnifiedEvent` | rows | telegram\|ai_agent\|screener\|system_health\|audit |
| **Health metrics** | `SystemHealthLog` | rows | ai_response_time, screener_duration, delivery_rate, db_query_time, uptime |

Full design: `.agents/docs/monitoring-and-logging.md`.

## 2. Raw log line taxonomy (what to keep / drop)

- **KEEP**: structured pino lines with meaningful `msg=` fields (`msg=Cron job due, spawning task...`, `msg=Executing task...`, `msg=Daily recommendation run starting...`, `msg=AI ...`, `msg=...error...`).
- **DROP (noise)**: boot lines `<Mon DD, hh:mm:ss AM>: <hash> Duration: xxx ms\tMemory Usage: yyy MB`, `✓ Running next.config took xms`, raw `Web Vitals metric received...` (unless chasing perf), duplicate mirror-snapshot uploads, raw auth-session chatter (keep the login SUCCESS/Failure outcome).
- **KEEP as WARN**: `Live Chartink fetch failed, TV fallback, ... error=Chartink scan HTTP 419` — high volume, keep counts (`templates=117`, per-template list), not per-failure detail.

## 3. Cleaning & formatting protocol

```
1. Extract structured lines (those containing `msg=`).
2. Strip noise lines (Duration/Memory, next.config, Web Vitals unless perf-investigating).
3. Normalize timestamps: keep both local prefix + UTC ISO from the structured payload.
4. Group by subsystem: cron / task / ai / chartink / sqlite / auth / db / infra.
5. Write cleaned artifact: logs/2026-10/YYYY-MM-DD-agent-clean.md (or docs/logs/<date>-clean.md).
6. Keep the raw file untouched — cleaned version is additive, never a rewrite of evidence.
```

## 4. Triage playbook (highest-frequency incidents)

| Symptom (dashboard / user report) | First grep on cleaned log |
|---|---|
| "not firing" / no runs | `Cron job due, spawning task`, `Recommendations catch-up enqueued`, `cron resync deferred`, `Scheduled cron job` |
| AI all-HOLD / silent | `AI Connection Test`, `Daily recommendation run starting`, `skipAi`, `aiSuccess:false`, OpenRouter 402/429 |
| Task stuck / reaped | `Executing task`, `task timed out`, `Reaped by worker`, `task ran past 45 min` |
| DB ops / plan-limit hold | `Plan limit circuit breaker open`, `fetch failed`, `P6003`, `db_health`, `flushWriteBehind`, degraded mode lines |
| NSE / market sync failure | `market_data`, `a is not iterable`, `getIndexStocks`, NSE fetch errors |

## 5. Netlify-specific realities

- Netlify suspends idle instances ~2h → node-cron ticks stop silently; daemon runs on persistent host / Netlify Functions via `instrumentation.ts` (`CRON_DAEMON_DISABLED=1` opt-out).
- Netlify function gateway ~30s wall → long tasks must go through worker task queue (async), never in-request.
- File logs are ephemeral on serverless → use DB layers for durable triage; use file logs for local dev.
- Netlify MCP tools (`@netlify/mcp`) available for deploy/site/log queries when wired; skill usage: `npx -y @netlify/mcp` server config (currently `enabled:false` in `.opencode/opencode.json` — flip when needed).

## 6. Verification before declaring "log reviewed"

1. Raw log re-read for the incident window (cross-check UTC vs IST: IST = UTC+5:30).
2. Cleaned artifact written and committed.
3. Root cause traced to code path; fix landed in same PR; cleaned log committed alongside.

## Checklist

- [ ] Locate raw log (`29Oct.log` naming pattern) + relevant date window
- [ ] Strip noise, keep structured `msg=` events
- [ ] Group by subsystem + write cleaned artifact
- [ ] Triage via playbook table above
- [ ] Cross-check UTC/IST before concluding
- [ ] Add new learnings to the skill if a pattern repeats
