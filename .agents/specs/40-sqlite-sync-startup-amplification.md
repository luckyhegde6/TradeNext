# Spec 40 — SQLite / Prisma sync amplification on Netlify

> Status: INVESTIGATION + SPEC DRAFT. No implementation or verification claims yet.
> Branch: `fix/sqlite-sync-startup-amplification` (created from current `main` at `7934335793a0773b39ecbc01ccbb59742dfdcfc5`).
> Evidence: production log excerpt supplied by the user, Nov 4 2026 ~00:06–02:06 IST; repository source at the same main SHA.

## 1. Problem and user value
Production logs show repeated per-instance mirror restores, Prisma→SQLite hydration, Blobs snapshot uploads, instrumentation starts, timer starts and leader-election churn. In the same window, a `CronJob.update` timed out after 120 seconds and worker/leader operations timed out. Reduce avoidable database and snapshot work without making cold instances serve an empty or stale SQLite mirror.

## 2. Evidence (observed, not inferred)
- Multiple distinct Netlify instance identifiers start instrumentation and report `SQLite: sync complete`, `totalRows≈2,853–2,860`, `durationMs≈10–13s`.
- Repeated `SQLite: mirror snapshot restored` events report 16,216,064 bytes and 36 tables.
- Repeated `SQLite: mirror snapshot uploaded to Blobs` events report the same 16,216,064 bytes.
- `WorkerStatus.updateMany` leader election timed out at 120 seconds; `CronJob.update` timed out at 120 seconds.
- Log shows leader acquired/lost/reclaimed events across multiple instance IDs.
- The logs have no SQL statement-level detail or per-query counts; they do not identify an individual table/query as the dominant operation.

## 3. Existing modules/contracts to reuse
- `instrumentation.ts`: starts worker/cron/sqlite-sync leader watchers, intelligence cache restore, SQLite init, daily price flush, ops-counter persistence and write-behind flush.
- `lib/sqlite.ts`: `initSqliteBackup`, per-instance boot hydration, `syncFromPrisma`, snapshot restore/persist/upload, 15-minute recovery probe and leader-gated SQLite→Prisma push.
- `lib/services/leader.ts`: existing leader elections/watchdogs. Do not add another leader mechanism.
- `lib/services/worker/cron-daemon.ts`: current 5-minute resync + outbox drain; maintain worker task/cron semantics.
- `lib/services/priceCache.ts`: daily price accumulator and timer; make no write-path change without tests proving single-writer behavior.
- Existing tests: `sqlite.test.ts`, `sqliteMirror.test.ts`, `instrumentation.test.ts`, `daemon-sqlite-first.test.ts`, `cron-daemon.test.ts`.

## 3A. Confirmed implementation defect (PR #154 follow-up)
- The recurring 15-minute recovery probe called `syncFromPrisma()` on every healthy tick before draining the SQLite→Prisma outbox.
- This performs a full mirror pull repeatedly, contrary to the boot-hydration-only pull invariant, and is a credible source of recurring Prisma query spikes.
- The probe should perform one lightweight liveness read and drain the outbox only. Full pulls remain limited to boot hydration and explicit admin recovery actions.
- Regression coverage must assert the recurring probe does not issue recommendation/run/tracker collection reads.

## 4. Core architectural invariant
Spec 09 states:
- Boot hydration is the only Prisma→SQLite pull and runs on every instance because SQLite is instance-local.
- The recurring six-hour sync is SQLite→Prisma, one-way push.
- No periodic Prisma→SQLite pull should occur after boot.
This is authoritative unless a replacement design is proven to preserve every instance's read availability and consistency. Do NOT simply leader-gate boot hydration.

## 5. Initial root-cause hypothesis
1. The 15-minute recovery probe appears to execute full `syncFromPrisma()` plus `pushSqliteToPrisma()` when Prisma is healthy, contradicting Spec 09's "only boot pulls" invariant and user expectation of a six-hour push. Confirm actual runtime cadence, production trigger, and historical intent before changing it.
2. Boot hydration per instance is expected, but the same 16 MB snapshot upload per instance suggests cross-instance dedup is absent. Existing upload serialization/digest state is process-local. A safe, authoritative distributed optimization is not yet established; do not suppress a needed instance's bootstrap based solely on another instance uploading.
3. Other candidates: cron-daemon 5-minute DB calls, repeated leader claims under instance recycling, CronJob.ensure update timeout and per-instance price flush timer. No SQL-level attribution is available.

## 6. In scope
- Verify and correct sync cadence so recurring work matches intended contract, with no periodic full Prisma→SQLite pull if Spec 09 still governs.
- Reduce redundant snapshot upload work safely, preserving durable snapshot freshness, failed-upload retry, cold-start restore, and Blobs context retry behavior.
- Review whether daily price flush timer can remain per-instance without duplicate writes; any change must preserve locally accumulated prices and avoid losing unsynced records.
- Bound avoidable cron/leader control-plane DB activity where evidence demonstrates repeated unnecessary calls.
- Add structured trigger/instance/cadence/row-count/duration logs and focused counters where needed to prove behavior.

## 7. Out of scope
- New queue system, ORM, database, dependency, Prisma schema/migration, broad worker rewrite, auth rewrite, or changes to stock-analysis/performance business logic.
- Disabling per-instance boot hydration without a replacement for the local mirror.
- Production deployment, environment/secrets changes, unrelated scheduled jobs.

## 8. Requirements and failure behavior
- Every cold instance must restore a valid local mirror from durable snapshot and/or complete boot pull before dependent reads rely on it.
- Prisma plan-limit breaker and degraded mode semantics remain intact.
- Boot pull remains read-only; it must never reconcile/push SQLite→Prisma.
- Recurring SQLite→Prisma push must be single-leader, idempotent, retry-safe, and use intended cadence.
- Snapshot upload skips only when unchanged under a safe coordination model; failed upload remains retryable.
- All leader/lease failures remain explicit and fail-safe.
- Do not add overlapping writers to daily_prices or job tables.
- Never log secrets, tokens, or sensitive payloads.

## 9. Acceptance criteria
- Tests prove boot hydration still happens per instance and does not perform SQLite→Prisma reconciliation.
- Tests prove periodic probe does not perform unintended full Prisma→SQLite hydration; push cadence matches approved policy.
- Snapshot upload tests prove unchanged data is not needlessly re-uploaded where safe coordination exists, while changed bytes and failed uploads behave correctly.
- Tests cover multiple instrumentation registrations, leader loss/reacquire, concurrent sync callers, breaker-open, missing/corrupt snapshots, and Blobs context unavailable/retry.
- Daily price flush behavior has tests for lifecycle and no dropped accumulated data.
- No regression to SQLite cold-start/plan-limit serving behavior.
- Required full gates recorded accurately; no check claimed green unless run.

## 10. Open decisions / risks
- Confirm whether production's 15-minute probe is intentionally retained as a temporary reliability backstop or should be changed to the user-defined six-hour push.
- Whether cross-instance snapshot upload dedup can safely use Blobs ETag/conditional writes without risking stale snapshot overwrite.
- Whether timer-per-instance is a real DB-write multiplier: each accumulator is local to an instance, so leader-only flush could lose another instance's accumulated data absent a shared buffer.
- Query-level attribution needs provider query stats or privacy-safe diagnostic sampling; current application logs are insufficient.
