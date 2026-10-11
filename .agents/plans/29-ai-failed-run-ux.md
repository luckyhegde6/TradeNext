# Implementation Plan — AI-Failed-Run UX (honest latest-run + repair sweep)

> Generated from spec: `.agents/specs/29-ai-failed-run-ux.md`
> Save to `.agents/plans/29-ai-failed-run-ux.md`

## Spec Reference

- **Spec**: `.agents/specs/29-ai-failed-run-ux.md`
- **Branch**: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`)
- **Created**: 2026-10-11
- **Status**: ⏳ **DRAFT — pending human spec review & approval before implementation (spec-driven gate)**

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step → verify: [check]`

### Phase 1: Predicate fix + fingerprint parity (`lib/services/dailyRecommendationService.ts`)

1. **Fix the latest-run query** (`getLatestRecommendations` at `:1302-1318`): change `where: { status: { in: ["completed", "failed"] }, uniqueStocks: { gt: 0 } }` → `status: "completed"` AND `aiProcessed: { gt: 0 }` (keep `uniqueStocks.gt: 0` for safety). Document why failed runs must never win: a failed run's row count is raw screener output, not AI-analyzed picks. → verify: `npx tsc --noEmit` (0 new).

2. **Update `getLatestRunFingerprint` (`:1236-1248`)** to the SAME predicate — fingerprint + latest-run must never diverge (cache-validity parity) → verify: unit test asserts both use one shared predicate (create `LATEST_RUN_WHERE` const if not already shared; keep a single source of truth).

3. **Add `lastSuccessfulRunDate` to `LatestRecommendations`** interface (`:75-90`) — `runDate` (UTC ISO) of the newest **completed+aiProcessed>0** run, or null. Populate in the service. → verify: tsc; interface test.

4. **Guard the read chain when no completed run exists** (Spec 29 §4B): `getLatestRecommendations` → null `run`, `stocks: []`, `lastSuccessfulRunDate: null` — never serves a failed run's rows as if picks → verify: route test with only-failed-runs fixture.

### Phase 2: Repair sweep (admin)

5. **Create `POST /api/admin/recommendations/repair-failed-runs/route.ts`** (`runtime = "nodejs"`, admin session, zod body optional `{ dryRun?: boolean }`): finds `DailyRecommendationRun` where `status:"failed" AND aiProcessed:0 AND uniqueStocks>0` ordered by runDate desc, cap 200 rows/run; recompute `aiProcessed` from the associated `DailyRecommendationStock` rows (relation exists — grep the exact relation name first); if `aiProcessed > 0` → set `status:"completed"` (+ `errorMessage:null` if the field exists — check schema); audit `RECS_REPAIR_FAILED_RUNS` with `{ repaired, dryRun, candidateRuns }`; respond `{ success, repaired, candidateRuns, dryRun }`. **Dry-run default returns candidates without mutating (safe default).** → verify: tsc; route unit tests (below).

6. **Add audit tag `RECS_REPAIR_FAILED_RUNS`** to `lib/audit.ts` → verify: tag exported.

### Phase 3: UI (reliable AI-unavailable notice + honest date)

7. **`app/api/recommendations/route.ts`**: pass `lastSuccessfulRunDate` through (map from service) ); keep `run`/`latestRun` keys intact (additive). → verify: curl shape includes the new key.

