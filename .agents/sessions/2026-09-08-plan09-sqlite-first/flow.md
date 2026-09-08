# Session Flow — 2026-09-08 — Plan 09 SQLite-first (Phases 4–5)

Branch `fix/v3.29.1-header-watchlist`; prior commits: 9303bd7 (P1), d9bda6b (P2),
56ee538 (P3). Today's: **a681a48 (P4)**, **f7e56b5 (P5)**.

## Phase 4 — `_sync_outbox` + 6h push engine (a681a48)

- `lib/sqlite.ts`: SCHEMA_SQL `_sync_outbox` table + `idx_sync_outbox_table`
  index; `recordSyncOutbox` (~:2930), `drainSyncOutbox` (~:2962),
  `pushSqliteToPrisma` singleflight (~:3023), `doPushSqliteToPrisma` (~:3031)
  with **leader gate now awaited** (:3035-3036), `rowsSynced` (:3081); probe
  tick after `syncFromPrisma()` (:1181) → `pushSqliteToPrisma({reason:"probe"})`.
- `lib/sqlitePushSinks.ts` (NEW): `readMirrorMap` — explicit
  `case "symbols": key = String(obj.symbol ?? "").toUpperCase()` (fixes
  "undefined:RELIANCE"); sinks for symbols/daily_price/corporate_action/
  chartink_screener_result (+`createMany`/raw upsert SQL shapes).
- `lib/__tests__/sqlite.test.ts`: Phase 4 describe (~:1324) — 10 tests incl.
  guard-order test (not-ready / breaker OPEN / not-leader → null), outbox
  insert/grouped-latest-op-wins/delete-survival, daily_price marker dedupe,
  drain-clear, failure-retain, probe-tick-push. 53/53 pass.

## Phase 5 — NSE captures → SQLite + outbox, auto-promote off (f7e56b5)

- `instrumentation.ts`: removed `startNsePromoteFlush` from `@/lib/sqlite`
  destructure (:21) + call block (:106-108).
- `lib/services/worker/worker-service.ts`: removed 2× `flushNseToPrisma()` calls
  (::209 stock sync, :343 corp-actions sync) — cacheSymbol/cacheCorporateActions
  kept.
- `lib/services/historicalPriceSyncService.ts`: removed end-of-task promote
  try/catch (:257-266) — cacheDailyPriceBars kept.
- `lib/sqlite.ts`: `startNsePromoteFlush` env-gated (`NSE_PROMOTE_ENABLED==="1"`
  to start; default no-op handle) — functions stay exported.
- `lib/__tests__/instrumentation.test.ts`: added `sqlite` requireMock ref +
  `expect(sqlite.startNsePromoteFlush).not.toHaveBeenCalled()` in first test.
- Outbox appends in capture helpers: NO-OP — already satisfied by Phase 4
  (capture helpers delegate to the outbox-wired writers).

## Verification

- `npx jest` (instrumentation + historicalPriceSyncService + sqlite +
  worker-engine): **88 passed, 88 total**.
- `npx tsc --noEmit`: **46 errors = exact baseline, 0 new**.
- Grep confirms zero `flushNseToPrisma()` / `startNsePromoteFlush()` call sites
  outside the lib/sqlite.ts exports.

## Phase 6 — Jobs write SQLite-first (recs / swing / perf)

Steps 1-3 committed: `ae44431` (schema parity + SCHEMA_SQL additions),
`63736f5` (write-through helpers + push sinks — Step 3).

Step 4-5 (THIS commit):

- `lib/sqlite.ts` +385: read-path re-base helpers behind `getSqliteFallback()`
  (recs/swing/perf read chains now mirror-first, Prisma fallback).
- `lib/services/dailyRecommendationService.ts`: mirror-first job writes
  (run/stock/tracker upserts, delete-on-failure, AI-patch via full-row upsert).
- `lib/services/swingRecommendationService.ts`: job/signal claim/update/retry/
  supersede via mirrored status/attemptCount.
- `lib/services/recommendationPerformanceService.ts`: archive write-through
  (`insertRecommendationArchive` + `deleteRecommendationTracker`) after Prisma
  create; perf status writes → `upsertRecommendationTracker` + status history.
