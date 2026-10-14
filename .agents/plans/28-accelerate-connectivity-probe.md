# Implementation Plan — Accelerate Connectivity Probe + Reaper Skip-On-Unreachable

> Generated from spec: `.agents/specs/28-accelerate-connectivity-probe.md`
> Save to `.agents/plans/28-accelerate-connectivity-probe.md`

## Spec Reference

- **Spec**: `.agents/specs/28-accelerate-connectivity-probe.md`
- **Branch**: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`, Spec 27 committed as `bbd49e8c`-work)
- **Created**: 2026-10-11
- **Status**: ⏳ **DRAFT — pending human spec review & approval before implementation (spec-driven gate)**

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step → verify: [check]`

### Phase 1: Probe service (`lib/services/accelerateProbe.ts`)

1. **Create `lib/services/accelerateProbe.ts`** — `probeAccelerate({ force? }: { force?: boolean }): Promise<{ ok: boolean; state: "fast" | "slow" | "unreachable" | "open"; latencyMs: number; checkTimestamp: Date; cached: boolean }>`
   - In-memory TTL cache (default 60 s, env `ACCELERATE_PROBE_TTL_MS`), cache key plain (no symbol); `force` bypasses the TTL.
   - Probe = a **cheap read-hardening `$queryRaw` audit 5s query only in prod?** — NO: use `prisma.$queryRaw\`SELECT 1\`` with `Promise.race` timeout (5 s, env `ACCELERATE_PROBE_TIMEOUT_MS`); failure classification via `isDbUnavailableError`/prisma error codes + `isPlanLimitBreakerOpen()` gate → `state: "open"`.
   - `shouldSkipReap(): Promise<boolean>` — true when probe fails (unreachable) or breaker open; never throws.
   → verify: `npx tsc --noEmit` (0 new); unit tests (below) green.

2. **Add audit tag `ACCELERATE_PROBE`** to `lib/audit.ts` (info-level, metadata `{ state, latencyMs }`) → verify: tag exported.

### Phase 2: Reaper adoption

3. **Modify `reapStaleWorkerTasks`** in `lib/services/worker/worker-engine.ts` — at the top (after the breaker guard, ~:551): `if (await shouldSkipReap()) { logger.warn({ msg: "Reap skipped — Accelerate unreachable/breaker open" }); return; }` — **no throws**, reaper becomes best-effort-only when the probe fails → verify: tsc; existing worker-engine suite green.

4. **Confirm `recordSystemRunOutcome` untouched** (skip path already returns without writing — verify no additional Prisma call is added by step 3) → verify: grep no new `prisma.` call in reaper skip path.

### Phase 3: Admin routes

5. **Create `GET /api/admin/accelerate/probe/route.ts`** (`runtime = "nodejs"`; admin session check pattern from `app/api/admin/google-sheets/config/route.ts:29-33`; query param `?force=1`; returns `{ success, probe }`, never 5xx on probe failure — 200 with `ok:false`) → verify: `curl` unauth → 401; admin cookie → 200 shape.

6. **Wire admin console card** (`app/admin/page.tsx` or the monitoring section) — button "Probe Accelerate" → result state/fast/slow/unreachable + latency; 401/403 handled → verify: page renders, click works on :3000.

### Phase 4: Tests

7. **Create `lib/__tests__/accelerateProbe.test.ts`** — cache hit (no 2nd call), force bypasses cache, timeout → unreachable, breaker open → `open`, `shouldSkipReap` true on failure/false on success → verify: `npm run test -- accelerateProbe`.

8. **Update `lib/__tests__/worker-engine.test.ts`** — mock `shouldSkipReap` true → `reapStaleWorkerTasks` returns early (no stale task claim attempted) → verify: suite green.

9. **Route test** (in `accelerateProbe.test.ts` or admin-route test): 401 unauth, 200 with probe shape, `?force=1` forwarded → verify: green.

### Phase 5: Docs

10. **`.agents/changelog/versions-v3.49.md`** — Spec 28 detail → verify: file exists, indexed in `.agents/CHANGELOG.md`.
11. **AGENTS.md** — compact version row (watch 32 KB cap, Lesson 142 — defer row into changelog if capped) → verify: row added or deferral noted.
12. **TODO.md / Primer.md / agent-memory.md** — status + activity entries → verify: each updated.
13. **Lessons.md** — add if a reusable pattern emerges (probe-before-destructive-reap; "read-path hardening") → verify: entry appended.
14. **Session memory** — `.agents/sessions/2026-10-11-recs-live-analysis/` updates of `decisions.md` + `flow.md` → verify: files reflect Spec 28.
15. **`.agents/session-todos.md` + `.agents/handoffs/active/latest.md`** → verify: updated.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Success probe → `{ ok:true, state:"fast" }` + latency measure | `accelerateProbe.test.ts` | Happy path |
| TTL cache hit → no second `$queryRaw` | `accelerateProbe.test.ts` | Cache works |
| `force:true` → bypasses cache | `accelerateProbe.test.ts` | Force semantics |
| Timeout (race) → `{ ok:false, state:"unreachable" }` | `accelerateProbe.test.ts` | Timeout classification |
| Breaker open → `state:"open", ok:false` | `accelerateProbe.test.ts` | Hold-aware |
| `shouldSkipReap()` true on failure, false on success | `accelerateProbe.test.ts` | Reaper gate |
| Reap skips early when probe fails (no claim attempted) | `worker-engine.test.ts` | Reaper adoption |
| Probe route: 401 unauth / 200 shape / force param / never 5xx | `accelerateProbe.test.ts` (route block) | Route contract |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `GET /api/admin/accelerate/probe` with admin session → 200 `{ success, probe }` | Live :3000 curl |
| Probe failure → endpoint still 200 `{ ok:false }` (not 5xx) | No-crash contract |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| — (optional; manual admin console click OK) | Console card interaction |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking (baseline: 46 error lines, prod 0)
npx tsc --noEmit

# Tests — RUN ALONE, never chained with ';'
npm run test -- accelerateProbe
npm run test -- worker-engine
npm run test            # full suite

npm run lint

# Hygène
git status        # no junk (*.yaml, screenshots, dev-server.log), no secrets
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Probe itself adds load | 1 × `SELECT 1` with 5 s timeout, TTL-cached 60 s | No |
| Skip-reap delays stale-task reclaim during an outage | Matches degraded intent (SQLite-first owns that); task shows `running` until DB recovers — visible on Workers page | No |
| False-positive "unreachable" on a slow-but-alive DB | `slow` state + tear can distinguish; still safe (reap deferred) | No |
| Multi-instance probes stampede gate | TTL cache per instance; probe is read-only | No |

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