8. **`app/recommendations/page.tsx`**: compute + pass `aiUnavailable` / `aiUnavailableDate` to `DailyPicksTab` reliably — `aiUnavailable = !latestRun?.aiProcessed` (or `!run` when none); `aiUnavailableDate = lastSuccessfulRunDate` (NOT the failed run date). Render the banner when `aiUnavailable` OR `run === null` (v3.11.1 notice machinery already in `DailyPicksTab.tsx` — wire the props, don't re-create). → verify: page renders banner in both failed-run + no-run states on :3000.

### Phase 4: Tests

9. **Create `lib/__tests__/recommendationsRunPredicate.test.ts`** (or extend existing recs tests):
   - only-failed-runs → latest = null, stocks [] , `lastSuccessfulRunDate:null`
   - mixed (failed newer, completed older) → completed wins
   - completed+aiProcessed>0 → served, `lastSuccessfulRunDate` = its runDate
   - `aiProcessed:0` completed → **not** served (predicate parity with fingerprint)
   → verify: `npm run test -- recommendationsRunPredicate`.

10. **Route tests** (`app/api/recommendations/route.test.ts` pattern): new key present; run-null case still 200; `aiUnavailable` wiring (page-level test optional if thin) → verify: green.

11. **Repair-sweep tests** (route block): dry-run no mutation; non-dry repairs failed→completed when `aiProcessed>0`; skip when 0; auth 401; zod 400 → verify: green.

### Phase 5: Docs

12. **`.agents/changelog/versions-v3.49.md`** — Spec 29 detail (root cause: failed-run predicate, evidence run 347d6887) → verify: file exists, indexed.
13. **AGENTS.md** — version row (32 KB cap watch, Lesson 142 — defer into changelog if capped) → verify: row added or deferral noted.
14. **TODO.md / Primer.md / agent-memory.md** — status + activity entries → verify: each updated.
15. **Lessons.md** — add if reusable pattern (failed-run must never win latest-run reads) → verify: entry appended.
16. **Session memory** — `.agents/sessions/2026-10-11-recs-live-analysis/` `decisions.md` + `flow.md` → verify: files reflect Spec 29.
17. **`.agents/session-todos.md` + `.agents/handoffs/active/latest.md`** → verify: updated.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| only-failed runs → latest null + empty stocks | `recommendationsRunPredicate.test.ts` | Core bug fix |
| failed-newer/completed-older → completed wins | `recommendationsRunPredicate.test.ts` | Predicate order |
| `aiProcessed:0` completed excluded | `recommendationsRunPredicate.test.ts` | AI-gate |
| fingerprint == latest predicate (single const) | `recommendationsRunPredicate.test.ts` | Cache parity |
| `lastSuccessfulRunDate` populated/null correctly | `recommendationsRunPredicate.test.ts` | Interface |
| sweep dry-run: candidates only, no mutation | repair route test | Safe default |
| sweep non-dry: failed→completed when `aiProcessed>0` | repair route test | Repair works |
| sweep skips `aiProcessed:0` | repair route test | Never fake a success |
| 401 unauth / zod 400 | repair route test | Auth + validation |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `GET /api/recommendations` includes `lastSuccessfulRunDate` | Live :3000 curl |
| Repair sweep dry-run vs real (real only with explicit intent) | Live safe-guarded |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Existing `e2e/recommendations.spec.ts` still green (additive) | No regression |
| (optional) page shows honest banner in no-run fixture | Manual |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking (baseline: 46 error lines, prod 0)
npx tsc --noEmit

# Tests — RUN ALONE, never chained with ';'
npm run test -- recommendationsRunPredicate
npm run test -- dailyRecommendationService
npm run test            # full suite

npm run lint

# Hygiene
git status        # no junk (*.yaml, screenshots, dev-server.log), no secrets
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Legacy "completed with null confidence" runs (v3.5.1 era) treated as healthy | They ARE healthy rows (HOLD etc.) — predicate keeps them when `aiProcessed>0`; if some legacy rows have `aiProcessed:0`, they simply won't be "latest" — acceptable, visible via admin | No |
| Repair could resurrect a run whose AI rows are stale | Recommended only as an ops path after connectivity is proven (Spec 28); dry-run first | No |
| Prediction parity risk if two consts drift | Single `LATEST_RUN_WHERE` shared const | No |
| `aiUnavailable` banner now appears after ANY failure (more visible) | Intended — honesty; text says "last successful run" | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row (or documented deferral at 32 KB cap, Lesson 142)
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.49.md` + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit. **Commit only on explicit user request; merge/deploy user-only (D9).**

1. `npx tsc --noEmit` — 0 new errors (baseline 46)
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated