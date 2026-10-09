# Implementation Plan — Scheduled Execution Reliability (cron · worker/outbox · daily-rec · swing)

> Generated from spec: `.agents/specs/25-scheduled-execution-reliability.md`
> Save to `.agents/plans/25-scheduled-execution-reliability.md`

## Spec Reference

- **Spec**: `.agents/specs/25-scheduled-execution-reliability.md`
- **Branch**: `fix/daily-rec-swing-cron-worker`
- **Created**: 2026-10-09

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Cron timezone reconciliation (canonical UTC)

1. **Set `DEFAULT_TIMEZONE = "UTC"`** in `lib/services/worker/cron-daemon.ts:26` → verify: `grep DEFAULT_TIMEZONE`
2. **Store UTC config** in `ensureRecommendationCrons()` (`recommendationCronService.ts:208` update + `:227` create) → verify: `npx tsc --noEmit`
3. **Add config-drift self-heal** (`config?.timezone !== "UTC"` ⇒ `changed`) → verify: unit test in Phase 5
4. **Fix header comment** (`recommendationCronService.ts:22`) IST → UTC → verify: read
5. **Add systemManaged tz-mismatch observability log** in `cron-daemon.ts syncCronJobs` → verify: `npx tsc --noEmit`

### Phase 2: Catch-up policy (run any overdue) + degraded path

6. **Rewrite `catchUpMissedCronJobs`** (`worker-engine.ts:856`): remove the `maxLatenessMs` skip branch; spawn every active job with `nextRun <= now` → verify: `npx tsc --noEmit`
7. **Replace the degraded early-return** with: read `getSqliteFallback().getCronJobs()`, filter `is_active && next_run <= now`, `enqueueDegradedTask` each, then advance the mirror `next_run` via `upsertCronJob(calculateNextRun(expr, getCronFrom()))` → verify: unit test
8. **Return `{ recovered, skipped: 0, enqueued }`**; update JSDoc → verify: `npx tsc --noEmit`
9. **Wire the call sites** (`cron-daemon.ts` boot + 5-min resync) to the new shape → verify: `npx tsc --noEmit`

### Phase 3: Delete dead poll

10. **Delete `startScheduler()`** (`worker-engine.ts:179`) and **`checkScheduledJobs()`** (`:803`) and the now-unused `schedulerInterval` var (`:16`) → verify: `grep -n "startScheduler\|checkScheduledJobs\|schedulerInterval" lib` returns nothing
11. **Remove `CRON_CATCHUP_WINDOW_MS`** (and adjust any remaining import) → verify: `grep` empty

### Phase 4: Outbox drain on resync tick

12. **Call `pushSqliteToPrisma()`** (defaults: leaderGate true, breaker-gated) from the 5-min resync interval in `cron-daemon.ts`, wrapped in `.catch` → verify: `npx tsc --noEmit`

### Phase 5: Tests

13. **`lib/__tests__/worker-engine.test.ts`** — remove `checkScheduledJobs` imports/blocks (`:143`, `:322-375`, `:865-954`); rewrite catch-up tests (run-any-overdue; degraded enqueue + mirror advance; no Prisma in degraded branch; non-due no-op; exports gone) → verify: `npm run test`
14. **`lib/__tests__/cron-daemon.test.ts`** — default tz → `"UTC"`; per-job override still honoured; resync calls `pushSqliteToPrisma` → verify: `npm run test`
15. **`lib/__tests__/recommendationCronService.test.ts`** — tz assertion → `"UTC"`; drift self-heal → verify: `npm run test`
16. **`lib/__tests__/daemon-sqlite-first.test.ts`** — registration tz → `"UTC"` → verify: `npm run test`

### Phase 6: Verification (daily-rec + swing + live)

17. **Manual “Run Now” Daily Recommendations** (local admin) → verify: run row + stocks persisted in the mirror
18. **Forced degraded catch-up smoke** (local) → verify: `enqueued > 0`, leader drains, mirror `next_run` advances
19. **Playwright** prod sanity: admin cron page shows updated `nextRun` after deploy → verify: no console errors

### Phase 7: Documentation

20. **AGENTS.md** → verify: version row added
21. **CHANGELOG** (`.agents/changelog/versions-v3.47.md`) → verify: created + index linked
22. **TODO.md** → verify: quick-reference row added
23. **Primer.md** / **agent-memory.md** / **Lessons.md** → verify: entries added
24. **Session memory** (`decisions.md` + `flow.md`) → verify: files updated
25. **session-todos.md** / **handoffs/active/latest.md** → verify: updated

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Job 3h overdue now spawns | `worker-engine.test.ts` | Run-any-overdue (was skipped) |
| Prisma path returns `skipped: 0, enqueued: 0` | `worker-engine.test.ts` | Return contract |
| Degraded path enqueues due mirror jobs | `worker-engine.test.ts` | Hold still runs work |
| Degraded path advances mirror `next_run` | `worker-engine.test.ts` | No 5-min re-enqueue |
| Degraded path makes zero Prisma cron reads | `worker-engine.test.ts` | Lesson 156 invariant |
| Non-due job never spawned/enqueued | `worker-engine.test.ts` | Due filter |
| `checkScheduledJobs`/`startScheduler` unexported | `worker-engine.test.ts` | Dead code removed |
| Default registration tz = UTC | `cron-daemon.test.ts` | Split-brain fixed |
| Per-job override honoured | `cron-daemon.test.ts` | Manual jobs unaffected |
| Resync tick drains outbox | `cron-daemon.test.ts` | Stuck outbox fixed |
| Store UTC on create/update | `recommendationCronService.test.ts` | Self-heal source |
| IST row rewritten to UTC | `recommendationCronService.test.ts` | Self-heal of prod rows |
| SQLite-first path tz = UTC | `daemon-sqlite-first.test.ts` | Registration path |

### Integration / Live Tests (If applicable)

| Test | What It Verifies |
|------|------------------|
| Admin “Run Now” Daily Recommendations completes | End-to-end daily-rec |
| Forced degraded catch-up enqueues + drains | Degraded recovery |
| Prod `/api/admin/cron` `nextRun` after deploy | Live scheduling |

### E2E Tests (If UI Change)

*(N/A — no UI change in spec 25; GS UI change is spec 26.)*

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass
npm run lint                        # No warnings

# Prisma
npx prisma validate                 # Schema valid (unchanged)
npx prisma generate                 # Client regenerated

# Build
npm run build                       # Production build succeeds (optional)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Run-any-overdue re-runs a job already done by another instance | `spawnDueCronJob` 90-min pending/running dedup | No |
| Degraded mirror advance diverges from Prisma during a long hold | 6h `reconcileControlToPrisma` re-syncs on recovery; `next_run` is recomputed, not cumulative | No |
| Deleting `checkScheduledJobs` breaks an unknown importer | grep proves only dead `startScheduler` + tests reference it | No |
| Per-job non-UTC override (manual crons) still mismatches `nextRun` | Documented caveat; system jobs (the broken ones) are UTC; optional follow-up | Yes |
| `pushSqliteToPrisma` contention on multi-instance | leader-gated (`sqlite-sync`) + in-flight guard | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row in table
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.47.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (timezone split-brain + degraded catch-up)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
