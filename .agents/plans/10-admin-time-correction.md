# Implementation Plan — Admin Time Synchronisation (server/DB time display + IST correction)

> Generated from spec: `.agents/specs/10-admin-time-correction.md`
> Branch: `feat/admin-time-correction` (from current worktree state — user decides)
> Created: 2026-09-10
> ✅ **IMPLEMENTED 2026-09-10** — all 7 phases complete + verified (targeted 118/118, tsc 46 = exact baseline, full 1106 pass / 4 skip / 1 documented pre-existing flake); docs in `.agents/changelog/versions-v3.32.md` + standard doc set. Implemented on the existing working tree `fix/sqlite-init-reserved-keyword` @ `8c67e89` — final branch name user decides.

## Spec Reference

- **Spec**: `.agents/specs/10-admin-time-correction.md`
- **Branch**: `feat/admin-time-correction`
- **Created**: 2026-09-10

---

## Implementation Steps

> Ordered steps. Each step is atomic — verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: SQLite meta helpers

1. **Add 4 `_backup_meta` helpers to `lib/sqlite.ts`** (`persistTimeCorrection`/`restoreTimeCorrection`/`deleteTimeCorrection`, `persistTimeProbe`/`restoreTimeProbe`) mirroring `persistOpsCounter` (:1582) / `persistDbErrorCounts` (:1682) — `INSERT OR REPLACE INTO _backup_meta (key, value)`, `SELECT value … LIMIT 1`, `DELETE WHERE key = ?`; export at module level (pattern :5807-5809); non-fatal try/catch → `verify: `npx tsc --noEmit` (0 new; baseline 46)

### Phase 2: Service layer

2. **Create `lib/services/timeCorrection.ts`** — `IST_OFFSET_MINUTES=330`, pure helpers `toIstIso`/`getIstNowIso`/`parseIstDateTimeLocal`/`computeCorrectionOffsetMinutes`/`applyOffset`/`formatOffsetMinutes` + persistence `saveCorrection`/`loadCorrection`/`clearCorrection`/`saveDbProbe`/`loadDbProbe` + `getCorrectedNow()`/`getCronFrom()`/`getTimeDiagnostics()` → verify: `npx tsc --noEmit` and targeted test file (step 12)
3. **Add 2 audit tags** to `lib/audit.ts` (`ADMIN_DB_TIME_CORRECTION_SET`, `ADMIN_DB_TIME_CORRECTION_CLEARED`) → verify: tags exported

### Phase 3: API routes

4. **GET `/api/admin/db-health`** — add `time: getTimeDiagnostics()` to the response (zero Prisma; `ensureSqliteBackup()` already runs) → verify: `curl localhost:3000/api/admin/db-health` shows `time` block
5. **POST `probe_time`** — zod literal `probe_time`; 30s throttle (module-level last-probe timestamp, like `nseRefreshInFlight` guard); `prisma.$queryRaw\`SELECT NOW()\`` in try/catch; persist `time_probe_db`; return full `time` block; DB-down → 200 + last-known/null + `warning` → verify: probe returns dbIso; second click <30s returns `throttled: true`
6. **POST `set_time_correction`** — zod `{ istDateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ }`; compute offset via pure helper (null → 400); persist `time_correction`; audit tag with metadata → verify: 400 on `"2026-13-99T99:99"`; success returns `computed {istDateTime, offsetMinutes, appliedAt}`
7. **POST `clear_time_correction`** — delete `time_correction` row; audit tag → verify: correction null in subsequent GET

### Phase 4: UI

8. **"Time Synchronisation" card in `app/admin/utils/db-health/page.tsx`** — display row (Server ISO/tz/offset · IST · DB time · misalignment badge), Probe button, correction form (`datetime-local` prefilled with IST; Apply/Clear; enabled-state amber notice) → verify: `npx tsc --noEmit`; page loads on :3000
9. **Responsive + dark-mode check** → verify: 375px/768px/1440px + dark theme render (Playwright if dev server up)

### Phase 5: Wiring (corrected now into scheduling)

