# TradeNext v3.45.0 — Spec 21 Degraded SQLite Execution Engine & Preemptive Plan-Limit Switch

> **Status:** CODE + TESTS + GATES + DOCS DONE · **UNCOMMITTED** — one authorized Spec 21 commit + PR #133 update pending explicit user go-ahead.
> **Branch:** `feature/google-sheets-tracking` (work sits on HEAD `f0c73c7` = deepmerge-ts override on the v3.43.0/v3.44.0 PR #133 chain).
> **Spec / plan:** `.agents/specs/21-degraded-sqlite-execution-engine.md` + `.agents/plans/21-degraded-sqlite-execution-engine.md`.
> **Supersedes:** nothing — builds on v3.44.0 (legal pages, committed `ac24ede`) and the v3.41.2 plan-limit fallback layer; carried by PR #133.

## What it does

Makes cron/worker execution survive a Prisma plan-limit hold **preemptively** — degraded mode engages at 90% of the monthly 200k-op budget (180,000 ops), BEFORE the breaker opens, so the system is already running from the SQLite mirror when the hold lands.

### Mode & activation semantics

- **Modes**: `auto | force | off` (operator settable; unknown env value coerced to `auto`).
- **Precedence**: `off > forced > breaker > threshold` — the kill switch always wins.
- **Hysteresis**: enter at `>= 180_000` ops, stay engaged while `> 160_000`, exit at `<= 160_000` **AND** breaker closed (asymmetric on purpose — `>=` to engage, `>` to hold; Lesson 154).
- **Persistence**: `_degraded_state` stores only the operator mode (survives deploy); the active hysteresis reading is process-local and reconciled after `initSqliteBackup()`.
- Unreadable ops state → not active (fail-safe, never over-triggers).

### Gate order — corrected implementation (user decision)

Spec §E (spec lines 271–285) places the degraded branch **above** the existing breaker return: `if (isDegradedModeActive())` first, then `if (isPlanLimitBreakerOpen()) return;` unchanged. The first implementation gated the branch on `isDegradedModeActive() && isPlanLimitBreakerOpen()` — which makes the 90% threshold and `force` mode **cosmetic**: with the breaker closed (the entire preemptive window) the degraded path never runs, while the admin panel shows ACTIVE. User decision: **"Fix code to match spec."** Mode-only gating now ships at the three sites:

1. `worker-engine.ts` `runDegradedPathIfActive()` (~L341) — the enqueue-from-mirror path,
2. `worker-engine.ts` `spawnDueCronJob()` (~L713) — cron → durable queue,
3. `cron-daemon.ts` `fireJob()` (~L255) — daemon enqueue.

This is a **corrected implementation**, not a spec deviation (recorded as a correction note in the plan, not a deviation row). The existing breaker short-circuit is untouched everywhere else (`checkScheduledJobs` order verified).

### Leadership (fail-closed)

- Netlify Blobs lease: ETag CAS (`onlyIfMatch` / `onlyIfNew`), 10-min lease, 60-s renew, store `degraded-leader-lock` / key `degraded-leader`.
- Holder id `${LEADER_SELF}#${randomUUID()}` minted once per process (memoized on `globalThis`) — CAS cannot fix a colliding identity.
- Blobs error → fail-closed (`false`): no uncoordinated execution (R2/R3 class).
- `canExecuteDegradedWork()` splits leader election by DB availability — spec-consistent (spec line 15): during a hold there is no Prisma leader to elect, so degraded leadership is elected on the Blobs lease alone.

### Degraded-safe task registry (2 of 29)

- NEW `lib/services/worker/degradedTaskRegistry.ts` — all 29 task types registered, deliberately **conservative**: a type is `degradedSafe` only with a `verifiedBy` note.
- Only `recommendations` and `corp_actions` are safe today (`DEGRADED_EXECUTOR_TASK_TYPES`); everything else is skipped + audited (`DEGRADED_JOB_SKIPPED`), never half-executed.
- `corp_actions` safety extracted to `lib/services/corpActionPurpose.ts`.
- `cron_job.config` is added by `ensureControlColumns()` (post-schema), **not** in `SCHEMA_SQL` (Lesson 155's finding — no semicolons inside `--` schema comments).

### Durable queue (`_degraded_task`, NEW in `lib/sqlite.ts`)

- 8 exported SQL statements (`DEGRADED_DEDUP/CLAIM_CANDIDATE/CLAIM/COMPLETE/LIST/COUNTS/OLDEST_PENDING/REQUEUE_STALE_SQL`) + sync sql.js accessors (the substrate is sync — artificial `Promise` wrappers rejected in the plan deviation log; `drainDegradedQueue()` stays async for the injected executor only).
- Invariants: 90-min dedup window, 5-task drain bound, 30-min stale-`running` reclaim (a dead leader's row is never stranded — status-guarded claim), strict `created_at` cutoff, no completion-outbox enqueue.
- Real-sql.js guard in `sqlite.test.ts` (bind-arity pinned per statement — a fully mocked SQLite cannot catch a placeholder/bind-count bug; Lesson 152).

### Execution wiring

- NEW `lib/services/worker/degradedExecutor.ts` — executes the 2 safe types from mirror data; structural "no `prisma` in this file" test + behavioural transitive-hold acceptance (Lesson 156: both Prisma touchpoints in `runDailyRecommendations()` reject with `P6003` and the run still completes).
- NEW `lib/services/worker/degradedQueue.ts` — enqueue/claim/complete/drain + skip auditing.
- NEW `lib/services/degradedMode.ts` (evaluation, precedence, hysteresis) + `lib/services/degradedLeader.ts` (Blobs lease).
- `instrumentation.ts` wires mode/leader init; `setSqliteDbForTests()` test hook added.

### Admin surface + audit

- NEW `GET/PATCH /api/admin/degraded-mode` (`securityAdmin`): GET reports **why** mode is on/off (mode + queue status + lease holder + available modes); PATCH zod-validates `z.enum(["auto","force","off"])`, persists to `_degraded_state`, audited as `DEGRADED_MODE_SET` (operator attributed).
- `/admin/utils/db-health` Degraded Mode block (live-checked: 0 console errors, 7/7 GET 200) + `/api/admin/db-health` additive fields.
- Audit tags (5): `DEGRADED_MODE_ENTERED`, `DEGRADED_MODE_EXITED`, `DEGRADED_JOB_SKIPPED`, `DEGRADED_LEADER_UNAVAILABLE`, `DEGRADED_MODE_SET`.

## Tests

- **6 NEW suites**: `degradedMode.test.ts` (hysteresis/precedence/fail-safe, real `opsMonthly` aggregation) · `degradedLeader.test.ts` (acquire/renew/steal-expired, race → one winner, Blobs error → fail-closed) · `degradedQueue.test.ts` (lifecycle, dedup, skip-audit, limits) · `degradedExecutor.test.ts` (safe-type parity + structural ban) · `degradedTaskRegistry.test.ts` (29/29 registered, no duplicates, safe/unsafe split) · `degradedModeAdminRoute.test.ts` (auth/validation/audit).
- **Gate 2×2 matrix (Lesson 157)** — mode on/off × breaker open/closed in `worker-engine.test.ts` (36 tests: `runs the degraded path when the mode is engaged even if the breaker is CLOSED` :701, `defers to the durable queue when the mode is engaged even if the breaker is CLOSED` :877, `does NOT drain when the mode is inactive even if the breaker is open` :670, `spawns normally when the mode is inactive (breaker state does not gate this branch)` :860) and `cron-daemon.test.ts` (25 tests: `enqueues from the mirror when the mode is engaged even if the breaker is CLOSED` :493, `still uses Prisma during a hold when the mode is inactive (kill-switch wins)` :532).
- Updated: `sqlite.test.ts` (real-sql.js degraded-SQL guard), `dbHealthRoute.test.ts`, `instrumentation.test.ts`, `dailyRecommendationService.test.ts` (Lesson 156 transitive-hold test → 35/35).
- **Separate concern (not Spec 21)**: `swingPerformanceService.test.ts` fixture-date fix — `postedAt` 2026-08-15 aged past `SWING_EXPIRY_DAYS` (45d) on 2026-09-29, so fixtures are now anchored to `now` (`POSTED_AT = Date.now() - 3*DAY_MS` etc.). `dailyRecommendationService.test.ts` also carries the Lesson 156 test; both are date-rot/time-dependent test fixes reported alongside this change set.

## Gates (all green)

| Gate | Result |
|------|--------|
| Jest (full) | **134/134 suites · 1972 pass / 4 skip / 0 fail** |
| tsc baseline | **46 exact (delta +0); prod 0** |
| ESLint | **0 errors / 1158 warnings** (baseline 1155, **+3** from Spec 21 test-file warning patterns; 0 in runtime files) |
| `npm run quickbuild` | **exit 0 · 76 s · 199/199 static pages** |
| Doc budget | see Documentation below (re-run after this file) |

## Documentation & bookkeeping

- **AGENTS.md v3.45.0 row is DEFERRED** — `AGENTS.md` sits at 32,666 B / 32,768 B cap (102 B headroom), so a ~2 KB version row would breach the per-file budget (Lesson 142). The compact row lives in `versions-index.md` + `.agents/CHANGELOG.md` and is recorded here. **No AGENTS.md edit in this version.**
- Lessons **152–157** (152 real-sql.js bind-arity guard · 153 real-engine claim defect — `db.run(...).changes` vs `getRowsModified()` · 154 hysteresis two comparisons · 155 `catch→[]` starvation + warn-once log latch · 156 transitive Prisma ban, behavioural test · 157 breaker/mode 2×2 gate matrix, name-vs-fixture false guard).
- **Plan records the gate-order fix as a correction note** (under `### Deviation log`), not a deviation row — the shipped code now matches the spec; the two logged deviations (sync sql.js accessors, `requeueStaleDegradedTasks`) are unchanged.
- No Prisma migration · no new runtime dependency · no OpenAPI change (degraded-mode route is admin-internal like its peers).
- **Findings recorded in `TODO.md`** (this version's required list): follower snapshot-upload coordination without changing `preserve-mirror`; 34 Chartink HTTP 419s; production FCP `25235 ms` / TTFB `20975 ms` at `https://tradenext6.netlify.app/`; `themeColor` viewport warnings; redeployment requirement.
- Browser/live-sheet verification: admin db-health Degraded Mode block checked live on `:3000` (0 console errors); full e2e deferred to the PR gate (repo convention for this branch).
- **Commit plan (pending explicit user go-ahead)**: one Spec 21 commit + PR #133 update; no push/PR/merge/deploy without the user's instruction.
