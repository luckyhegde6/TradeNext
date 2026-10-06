# Implementation Plan — Degraded SQLite Execution Engine & Preemptive Plan-Limit Switch

## Spec Reference

- **Spec**: `.agents/specs/21-degraded-sqlite-execution-engine.md`
- **Branch**: `feature/google-sheets-tracking` (PR #133 — this work lands as one commit on the
  existing PR, NOT a new branch; PR #133 already contains the `runInChunks()` Today's Picks fix)
- **Created**: 2026-10-05
- **Status**: spec 21 **APPROVED** by user 2026-10-05; implementation in progress.
  Commit strategy (user decision): finish the whole spec, then land as **one** commit on PR #133.
  Merge/deploy remains unauthorised.
- **Blobs CAS correction (see spec header)**: the design was amended after the build proved
  `@netlify/blobs@11.0.3` has a real ETag CAS (`onlyIfNew`/`onlyIfMatch`). The leader is also
  split: Prisma election while the breaker is closed, fail-closed Blobs lease while it is open.

---

## Prerequisites Before Any Code

| # | Item | Status |
|---|------|--------|
| P1 | User approves spec 21 | ⛔ required |
| P2 | ~~Answer spec §17 Q1–Q3~~ | ✅ **resolved by investigation** — reads need no work; symptom = stale 31d; scope = reads+writes; SWING is a degraded candidate |
| P3 | Decide whether PR #133 merges first (`f0c73c7`, all 11 checks green) | ⛔ **now the top decision** — it contains the fix for the live symptom (spec §18) |
| P4 | Confirm Netlify Blobs works in prod (store enabled, snapshot+restore round-trip) | ⛔ required — hard prerequisite (R3) |
| P5 | Confirm prod cron rows + whether the 6h probe is actually firing | required for Phase 1 diagnosis |

> P3 is the live decision: **Today's Picks has been stale for 31 days** because run `347d6887` failed, and
> `runInChunks()` (the documented remedy) is committed but unmerged. This plan is the *resilience* layer,
> not the fix for that symptom.
> P4/P5 are *diagnostic*, not code. If Blobs is not healthy, R3 means degraded execution cannot
> elect a leader, and Phase 2 must be preceded by a Blobs fix.

---

## Implementation Steps

### Phase 0: Diagnosis — ✅ COMPLETE (2026-10-05)

1. ~~Reproduce the Today's Picks symptom~~ → **DONE**: HTTP 200, 100 symbols, `servedFrom: "memory_cache"`,
   all rows `2026-09-04`, `latestRun.status: "failed"`, `aiProcessed: 0`, `executionTimeMs: null`.
   ⇒ **stale, not a Blobs/mirror failure.** (spec F11/F12)
2. ~~Audit SWING + PERFORMANCE read paths~~ → **DONE**: both already degrade correctly; SWING is already
   SQLite-primary. **No read work needed.** (spec §17)
3. **Verify Blobs health in prod** → verify: P4 answered with evidence. *(still open)*
4. **Verify the 6h probe is firing** — `pushSqliteToPrisma()` is leader+breaker gated
   (`sqlite.ts:2252`); confirm the timer runs and `sync_history` records drains
   → verify: a recent `sync_history` row, or proof the probe never runs. *(still open — needs prod access)*

### Phase 1: SQLite substrate

5. **Add `_degraded_state` + `_degraded_task`** to the SQLite schema in `lib/sqlite.ts`, created through
   the **strict** `applySchema` path (v3.44 Lesson 151 — no fail-open on fresh init) → verify: a
   restored-snapshot replay test still passes (`sqlite.test.ts` 92/92).
6. **Add SQLite queue API** — `enqueueDegradedTask` / `claimNextDegradedTask` / `completeDegradedTask`
   + dedup window mirroring `DEDUP_WINDOW_MS` → verify: lifecycle unit test.
7. **Add outbox enqueue helper** reusing `_sync_outbox` so degraded-produced rows are drained by the
   existing `pushSqliteToPrisma()` → verify: outbox row present after `completeDegradedTask`.

### Phase 2: Control plane

8. **Implement `lib/services/degradedMode.ts`** — precedence `off > forced > breaker > threshold`,
   enter at `0.90 × planLimit`, exit at `0.80 × planLimit` **and** breaker closed, 5s cache,
   never throws → verify: threshold/hysteresis/precedence unit tests.
9. **Implement `lib/services/degradedLeader.ts`** — Blobs conditional lock (new
   `degraded-leader-lock` store), reuse `LEADER_HEARTBEAT_MS`/`LEADER_STALENESS_MS`, adaptive probe,
   **fail-closed** → verify: acquire/renew/steal + two-instance race (exactly one winner) + Blobs-error
   fail-closed tests.
10. **Register `watchDegradedLeader`** in `instrumentation.ts` (dynamic import only — EDGE-SAFETY)
    → verify: `instrumentation.test.ts` green.

### Phase 3: Capability registry

11. **Build `degradedTaskRegistry.ts`** covering all 29 `worker-service.ts:29-116` task types, seeded
    from the already-mirrored writers (`recommendations`, `swing`, `dividends`, `alerts`, `corp_actions`);
    everything else `degradedSafe: false` with a reason → verify: a test asserts **29/29 coverage** and
    that an unsafe job is skipped + audited without invoking the executor.
    *Note: `swing` is a **strong** candidate — already outbox-backed / SQLite-primary
    (`swingRecommendationService.ts:1237`).*
12. **Add audit tags** `DEGRADED_MODE_ENTERED` / `DEGRADED_MODE_EXITED` / `DEGRADED_JOB_SKIPPED` /
    `DEGRADED_LEADER_UNAVAILABLE` in `lib/audit.ts` → verify: tags exported.

### Phase 4: Degraded execution

13. **Add the degraded branch to `pollAndExecute()`** *above* the existing breaker `return` (line 330 —
    do **not** remove it) → verify: mode `off` still short-circuits on the breaker (regression test).
14. **Add the degraded branch to `checkScheduledJobs()`** above the breaker `return` (line 693) with the
    same non-removal rule → verify: same regression test.
15. **Fix `cron-daemon.ts` `fireJob()`** — Prisma `findUnique` throw → re-read the CronJob row from the
    SQLite mirror and enqueue (this is the current `Cron job fire failed` line, F2) → verify: Prisma
    throwing yields an enqueue, with zero Prisma writes attempted.

### Phase 5: Admin surface

16. **Extend `GET /api/admin/db-health`** with an additive `degradedMode` block → verify: the existing
    db-health assertions (`planLimit`, `planOperationsRemaining`) still pass unchanged.
17. **Create `POST /api/admin/degraded-mode`** — mode control + on-demand sync, Zod-validated
    → verify: 401 unauth, 400 invalid mode, 503 when breaker open, 200 with state.
18. **Admin UI** — banner, `auto`/`force`/`off` control, Blobs health chip, skipped-job counter
    → verify: loading/empty/error/data states + 375/768/1440 + dark/light.

### Phase 6: Tests & gates

19. **Unit**: `degradedMode`, `degradedLeader`, `degradedQueue`, registry coverage
20. **Integration**: breaker-open execution → SQLite → outbox → 6h push drain; `/api/recommendations`
    200 + `servedFrom: "sqlite_mirror"` under P6003
21. **Regression**: full existing suites — `sqlite` (92), `sqliteMirror` (12), `leader`, `cron-daemon`,
    `instrumentation`, `daemon-sqlite-first`, `recommendationsPlanLimitFallbacks` (21),
    `alertsMirrorFallback`, `dividendCalendarMirror`, `dbHealthRoute`
22. **E2E**: admin panel chip + kill-switch round-trip (routes mocked per repo convention)
23. **Gates**: `npx tsc --noEmit` (0 new vs the 46 baseline, prod 0) · `npm run test` · `npm run lint`
    (0 errors in new files) · `npm run quickbuild` (Netlify runs the same command)

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Threshold enter at 180k / exit at 160k | `degradedMode.test.ts` | Preemptive switch + hysteresis (no flapping) |
| Precedence `off`>`forced`>`breaker`>`threshold` | `degradedMode.test.ts` | Kill switch always wins |
| Unreadable ops state → not active | `degradedMode.test.ts` | Fail-safe, never over-triggers |
| Blobs acquire / renew / steal-when-expired | `degradedLeader.test.ts` | Lock semantics |
| Two instances race → exactly one winner | `degradedLeader.test.ts` | The user's single-instance requirement |
| Blobs error → `false` (fail-closed) | `degradedLeader.test.ts` | No uncoordinated execution (R2/R3) |
| Queue enqueue→claim→complete + dedup | `degradedQueue.test.ts` | Lifecycle + no double-claim |
| Completion enqueues outbox rows | `degradedQueue.test.ts` | 6h delivery has something to push |
| **29/29 task types registered** | `degradedTaskRegistry.test.ts` | No silent gaps |
| `degradedSafe:false` skipped + audited | `degradedQueue.test.ts` | Never half-executed |
| Stale-running reclaim (real sql.js) | `sqlite.test.ts` | A dead leader's `running` row is NOT stranded forever |
| Degraded SQL binds on real SQLite | `sqlite.test.ts` | Mocked sql.js cannot catch a placeholder/bind-count bug (Lesson 152) |
| Breaker gates still short-circuit when `off` | `worker-engine.test.ts` (:670, :860) + `cron-daemon.test.ts` (:532) | Today's behaviour preserved — kill-switch wins (Lesson 157) |

### Deviation log

| Spec says | Shipped | Why |
|---|---|---|
| `enqueueDegradedTask`/`claimNextDegradedTask`/`completeDegradedTask` return `Promise` | **synchronous** | `lib/sqlite.ts` is sql.js — `run`/`exec` are sync, and every existing accessor is sync. `drainDegradedQueue()` stays `async` for the injected executor only. Artificial `Promise` wrappers would add a hop + an unawaited-rejection failure mode for no gain. |
| — | `requeueStaleDegradedTasks(staleMs)` added | Without it a leader that dies mid-executor strands its row in `running` forever (status-guarded claim ⇒ invisible forever). |

> **Correction note (2026-10-06 — not a deviation row):** the first implementation gated the degraded branch on
> `isDegradedModeActive() && isPlanLimitBreakerOpen()`. Spec §E (spec lines 271–285) places the degraded branch
> **above** the unchanged `if (isPlanLimitBreakerOpen()) return;`, so the 90% threshold and `force` mode engage
> **preemptively while the breaker is still CLOSED** — a mode-only gate. With the extra conjunct the degraded path
> never ran until the hold had already landed (admin panel ACTIVE while ticks run Prisma). User decision: "Fix code
> to match spec" → mode-only gating ships at the three sites (`worker-engine.ts` `runDegradedPathIfActive` ~L341,
> `spawnDueCronJob` ~L713, `cron-daemon.ts` `fireJob` ~L255); the breaker return stays untouched below and no other
> call site inverts. This is a **corrected implementation** (shipped code now matches the spec), recorded as a note
> rather than a deviation row. Lesson 157 documents the 2×2 gate matrix (mode on/off × breaker open/closed) and the
> name-states-the-spec/fixture-encodes-the-bug false-guard trap.

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| Breaker open + degraded → job runs from SQLite | The core requirement |
| 6h push drains degraded rows into Prisma | End-to-end durability (F6 reuse) |
| `/api/recommendations` → 200 + `sqlite_mirror` under P6003 | Today's Picks serves |
| `/api/admin/db-health` additive-compatible | No regression for existing UI/tests |
| `POST /api/admin/degraded-mode` 401/400/503/200 | Contract + auth |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Admin panel renders mode chip | UI wiring |
| Kill switch round-trips off → auto | Control works without redeploy |
| Blobs-unhealthy chip renders | Fail-closed is visible, not silent |
| Mobile 375px layout | Responsive |

