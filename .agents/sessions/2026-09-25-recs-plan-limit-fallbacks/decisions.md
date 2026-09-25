# Session decisions — 2026-09-25 · v3.41.2 Spec 01 Recommendations plan-limit fallbacks

## Decision 1 — Fallback contract: zero Prisma ops, degraded `[]` only when mirror HAS data
- **Decision**: The SQLite-mirror fallback branches (top-stocks, performance, syncedDataService steps 2+3) perform ZERO Prisma operations, and degrade to an empty list ONLY when the mirror genuinely holds data. If the mirror is exhausted or not ready, the fallback RETHROWS the ORIGINAL error (the 500 the caller would have gotten).
- **Why**: The whole point of the fallback is the P6003 plan-limit hold — falling back through Prisma again would re-trigger the hold. Rethrowing the original error (vs returning a friendlier `[]`) preserves failure telemetry and never masks an outage as "no data". Only `isDbUnavailableError` (message/code-based → matches P6003 "hold on your account") gates the fallback; non-hold DB errors propagate as-is.
- **Trade-off**: A mirror read that isn't there surfaces the hard 500 in the UI again — but the UI now has the proper error card + Retry (Phase 5), so the user sees a real error instead of a silent empty state.

## Decision 2 — Keep the Prisma happy path byte-identical
- **Decision**: The Prisma `$queryRaw` top-stocks branch and the Prisma performance branch keep their exact previous shapes/filters; the fallbacks are additive.
- **Why**: Zero-risk to the normal path; sqliteMirror.test.ts 11/11 + new suite 21/21 verify both branches; a masked-500 regression would otherwise be invisible.

## Decision 3 — HistoryTab error state BEFORE empty-state list
- **Decision**: In `HistoryTab.tsx`, the error card (title + message + Retry) renders before the empty-state branch — even if stale rows are present, a failed fetch shows the error card, not the empty list.
- **Why**: The bug being fixed is the masked-500-as-empty-state — the silent "no recommendations yet" on a failed fetch. Rendering error-first mirrors PerformanceTab's existing pattern (approved via spec).
- **Trade-off**: During the hold, users with genuinely-empty mirrors see an error card instead of empty state — acceptable; the error surfaces the real outage.

## Decision 4 — Real `@/lib/db-utils` in tests + breaker test hooks defaulting CLOSED
- **Decision**: The new suite mocks logger/prisma/sqlite/cache/audit but uses the REAL `isPlanLimitBreakerOpen` + real dbHealthState fallback, with test hooks `openPlanLimitBreaker`/`closePlanLimitBreaker`/`resetPlanLimitBreaker`.
- **Why**: The P6003 gate logic itself is the thing to test; the breaker default CLOSED means prod code with no opened breaker stays on the pure Prisma path (identity preserved).

## Decision 5 — DateTime-safe cache key for the degraded market-cache read
- **Decision**: `mirrorReadMarketCache` uses a key derived from `getDbHealthState` + the breaker state, so a cache entry written while the breaker was open does not get served as a fresh Prisma-backed value after recovery.
- **Why**: Naive `mc:` keys could serve a mirror row indefinitely; the state-derived key expires the degraded read automatically on recovery.

## Decision 6 — Commit as v3.41.2, one branch, all three versions pushed together
- **Decision**: Commit v3.41.2 on `feature/ph22-decision-engine` (already carries v3.41.0 + v3.41.1 as committed ancestors); a future push + PR carries all three. No push/PR without separate user approval.
- **Why**: Linear history per repo convention; single PR keeps the decision-engine workstream reviewable.