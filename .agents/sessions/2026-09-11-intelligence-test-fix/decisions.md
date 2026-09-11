# Session Decisions — 2026-09-11 — v3.35.0 Flaky intelligence.test.ts CI fix

> Decision journal for the v3.35.0 session. Format per `.agents/sessions/README.md`.
> Branch: PR #118 branch `fix/leader-watchdog-self-heal` (on top of v3.34.1 merge `05b91e8`).
> Test-only +21 COMMITTED `2036724` + PUSHED (user-approved push); PR #118 merge/deploy pending user (no merge/deploy without explicit approval).

## D1. Fix the CI flake at the source — mock `@/lib/prisma` inside `intelligence.test.ts`

- **Decision**: Insert a full prisma mock factory (`{ __esModule: true, default: { intelligenceCache: { findUnique/upsert/delete/deleteMany/count/findMany -> jest.fn() } } }`) between the `beforeEach` close and the Tests header, so the suite performs ZERO real-DB writes to `intelligenceCache`.
- **Context**: `setIntelligenceCache` (`lib/services/intelligence/cache.ts` :101-124) fires `prisma.intelligenceCache.upsert(...)` UN-AWAITED; the suite's real-Postgres `beforeEach` `deleteMany` teardown (:73-80) races the in-flight upsert -> stale row -> spurious `INTELLIGENCE_CACHE_HIT` -> flaky fails at :187/:246/:279. The "documented pre-existing flake" since v3.25.0.
- **Why**: The cache write is deliberately fire-and-forget production behavior; the test suite must not depend on real-DB write timing. Mocking the prisma client at the suite boundary guarantees deterministic cache-hit probes.
- **Impact**: `lib/__tests__/intelligence.test.ts` only (+21). Pattern precedent: `intelligenceCache.test.ts` :13-24.

## D2. Keep the change test-only — zero production code touched

- **Decision**: Do NOT modify `lib/services/intelligence/cache.ts` (no `await` change, no config flag, no environment gate).
- **Context**: The un-awaited `upsert` is an intentional fire-and-forget design; real App Router requests must not block on cache DB writes.
- **Why**: The flake is a test-isolation defect, not a production defect. A production change would trade a test flake for a per-request latency regression and widen the diff.
- **Impact**: Diff = 1 file +21 (test-only). tsc 46 = exact baseline (0 new); no migration; no new packages.

## D3. `jest.clearAllMocks()` — clears call history, keeps impls

- **Decision**: Use `jest.clearAllMocks()` (NOT `resetAllMocks`) in `beforeEach` so the mocked `intelligenceCache` methods keep their `mockResolvedValue` implementations while call-assertion history is reset per test.
- **Context**: The suite asserts on call counts/args in individual tests; `resetAllMocks()` would null the impls and break every cache-write assertion.
- **Why**: Matches the existing factory pattern and keeps per-test isolation without re-stubbing each case.
- **Impact**: `intelligence.test.ts` **13/13 PASS**; full **86/86 suites / 1170 pass / 4 skip / 0 fail** — FIRST fully-green full run (no more pre-existing-flake asterisk).

## D4. Full-suite verification is the definition of done for a flake fix

- **Decision**: Run the ENTIRE suite (not just the targeted file) and require 0 failures before declaring the fix complete; record benign noise separately.
- **Context**: A flake fix that only passes its own file can still fail CI on cross-suite timing; the previous "pre-existing flake" asterisk was carried for weeks of full runs.
- **Why**: The user-facing value is a green CI pipeline — the full run is the acceptance check.
- **Impact**: 86/86 suites / 1170 pass / 4 skip / 0 fail (first fully-green); benign noise documented (sibling-test DB-write ERROR, teardown `ReferenceError` ×2, "Jest did not exit") — none affect pass/fail.