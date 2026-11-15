# Primer.md - Session Tracking

> Agent reads this at the start of every session to understand current state and progress
> âš ï¸ IMPORTANT: After completing ANY task, you MUST update documentation (@AGENTS.md, @Primer.md, @agent-memory.md, @Lessons.md). See @Lessons.md Lesson 20 for details.
> ðŸ”„ Handoff System: Read `@HANDOFF.md` for orchestration state and `.agents/handoffs/active/latest.md` for current session handoff.

## Last Updated

2026-11-15 — **Spec 43 prediction targets & `analysisMode` (v3.58.0, `feature/spec-43-prediction-targets`, commit prep)**: per-stock AI vs Prediction targets across Swing+Daily (DB/schema migration `20261115160000_add_analysis_mode_prediction_targets`, mirror/push sinks, fallback/agents, services/APIs/UI, Telegram/broadcast, exports/Sheets, bounded/idempotent perf backfill). No "AI targets off"/targetless states; daily fallback never HOLD; swing auto prediction on load. **Gates:** targeted Jest 174/174, lint 0 errors, tsc 46 baseline-aware, doc budget OK, quickbuild 202/202. Spec 43 commit requested; Tracks 1–4 sequenced after commit.

## Current Status

- **Branch:** `feature/spec-43-prediction-targets` (includes merged PR #155 / v3.57.0 baseline; Spec 43 implementation uncommitted, commit prep in progress)
- **Spec 43:** spec/plan approved; implementation present (schema+migration, persistence, fallback/agents, daily+swing propagation, APIs/UI, Telegram/exports/Sheets, perf backfill) + targeted verification green.
- **Next (approved sequence):** commit Spec 43, then Track 1 (outbound notification tracking) → Track 2/3 (unified notifications + admin UI/history) → Track 4 (sync prepare-for-deploy with `worker_tasks` + workers visibility fix) with PR screenshots.
- **Blocked/carry-forward:** S2 prod Prisma-Remote diagnostics; Archify/Graphify installs/diagrams require explicit package/tool-install permission; no push/merge/deploy without explicit request (`WORKER_DISPATCH_SECRET` required before deploy).

## Recent Sessions (summary)

- **2026-11-15**: Skill consolidation to `.agents/skills` (format A), WebMCP skill/agent, rules/commands/agents/orchestration/handoff updates, 3 lib fixes + targeted validation, docs updated, commit/push/PR update.
- **2026-11-08**: Spec 42 implementation complete (Netlify scheduled/background worker/cron, bounded runner, DR checkpointing, runtime observability). Gates passed (2144 pass, 0 fail / tsc prod 0 / lint 0 / quickbuild 202/202).
- **2026-11-05**: PR #154 follow-up (Sheets JSX/exporter fixes, Swing publish outside AI failure path, daily rec task outcome telemetry, recovery probe amplification fix).
- **2026-11-04**: Spec 40/41 runtime visibility + Sheets diagnostics groundwork.

> Detailed historical log moved to `.agents/session-archive/primer-history-archive.md`.
