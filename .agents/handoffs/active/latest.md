# Live Resume — v3.51.0 Spec 32 prod resilience (AI daily free-quota latch · breaker trips on the CAUSE · degraded-queue cadence dedup)

> Updated: 2026-10-16 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Spec 32 — three independent prod-resilience fixes: (1) the OpenRouter free-tier **daily-quota 429** causing silent all-AI-fail days + Telegram spam (bounded in v3.50.0 but still *attempted* every resync); (2) a **transient `PrismaQueryTimeoutError` wrongly tripping the 5-min plan-limit breaker** and freezing the app; (3) the **degraded executor completing a run while the job re-fires every 5-min resync** (mirror `next_run` deliberately static). |
| **Branch** | session started clean at `0a712eb` — **changes uncommitted** |
| **State** | CODE + TESTS + GATES + DOCS **DONE** — **COMMIT PENDING USER** (D9; merge/push/deploy = user actions) |
| **In-flight** | None |
| **Blocked** | (none code-wise.) External/operational: OpenRouter free-tier daily quota exhausted (HTTP 429 `free-models-per-day` — Fix 1 bounds the damage, a restore needs credits/model change); Prisma plan-limit hold + Accelerate-degraded (Fix 2 only tightens *our* breaker). |
| **Spec/Plan** | `.agents/specs/32-prod-resilience-fixes.md` · `.agents/plans/32-prod-resilience-fixes.md` · detail `.agents/changelog/versions-v3.51.md` |

## What's done (v3.51.0)

- **(1) AI daily free-quota latch — NEW `lib/services/ai/quotaLatch.ts` (zero Prisma).** `isDailyFreeQuotaMessage()` matches **only** the account-wide *daily free* 429 (`free-models-per-day` / `free models per day`), never a per-minute 429. `markAiQuotaExhausted({model, detail, resetAt?})` latches the **UTC day** (`resetAt` defaults to next UTC midnight); `isAiQuotaExhausted()`/`getAiQuotaStatus()` **self-clear** (a wrong-day or expired record is ignored **and deleted** — no reset job); `clearAiQuotaExhausted()` is the operator path. Persistence = the generic `_backup_meta` KV in `lib/sqlite.ts` (`persistBackupMeta`/`restoreBackupMeta`/`deleteBackupMeta`, never throw, no-op when the mirror isn't ready) **plus** a `globalThis.__aiQuotaLatch` memo (a cold mirror must not disable the short-circuit mid-instance). Wiring: `llm-provider.directPrompt` keeps its `HTTP <status>` marker and appends the trimmed provider body (≤300 chars, whitespace-collapsed); `recommendation-agent.analyzeBatch` latches on `isDailyFreeQuotaMessage(raw)` only; `analyzeStocks` returns labelled failed results with **zero HTTP calls** when latched; `app/api/admin/ai/monitoring/route.ts` adds `quota` to stats + `?type=quota` + `POST {action:"clear-quota"}` (unknown → 400); `app/admin/utils/ai-monitoring/page.tsx` renders an amber banner (day · model · auto-clear · detail) with **Clear latch**.
- **(2) Breaker keys on the HOLD (`lib/db-utils.ts`).** `isPlanLimitHoldError()` dropped `name.includes("timeout")`; it now matches **only** `code === "P6003"` / `"hold on your account"` / `"planlimitreached"`. A transient `PrismaQueryTimeoutError` (our own 120 s deadline, exceeded by a slow proxy on a *healthy* DB) degrades **per-query** via `isDbUnavailableError` instead of latching the 5-min global freeze. Test pins the 2×2 (`isPlanLimitHoldError(timeout) === false` while `isDbUnavailableError(timeout) === true`).
- **(3) Degraded-queue dedup on the job's cadence (`lib/sqlite.ts` + `lib/cron-parser.ts` + `lib/services/worker/degradedQueue.ts`).** `DEGRADED_DEDUP_SQL` dropped `AND status IN ('pending','running')` → **status-agnostic** (a terminal `completed`/`failed`/`skipped` row suppresses a re-enqueue inside the window; before, only in-flight rows did — the re-fire loop). New `cronNextGapMs(expr, from?)` returns −1 for a non-5-field expression (so `calculateNextRun`'s +60 s invalid-expression fallback is never mistaken for a real gap). New `cronDedupWindowMs(expr, from?)` = that gap clamped `60 s…32 d`, falling back to the 90-min `DEDUP_WINDOW_MS`; `enqueueDegradedTask` now defaults `dedupWindowMs` to it. With the mirror `next_run` intentionally static, the window **is** the schedule (daily ⇒ once/day, hourly ⇒ once/hour).
- **Bonus (v3.50.0 residual).** 2 tests in `lib/__tests__/dbHealthRoute.test.ts` still asserted the **pre-`0a712eb` synchronous** deploy-prep contract (red on `main`); rewritten to the async **202 `{queued,taskId}`** contract (orchestrator mocked) → **21/21**.
- **Tests/Gates**: NEW `quotaLatch.test.ts` + `cronParser`/`degradedQueue`/`sqlite`/`recommendation-agent`/`db-utils` updated. tsc **46 exact (prod 0)** · full Jest **138/138 · 2078 pass / 4 skip / 0 fail** · eslint 0 on touched files · quickbuild **201/201**. Diff 14 modified + 1 new source/test file; no schema change → no migration; no new runtime package.
- **Playwright** (admin login, dev server :3000 — pre-existing, NOT started by me): `/admin/utils/ai-monitoring` renders with **0 real console errors**; `?type=stats` now carries `quota`; `?type=quota` → 200; `POST {action:"clear-quota"}` → 200; unknown action → 400; banner markup + `Clear latch` confirmed in the served client chunks (16 scanned). **Not visually confirmed**: the banner renders only once the latch is set (needs a real daily-free 429 or a dev-mirror write — not approved).
- **Docs**: `.agents/changelog/versions-v3.51.md` (NEW) + AGENTS.md v3.51.0 row (v3.41.1–3 collapsed → **31,697 B**) + `.agents/CHANGELOG.md` index + `.agents/changelog/versions-index.md` + `TODO.md` + `Primer.md` (Last Updated + Current Project Status) + `agent-memory.md` + **Lesson 163** + `.agents/session-todos.md` + `HANDOFF.md` + this file + session archive `2026-10-16-prod-resilience/`.