- `lib/__tests__/dailyRecommendationService.test.ts`: re-pointed run/stock/
  tracker/delete/failure/perf assertions to mirror helpers (edits 4-15);
  creation-state trap fixed (intermediate `status` not assertable — ref
  mutated in place; see decisions.md §Phase 6 #5).
- `lib/__tests__/swingRecommendationService.test.ts`: mirror-factory retrofit
  (52/52).

Verification: **daily 34/34**; targeted batch (swing 52/52, perf, sqlite,
daemon-sqlite-first, nseRateGuard, instrumentation) **145/145**;
`npx tsc --noEmit` **46 = exact baseline, 0 new**.

## Next (Phase 7 — admin long-lived datasets SQLite-first: announcements / corp-actions / alerts / holdings)

Per plan 09 §Phase 7: SCHEMA_SQL additions (`admin_announcement`, `alert`,
`transaction`, corporate_action mirror exists); boot pulls in `syncFromPrisma`;
SqliteFallback CRUD helpers (`listAlerts/upsertAlert/deleteAlert` etc.);
flip admin CRUD routes (`app/api/admin/{announcements,corporate-actions,alerts,
holdings}/route.ts`); re-point admin route tests.

## Phase 7 — Admin long-lived datasets SQLite-first (DONE)

- `lib/sqlite.ts` +7 helpers: `deleteCorporateAction` (:4037, SELECT natural
  key → DELETE → outbox natural-key delete → boolean), `upsertAnnouncement`
  (:5077, returns id), `deleteAnnouncement` (:5133), `upsertAlert` (:5146,
  id = row.id ?? randomUUID()), `deleteAlert` (:5187), `upsertTransaction`
  (:5274, ticker uppercased), `deleteTransaction` (:5321); interface additions
  (:385-407). Table names: `admin_announcement`, `alert` (NOT `admin_alert`),
  `transaction`, `corporate_action` (mirror exists).
- 4 admin routes flipped mirror-first with Prisma fallback (`if (sqlite)`):
  `app/api/admin/{announcements,corporate-actions,alerts,holdings}/route.ts`.
  corporate-actions POST = check-then-insert (natural-key dedupe
  `symbol|actionType|exDateKey` → `setCorporateActions(existing + new)`);
  DELETE = mirror per-id with Prisma `deleteMany` fallback.
- `lib/__tests__/sqlite.test.ts`: Phase 7 describe (:1589) — 4 tests
  (announcement upsert/replace + outbox upsert/delete; alert round-trip +
  delete outbox; transaction round-trip + filters + uppercased ticker +
  delete outbox; corporate_action delete by id + natural-key outbox delete +
  second-delete false).
- **Mock executor**: added single-value `DELETE ... WHERE <col> = ?` equality
  branch (~:67) — previously fell to whole-table wipe. delete tests assert real
  sql.js semantics (1 row remains).
- **Test-only AUTOINCREMENT simulation** in the corporate_action delete test:
  `sqlModule.__getStore()["corporate_action"]` columns/rows patched to prepend
  `id = i + 1` — real sql.js assigns ids on INSERT, mock derives columns from
  INSERTs and would otherwise ignore `WHERE id = ?`.

Verification: **sqlite.test.ts 57/57**; full suite **1093 pass / 4 skip /
2 fail** (2 = pre-existing `intelligence.test.ts` async cache-flake only);
`npx tsc --noEmit` **46 = exact baseline, 0 new** (admin routes + lib/sqlite.ts
clean); no schema change → no migration.

## Next (Phase 8)

Per plan 09 §Phase 8 (`.agents/plans/09-sqlite-first-read-architecture.md`
L92-99) — read the plan's exact Phase 8 target list before starting.

## Relevant refs

- Plan: `.agents/plans/09-sqlite-first-read-architecture.md` (Phase 6 §68-77;
  Phase 9 verification §101-110; files table §122-141).
- Spec: `.agents/specs/09-sqlite-first-read-architecture.md`.
- Deferred PCJEWELLER evidence files in decisions.md.

## Phase 8 — db-health page wiring + push engine opts + derived counts + hot-route headers (THIS commit)

- `lib/sqlite.ts`: `pushSqliteToPrisma(opts?: { reason?: SyncTrigger;
  leaderGate?: boolean })` (:3665) — `trigger = opts?.reason ?? "probe"`,
  `leaderGate = opts?.leaderGate ?? true`; both `recordSyncHistory` sites
  (:3691, :3727) record trigger/leaderGated. NEW `DERIVED_COUNT_TABLES`
  (:3405), `hasSyncHistoryTable()` (:3420), `getOutboxPending()` (:3432,
  per-table `{pending, lastAt}`), `getSqliteDerivedCounts()` (:3468,
  `SELECT COUNT(*)` per derived table); all reads instrumented via
  `recordSqliteRead`.
- `app/api/admin/db-health/route.ts`: GET spreads `sqlite` (outbox + derived
  counts + sync history + health) into the response; POST gains
  `push_to_prisma` branch → `pushSqliteToPrisma({ reason: "admin",
  leaderGate: false })` + audit `ADMIN_DB_SYNC` resource `sqlite-push`
  (403-guarded).
- `app/admin/utils/db-health/page.tsx`: Outbox card (per-table pending +
  lastAt), Derived-counts card, "Push SQLite → Prisma now" button
  (`triggerPush`, `pushing` state), Direction/Trigger columns on Run History,
  footer notes (DB-first reads; push at the 6h probe tick).
- `app/admin/utils/nse-sync/page.tsx`: amber DB-first info paragraph.
- Hot-route header comments (5): `app/api/recommendations/route.ts`,
  `app/api/recommendations/swing/route.ts`, `app/api/screener/chartink/
  route.ts`, `app/api/corporate-actions/combined/route.ts`,
  `app/api/nse/indexes/route.ts` — each documents its SQLite-first read chain
  + provider fallback.
- `lib/__tests__/sqlite.test.ts`: Phase 8 describe (:1796-1970) — 11 tests
  (hasSyncHistoryTable pre/post-init; getOutboxPending {} before init / empty
  when empty / per-table counts+lastAt after seeding / {} after drain; derived
  counts {} before init / all-zero on empty mirror / correct counts after
  seeding; admin push as non-leader succeeds + records trigger+leaderGated;
  empty-outbox admin push; leader-gated default push returns empty when outbox
  empty).

Verification: **sqlite.test.ts 68/68** (11 new Phase 8 tests); `npx tsc
--noEmit` **46 = exact baseline, 0 new** (db-health pages/routes + lib/sqlite.ts
clean); no schema change → no migration.

## Next (Phase 9 — docs)

Per plan 09 §Phase 9: AGENTS.md version-table row + CHANGELOG bullet,
TODO quick-reference row, Primer/agent-memory/Lessons entries, plan+spec
status → Complete. Session memory + checkpoint handled first (this commit).