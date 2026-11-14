## Current (2026-11-15 — v3.57.0 skills consolidation + WebMCP + rec/index fixes, PR #155)

Branch: `feature/spec-42-durable-worker-cron-v2` (PR #155)  
Base: main `10337d956cafc943c3e97f73121e1038330d86af`

- [x] Consolidate all skills to canonical `.agents/skills/<name>/SKILL.md` (format A); remove legacy `.opencode/skills` and obsolete `.agents/skills/*.md` mirrors; update references/matrix/docs/config.
- [x] Add WebMCP artifacts: `.agents/skills/webmcp/SKILL.md`, `.agents/agents/webmcp-integrator.md`.
- [x] Optimize agent profiles, rules, commands, orchestration, and session handoff/work-continuation guidance for `.agents` canonical skills and file-based resume.
- [x] Validate targeted lib fixes:
  - `lib/services/dailyRecommendationService.ts` — perf no-price `lastCheckedAt` stamp (mirror + best-effort Prisma, breaker-guarded/non-fatal)
  - `lib/index-service.ts` — index fallback/config-aware resolution/caching (`NIFTY TOTAL MARKET` diagnostics)
  - `lib/services/worker/worker-service.ts` — index-aware market/stock sync error diagnostics
- [x] Targeted validation: Jest **36/36** (`worker-service`, `historicalPriceSyncService`, `googleSheetsRescanTask`); `npm run lint` **0 errors**; `tsc --noEmit` baseline unchanged for changed prod libs.
- [x] Docs/session updates: `versions-v3.57.md`, `versions-index.md`, `.agents/CHANGELOG.md`, `AGENTS.md`, `TODO.md`, `Primer.md`, `Lessons.md` (168), `agent-memory.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/sessions/2026-11-15-skills-consolidation/{decisions,flow}.md`.
- [ ] **S2 (blocked):** retry minimal Prisma-Remote prod read-only diagnostics (ops-limited) for stale recs/perf `lastCheckedAt`, 2026-11-04 AI-unavailable, `NIFTY TOTAL MARKET` 404 once approval/tool access is available.
- [x] Commit, push, and update PR #155 (explicit user request). **User controls merge/deploy**; `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy.
