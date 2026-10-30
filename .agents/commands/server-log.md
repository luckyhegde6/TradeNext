# Server Log Command

> Triage, clean, and format TradeNext server logs (raw Netlify/function logs + DB/file layers).

## Usage

```
/server-log [source] [window]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `source` | - | Which layer to analyze | `raw` (default; `29Oct.log`-style), `db` (ServerLog), `file` (worker logs), `all` |
| `window` | - | Time window | e.g. `2026-10-28`, `24h`, `last-week` |

### Examples

```
/server-log raw 2026-10-28
/server-log db last-week
/server-log all 24h
```

## Workflow

### 1. Locate source
- **raw**: repo-root `29Oct.log`, `15OctProdlog..txt`, or `logs/<YYYY-MM>/<YYYY-MM-DD>.log`.
- **db**: `/api/admin/monitoring?type=db-logs`, `/api/system/events`, `/api/admin/ai/monitoring`, `/api/admin/db-health`.

### 2. Clean & format (raw)
- Strip noise: boot `Duration:`/`Memory Usage:`, `Running next.config took`, raw Web Vitals (unless perf), duplicate uploads, raw auth chatter.
- Keep structured `msg=` lines; normalize UTC ISO vs IST (IST = UTC+5:30).
- Group by subsystem: cron / task / ai / chartink / sqlite / auth / db / infra.

### 3. Triage playbook
| Symptom | First grep on cleaned log |
|---|---|
| "not firing" | `Cron job due, spawning task`, `catch-up enqueued`, `cron resync deferred`, `Scheduled cron job` |
| AI all-HOLD / silent | `AI Connection Test`, `Daily recommendation run starting`, `skipAi`, `aiSuccess:false`, OpenRouter 402/429 |
| Task stuck / reaped | `Executing task`, `task timed out`, `Reaped by worker`, `task ran past 45 min` |
| DB ops / plan-limit | `Plan limit circuit breaker open`, `fetch failed`, `P6003`, `db_health`, `flushWriteBehind`, degraded mode |
| NSE / market sync | `market_data`, `a is not iterable`, `getIndexStocks`, NSE fetch errors |

### 4. Write cleaned artifact
- `logs/2026-10/YYYY-MM-DD-agent-clean.md` (cleaned + agent-readable; raw stays untouched).

### 5. Report
- Findings, cleaned-artifact path, root cause, fix status, watch points.

## Verification

- [ ] Raw log re-read for incident window (UTC vs IST cross-check)
- [ ] Cleaned artifact written + committed
- [ ] Root cause → fix landed in same PR; cleaned log committed alongside
