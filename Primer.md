# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> âš ï¸ IMPORTANT: After completing ANY task, you MUST update documentation (@AGENTS.md, @Primer.md, @agent-memory.md, @Lessons.md). See @Lessons.md Lesson 20 for details.
> ðŸ”„ Handoff System: Read `@HANDOFF.md` for orchestration state and `.agents/handoffs/active/latest.md` for current session handoff.

## Last Updated

2026-11-15 — **v3.57.0 (PR #155, `feature/spec-42-durable-worker-cron-v2`)**: consolidated all skills to canonical `.agents/skills/<name>/SKILL.md` (format A), removed legacy `.opencode/skills`, added WebMCP skill/agent, and optimized agent/rules/commands/orchestration + session continuation/handoff docs. Landed targeted fixes: daily rec performance no-price `lastCheckedAt` stamping (mirror + best-effort Prisma, breaker-guarded), index/NIFTY TOTAL MARKET fallback+diagnostics, worker index-aware sync errors. **Validation:** targeted Jest 36/36 (`worker-service`, `historicalPriceSyncService`, `googleSheetsRescanTask`), `npm run lint` 0 errors, `tsc` baseline unchanged for changed prod libs. **Blocked:** S2 prod Prisma-Remote diagnostics (approval/tool unavailable). Spec 42 implementation remains complete; commit/push/PR update done on explicit request. `WORKER_DISPATCH_SECRET` required in Netlify before deploy; user controls merge/deploy.

## Current Status

- **Branch:** `feature/spec-42-durable-worker-cron-v2` (PR #155)
- **Spec 42:** implementation complete (handlers, bounded runner, DR checkpointing, Netlify split, DB Health runtime observability) — no schema/migration/package/env changes in this increment beyond code/docs/skill consolidation.
- **v3.57.0:** canonical `.agents/skills` source of truth, WebMCP integration docs/agent, orchestration/handoff/continuation rule updates, targeted rec/index/worker fixes.
- **Blocked follow-up:** S2 prod read-only diagnostics (stale recs/perf `lastCheckedAt`, 2026-11-04 AI-unavailable, `NIFTY TOTAL MARKET`) pending Prisma-Remote approval/tool access.

## Recent Sessions (summary)

- **2026-11-15**: Skill consolidation to `.agents/skills` (format A), WebMCP skill/agent, rules/commands/agents/orchestration/handoff updates, 3 lib fixes + targeted validation, docs updated, commit/push/PR update.
- **2026-11-08**: Spec 42 implementation complete (Netlify scheduled/background worker/cron, bounded runner, DR checkpointing, runtime observability). Gates passed (2144 pass, 0 fail / tsc prod 0 / lint 0 / quickbuild 202/202).
- **2026-11-05**: PR #154 follow-up (Sheets JSX/exporter fixes, Swing publish outside AI failure path, daily rec task outcome telemetry, recovery probe amplification fix).
- **2026-11-04**: Spec 40/41 runtime visibility + Sheets diagnostics groundwork.

> Detailed historical log moved to `.agents/session-archive/primer-history-archive.md`.
