# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> âš ï¸ IMPORTANT: After completing ANY task, you MUST update documentation (@AGENTS.md, @Primer.md, @agent-memory.md, @Lessons.md). See @Lessons.md Lesson 20 for details.
> ðŸ”„ Handoff System: Read `@HANDOFF.md` for orchestration state and `.agents/handoffs/active/latest.md` for current session handoff.

## Last Updated

2026-11-26 — **Netlify deploy fix — function upload limit cleared (v3.59.0)**: `worker-runner-background` zip 430.15MB → **65.24MB**; `__csp-violations` → 162.59MB (< 250MB); `___netlify-server-handler` 48.06MB (already OK). Fixes: netlify.toml `[functions] external_node_modules`, plugin 5.16.9 patches, `scripts/predeploy/prune-standalone.mjs` (deletes `.next/cache/turbopack` ~260MB, `.next/standalone/worker_logs`, all `*.js.map`), `scripts/cleanup-logs.mjs` (772.6MB removed; 15d/50MB cap). Local build run 3 (`npx netlify build`): Functions bundling completed; functions now fit. Known remaining issue: `___netlify-edge-handler-node-middleware` Windows edge-runtime path bug (pre-existing, blocked).

## Current Status

- **Branch:** `feature/spec-43-prediction-targets` (includes merged PR #155 / v3.57.0 baseline; Spec 43 implementation uncommitted, commit prep in progress)
- **Spec 43:** spec/plan approved; implementation present (schema+migration, persistence, fallback/agents, daily+swing propagation, APIs/UI, Telegram/exports/Sheets, perf backfill) + targeted verification green.
- **Next (approved sequence):** commit Spec 43, then Track 1 (outbound notification tracking) → Track 2/3 (unified notifications + admin UI/history) → Track 4 (sync prepare-for-deploy with `worker_tasks` + workers visibility fix) with PR screenshots.
- **Blocked/carry-forward:** S2 prod Prisma-Remote diagnostics; Archify/Graphify installs/diagrams require explicit package/tool-install permission; no push/merge/deploy without explicit request (Spec 42 standalone worker + `WORKER_DISPATCH_SECRET` removed in 250MB fix).

## Recent Sessions (summary)

- **2026-11-26**: Deploy fix — functions under 250MB (worker-runner-background 430MB→65MB, __csp-violations 162MB); logs cleaned (772MB); netlify.toml externals + plugin patches + prune script; local `npx netlify build` run 3 green on functions bundling. Known remaining: edge function Windows path bug.
- **2026-11-15**: Skill consolidation to `.agents/skills` (format A), WebMCP skill/agent, rules/commands/agents/orchestration/handoff updates, 3 lib fixes + targeted validation, docs updated, commit/push/PR update.
- **2026-11-08**: Spec 42 implementation complete (Netlify scheduled/background worker/cron, bounded runner, DR checkpointing, runtime observability). Gates passed (2144 pass, 0 fail / tsc prod 0 / lint 0 / quickbuild 202/202).
- **2026-11-05**: PR #154 follow-up (Sheets JSX/exporter fixes, Swing publish outside AI failure path, daily rec task outcome telemetry, recovery probe amplification fix).
- **2026-11-04**: Spec 40/41 runtime visibility + Sheets diagnostics groundwork.

> Detailed historical log moved to `.agents/session-archive/primer-history-archive.md`.
