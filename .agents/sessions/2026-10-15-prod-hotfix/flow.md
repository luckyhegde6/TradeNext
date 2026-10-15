# Flow — 2026-10-15 prod hotfix (deploy-prep 502 + AI-unavailable Telegram spam)

> Execution path + code touched. All changes UNCOMMITTED at session end.

## 1. Analysis (read-only)

1. Read `15OctProdlog..txt` + the newer ~2h live-log excerpt.
2. `grep` the log for the loop signature: `Recommendations catch-up enqueued … reason=missed-daily-window`, `Daily run failed — AI unavailable on all stocks`, `Telegram broadcast for AI unavailability notice, sent=1`, repeating every 4–20 min.
3. Traced the code: `lib/services/worker/cron-daemon.ts` (`ensureDailyRecommendationRan` at boot + resync) → `lib/services/worker/worker-engine.ts` (`ensureDailyRecommendationRan`, `catchUpMissedCronJobs`, `spawnDueCronJob`) → `lib/services/worker/task-orchestrator.ts` (`spawnRegularTask`, `triggeredBy`) → `lib/services/worker/worker-service.ts` (`executeRecommendations`) → `lib/services/dailyRecommendationService.ts` (`runDailyRecommendations`, `hasSuccessfulRunToday`, failure branch + `buildAiUnavailableNotice`).
4. Confirmed the day-guard failure mode: on a day the run fails on every stock, the persisted run is `status:"failed", aiProcessed:0`, which `hasSuccessfulRunToday()` never counts ⇒ every resync re-enqueues.
5. Confirmed the external trigger: OpenRouter free-tier 429 `free-models-per-day`.
6. Reviewed swing (`templates=34`, Chartink 419 → TV fallback) + performance (`Recommendation Performance Check (System)` cron) — no loop.

## 2. Defect A — deploy-prep 502 → async worker task

| File | Change |
|------|--------|
| `app/api/admin/db-health/route.ts` | `action:"deploy_prep"` → `spawnRegularTask({name, taskType:"deploy_prep", priority:10, payload:{reason:"admin_deploy_prep", triggeredBy:"admin"}})`; audit `ADMIN_DB_DEPLOY_PREP_QUEUED`; return **202** `{success, queued:true, taskId, message}`. Removed the old inline Prisma work + breaker short-circuit + unused `isPlanLimitBreakerOpen` import. |
| `lib/services/worker/worker-service.ts` | NEW `executeDeployPrep(taskId, payload)`: breaker throw, `flushWriteBehind()`, `ensureSqliteBackup()`, `sqlite.syncFromPrisma({force:true, reason:"admin"})`, `persistOpsCounter()`, `persistDbErrorCounts()`, returns `{flushed, retained, pending, rowsFlushed, sqlite}`. Dispatch `case "deploy_prep"`. |
| `lib/services/worker/degradedTaskRegistry.ts` | `deploy_prep` added to the union + `DEGRADED_TASK_TYPES` (**30 → 31**); registry entry `{ degradedSafe:false, failClosed:true }`. |
| `app/api/admin/workers/route.ts` | taskType enum + `"deploy_prep"`. |
| `app/admin/utils/db-health/page.tsx` | 202 branch: `body.queued` → "Deploy prep queued (task …) — check Workers → Tasks for progress". |
| `lib/audit.ts` | `+ 'ADMIN_DB_DEPLOY_PREP_QUEUED'`. |

## 3. Defect B — AI-unavailable Telegram spam

| File | Change |
|------|--------|
| `lib/services/worker/worker-engine.ts` | NEW per-UTC-day dedup block in `ensureDailyRecommendationRan()`: `workerTask.count({taskType:"recommendations", triggeredBy:"catchup", createdAt: {gte: UTC-day-start}})`; `≥1` → `{enqueued:false, reason:"already-enqueued-today"}`; throw → `{enqueued:false, reason:"dedup-check-failed"}` (fail safe). |
| `lib/services/dailyRecommendationService.ts` | `runDailyRecommendations(options)` gains `notifyAiUnavailable` (default true); the failure branch's Telegram `broadcastToSubscribers` is gated on `notifyAiUnavailable`. |
| `lib/services/worker/worker-service.ts` | `executeRecommendations` derives `notifyAiUnavailable = payload?.source !== "catchup"` and threads it into `runDailyRecommendations({ triggeredBy, notifyAiUnavailable })`. |

## 4. Tests + verification

- `lib/__tests__/worker-engine.test.ts` (+43) — dedup runs once per UTC day; `already-enqueued-today`; `dedup-check-failed` on count throw.
- `lib/__tests__/dailyRecommendationService.test.ts` (+56) — `notifyAiUnavailable:false` suppresses the notice; default still notifies.
- `npx tsc --noEmit` → **46 exact (prod 0)**. `eslint` on changed files → 0.
- `git diff --stat` → 10 files, +230 / −62.

## 5. Docs updated

`.agents/changelog/versions-v3.50.md` (NEW) · `AGENTS.md` (v3.50.0 row + trimmed oldest rows for the 32 KB cap + updated latest-detail pointer) · `.agents/CHANGELOG.md` index · `.agents/changelog/versions-index.md` · `Primer.md` · `agent-memory.md` · `Lessons.md` (Lesson 162) · `.agents/session-todos.md` · `HANDOFF.md` · `.agents/handoffs/active/latest.md` · this session folder.

## 6. Not done

- COMMIT (D9 — on explicit user request only). `15OctProdlog..txt` deliberately left untracked.
