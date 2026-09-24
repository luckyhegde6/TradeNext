# Session flow — 2026-09-25 · v3.41.2 Spec 01 Recommendations plan-limit fallbacks

## Approval
- User approved spec `.agents/specs/01-recommendations-plan-limit-fallbacks.md` + plan `.agents/plans/01-recommendations-plan-limit-fallbacks.md` → implementation started on `feature/ph22-decision-engine` (HEAD `a269057` = v3.41.1 committed).

## Phase 1 — `lib/sqlite.ts`: `getRecommendationRuns()`
- NEW exported mirror query `getRecommendationRuns(opts)`: camelCase row mapping (`id`, `generatedAt` Date, `source`, `status`, `uniqueStocks`), newest-first ordering, `unique_stocks > 0` filter, status filter, limit clamped 1..2000 (default 200). Zero Prisma.

## Phase 2 — `app/api/recommendations/top-stocks/route.ts`
- NEW `topStocksFromSqlite()` fallback: `getSqliteFallback()` → `getRecommendationRuns()` → `getRecommendationStocks()` → serializer (same result shape + `source: "sqlite_mirror_degraded"`), 1 h cache via `getWithCache` (fresh key to avoid collision with the Prisma-path cache).
- Prisma `$queryRaw` branch KEPT byte-identical (run-status filter unchanged).
- Mirror-exhausted/not-ready → RETHROW original error (never mask as empty).

## Phase 3 — `lib/services/recommendationPerformanceService.ts`
- NEW `listItemFromMirrorTracker()` adapter (camelCase + Date coercion from the snake-case-ish raw mirror row).
- NEW `getPerformanceListFromSqlite()`: JS-side status filter mirroring the SQL semantics (the mock mirror's tracker getter returns rows independent of SQL args — Lesson 138), timerange-aware, newest-first.
- `getPerformanceList` Prisma branch wrapped in try/catch that ONLY catches `isDbUnavailableError` → fallback; non-hold errors propagate as-is.

## Phase 4 — `lib/services/syncedDataService.ts` (steps 2 + 3)
- `mirrorWriteThrough`: write mirror EXCEPT when breaker open / plan-limit hold (mirror-only writes during hold).
- `mirrorReadMarketCache`: breaker-open/hold → mirror read with DateTime-safe cache key (state-derived); rethrows original when mirror not ready. Prisma happy path byte-identical.

## Phase 5 — HistoryTab error state
- `app/components/recommendations/HistoryTab.tsx`: NEW `error` state (reset per fetch, set on `data.success === false` OR fetch throw → `"Failed to load recommendations history"`); error card + Retry rendered BEFORE the empty-state list (same as PerformanceTab). Fixes the masked-500-as-empty-state.

## Phase 6 — Verification gate (ALL GREEN)
- `npx tsc --noEmit`: 46 = exact baseline (0 new; all 46 pre-existing `*.test.ts(x)` matcher noise).
- `npm run lint`: 0 errors.
- `npm run test`: 109/109 suites · 1440 pass / 4 skip / 0 fail (new Spec 01 suite 21/21 + sqliteMirror 11/11).
- `npm run quickbuild`: 189/189 pages ✓.
- Live dev server (user-approved): top-stocks 200, performance 200 (LODHA), ideas 200.
- `npm run test:e2e` `e2e/recommendations.spec.ts`: 10/10 passed (Chromium, 29.3 s).
- Cleanup: dev server killed (PID 35424), port 3000 free, `next-dev.log`/`dev-server.pid` deleted.

## Phase 7 — Docs pass (DONE)
- AGENTS.md v3.41.2 version-table row (above v3.41.1) + corrected stale v3.41.1 "commit pending" → COMMITTED `a269057`.
- `.agents/CHANGELOG.md` v3.41 index row updated (v3.41.2 first).
- `.agents/changelog/versions-v3.41.md` §v3.41.2 section inserted above v3.41.1; v3.41.1 status → COMMITTED.
- `TODO.md` Quick Reference: v3.41.2 block at top; v3.41.1 → COMMITTED.
- `Primer.md` Last Updated: 2026-09-25 v3.41.2 entry; v3.41.1 → COMMITTED.
- `agent-memory.md`: NEW v3.41.2 activity entry at top.
- `Lessons.md`: NEW Lesson 138 + Update Log entry.
- `.agents/session-todos.md`: NEW Current v3.41.2 block; v3.41.1 → Prior/COMMITTED.
- `.agents/handoffs/active/latest.md`: rewritten for v3.41.2.
- `HANDOFF.md`: orchestration yaml → v3.41.2 pending commit.
- Session memory: this `decisions.md` + `flow.md`.

## Next
- Pre-commit hygiene check → `/pre-commit-check` → ask user for approval → `git commit` as v3.41.2 (no push/PR). After approval: push + PR (carries v3.41.0 + v3.41.1 + v3.41.2); then P1–P3 real Laya inference behind parity gate.