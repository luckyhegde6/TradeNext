# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-17) — v3.14.0 (Swing signal persistence + performance tracking + spec-driven development) — branch `feat/swing-signals`

**Working tree**: v3.14.0 code + tests + spec-driven workflow + docs ALL COMPLETE — suite **758 pass / 4 skip** (was 730/4, +28); `npx tsc --noEmit` **46 = exact baseline, 0 new**. Branch on top of docs branch `docs-readme-refs-agentic-coding`.

### Completed
- [x] **NEW Prisma `SwingSignal`** (`@@unique([jobId, symbol])`) — migration `20260817000000_add_swing_signal` applied
- [x] **`swingPerformanceService.ts`** — `evaluateSwingSignalStatus` (direction-aware) + `checkSwingPerformance` (batch DB + live-price bridge)
- [x] **`swingRecommendationService.ts`** — `persistSwingSignals`/`patchSwingSignalAnalysis` + `SWING_DONE_CACHE_TTL` + `staticCache.del`
- [x] **`worker-service.ts`** — `swing_performance` task case + `executeSwingPerformance`
- [x] **Admin**: `check_swing_performance` action + teal button on daily page
- [x] **Audit tags**: `SWING_PERFORMANCE_CHECK` + `SWING_SIGNAL_STATUS_CHANGED`
- [x] **Worker-logs**: `resolveLogsDir()` → `worker_logs` + monitoring API `type=worker-logs` + Workers tab
- [x] **Tests**: NEW `swingPerformanceService.test.ts` (18); extended `swingRecommendationService.test.ts` (10); suite 758 pass / 4 skip
- [x] **Spec-driven development workflow**: `.agents/templates/spec-template.md` + `.agents/templates/plan-template.md` + `.agents/rules/spec-driven-development.md` + checklist v1.3 + AGENTS.md + rules README
- [x] **Docs**: AGENTS.md v3.14.0 row + spec-driven workflow, CHANGELOG index + versions-v3.14.md, TODO.md row, Primer.md, agent-memory.md, Lessons #82, session-todos, session decisions/flow `2026-08-17-swing-signals`

### Pending (this session)
- [ ] **Commit + push** (user approval)
- [ ] **Live-verify :3000** — swing API force=1 → signals persisted, admin button queues `swing_performance`, Workers tab lists/views/deletes logs

### Pending (carried forward — other branches / later sessions)
- [ ] Advanced screener template fixes (user-reported: only 1 template working)
- [ ] Prod DB fetch failures (reaper + processor `fetch failed` — DB connection issue)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan`
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88)
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs + Netlify cron UI entries removal
