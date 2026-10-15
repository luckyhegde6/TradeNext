# v3.50.0 — Production hotfixes: deploy-prep 502 + AI-unavailable Telegram spam

> **COMMIT PENDING USER (D9).** Merge/deploy are always user actions. Session started clean at HEAD `7d03998`; all changes below were uncommitted during analysis.
> Two independent production defects, both surfaced while reviewing the live prod logs the user attached (`15OctProdlog..txt` + a ~2h live-log excerpt).

---

## 1. Background — what the prod logs showed

**Defect A — "Prepare for Deploy" HTTP 502.**
The admin action `POST /api/admin/db-health` with `action:"deploy_prep"` ran three heavyweight steps **synchronously in the request**:

1. `flushWriteBehind()` — bulk-flush queued write-behind logs (APIRequestLog/ServerLog/AuditLog) from the SQLite mirror into Prisma,
2. `ensureSqliteBackup()` + `sqlite.syncFromPrisma({ force: true })` — force a full mirror refresh from the current Prisma state,
3. `persistOpsCounter()` / `persistDbErrorCounts()` + health read.

Under the Netlify gateway timeout (with the plan-limit breaker pushing every Prisma call toward its per-query timeout) the request never returned → **502**, and the admin UI saw `undefined` instead of a message. The work itself is fine — it must not run inside an HTTP request.

**Defect B — Telegram "AI Analysis Unavailable" spam (dozens/day).**
The live log showed the same cycle repeating every 4–20 min:

```
Recommendations catch-up enqueued        reason=missed-daily-window
Daily recommendation run starting        triggeredBy=system
Daily recommendations completed          stockCount=10896
Daily run failed — AI unavailable on all stocks; aiFailed=100
Telegram broadcast for AI unavailability notice, sent=1
```

Root cause chain:

- Spec 30 added `ensureDailyRecommendationRan()` (worker-engine), which runs on **daemon boot** and on the **5-minute resync tick**.
- Its day guard `hasSuccessfulRunToday()` only returns true when a run with `status` completed + AI processed is persisted. On a day where **AI fails on every stock**, the run is persisted `status:"failed", aiProcessed:0`, so the guard stays **FALSE for the whole day**.
- ⇒ every 5-min tick re-enqueued a full pipeline run, each failing and each broadcasting the "AI Unavailable" notice → ~70 runs / ~70 duplicate Telegram notices on 2026-10-14/15.

This contradicts Spec 30's stated intent ("at most ONE catch-up retry"). The real AI-failure trigger is **external**: OpenRouter `openrouter/free` returns HTTP 429 `free-models-per-day` with `X-RateLimit-Reset` — the free daily quota is exhausted (needs credits or a model change; not a code bug).

---

## 2. Fix A — `deploy_prep` becomes an async worker task

**Files**

| File | Change |
|------|--------|
| `app/api/admin/db-health/route.ts` | `action:"deploy_prep"` now **enqueues** via `spawnRegularTask({ taskType:"deploy_prep", priority:10, payload:{ reason, triggeredBy:"admin" } })`, audits `ADMIN_DB_DEPLOY_PREP_QUEUED`, returns **202** `{ queued:true, taskId, message }`. Removed the in-request flush/backup/mirror-sync body, the breaker 503 short-circuit (the executor now owns that check) and the now-unused `isPlanLimitBreakerOpen` import. |
| `lib/services/worker/worker-service.ts` | New `executeDeployPrep(taskId, payload)` performs the flush + `ensureSqliteBackup()` + `syncFromPrisma({force:true})` + `persist*` + health read in the worker; throws on breaker-open (a real message lands in the task row, not a 502). New `case "deploy_prep"` in `executeTask`.
- `lib/services/worker/degradedTaskRegistry.ts` — added `deploy_prep` to the union/`DEGRADED_TASK_TYPES` (now **31** dispatchable types) + registry entry (not degraded-safe — it needs Prisma). The `degradedTaskRegistry` test asserts the registry order equals the `worker-service` switch order.
- `app/api/admin/workers/route.ts` — added `deploy_prep` to the zod taskType enum (manual re-run path).
- `app/admin/utils/db-health/page.tsx` — 202 handling: **"Deploy prep queued (task …) — check Workers → Tasks for progress"** instead of the completion message (which is still used for non-queued responses).
- `lib/audit.ts` — new audit action `ADMIN_DB_DEPLOY_PREP_QUEUED` (the old `ADMIN_DB_DEPLOY_PREP` is retained for the historic rows).