## Prior — v3.50.0 Prod hotfixes (deploy-prep 502 → async worker + AI-unavailable Telegram spam)

> Snapshot from 2026-10-15.

## Status

| Field | Value |
|-------|-------|
| **Task** | (1) "Prepare for Deploy" `/admin/utils/db-health` returned **HTTP 502**; (2) Telegram received **dozens/day** of "AI Analysis Unavailable" (far more than once). Plus: swing + performance subsystem review of the attached prod logs. |
| **Branch** | session started clean at `7d03998` — **changes uncommitted** |
| **State** | CODE + TESTS + GATES + DOCS **DONE** — **COMMIT PENDING USER** (D9; merge/push/deploy = user actions) |
| **In-flight** | None |
| **Blocked** | (none code-wise.) External/operational: OpenRouter free-tier daily quota exhausted (HTTP 429 `free-models-per-day`); Prisma plan-limit hold + Accelerate-degraded + `PrismaQueryTimeoutError`. |
| **Side note** | ⚠️ **BUG A (still open, from v3.47.0/25)**: degraded executor completes but never advances mirror `next_run` → recurring job re-fires every 5-min tick while due; fix idea = advance via `calculateNextRun` (`worker-engine.ts` :729/:762). |

## What's done (v3.50.0)

- **(1) Deploy-prep 502 → async worker task.** `POST /api/admin/db-health` `action:"deploy_prep"` ran `flushWriteBehind()` + `ensureSqliteBackup()` + `sqlite.syncFromPrisma({force:true})` **synchronously in-request**; under the Netlify gateway timeout (plan-limit hold drives each Prisma call to its per-query timeout) it never returned → **502**, UI saw `undefined`. Now the route **enqueues** a worker task (`spawnRegularTask`, `taskType:"deploy_prep"`, priority 10) → **202 `{queued:true, taskId}`** + audit `ADMIN_DB_DEPLOY_PREP_QUEUED`; identical steps moved verbatim into new `executeDeployPrep(taskId)` in `worker-service.ts` (`case "deploy_prep"`); `degradedTaskRegistry` **30 → 31** types; `workers` route taskType enum; `db-health/page.tsx` 202 message. Removed unused `isPlanLimitBreakerOpen` import + in-route breaker short-circuit (executor owns it).
- **(2a) Fix A — bound the catch-up to ≤1/UTC-day** (`worker-engine.ts` `ensureDailyRecommendationRan`): `prisma.workerTask.count({taskType:"recommendations", triggeredBy:"catchup", createdAt ≥ UTC-day-start})`; `≥1` → `already-enqueued-today`; count **throw** → `dedup-check-failed` (fail SAFE — never re-spawn on an uncertain read). Dedup key matches the catch-up spawn path (`spawnDueCronJob` → `triggeredBy:"catchup"`, payload `{source:"catchup"}`).
- **(2b) Fix B — dedup the notice** (`dailyRecommendationService.ts` + `worker-service.ts`): `runDailyRecommendations({ notifyAiUnavailable })` (default `true`) gates the Telegram heartbeat; `executeRecommendations` passes `payload.source !== "catchup"` ⇒ catch-up retries silent ⇒ **≤1 notice/day** (scheduled `30 4 * * 1-5` run still sends it).
- **Root trigger is external**: OpenRouter `openrouter/free` HTTP 429 `free-models-per-day` (daily quota exhausted) — needs credits or a model change; not code.
- **Swing/performance review** of the same log: swing `templates=34` (Chartink HTTP 419 → TradingView fallback, normal); recommendations `templates=117`; `"Recommendation Performance Check (System)"` cron present — **no loop** in either; the spam is entirely the recommendations catch-up path. Also observed: Prisma plan-limit + Accelerate-degraded + SQLite `pushTable failed — outbox retained` (incl. FK `daily_recommendation_stocks_runId_fkey`) + leader-flapping ("Leader lock acquired (stale claimed)" / "Lost leader lock") with many cold starts (each boot also calls `ensureDailyRecommendationRan`, now bounded by Fix A).
- **Tests/Gates**: `worker-engine.test.ts` +43, `dailyRecommendationService.test.ts` +56 (both suites pass) · tsc **46 exact (prod 0)** · eslint 0 on changed files. Diff 10 files +230/−62.
- **Docs**: `.agents/changelog/versions-v3.50.md` (NEW) + AGENTS.md v3.50.0 row (trimmed oldest rows for the 32 KB cap) + `.agents/CHANGELOG.md` index + `.agents/changelog/versions-index.md` + `Primer.md` + `agent-memory.md` + **Lesson 162** + `.agents/session-todos.md` + `HANDOFF.md` + this file.