---

## Verification Checklist

```bash
npx tsc --noEmit        # 0 new errors (baseline: 46 exact, prod 0)
npm run test            # all suites green (run ALONE — Windows ';' quirk)
npm run lint            # 0 errors in new/changed files
npm run quickbuild      # production build (Netlify runs this exact command)
node scripts/dev-checks/check-tsc-baseline.mjs   # baseline gate
node scripts/dev-checks/check-doc-sizes.mjs      # doc budget
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|-----------|----------|
| Hard preemptive switch serves staler data on a healthy DB (user's explicit choice) | Hysteresis, additive `servedFrom`, admin banner, `off` kill switch | No |
| Duplicate Telegram/Sheets side effects | Fail-closed Blobs election + `degradedSafe:false` skip | No |
| **Blobs unhealthy ⇒ no degraded execution at all** | Blobs is a hard prerequisite (P4); health chip + startup log | Blobs provisioning itself |
| Long hold ⇒ unbounded outbox | Row cap + admin surfacing + prune on drain | No |
| 29 job types is a large surface | Capability registry, incremental growth, skip-not-guess | Full per-type SQLite writers |
| Two plan-limit notions (200k monthly vs 10k `getDbHealthState`) | Use monthly only; record the 10k inconsistency | Fixing the 10k figure |
| Prod cron rows / 6h probe may themselves be broken | Phase 0 step 4 diagnoses before any code | Fixing them if broken |

---

## Documentation Checklist

- [ ] `.agents/CHANGELOG.md` + `.agents/changelog/versions-v3.45.md`
- [ ] `TODO.md` quick-reference row
- [ ] `Primer.md` current status
- [ ] `agent-memory.md` activity entry
- [ ] `Lessons.md` — new lesson (reactive-vs-proactive breaker; fail-closed election)
- [ ] Session memory `decisions.md` + `flow.md` in `.agents/sessions/`
- [ ] `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`
- [ ] **`AGENTS.md` — DO NOT EDIT** (32,719/32,768 B cap, Lesson 142)

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — 0 errors in new files
4. `git status` — no junk artifacts, no secrets
5. Documentation updated per checklist
6. `.agents/rules/checklist.md` validated
7. `git status` — confirm `.agents/refresh-token.log` is not staged
