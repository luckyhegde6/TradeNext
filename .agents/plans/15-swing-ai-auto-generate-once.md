# Implementation Plan — 15. Swing AI auto-generate-once

> Generated from spec: `.agents/specs/15-swing-ai-auto-generate-once.md`
> Save to `.agents/plans/15-swing-ai-auto-generate-once.md`

## Branch

- **Feature base branch**: `feat/pwa-sprint-phase-b-ga4`
- **Feature branch**: continues on `feat/pwa-sprint-phase-b-ga4` (extends open PR #131)
- **Created**: 2026-09-20
- **Requires**: human approval (gate #2) — no code before approval

---

## Implementation Steps

> Ordered, atomic, independently verifiable.
> `[N] Step → verify: [check]`

### Phase 1: Database

1. **No schema change** — `SwingRecommendation`/`SwingTracker` already exists (v3.40.x). Verify per-symbol column constraint: `analyze=0&symbol` single-symbol query works against existing model → verify: `npx prisma validate` (0 errors).

### Phase 2: Service Layer

2. **Add `seed-swing-once` guard service** in `lib/services/swingAutoSeedService.ts` → verify: `npx tsc --noEmit` (0 new errors).

   Functions:
   - `isSwingSeededForUser(userId)` → reads DB/tracker flag (no AI) → verify: unit test `false` on empty, `true` once seeded.
   - `generateSwingTargetForSymbol(symbol, userId)` → single-symbol scan + one AI call; persists to swing targets; sets seeded flag → verify: unit test: only target symbol written, seeded flag set.
   - `autoTriggerOnce({ trigger, symbol? })` → dispatch: 
     - `trigger="empty-state"` → if not seeded → seed-once (a bounded single scan) → verify: second call is `no-op` (no double AI).
     - `trigger="watchlist-add"` → if not seeded → single-symbol generate for added symbol → verify: no-op if already seeded/fresh target exists.

3. **Wire empty-state auto-seed** into `getSwingRecommendations({ analyze })` path:
   - If stored targets exist → serve (no AI) — **unchanged**.
   - If targets absent AND not seeded → run one-time seed (fire-and-forget) → next load serves stored → verify: `analyze=0` never fires AI when stored targets exist.

4. **Wire watchlist-add trigger**: in the watchlist add handler → `autoTriggerOnce({ trigger:"watchlist-add", symbol })` fire-and-forget → verify: one AI call only for the added symbol, happens exactly once, non-blocking.

5. **Audit tags** → add `SWING_AUTO_SEED_TRIGGERED` / `SWING_AUTO_SEED_SKIPPED` to `lib/audit.ts` → verify: exported.

### Phase 3: API Route

6. **Extend `app/api/recommendations/swing/route.ts`** — keep `analyze=0` serve-first; add `analyze` + `seed` semantics per spec §7 → verify: `curl "localhost:3000/api/recommendations/swing?analyze=0"` returns stored data with `analysisStatus`; POST returns 400 for invalid body, 401 unauth.

### Phase 4: UI (SwingTab)

7. **SwingTab empty-state** → if analysisStatus is `seeded`/empty and no data → show inline "⚙️ Seeding first AI targets…" pill (non-blocking), then content or empty+CTA → verify headed: load once, no AI on plain reload, empty→seed→content path works, 375/768/1440 responsive, dark mode.

### Phase 5: Tests

8. `lib/__tests__/swingAutoSeedService.test.ts` → verify: `npm run test` (all pass)
9. `lib/__tests__/swingRecommendationService.test.ts` (extend) → new cases → verify: pass
10. E2E (if UI): `e2e/swing-auto-seed.spec.ts` → verify: `npm run test:e2e` passes; headed: watchlist-add triggers single-symbol generation, no AI on plain load.

### Phase 6: Documentation

11. Update `AGENTS.md` (version row v3.40.5) → verify: row added
12. Update `CHANGELOG.md` + `.agents/changelog/versions-v3.40.md` (v3.40.5 detail) → verify: entry added
13. Update `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md` (if lesson) → verify: entries added
14. Session memory: `.agents/sessions/<hash>/decisions.md` + `flow.md`, `session-todos.md`, handoff `latest.md` → verify: saved

---

## Test Strategy

### Unit

| Test | File | Verifies |
|------|------|----------|
| Seed-once: first call seeds, second no-op | `swingAutoSeedService.test.ts` | Idempotent seed |
| Watchlist-add: one symbol target generated | `swingAutoSeedService.test.ts` | Single-symbol scope |
| Watchlist-add when target fresh → no AI | `swingAutoSeedService.test.ts` | Fresh check |
| Serve-stored: no AI on load | `swingRecommendationService.test.ts` | Load guard |
| AI fail → safe default, no throw | `swingAutoSeedService.test.ts` | Error handling |
| Rate limit → skip + log | `swingAutoSeedService.test.ts` | Budget guard |

### E2E

| Test | Verifies |
|------|----------|
| Watchlist add → Swing generates once for symbol | Trigger wiring |
| Plain page load → no AI call | Regression guard v3.40.4 |
| Empty state → seed pill → content | Empty-flow |

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — 0 issues
4. `git status` — no junk, no secrets
5. Docs updated per checklist
6. Engineering checklist validated

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Empty-state seed burns AI on first visit | One-time + flag; only genuinely-empty | No |
| Watchlist-add storm → repeated AI | Per-symbol single-shot + fresh-target check | No |
| NSE rate limit | `nseRateGuard` + retry/backoff | No |