## Prior — v3.49.0 Specs 28–31 completion (missing plan tests) + PR #135 CI fixes

- **CI Fix 1 — Quality Gate `tsc-baseline`**: `app/admin/google-sheets/page.tsx`'s local `SheetsStatus` interface had no `missingEnvVars`, but the Spec 31 "not armed" card reads `status.missingEnvVars.length` + `.map(…)` **unconditionally** → `TS2339` (`:180`) + `TS2551` (`:187`) = **2 PRODUCTION tsc errors**. Fixed the **interface** (`missingEnvVars: string[]`).
- **Baseline NEVER raised**: `scripts/dev-checks/tsc-baseline.json` is **untouched** (absent from `git status`). Proof — raw `npx tsc --noEmit` = 46 `error TS…` lines, **all inside `__tests__/`, zero in `page.tsx`/`app/admin`**; gate → `total 46 / prod 0 / delta +0`.
- **CI Fix 2 — Playwright route-mock drift (Lesson 161)**: `e2e/admin-google-sheets.spec.ts`'s `statusBody()` returned a mocked status **without** `missingEnvVars` → `undefined.length` threw **in render** → route ErrorBoundary → every `gs-…` assertion failed. The spec **self-skips** unless `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (or `ADMIN_*`) are exported → GREEN locally, RED only in CI. Fixed `statusBody()` (+`missingEnvVars: []`) and added the Spec 31 regression test `an unarmed deploy lists the missing env vars by name` (`data-testid="env-not-armed"` → "3 required env var(s) missing" + the 3 var names).
- **Missing plan tests authored** (none existed before):
  - Spec 30 `lib/__tests__/dailyRecommendationService.test.ts` **+13 → 56/56** (`getNextRunAt` / `computeFreshnessFields` / `computeIsStale` / `hasSuccessfulRunToday`).
  - Spec 30 `lib/__tests__/worker-engine.test.ts` **+12 → 55/55** (`ensureDailyRecommendationRan` full guard matrix: degraded / not-leader / weekend / before-window / already-ran / in-flight / check-failed / enqueue-failed + audit-on-enqueue-only).
  - Spec 31 `lib/__tests__/googleSheetsStatus.test.ts` **+6 → 21/21** (`missingEnvVars`).
