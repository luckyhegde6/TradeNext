# v3.57.0 — Skills consolidation (.agents canonical), WebMCP agent/skill, rec/index reliability fixes

**Date:** 2026-11-15  
**Branch:** `feature/spec-42-durable-worker-cron-v2` (PR #155)  
**Status:** CODE + DOCS + TARGETED TESTS DONE (commit/push/PR update performed on explicit user request). Prod Prisma-Remote diagnostics (S2) blocked by approval/tool availability; no prod DB mutations.

## Summary
Consolidated all skills into `.agents/skills/<name>/SKILL.md` (format A, optional `references/`) as the single source of truth for humans/LLMs, removed legacy `.opencode/skills`, added WebMCP integration artifacts, optimized agent/rule/command/orchestration and session handoff/continuation guidance, and landed targeted Daily Recommendations/Performance/index/worker reliability fixes with focused validation.

## Changes

### 1) Skills consolidation (canonical `.agents/skills`, format A)
- Migrated/normalized skills to `.agents/skills/*/SKILL.md`: `bug-finder`, `docs-updater`, `docs-workflow`, `nse-integration`, `playwright-cli` (+ `references/`), `playwright-debug`, `playwright-e2e`, `server-log-analysis`, `ux-enhancer`, `wiki-creator`, `webmcp` (new).
- Canonicalized `nse-integration` from richer `.agents` content and added frontmatter.
- Removed legacy tracked `.opencode/skills/**` and superseded root `.agents/skills/*.md` mirrors to avoid confusion.
- Updated repo references and mappings to `.agents/skills/...` (including `.opencode/opencode.json` command template, `AGENTS.md`, `.agents/AGENT-SKILL-MATRIX.md`, `.agents/INDEX.md`, agent profiles, docs, changelog/session archives, memory/primer notes where applicable).

### 2) WebMCP support
- **NEW** `.agents/skills/webmcp/SKILL.md` — WebMCP (`document.modelContext`) tool design/integration guidance (client-only, schema-driven, secure/auth-aware).
- **NEW** `.agents/agents/webmcp-integrator.md` — agent profile, workflow, handoff triggers, and canonical skill/tool usage.

### 3) Agent/rules/commands/orchestration and session continuity
- Updated agent profiles (`bug-hunter`, `doc-writer`, `e2e-agent`, `qa`, `ux-designer`, `wiki-publisher`, `orchestrator`) and added `webmcp-integrator` with canonical skill/tool mappings.
- Updated `.agents/rules/session-memory-rules.md` (session start + work continuation/resume checklist, handoff-before-stop/`Resume from` pointers, orchestration/subagent guidance).
- Updated `.agents/commands/orchestrate.md` (resume-first flow, required output fields including `Verified`/`Resume from`, canonical `.agents/skills` usage).
- Updated `.agents/rules/README.md` and `.agents/AGENT-SKILL-MATRIX.md` (canonical format-A skills, `webmcp`, `/server-log` mapping, new-skill policy: no `.opencode/skills`).

### 4) Targeted runtime reliability fixes
- **`lib/services/dailyRecommendationService.ts`**: in performance-check no-price path, stamp `lastCheckedAt` in SQLite mirror and attempt best-effort Prisma update (skipped when plan-limit breaker open, non-fatal on failure) to prevent stale performance tracking state.
- **`lib/index-service.ts`**: add index fallback/config-aware resolution and resolved-index caching (including `NIFTY TOTAL MARKET` handling/diagnostics) to reduce invalid-index 404/stale-resolution issues.
- **`lib/services/worker/worker-service.ts`**: improve market/stock sync error diagnostics with index-aware context.

## Verification
- **Targeted Jest:** `lib/__tests__/worker-service.test.ts`, `lib/__tests__/historicalPriceSyncService.test.ts`, `lib/__tests__/googleSheetsRescanTask.test.ts` → **3 suites, 36 tests passed**.
- **ESLint:** `npm run lint` → **0 errors** (repo-wide pre-existing warnings remain).
- **TypeScript:** `npx tsc --noEmit` → pre-existing baseline test/type errors in unrelated files; no errors identified in changed production lib files (`index-service.ts`, `dailyRecommendationService.ts`, `worker-service.ts`).
- **Prod diagnostics (S2):** Prisma-Remote minimal read-only query for reported symptoms (`77c94771...`, 2026-11-04 AI-unavailable, `lastCheckedAt` distribution, task/cron events) **not completed** due approval/tool availability; no production mutations performed.

## Files (representative)
- **Lib fixes:** `lib/index-service.ts`, `lib/services/dailyRecommendationService.ts`, `lib/services/worker/worker-service.ts`
- **Canonical skills/agents/rules/commands:** `.agents/skills/**`, `.agents/agents/**`, `.agents/commands/orchestrate.md`, `.agents/rules/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/AGENT-SKILL-MATRIX.md`
- **Config/docs:** `.opencode/opencode.json`, `AGENTS.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-index.md`, `.agents/INDEX.md`, `.agents/docs/playwright-debug.md`, `.agents/docs/playwright-e2e.md`, `TODO.md`, `Primer.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/session-todos.md`, `agent-memory.md`, `Lessons.md`, session archives

## Notes / follow-up
- Re-run S2 Prisma-Remote diagnostics when approval/tool access is available (ops-budget aware).
- Run full CI-equivalent gates in PR as needed (`npm run test`, `npm run quickbuild`) per environment time/capacity.
- External OpenRouter quota/credit issues remain separate from these code/docs/tooling changes.