10. **`lib/services/recommendationCronService.ts:117/:186`** — pass `getCronFrom()` as the `from` arg to `calculateNextRun` → verify: existing `recommendationCronService.test.ts` still green (defaults unchanged when no correction)
11. **`lib/services/worker/worker-engine.ts:597/:630/:653`** — `getCorrectedNow()` for nextRun advance + due gate `now` → verify: existing `worker-engine.test.ts` + `cron-daemon.test.ts` green (no-correction path equals today's behavior — `applyOffset(_, 0)` identity)

### Phase 6: Tests

12. **NEW `lib/__tests__/timeCorrection.test.ts`** (~9, per spec §12) → verify: `npm run test lib/__tests__/timeCorrection.test.ts` all pass (TZ-pinned `Asia/Kolkata` for `toIstIso`; `@/lib/sqlite` mocked)
13. **`lib/__tests__/sqlite.test.ts` +2** (time_correction roundtrip incl. delete; time_probe roundtrip) → verify: `npm run test lib/__tests__/sqlite.test.ts` (69 → 71)
14. **Full suite + regression** → verify: `npm run test` (baseline 1106 pass / 4 skip / 1 flake), `npx tsc --noEmit` (46 = baseline, 0 new)

### Phase 7: Live verification + docs

15. **Live-verify on :3000** (if dev server running; Postgres optional — `probe_time` degrades gracefully) → verify: card renders, correction applies (nextRun shifts by offset), 0 console errors; Docker/Postgres optional for real probe
16. **Documentation + session memory** (AGENTS.md version row v3.32.0, CHANGELOG, TODO, Primer, agent-memory, Lessons if new pattern, `.agents/sessions/` decisions+flow) → verify: all four doc files updated
17. **Pre-commit gate** (checklist, hygiene, run `git status`; no junk; NO commit/push without user approval) → verify: checklist §Pre-Commit gate

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| IST-as-UTC skew → offset −330 | `timeCorrection.test.ts` | Regression for diagnosed +5.5h corruption |
| Aligned clock → offset 0 | `timeCorrection.test.ts` | Identity when server correct |
| parse/format/apply helpers | `timeCorrection.test.ts` | Correctness + sign semantics |
| `getTimeDiagnostics` misaligned flag | `timeCorrection.test.ts` | null no-probe / false within 60s / true >60s |
| `time_correction` meta roundtrip | `sqlite.test.ts` | persist/restore/delete |
| `time_probe_db` meta roundtrip | `sqlite.test.ts` | persist/restore |

### Integration/Route (If Mock Pattern Lightweight)

| Test | What It Verifies |
|------|------------------|
| POST invalid `istDateTime` → 400 | Validation |
| POST `clear_time_correction` → success | Wiring |

### E2E (If UI Change)

| Test | What It Verifies |
|------|------------------|
| db-health page loads with card | Component rendering |
| Card renders in empty (not-probed) state | Empty state |
| Mobile layout (375px) | Responsive |

---

## Verification Checklist

```bash
npx tsc --noEmit                    # 0 new errors (baseline: 46)
npm run test lib/__tests__/timeCorrection.test.ts   # new pure tests
npm run test lib/__tests__/sqlite.test.ts           # 71 pass
npm run test                        # full: 1106 pass / 4 skip / 1 flake (baseline)
npm run lint                        # no new warnings
npx prisma validate                 # unchanged (no schema change)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Node-cron path-A timers can't be shifted | Correction fixes DB-persisted nextRun math + `checkScheduledJobs` gate; document limitation; long-term = set `TZ`/`UTC` env on Netlify | Yes (deploy-operator) |
| SQLite meta resets on fresh deploy | Same mechanism as ops-counter; UI notes fresh-deploy reset; admin re-applies | Acceptable |
| `SELECT NOW()` returns DB-server time (Prisma **Postgres** is authoritative) | That's the point — Postgres clock vs app-server clock | No |
| Throttle too aggressive for debugging | 30s matches probe-per-click need; message surfaces `throttled` | No |
| Correction drift over time | Re-apply via the same form anytime; `appliedAt` logged | No |

---

## Documentation Checklist

- [x] **AGENTS.md** — version row (v3.32.0) + CHANGELOG bullets
- [x] **CHANGELOG** — `.agents/changelog/versions-v3.32.md`
- [x] **TODO.md** — quick-reference row
- [x] **Primer.md** — project status
- [x] **agent-memory.md** — activity entry
- [x] **Lessons.md** — new lesson if pattern/bug discovered
- [x] **Session memory** — `decisions.md` + `flow.md` in `.agents/sessions/`
- [x] **session-todos.md** — current session updated
- [x] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no new warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
7. **NO commit/push/merge without explicit user approval**