`POST /api/admin/db-health` response contract changed for `deploy_prep`: **200 (sync complete)** → **202 `{ queued: true, taskId }`**. The original in-request implementation is preserved verbatim as the executor, so no behaviour is lost — only the *when* changes.

---

## 3. Fix B — bound + silence the AI-unavailable catch-up

Two independent guards, both in the code (not the log-only analysis):

**B1 — one catch-up per UTC day** (`lib/services/worker/worker-engine.ts`, `ensureDailyRecommendationRan`).
After the weekday/window/already-ran guards, count worker tasks:

```ts
const dayStart = startOfUtcDay();
const alreadyEnqueued = await prisma.workerTask.count({
  where: { taskType: "recommendations", triggeredBy: "catchup", createdAt: { gte: dayStart } },
});
```

- `≥1` ⇒ return `{ enqueued: false, reason: "already-enqueued-today" }`.
- On a count throw ⇒ **fail safe**: return `{ enqueued: false, reason: "dedup-check-failed" }` (never re-spawn on an uncertain read).
- The dedup key is exactly what the catch-up path writes, so it matches the observed loop: `spawnDueCronJob` spawns the catch-up via `spawnRegularTask` with `triggeredBy:"catchup"` and payload `{ source: "catchup", reason: "missed-daily-window" }`.

**B2 — catch-up runs are silent** (`worker-service.ts` → `dailyRecommendationService.ts`).
- `runDailyRecommendations` gains `options.notifyAiUnavailable` (default `true`); the "AI Unavailable" Telegram broadcast is now gated on it.
- `executeRecommendations` derives `notifyAiUnavailable = payload.source !== "catchup"` and passes it through.
- ⇒ a day-long AI outage produces **one** notice (the scheduled cron run) plus a silent retry, instead of one notice per retry.

The scheduled run keeps its `RECOMMENDATION_CRON_EXPR = "30 4 * * 1-5"` cadence (once/day) and default `notifyAiUnavailable` (true), so subscribers still get exactly one heartbeat per failed day.

---

## 4. Tests

- `lib/__tests__/worker-engine.test.ts` (+43) — asserts the dedup guard across repeated boots/ticks and the fail-safe count-throw path (`already-enqueued-today` / `dedup-check-failed`).
- `lib/__tests__/dailyRecommendationService.test.ts` (+56) — notify gating (`notifyAiUnavailable:false` suppresses the Telegram broadcast; default still sends).

Both suites pass. `npx tsc --noEmit` = **46 exact / 0 new** (the standing `__tests__`-only baseline; production 0). ESLint clean on changed files.

---

## 5. Root-cause note (external — not a code fix)

Netlify + the Prisma plan-limit hold are the operational context:
`PlanLimitOpenError`, "Plan limit circuit breaker open — Prisma account likely on hold", Accelerate probe timeouts, `PrismaQueryTimeoutError`, SQLite `pushTable failed — outbox retained for retry` (incl. FK violation `daily_recommendation_stocks_runId_fkey`). The **AI-unavailable spam's true trigger** is OpenRouter free-tier quota exhaustion (HTTP 429), which belongs to operations/credentials — needs a funded key or a different model. The v3.50.0 fix makes the codebase resilient to that condition (retry bounded, notice deduplicated), not the quota itself.

---

## 6. Files touched

| File | +/- |
|------|-----|
| `app/api/admin/db-health/route.ts` | −45 / +18 (async) |
| `app/api/admin/workers/route.ts` | +1 (taskType enum) |
| `app/admin/utils/db-health/page.tsx` | +3 / −1 (202 message) |
| `lib/services/worker/worker-service.ts` | +43 / −4 (`executeDeployPrep` + `notifyAiUnavailable`) |
| `lib/services/worker/worker-engine.ts` | +30 (per-day dedup) |
| `lib/services/worker/degradedTaskRegistry.ts` | +9 / −2 (31st type) |
| `lib/services/dailyRecommendationService.ts` | +25 / −13 (gated notice) |
| `lib/audit.ts` | +1 (`ADMIN_DB_DEPLOY_PREP_QUEUED`) |
| `lib/__tests__/worker-engine.test.ts` | +43 |
| `lib/__tests__/dailyRecommendationService.test.ts` | +56 |

Lesson 162 (a day-long failure must not turn a daily retry into a per-tick loop; bound retries at the *spawn* site and dedup the *notice* separately).
