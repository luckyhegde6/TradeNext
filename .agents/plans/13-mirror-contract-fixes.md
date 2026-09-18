# Implementation Plan — Mirror-Contract Fixes (bugs 15 / 16 / 17)

> Generated from spec: `.agents/specs/13-mirror-contract-fixes.md`
> Save to `.agents/plans/13-mirror-contract-fixes.md`

## Spec Reference

- **Spec**: `.agents/specs/13-mirror-contract-fixes.md`
- **Branch**: `fix/mirror-contract-fixes`
- **Created**: 2026-09-18
- **Approved scope**: 15 + 16 + high-impact 17; heartbeat POST auth added.

---

## Implementation Steps

### Phase 0: Setup

1. **Create branch** `fix/mirror-contract-fixes` from `main` (carries the 6 uncommitted doc
   files from the verification session) → verify: `git branch --show-current`
2. **Shared mapper** `lib/services/corpActionMirror.ts` → verify: `npx tsc --noEmit` (46 baseline)

### Phase 1: Bug 16 — mirror shape + IST day key

3. **Apply mapper** in `app/api/corporate-actions/combined/route.ts` at `:292` and `:445`
   → verify: unit test asserts camelCase keys on a snake_case fixture
4. **Local day key** in `app/markets/calendar/page.tsx` — replace
   `new Date(...).toISOString().split("T")[0]` with a local `toDayKey(YYYY-MM-DD)` used for
   `dateStr`, `actionDate`, `eventDate` → verify: 40 mirror rows render on IST-correct days

### Phase 2: Bug 17 — dividends calendar

5. **Mirror fallback** in `lib/services/dividendCalendarService.ts` `fetchDividends` catch
   (filter `action_type=DIVIDEND` + date window) → verify: unit test with Prisma rejecting P6003

### Phase 3: Bug 15 — alerts

6. **`getMirrorAlerts(userId)`** + fallback in `app/api/alerts/route.ts` (list + `action=count`)
   → verify: unit test — P6003 → 200 mirror array scoped to user; mirror down → `[]`
7. **Page guard** `app/alerts/page.tsx` — `Array.isArray` + `res.ok` + error state
   → verify: e2e route-intercept 500 → page renders, no Error Boundary

### Phase 4: Bug 17 — workers status

8. **Auth + mirror fallback** in `app/api/admin/workers/status/route.ts`:
   GET (+`includeOffline`) and POST both `auth()` admin-gated; GET falls back to
   `getWorkerStatuses()` mapped to camelCase → verify: 401 unauth tests + mirror shape test
9. **Poll backoff** `app/admin/utils/workers/page.tsx` — recursive `setTimeout`
   10s → 20s → 40s → 60s cap on failure, reset on success, "retrying" hint
   → verify: no repeated identical console errors when endpoints 500

### Phase 5: Tests

10. **Unit tests** `lib/__tests__/{corpActionMirror,alertsMirrorFallback,workersStatusRoute,dividendCalendarMirror}.test.ts`
    → verify: `npm run test` all pass
11. **E2E guard** alerts page against a 500 → verify: `npx playwright test -g alerts`

### Phase 6: Documentation

12. **BUGS.md** — 15/16 → Fixed; 17 narrowed + follow-up row for deferred endpoints
13. **AGENTS.md / CHANGELOG / Primer / agent-memory / Lessons / session files / session-todos / handoff**

---

## Test Strategy

| Test | File | What It Verifies |
|------|------|------------------|
| snake→camel mapping | `corpActionMirror.test.ts` | Contract parity with Prisma path |
| numeric coercion / null-safe | `corpActionMirror.test.ts` | `dividendPerShare` number|null |
| mapper idempotent | `corpActionMirror.test.ts` | Camel input tolerated |
| P6003 → mirror dividends | `dividendCalendarMirror.test.ts` | Non-zero `totalDividends` |
| P6003 → mirror alerts | `alertsMirrorFallback.test.ts` | 200 + user scoping |
| mirror down → `[]` | `alertsMirrorFallback.test.ts` | Safe default, no throw |
| 401 unauth GET/POST | `workersStatusRoute.test.ts` | Admin protection |
| mirror worker shape | `workersStatusRoute.test.ts` | camelCase + `includeOffline` |
| alerts page on 500 | `e2e/alerts.spec.ts` (guard) | No Error Boundary |

---

## Verification Checklist

```bash
npx tsc --noEmit                    # baseline: 46 — no new errors
npm run test                        # all pass (baseline 1283 pass / 4 skip)
npm run lint
npm run quickbuild                  # 185/185 pages, 0 Turbopack warnings
npx playwright test -g "alerts"     # UI guard (dev server on :3000)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Mirror row shape drift | Tolerant mapper (reads both cases) + tests | No |
| Changing mirror helper shapes breaks daemon/engine | **Do not** change `lib/sqlite.ts` helper shapes; map at the call site | No |
| POST auth breaks an out-of-repo heartbeat | No in-repo caller; worker engine writes via direct Prisma | Accepted (user-approved) |
| Deferred bug-17 endpoints stay degraded | Recorded as a tracked follow-up in `BUGS.md` | Yes |

---

## Documentation Checklist

- [ ] **BUGS.md** — 15/16 Fixed; 17 narrowed + follow-up row
- [ ] **AGENTS.md** — version row
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.40.md` bullet
- [ ] **Primer.md** — current status
- [ ] **agent-memory.md** — activity entry
- [ ] **Lessons.md** — confirm/extend 129-130
- [ ] **Session memory** — `.agents/sessions/2026-09-18-v340ctx/{decisions,flow}.md`
- [ ] **session-todos.md** + **handoffs/active/latest.md**

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — no new errors (baseline 46)
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk, no secrets in diff
5. Docs updated per checklist
6. `.agents/rules/checklist.md` validated
