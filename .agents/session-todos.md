## Current (2026-11-15 — Spec 43 prediction targets & analysis mode: branch setup + prod worker analysis)

Branch: `feature/spec-43-prediction-targets` (created from local `main`, merged with `origin/main` after PR #155)  
Base: includes merged PR #155 (`v3.57.0`) + Spec 43 planning commit on this branch.

### Spec 43 — Prediction targets & `analysisMode` (no "AI targets off")
- Spec: `.agents/specs/43-prediction-targets-analysis-mode.md`
- Plan: `.agents/plans/43-prediction-targets-analysis-mode.md`
- Session: `.agents/sessions/2026-11-15-prediction-targets/{decisions,flow}.md`

**Status:** [x] spec drafted, [x] plan drafted, [x] TODOs/session updated — **APPROVED by user (Spec 43 + Plan 43, DB migration/backfill, verification). Implementation in progress.**

**User decisions:** `analysisMode="AI Targets"|"Prediction Targets"` (per stock) · historical rows with any target/analysis -> `AI Targets` · daily fallback/prediction never HOLD on weak signals (BUY/SELL); normal rare-neutral HOLD allowed · Swing auto prediction on every screener-only view/load · Swing keeps `LONG/SHORT/OBSERVE` with targets · perf checks generate+persist missing prediction targets/mode (bounded/idempotent) · Telegram/admin exports/Sheets keep working and include mode.

**Implementation tasks:**
- [ ] **Phase 1 (DB/persistence, PERMISSION GRANTED):** add `analysisMode` to `DailyRecommendationStock`, `RecommendationTracker`, `SwingSignal` (Prisma schema + migration), update SQLite mirror (`lib/sqlite.ts`) + push sinks (`lib/sqlitePushSinks.ts`) + types/mappings, `prisma generate`.
- [ ] **Phase 2 (fallback):** make daily prediction fallback strictly directional BUY/SELL (never HOLD), ensure swing prediction yields targets for LONG/SHORT/OBSERVE; add/update unit tests.
- [ ] **Phase 3 (daily):** per-stock mode in agent/service persistence + AI-unavailable/partial paths produce prediction targets; update APIs/broadcast/exports/Sheets to include mode; tests.
- [ ] **Phase 4 (swing):** auto prediction on screener-only load, remove "AI targets off"/targetless skipped UX, per-stock mode in payloads/signals, Swing UI labels/mode; align SwingSignal active/status contract for perf; tests.
- [ ] **Phase 5 (perf/backfill):** bounded/idempotent prediction+mode backfill in `checkRecommendationPerformance`/`checkSwingPerformance` (+ scheduled/admin paths) and one-time historical `AI Targets` backfill for rows with targets/analysis; tests.
- [ ] **Phase 6 (verify/docs):** targeted/full tests, `tsc --noEmit`, `npm run lint`, `npm run quickbuild`, local UI verification + evidence; update required docs/changelog/session artifacts; commit only on explicit request.

### Prod worker/tasks investigation (tradenext6.netlify.app/admin/utils/workers, 2026-11-15 snapshot)
- [x] Collected snapshot: **35 pending / 0 running / 0 completed / 0 failed** tasks (oldest 2026-11-09, newest deploy_prep 2026-11-15 06:08:51 pm), all `startedAt`/`completedAt` empty, retries `0/3`; 1 idle worker (`169.254.45.199-9`, completed 0, failed 0, heartbeat 6:06:39 pm); leaders `sqlite-sync`/`worker`/`cron-daemon` all holding same instance; Accelerate reachable (360ms). System/crons show last runs up to 2026-11-13 and next runs future; recent sync history shows frequent `↓ to SQLite` boots today + one `↑ to Prisma` admin sync.
- [x] Code/config analysis completed (see session response): likely contributors — SQLite-fresh mirror discovery can hide Prisma-pending rows until stale fallback, degraded/breaker/runner/runtime path can prevent Prisma task claims, and durable runner/dispatch preconditions (Spec 42) must be satisfied on prod.
- [ ] Implement remediation/fix path and validate (code and/or prod config/deploy actions as required).

### Carried forward
- [ ] **S2 (blocked):** retry minimal Prisma-Remote prod read-only diagnostics (ops-limited) once approval/tool access is available.
- [ ] **User controls merge/deploy**; `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy (Spec 42). No merge/deploy without explicit user request.
