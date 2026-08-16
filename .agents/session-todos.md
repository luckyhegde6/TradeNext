# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-16) — v3.13.0 (DB-backed Swing AI analysis job — durable `SwingAnalysisJob` replaces the volatile cache-only fire-and-forget) — branch `feat/swing-db-analysis-job`

**Working tree**: v3.13.0 code + tests + docs COMPLETE + LIVE-VERIFIED — **commit pending user** (user merges PR → Netlify rebuild = deploy + `migrate deploy` applies the table). Full suite **730 pass / 4 skip** (was 722/4; 4 skips = intentional client-cache IndexedDB); `npx tsc --noEmit` **46 errors = exact baseline, 0 new**. Branch on top of main (v3.12.0 merged via PR #95).

### Completed
- [x] **NEW Prisma `SwingAnalysisJob`** (after `DailyRecommendationStock`) — migration `20260816000000_add_swing_analysis_job` applied locally via `migrate diff --from-config-datasource` + `db execute` (⚠️ local DB has NO `_prisma_migrations` ledger — never `migrate dev` locally, destructive; prod uses `migrate deploy`)
- [x] **Service rewrite**: pre-scan DB lookup (done/failed/pending/running served WITHOUT re-scan; pending kicks `maybeProcessSwingAnalysis()`), absent → scan + durable job + frozen pending feed, `force=1` supersedes pending/running (`updateMany → failed "Superseded by a newer force refresh"`), empty feed → synchronous skipped; processor atomic claim `updateMany({where:{id,status:"pending"},data:{running,startedAt,attemptCount:{increment}}})`, re-read + abort unless still `running`, stale recovery 45min / 2 attempts, audits START/COMPLETE/FAILED + RUN_COMPLETE, trackers persisted when done (non-fatal), cache warm; **cache holds ONLY final done/failed**; REMOVED `SWING_PENDING_TTL`/`swingAnalysisInFlight`/`runSwingAnalysisInBackground` (grep 0 refs)
- [x] **Daemon drain**: `cron-daemon.ts` 60s resync tick → `maybeProcessSwingAnalysis()` fire-and-forget (dynamic import, no circular dep); module guard `swingProcessorInFlight` + `flushSwingAnalysis()` test hook
- [x] **Tests**: stateful in-memory `swing_analysis_job` mock + orchestration suite — file 44/44; **suite 730 pass / 4 skip** (was 722/4, +8); tsc 46 = exact baseline, 0 new
- [x] **Live-verified :3000**: `force=1` → **11.11s pending feed** → job `68bbed30…` claimed (running, attempt 1) → 4 batches (24.9s each) → **done 20/20**; non-force 39ms DB-served frozen pending / 25ms cached done; audit RUN_START→ANALYSIS_START→ANALYSIS_COMPLETE→RUN_COMPLETE; 5 new swing trackers (idempotent); Swing tab "AI targets ready" + 20/20 direction-aware targets, **0 console errors**
- [x] **Docs**: AGENTS.md v3.13.0 row, CHANGELOG index + versions-v3.md entry, TODO.md row, Primer (status + Last Updated), agent-memory entry, Lessons #81 + Last Updated + Update Log, session `decisions.md` + `flow.md` (`2026-08-16-swing-db-job`)

### Pending (this session)
- [ ] **Commit + push `feat/swing-db-analysis-job` + open PR** (user approval; commit message without credential literals — hook blocks them)
- [ ] **PR merge (user)** → Netlify rebuild = deploy + `migrate deploy` applies `SwingAnalysisJob`
- [ ] Post-deploy smoke: Swing tab instant load + targets ~2–3 min (Refresh → pending → done), audit rows for SWING_ANALYSIS_*, no stale Netlify cron UI entries (remove if present)

### Pending (carried forward — other branches / later sessions)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200 (prod backfill manual trigger + market-sync step 4 auto-backfill)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them), open PR
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy) + Netlify cron UI entries removal