- **Local CI reproduction** (so authenticated e2e could run at all): Docker Desktop started · `docker compose up -d db redis` (healthy, `:5432`/`:6379`) · `npx prisma migrate deploy` (38 migrations, **none pending**) · `npx tsx prisma/seed.ts` (demo **id 2** / admin **id 1**) · `npx playwright test --project=setup` **1 passed (19.3 s)**.
- **Gates**: tsc **46 exact (prod 0, delta +0)** · Jest **137/137 suites · 2053 passed / 4 skipped / 0 failed** · Spec 28–31 targeted **6 suites / 187 tests** · eslint 0 on changed files · quickbuild **201/201, 0 `warn`** · **Playwright full suite (all projects, exactly as CI runs it) 126 passed / 2 flaky (both retry-green) / 0 failed** (10.9 m).
- **Docs**: `.agents/changelog/versions-v3.49.md` (NEW) + AGENTS.md v3.49.0 row (464 B; 32,667/32,768 B cap — green) + `.agents/CHANGELOG.md` index row + `.agents/changelog/versions-index.md` (v3.49.0 **and the previously-missing v3.48.0** row) + `Primer.md` (Last Updated + Current Project Status) + `agent-memory.md` + **Lesson 161** + `.agents/session-todos.md` + `HANDOFF.md` + this file.

## Not done (deliberately)

- **v3.51.0 changes are UNCOMMITTED** — commit awaits explicit user request (D9); merge/push/deploy are user actions. Scratch `_docs-scratch.cjs`/`_docs-edit.cjs`/`_docs-todo.cjs` deleted after use.
- **Not verified locally**: the AI-quota banner renders only once the latch is actually set (would need a real `free-models-per-day` 429 or a dev-mirror write — not approved). Covered by unit tests + the served-chunk string check.
- **BUG A (v3.47.0/25) — resolved by window, not by cursor**: the proposed "advance mirror `next_run`" fix was **rejected by the user**; Fix 3 instead makes the dedup window equal the job's own cadence and status-agnostic, which is what actually stops the every-tick re-fire. `next_run` stays static by design.
- Merge `fix/daily-rec-swing-cron-worker` → `main`, deploy — **user actions (D9)**.

## Next steps

1. **User commits** on explicit request (D9); then merge/deploy (user-only).
2. OpenRouter quota restore (credits or a non-free model) is an external/user action — not code.
3. Optional: reproduce a real daily-free 429 (or write the dev-mirror latch) to visually confirm the AI-Monitoring banner.

## Gotchas / lessons for this handoff

