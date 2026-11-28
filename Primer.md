# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> âš ï¸ IMPORTANT: After completing ANY task, you MUST update documentation (@AGENTS.md, @Primer.md, @agent-memory.md, @Lessons.md). See @Lessons.md Lesson 20 for details.
> ðŸ”„ Handoff System: Read `@HANDOFF.md` for orchestration state and `.agents/handoffs/active/latest.md` for current session handoff.

## Last Updated

2026-11-29 — **v3.60.0 — Netlify 250MB fix + production 500 recovery**: removed Spec 42 standalone worker functions + `WORKER_DISPATCH_SECRET` (worker/task/cron in-process on Node.js), removed `external_node_modules` and `scripts/predeploy/prune-standalone.mjs` (its `[turbopack]_runtime.js` patch caused Linux SSR `ChunkLoadError` → 500 on an otherwise `ready` prod deploy `main@35783f6`), pinned `@netlify/plugin-nextjs@5.15.8` via file-based config + `$schema`. New `netlify-deploy-debug` skill + Lesson 174. Branch `fix/netlify-250mb-remove-externals`; PR to be created/updated by user request. No prod deploy/merge by agent.

2026-11-26 — **Netlify deploy fix — function upload limit cleared (v3.59.0)**: `worker-runner-background` zip 430.15MB → **65.24MB**; `__csp-violations` → 162.59MB (< 250MB); `___netlify-server-handler` 48.06MB (already OK). Fixes: netlify.toml `[functions] external_node_modules`, plugin 5.16.9 patches, `scripts/predeploy/prune-standalone.mjs` (deletes `.next/cache/turbopack` ~260MB, `.next/standalone/worker_logs`, all `*.js.map`), `scripts/cleanup-logs.mjs` (772.6MB removed; 15d/50MB cap). Local build run 3 (`npx netlify build`): Functions bundling completed; functions now fit. Known remaining issue: `___netlify-edge-handler-node-middleware` Windows edge-runtime path bug (pre-existing, blocked).

## Current Status

- **Branch:** `fix/netlify-250mb-remove-externals` (v3.60.0; Netlify 250MB + 500 fix; PR requested, no merge/deploy by agent)
- **Spec 43:** spec/plan approved; implementation present (schema+migration, persistence, fallback/agents, daily+swing propagation, APIs/UI, Telegram/exports/Sheets, perf backfill) + targeted verification green.
- **Next (approved sequence):** commit Spec 43, then Track 1 (outbound notification tracking) → Track 2/3 (unified notifications + admin UI/history) → Track 4 (sync prepare-for-deploy with `worker_tasks` + workers visibility fix) with PR screenshots.
- **Blocked/carry-forward:** user must merge/deploy the v3.60.0 fix to recover prod 500 (agent does not deploy); verify prod HTTP 200 + function logs after deploy; S2 prod Prisma-Remote diagnostics; no merge/deploy without explicit request.

## Recent Sessions (summary)

- **2026-11-29**: Bisected from `a5daee9` with Netlify MCP/CLI previews; removed worker chain + secret, pinned plugin 5.15.8, fixed 500 by removing `prune-standalone.mjs`; added `netlify-deploy-debug` skill, Lesson 174, v3.60.0 docs. Prod `main@35783f6` ready but 500 until this fix is deployed.
- **2026-11-26**: Deploy fix — functions under 250MB (worker-runner-background 430MB→65MB, __csp-violations 162MB); logs cleaned (772MB); netlify.toml externals + plugin patches + prune script; local `npx netlify build` run 3 green on functions bundling. Known remaining: edge function Windows path bug.
- **2026-11-15**: Skill consolidation to `.agents/skills` (format A), WebMCP skill/agent, rules/commands/agents/orchestration/handoff updates, 3 lib fixes + targeted validation, docs updated, commit/push/PR update.
- **2026-11-08**: Spec 42 implementation complete (Netlify scheduled/background worker/cron, bounded runner, DR checkpointing, runtime observability). Gates passed (2144 pass, 0 fail / tsc prod 0 / lint 0 / quickbuild 202/202).
- **2026-11-05**: PR #154 follow-up (Sheets JSX/exporter fixes, Swing publish outside AI failure path, daily rec task outcome telemetry, recovery probe amplification fix).
- **2026-11-04**: Spec 40/41 runtime visibility + Sheets diagnostics groundwork.

> Detailed historical log moved to `.agents/session-archive/primer-history-archive.md`.
