# v3.35.0 — Flaky `intelligence.test.ts` CI fix — prisma mock isolates the fire-and-forget `IntelligenceCache` upsert (zero real-DB writes in tests)

- **Date**: Sep 11 2026
- **Branch**: PR #118 branch `fix/leader-watchdog-self-heal` (on top of v3.34.1 merge `05b91e8`; test-only +21, **UNCOMMITTED** — push/merge/deploy pending user)
- **Status**: Code + tests VERIFIED; docs phase DONE; diff/commit PENDING USER (no commit/push/merge without explicit user approval)
- **Plan / Spec**: none — test-only CI flake fix (the "documented pre-existing flake" since v3.25.0, now FIXED)

## Root cause
`setIntelligenceCache` (`lib/services/intelligence/cache.ts` :101-124) fires
`prisma.intelligenceCache.upsert(...)` **UN-AWAITED** — it is a deliberate
fire-and-forget DB write. In `lib/__tests__/intelligence.test.ts` the `beforeEach`
teardown runs a REAL-Postgres `deleteMany` on `intelligenceCache` (:73-80) to reset
state between tests. When an earlier test's in-flight `upsert` lands AFTER that
`deleteMany`, a stale row survives into the next test → the cache-hit probe reads it
→ spurious `INTELLIGENCE_CACHE_HIT` → flaky failures at :187/:246/:279. This is the
same flake documented as "pre-existing" in every full-suite run since v3.25.0
(most recently: v3.34.1 full run = 1154 pass / 4 skip / 1 fail, the 1 = this test).

## Fix
- Insert a NEW full prisma mock factory **between the `beforeEach` close and the
  Tests header** so the suite performs ZERO real-DB writes to `intelligenceCache`:
  ```ts
  // ─── Mock Prisma ───
  jest.mock("@/lib/prisma", () => ({
    __esModule: true,
    default: {
      intelligenceCache: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  }));
  ```
- `jest.clearAllMocks()` clears call history but **keeps the mock impls** alive.
- Single-file surgical change: `lib/__tests__/intelligence.test.ts` only (+21).
- Pattern precedent: `lib/__tests__/intelligenceCache.test.ts` :13-24.

## Tests
- Targeted `intelligence.test.ts` **13/13 PASS**.
- Full suite — **86/86 suites / 1170 pass / 4 skip / 0 fail** — the **FIRST
  fully-green full run** (no more pre-existing-flake asterisk). Benign noise:
  `❌ ERROR | Intelligence cache DB write failed` (sibling test), teardown
  `ReferenceError` (2 services), "Jest did not exit".

## Verification
- `npx tsc --noEmit` **46 = exact baseline (0 new)** · no schema change → no
  migration · no new packages · diff = 1 file +21 (test-only)

## Notes / Next
- Docs pass DONE: AGENTS.md row + CHANGELOG index row + TODO.md row + Primer.md
  (Last Updated + Current Project Status) + Lessons.md #115 + agent-memory.md
  entry + session-todos.md + HANDOFF.md (:15-16 yaml, :21 consolidated bullet,
  :35 Next, :105 v1.14 version-history row) + latest.md + this file + session
  archive `2026-09-11-intelligence-test-fix/` (decisions.md + flow.md).
- Run `/pre-commit-check`; commit `lib/__tests__/intelligence.test.ts` (+21) only
  on explicit user approval; **no push/merge/deploy of PR #118 without explicit
  user approval**.