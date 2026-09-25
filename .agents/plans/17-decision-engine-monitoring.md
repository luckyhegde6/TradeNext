# Implementation Plan — Decision Engine Performance Tracing (AI Monitoring section)

> Generated from spec: `.agents/specs/17-decision-engine-monitoring.md`
> Save to `.agents/plans/17-decision-engine-monitoring.md`

## Spec Reference

- **Spec**: `.agents/specs/17-decision-engine-monitoring.md`
- **Branch**: `feature/ph22-decision-engine` (current, v3.41.0 committed at `ab6fd65`)
- **Created**: 2026-09-24

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Monitoring Service

1. **Create `lib/services/decision/monitoring.ts`** — `DecisionTraceEntry`, `DecisionStats`, global ring buffer (`_decisionTraces`, max 500), `trackDecisionTrace`, `getDecisionTraces`, `getDecisionStats`, `clearDecisionTraces` (mirror `ai-monitoring.ts` structure; in-memory only, zero Prisma) → verify: `npx tsc --noEmit` (no new errors)

### Phase 2: Client Instrumentation

2. **Modify `lib/services/decision/client.ts`** — `evaluateWithRetry` returns `attempts`; `evaluate()` records inert/success/error traces (fire-and-forget, rethrow preserved); `ping()` records a trace → verify: `npx tsc --noEmit`
3. **Verify no circular import**: monitoring.ts imports nothing from client.ts; client.ts imports `trackDecisionTrace` from `./monitoring` → verify: `npm run test` decision suites still pass

### Phase 3: POC Instrumentation

4. **Modify `chartinkUnifiedScreenerService.ts`** — after POC A scoring loop: track `poc-a-screener` trace with `scoredCount` + `gateDistribution`, inside the existing try/catch → verify: `npx tsc --noEmit`
5. **Modify `swingAutoSeedService.ts`** — `gateAutoGenerate()` POC B records `poc-b-autoseed-gate` trace (gate/reason/allowed/noulAmount), non-fatal try/catch → verify: `npx tsc --noEmit`

### Phase 4: API Route

6. **Create `app/api/admin/decision/monitoring/route.ts`** — GET `type=stats|traces` (limit ≤500 default 50, timeframe ≤1440 default 60), DELETE clear; admin auth via `auth()`; `runtime = "nodejs"` → verify: `npx tsc --noEmit`
7. **curl check** (once dev server up): `GET /api/admin/decision/monitoring?type=stats` returns 401 unauth; 200 admin with stats contract → verify: admin curl

### Phase 5: UI

8. **Modify `app/admin/utils/ai-monitoring/page.tsx`** — add `DecisionTraceRow` component; third tab "Decision Engine"; decision stats/traces state + parallel fetch in `fetchData()`; "Clear decision traces" button; empty/loading states via existing patterns → verify: `npx tsc --noEmit`
9. **Responsive + dark mode check** → verify: Playwright MCP at 375/768/1440, dark mode, 0 console errors

### Phase 6: Tests

10. **Create `lib/__tests__/decisionMonitoring.test.ts`** — buffer/trim/stats/timeframe/clear; client evaluate success (attempts+latency), inert (mode none), error (throws + trace); ping trace; `beforeEach` clear → verify: `npm run test` (run ALONE on Windows)

### Phase 7: OpenAPI + Documentation

11. **Modify `app/api/openapi/route.ts`** — document `GET/DELETE /api/admin/decision/monitoring` under tag `Decision Engine` (summary, params, 200/401/500 responses) → verify: `npx tsc --noEmit`
12. **Docs**: AGENTS.md version table row (v3.41.1), `.agents/changelog/versions-v3.41.md` addendum, CHANGELOG index, TODO quick-ref, Primer, agent-memory, session `decisions.md` + `flow.md` (new `.agents/sessions/2026-09-24-decision-monitoring/` or extend current), session-todos, handoff latest.md → verify: files present

### Phase 8: Full Verification + Commit

13. **Full gate**: `npx tsc --noEmit` (baseline 46), `npm run lint`, `npm run quickbuild` → verify: 0 new errors, lint 0, 188/188 pages
14. **Playwright live check** on :3000 (admin login → AI Monitoring → Decision Engine tab renders, no console errors) → verify: snapshot
15. **Commit** with user-approved message (no push/PR) → verify: `git log --oneline -1`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| trackDecisionTrace appends + trims at 500 | `decisionMonitoring.test.ts` | Ring buffer |
| getDecisionTraces newest-first + limit | `decisionMonitoring.test.ts` | Ordering |
| getDecisionStats aggregation + timeframe | `decisionMonitoring.test.ts` | Stats math |
| clearDecisionTraces empties buffer | `decisionMonitoring.test.ts` | Reset |
| client evaluate success records attempts+latency | `decisionMonitoring.test.ts` | Instrumentation |
| client evaluate mode=none records inert trace | `decisionMonitoring.test.ts` | Inert path |
| client evaluate all-providers-fail records error + rethrows | `decisionMonitoring.test.ts` | Error path preserved |
| client ping records a trace | `decisionMonitoring.test.ts` | Ping path |

### Integration Tests (If API Route)

| Test | What It Verifies |
|------|------------------|
| GET returns 401 without admin | Auth middleware |
| GET type=stats returns contract shape | Route wiring |
| DELETE clears buffer | Clear path |

### E2E Tests (UI change — Playwright MCP, not committed spec)

| Test | What It Verifies |
|------|------------------|
| Admin AI Monitoring page shows Decision Engine tab | Component rendering |
| Stats cards + breakdowns + rows render with data | Data flow |
| Mobile layout (375px) | Responsive design |
| Dark mode renders | Theme support |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests (RUN ALONE — Windows quirk)
npm run test                        # All pass (107 suites / ~1401 pass)

# Lint + build
npm run lint                        # No warnings
npm run quickbuild                  # 188/188 pages (optional final gate)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Circular import client↔monitoring | monitoring.ts is leaf (imports only logger/types); client imports it one-way | No |
| Trace recording breaks runtime behavior | Fire-and-forget; all call sites in try/catch; rethrow preserved | No |
| In-memory traces lost on restart | Accepted — mock engine; persistence lands with real Laya provider (P1–P6) | Yes |
| Page bloat from third tab | Reuse `StatCard`/`BreakdownBar`; `DecisionTraceRow` mirrors `CallRow` | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — v3.41.1 version row
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.41.md` addendum + index bullets
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson only if pattern discovered (likely none; trace-pattern is copy of ai-monitoring)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass (run alone)
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts (.context/ stays untracked), no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
7. `.githooks/pre-commit` auto-runs SECURITY + CODE QUALITY + GIT on commit