# Live Resume — v3.50.0 Prod hotfixes (deploy-prep 502 → async worker + AI-unavailable Telegram spam)

> Updated: 2026-10-15 · Snapshot of the active handoff for the current session state.

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

- **v3.50.0 changes are UNCOMMITTED** — commit awaits explicit user request (D9); task = current (see above). Do **NOT** commit `15OctProdlog..txt` (user-provided, untracked); delete scratch `eslint-out.txt`/`jest-out*.txt`/`tsc-out.txt`.
- **BUG A**: next_run advance in the degraded completion path (follow-up spec, needs user approval).
- Merge `fix/daily-rec-swing-cron-worker` → `main`, deploy — **user actions (D9)** (push performed on explicit user request 2026-10-15; merge/deploy still user-only).

## Next steps

1. **User decides merge/deploy** of `fix/daily-rec-swing-cron-worker` (PR #135) — never automatic (D9).
2. BUG A fix = next spec/plan cycle (needs user approval).

## Gotchas / lessons for this handoff

- **D9 RULE (user directive)**: MERGE + DEPLOY are ALWAYS user actions. Push is a user action too — performed here only because the user explicitly asked ("test and commit and push"). No auto-merge/deploy even on green CI (`.agents/RULES.md` §6).
- **Lesson 161 (NEW)**: an e2e **route mock is a contract with the page it stands in for** — when a page reads a field **unconditionally**, a mock that omits it throws in render → ErrorBoundary → the spec is **permanently red**; and you can't see it locally if the spec **self-skips without credentials** (admin specs need `E2E_ADMIN_*`/`ADMIN_*`). Any self-skipping spec has a verification blind spot. Update the mock **in the same change** as the new unconditional field read.
- **Lesson 160**: killing a dev server does **not** release the DB leader lock immediately — the worker engine only starts after the old lease expires (TTL ~15 min). Task logs are file-based (`worker_logs/<taskId>.log`).
- **Lesson 150**: `next build` hangs while a dev server holds `.next` — quickbuild requires killing the dev server first, then restarting it.
- **Dev server picks up a late-arriving DB lazily**: the server started before Docker/DB existed still authenticates once `seed.ts` runs — **no restart needed** (verified: `--project=setup` 1 passed).
- tsc baseline = **46 error lines (prod 0; all pre-existing `__tests__/` errors)** — must stay 46 exact. Verify against the **raw** `npx tsc --noEmit`, not only the gate summary.
- Windows cmd: no `tail` (use PowerShell `Get-Content … -Tail N`); commands are mangled by `&` chains / quoted spaced paths / `/flag` args — redirect to `worker_logs/*.txt` then `read`.
- AGENTS.md doc-gate cap 32,768 B (Lesson 142); AGENTS.md now **32,667 B** after the v3.49.0 row (~101 B headroom).
- Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- Pre-existing local GS OAuth expiry → `invalid_grant` on append/header-ensure (non-fatal; `delegatedExport:true`).

## Remaining-merge state of PREVIOUS workstreams

- v3.48.0 (Spec 27 async re-scan): **COMMIT PENDING USER** (branch `fix/daily-rec-swing-cron-worker`).
- v3.47.0 (Specs 25/26 — scheduled-execution reliability + GS header-label): Spec 25 COMMITTED `480cd3b`, **Spec 26 COMMITTED `44156e6`**; merge/deploy user-only.
- v3.46.0 (ops-counter authority / GS tolerance / catch-up): **MERGED via PR #134 `c0bb972`** into `main` (2026-10-09).
- v3.45.0 (degraded engine): **MERGED into `main`** (2026-10-06) — pending Netlify deploy + Dependabot alert clearance.
- v3.44.0 (legal pages): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.43.0 (Sheets console): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.
