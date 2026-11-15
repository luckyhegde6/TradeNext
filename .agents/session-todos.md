## Current (2026-11-15 — Spec 43 prediction targets & analysis mode: commit prep)

Branch: `feature/spec-43-prediction-targets` (from local `main` merged with `origin/main` after PR #155, includes v3.57.0). Planning/docs commits: `df5ef74`, `683a937`, `0e9c64f`.

### Spec 43 — Prediction targets & `analysisMode` (no "AI targets off")
- Spec: `.agents/specs/43-prediction-targets-analysis-mode.md`
- Plan: `.agents/plans/43-prediction-targets-analysis-mode.md`
- Session: `.agents/sessions/2026-11-15-prediction-targets/{decisions,flow}.md`

**Status:** Spec/plan approved (DB migration/backfill + verification). Implementation present (uncommitted) and in commit-prep.

**Decisions:** per-stock `analysisMode="AI Targets"|"Prediction Targets"` · historical rows with any target/analysis -> `AI Targets` (migration intent) · daily fallback/prediction never HOLD on weak signals (BUY/SELL); normal rare-neutral HOLD allowed · Swing auto prediction on every screener-only view/load · Swing keeps `LONG/SHORT/OBSERVE` with targets · perf checks bounded/idempotent prediction+mode backfill · Telegram/admin exports/Sheets include mode.

**Implementation/gates (this session):**
- [x] **Phase 1:** `analysisMode` in `prisma/schema.prisma` + migration `prisma/migrations/20261115160000_add_analysis_mode_prediction_targets/migration.sql`; `lib/sqlite.ts` + `lib/sqlitePushSinks.ts` updated.
- [x] **Phase 2:** directional daily BUY/SELL fallback + swing prediction targets in `lib/services/ai/fallbackAnalysis.ts`, agents, and consumers.
- [x] **Phase 3:** daily per-stock mode/prediction propagation across service/agent/APIs/broadcast/exports/Sheets paths.
- [x] **Phase 4:** swing auto prediction-backed normalization/serve (no targetless states), per-stock mode in payloads/signals/UI/Sheets; stabilized `jobToResponse` mirror/terminal handling and hardened tests.
- [x] **Phase 5:** perf-check bounded/idempotent prediction+mode backfill hooks in recommendation/swing performance paths.
- [~] **Phase 6 (commit prep):** targeted suites green — `dailyRecommendationService` 58/58, `swingRecommendationService` 68/68, `swingPerformanceService` 27/27, `recommendationsPlanLimitFallbacks` 21/21. Gates: `npm run lint` **0 errors / 1227 warnings**; `npx tsc --noEmit` **46 errors, baseline-aware/no Spec 43 prod-file or non-test errors identified**; `node scripts/dev-checks/check-doc-sizes.mjs` **OK (95.7 KB / 100 KB, TODO 30.3 KB)** after trimming. Pending: full `npm run test` confirmation, `npm run quickbuild` confirmation, UI/Playwright screenshot evidence retry as feasible, required Spec 43 docs/session-memory updates (AGENTS/changelog detail, TODO, Primer, Lessons if warranted, agent-memory, HANDOFF/latest handoff, session decisions/flow), then **Spec 43 commit (explicitly requested)**.
- [ ] **Spec 43 commit:** stage implementation + migration + docs/evidence and commit on `feature/spec-43-prediction-targets`.

### After Spec 43 commit (approved sequence)
- [ ] **Track 1:** per-recipient/chatId outbound-notification tracking in structured logs + DB hooks for all outbound notifications (Telegram broadcasts, direct user alerts, bot command replies, email/webhook/in-app deliveries; e.g. daily notice 9:15pm case).
- [ ] **Track 2:** unified notification persistence (schema/migration + SQLite mirror/push sinks) for all triggered notifications (timestamp, chatId, type, message, delivery status, channel, etc.) with manage/retry/cancel (+ bulk), filters, detail/message preview, audit trail.
- [ ] **Track 3:** `/admin/utils/notifications` (utils sidebar, label “Notifications”); update `/admin/alerts` and `/admin/utils/announcements` with unified send history; announcement create/activate stores notification send record; cross-links.
- [ ] **Track 4:** “Prepare for Deploy” runs synchronously in same request but creates `worker_tasks` entry (not queued/pending scheduler path) with checks `probePrismaNow`/breaker/latency, SQLite ready/health, mirror/outbox state; fix `/admin/utils/workers` showing 0.
- [ ] **PR evidence:** capture screenshots for Tracks 1–4/UI changes.

### Prod worker/tasks investigation (tradenext6.netlify.app/admin/utils/workers, 2026-11-15 snapshot)
- [x] Collected snapshot: **35 pending / 0 running / 0 completed / 0 failed** tasks (oldest 2026-11-09, newest deploy_prep 2026-11-15 06:08:51 pm), all `startedAt`/`completedAt` empty, retries `0/3`; 1 idle worker (`169.254.45.199-9`, completed 0, failed 0, heartbeat 6:06:39 pm); leaders `sqlite-sync`/`worker`/`cron-daemon` all holding same instance; Accelerate reachable (360ms). System/crons show last runs up to 2026-11-13 and next runs future; recent sync history shows frequent `↓ to SQLite` boots today + one `↑ to Prisma` admin sync.
- [x] Code/config analysis completed (see session response): likely contributors — SQLite-fresh mirror discovery can hide Prisma-pending rows until stale fallback, degraded/breaker/runner/runtime path can prevent Prisma task claims, and durable runner/dispatch preconditions (Spec 42) must be satisfied on prod.
- [ ] Implement remediation/fix path and validate (code and/or prod config/deploy actions as required).

### Carried forward
- [ ] **S2 (blocked):** retry minimal Prisma-Remote prod read-only diagnostics (ops-limited) once approval/tool access is available.
- [ ] **User controls merge/deploy**; `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy (Spec 42). No merge/deploy without explicit user request.

### Tooling / diagrams (user-requested)
- [ ] **Archify:** install for the user by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt and following its confirmed install steps (respect install-scope/agent confirmation and package-install permission). Use Archify to draw diagrams based on the codebase. Repo: https://github.com/tt-a1i/archify/tree/main
- [ ] **Graphify:** install CLI + register skill (`uv tool install graphifyy` or `pipx install graphifyy`, then `graphify install`) and run `/graphify .` to generate `graphify-out/{graph.html,GRAPH_REPORT.md,graph.json}` for the codebase (requires package/tool-install permission). Repo: https://github.com/Graphify-Labs/graphify