- **D9 RULE (user directive)**: MERGE + DEPLOY are ALWAYS user actions. Push is a user action too — performed here only because the user explicitly asked ("test and commit and push"). No auto-merge/deploy even on green CI (`.agents/RULES.md` §6).
- **Lesson 163 (NEW)**: fix the classification, not the symptom — a breaker predicate must match the *cause's own evidence* (`P6003` / `"hold on your account"` / `planlimitreached`), never a generic symptom class (`name.includes("timeout")`) that it shares with unrelated failures; and a dedup window must be derived from the schedule it guards (`cronNextGapMs` → `cronDedupWindowMs`) whenever the schedule cursor is immutable — a fixed 90-min window re-fires a *daily* job every 90 min once the row is terminal, so the SQL must also be **status-agnostic** (a finished run must suppress, or it suppresses nothing).
- **Lesson 161**: an e2e **route mock is a contract with the page it stands in for** — when a page reads a field **unconditionally**, a mock that omits it throws in render → ErrorBoundary → the spec is **permanently red**; and you can't see it locally if the spec **self-skips without credentials** (admin specs need `E2E_ADMIN_*`/`ADMIN_*`). Any self-skipping spec has a verification blind spot. Update the mock **in the same change** as the new unconditional field read.
- **Lesson 160**: killing a dev server does **not** release the DB leader lock immediately — the worker engine only starts after the old lease expires (TTL ~15 min). Task logs are file-based (`worker_logs/<taskId>.log`).
- **Lesson 150**: `next build` hangs while a dev server holds `.next` — quickbuild requires killing the dev server first, then restarting it.
- **Dev server picks up a late-arriving DB lazily**: the server started before Docker/DB existed still authenticates once `seed.ts` runs — **no restart needed** (verified: `--project=setup` 1 passed).
- tsc baseline = **46 error lines (prod 0; all pre-existing `__tests__/` errors)** — must stay 46 exact. Verify against the **raw** `npx tsc --noEmit`, not only the gate summary.
- Windows cmd: no `tail` (use PowerShell `Get-Content … -Tail N`); commands are mangled by `&` chains / quoted spaced paths / `/flag` args — redirect to `worker_logs/*.txt` then `read`.
- AGENTS.md doc-gate cap 32,768 B (Lesson 142); AGENTS.md now **31,697 B** after the v3.51.0 row (the verbose v3.41.1–v3.41.3 rows collapsed into one pointer row — ~1,071 B headroom). TODO.md **~32.6 KB** (tight — trim before the next row).
- **Banner-not-set locally**: `POST {action:"clear-quota"}` and `?type=quota` are the API-level proof; the amber banner itself only mounts when `isAiQuotaExhausted()` is true, so a unit test + a served-chunk string check is the strongest local evidence.
- Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- Pre-existing local GS OAuth expiry → `invalid_grant` on append/header-ensure (non-fatal; `delegatedExport:true`).

## Remaining-merge state of PREVIOUS workstreams

- v3.51.0 (Spec 32 prod resilience): **COMMIT PENDING USER** (session started clean at `0a712eb`).
- v3.50.0 (prod hotfixes — deploy-prep async + AI-spam): **COMMITTED `0a712eb`** on local `main`, **unpushed** (`main` ahead of `origin/main` by 1); merge/deploy user-only.
- v3.49.0 (Specs 28–31 tests + PR #135 CI fixes): **PUSHED** with the v3.50.0 commit (PR #135 merged into `main`).
- v3.48.0 (Spec 27 async re-scan): **COMMITTED** (branch `fix/daily-rec-swing-cron-worker`).
- v3.47.0 (Specs 25/26 — scheduled-execution reliability + GS header-label): Spec 25 COMMITTED `480cd3b`, **Spec 26 COMMITTED `44156e6`**; merge/deploy user-only.
- v3.46.0 (ops-counter authority / GS tolerance / catch-up): **MERGED via PR #134 `c0bb972`** into `main` (2026-10-09).
- v3.45.0 (degraded engine): **MERGED into `main`** (2026-10-06) — pending Netlify deploy + Dependabot alert clearance.
- v3.44.0 (legal pages): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.43.0 (Sheets console): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.
