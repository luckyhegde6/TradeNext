---
name: server-log-analysis
description: Triage, clean, and analyze server logs from Netlify function logs, DB logs, and local worker logs. Includes Netlify MCP tool integration for live server queries and log retrieval.
metadata:
  audience: agents
  workflow: observability
---

# Server Log Analysis Skill

A systematic workflow for triaging, cleaning, and formatting TradeNext server logs so agents can debug issues accurately and efficiently.

## 1. Log Sources & Architecture

| Source | Path / Interface | Format | Description & Purpose |
|--------|------------------|--------|-----------------------|
| **Raw Netlify Logs** | Root (`29Oct.log`, `15OctProdlog..txt`) or Netlify MCP | Text with `<Date/Time>: <request-id> <LEVEL> <UTC-ISO> \| msg=...` | Live serverless function execution traces, cold starts, cron executions |
| **Netlify MCP** | MCP server (`@netlify/mcp`) | Interactive tools | Query site details, recent deploys, build logs, and function outputs |
| **Worker Logs** | `worker_logs/<taskId>.log` | Line-delimited JSON / text | Execution log for specific worker tasks |
| **Server DB Logs** | `ServerLog` table | SQL table | 7-day retention of internal subsystem logs (`source`: nse, worker, ai, api, system) |
| **Cleaned Artifacts** | `logs/YYYY-MM/YYYY-MM-DD-agent-clean.md` | Markdown | Distilled, agent-readable incident timeline with noise removed |

## 2. Using Netlify MCP for Log & Deploy Analysis

When `@netlify/mcp` is active in `.opencode/opencode.json` or as an MCP server:
- Check recent deploys and deployment statuses to correlate server errors with new releases.
- Query function logs directly to monitor in-flight background tasks.
- Verify environment variables (e.g. checking whether fallback models or external API keys are configured) without exposing secrets.

## 3. Log Line Taxonomy (What to Keep vs. What to Drop)

When processing raw logs like `29Oct.log`:
- **KEEP (High Signal)**:
  - Structured pino logs containing `msg=...` (e.g. `msg=Cron job due, spawning task`, `msg=Executing task`, `msg=Daily recommendation run starting`, `msg=AI ...`).
  - Error and warning lines (`ERROR`, `WARN`, `CircuitBreakerError`, `HTTP 402`, `HTTP 419`, `P6003`, Accelerate probe failures).
  - Leader lock acquisitions/losses (`role=worker`, `role=cron-daemon`, `role=sqlite-sync`).
  - Worker task lifecycle events (`task_started`, `task completed`, `reaped`, `timed out`).
- **DROP (Noise)**:
  - Container metric lines: `Duration: xxx ms\tMemory Usage: yyy MB`.
  - Next.js config boot lines: `✓ Running next.config took xms`.
  - Client web vitals reports (`msg=Web Vitals metric received...`) unless specifically analyzing frontend latency.
  - Periodic duplicate mirror snapshot uploads (`msg=SQLite: mirror snapshot uploaded to Blobs`).

## 4. Cleaning & Formatting Protocol

```text
1. Read the raw log file or fetch logs via Netlify MCP.
2. Filter for structured lines containing `msg=` or error markers.
3. Align timestamps: note both the local header timestamp (often IST) and the inner UTC ISO timestamp (IST = UTC + 5:30).
4. Group by subsystem:
   - Cron Daemon & Scheduler
   - Worker Engine & Task Execution
   - Daily Recommendations Pipeline & Screeners
   - AI Analysis & LLM Providers (OpenRouter status/credits)
   - Database / Accelerate / SQLite Mirror
5. Generate the cleaned artifact at `logs/YYYY-MM/YYYY-MM-DD-agent-clean.md`.
6. Retain raw logs untouched for auditability.
```

## 5. Triage Playbook (Common TradeNext Symptoms)

| Symptom | Diagnostic Grep in Log | Root Cause & Remediation |
|---|---|---|
| **"Cron not firing / No runs in history"** | `Cron job due, spawning task`, `Daily recommendation run starting` | Check if cron ticked but spawned task got stuck, or if container suspended mid-execution. Verify if `DailyRecommendationRun` reached Prisma or only SQLite mirror. |
| **"Run failed / 0 stocks / 0 AI analyzed"** | `AI pre-flight FAILED`, `Insufficient credits`, `402`, `429` | OpenRouter credits exhausted or daily free quota latched. Check fallback chain (`config.ts`, `modelChain.ts`). |
| **"Task running forever / busy worker"** | `Executing task`, `STALE_MS`, `Reaped by worker`, `task timed out` | Worker container frozen by Netlify timeout or Accelerate query hung past deadline. Check `TASK_TIMEOUT_MS` and liveness heartbeat. |
| **"Accelerate timeout / DB unavailable"** | `Accelerate probe failed`, `Prisma query WorkerStatus timed out` | Accelerate network degradation or plan limit hold (`P6003`). Verify degraded mode switch and SQLite fallback. |
| **"Chartink scan HTTP 419"** | `Live Chartink fetch failed, TV fallback` | Chartink CSRF/session block; verify TradingView fallback is taking over properly. |

## 6. Verification Checklist

- [ ] Timestamps cross-checked between IST and UTC (IST = UTC + 5h30m).
- [ ] Task IDs correlated from Cron trigger -> Worker execution -> Task completion/failure.
- [ ] Cleaned markdown artifact saved to `logs/YYYY-MM/YYYY-MM-DD-agent-clean.md`.
- [ ] Findings and actions clearly documented for pair-programming agent or human review.
