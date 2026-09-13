# v3.38.0 — Admin SET_OPS_COUNTER authority fix + db-health "Sync Operations Count" UI

- **Date**: Sep 13 2026
- **Branch**: `fix/db-health-ops-count-manual-sync`
- **Commit**: `d5645a9` (committed; push/PR pending user)
- **Status**: Committed `d5645a9`; **PR #121 OPEN** covering `d5645a9` + the v3.38.1 bundle; merge/deploy PENDING USER
- **Plan**: follow-on to Plan `.agents/plans/01-db-ops-reduction.md` (db-ops-reduction / monthly-ops window) · user directive: admin must be able to correct the ops-usage count used for plan display

## User directive
The db-health dashboard shows "Plan Operations Usage" / "Monthly Query Consumption"
computed from the persisted ops ledger. Because the admin is the authority on actual
Prisma-dashboard consumption (Netlify instances can diverge from the Prisma console
counter), the admin must be able to MANUALLY set the ops-usage date + total — with
the delicate live counter protected from being zeroed by a misuse of the tool.

## Changes (7 files +349/−2 in `d5645a9`)
1. **`lib/services/opsMonthly.ts` (+42)** — NEW exported `setOpsMonthlyDay(day)` and
   `setOpsMonthlyTotal(total)` mutators on the globalThis `__opsMonthly` ledger, plus
   `readOpsLedger()` refresh + `resetOpsMonthlyForTests()` flush/clear (`ops.ops`
   DELETEd, deleted vars, `ref<void>` sync) for the test hook.
2. **`lib/audit.ts` (+1)** — NEW audit action `ADMIN_DB_SET_OPS_COUNTER`.
3. **`app/api/admin/db-health/route.ts` (+75)** — POST `set_ops_counter` action:
   - zod `setOpsCounterPayload` — `action` + `set-day`/`set-val` are validated
     TOGETHER (a `{ action: "set_ops_counter" }` body with no value params →
     400 `"Invalid set_ops_counter payload"` instead of silently doing nothing);
   - day parsed via `Date.parse` with `new Date(s)` fallback then falls back to
     `getIstDayKey()`; must be a valid IST `YYYY-MM-DD` (zod `z` `length` + `regex`
     check → else 400 `"Invalid set_ops_counter payload"`);
   - `setOpsMonthlyDay(day)` zero-inits that day's ops record (folded @60s → the
     record resets to 0 naturally, never a live-counter write);
   - `setOpsMonthlyTotal(total)` → `dbOpsCounter.total = round(abs(total))` with
     `.reset = false` (deliberate: the live counter is NOT zeroed — only the
     DISPLAYED daily total is overridden until next fold);
   - fail-open `.catch` → 500, never crashes; success → `200 { success: true }` +
     `createAuditLog(ADMIN_DB_SET_OPS_COUNTER, ...)`.
4. **`app/admin/utils/db-health/page.tsx` (+110)** — SECOND db-health card with local
   day/total inputs + "Update" + "Reset" buttons + an **authority tooltip**:
   *"Grants authorized admin manual override of the date + ops-count used to compute
   plan usage — affects the ops-usage UI display and monthly plan usage — NOT the live
   counter itself"* + `warn('unsafe')`; `handleSetOpsCounter` ("Update") →
   `updateOpsCounter("set")` POST with `{ syncing: "set" }`; "Reset" →
   `resetOpsCounter()` then `updateOpsCounter("reset")` POST; `resetOpsCounter`
   syncs `day === currentDay` → `setOpsCounter("")`; `getCurrentDay` ("server") →
   current day; `serverOps` → ops-usage response; callbacks refetch `data` via the
   existing `refreshFns` `fetchFn` (no additional change needed).

## Tests
- `lib/__tests__/dbHealthRoute.test.ts` **(+69)** — `setOpsCounterPayload`
  validation fns + `POST set_ops_counter`: `{ action }` only → 400; normal value
  params OK; day variant OK; combined set-day+set-val → 200 + `ADMIN_DB_SET_OPS_COUNTER`
  audit; malformed (bad day format / missing params) → 400 + audit `"Invalid"`.
- `lib/__tests__/opsMonthly.test.ts` **(+51)** — set day + fold; set total;
  reset hook — **10/10 total**.
- `lib/__tests__/audit.test.ts` (+3/−1) — `ADMIN_DB_SET_OPS_COUNTER` coverage.

## Verification
- Full suite **88 suites / 1207 pass / 4 skip / 0 fail**; `npx tsc --noEmit`
  **46 = exact baseline (0 new)**; no schema change → no migration; no new packages.

---

# v3.38.1 — Swing generatedAt push-sink NULL guard (Prisma 23502/23503) + AI-monitoring "Last hour" timeframe filter

- **Date**: Sep 13 2026
- **Branch**: `fix/db-health-ops-count-manual-sync` (on top of committed v3.38.0 `d5645a9`)
- **Status**: Code + tests VERIFIED; COMMITTED `d35343e` (feature) + `36f2c9b` (docs); PUSHED; PR #121 OPEN; merge/deploy PENDING USER
- **Fix scope**: 6 files +157/−3 uncommitted (v3.38.1 bundle)

## Root cause 1 — swing rows wiped / blanked by the ~6h SQLite→Prisma push
Pre-fix (v3.38.0 and earlier) the swing upsert payload bound ONLY `created_at`
INSIDE `payload` (example shape `{ symbol, "created_at": "...", tb: 2 }`) → the
SQLite mirror's `generated_at` column stayed NULL for those rows. On the next
6h `pushSqliteToPrisma` probe the swing push sink handed Prisma
`swing_signals.create` with `generatedAt: :undefined` (the prop is DROPPED by the
client) → Prisma 23502 NOT NULL violation on `generated_at` (column maps
`generatedAt`) AND 23503 FK cascade (the dropped column leaves no constraint
match) — remaining columns SET NULL → most swing cards' target/stop blanked in
the 23502 branch; in the 23503 branch the victory row was DESTROYED. Prisma 23502
reset → ResolverFailed → `runScheduledOps` (`lib/sqlite.ts` :2050) `.finally` →
`recoverySync` → a migration-style reconcile on an unknown/invalid commit →
`recordDbError` → the recurring "Recent DB Errors" entries in db-health.

## Root cause 2 — AI-monitoring "Last hour" filter ignored
`getAiCallsMerged` merged the in-memory ring + persisted calls but NEVER filtered
the in-memory ring by timeframe — only `getAiStatsMerged` re-filtered after
merging. Result: the admin monitoring page's "Last hour" preset displayed
prescribed-60-min calls even after the user pressed "Last hour" (`timeframe` from
`app/api/admin/ai/monitoring/route.ts` L32; default 60, cap 1440).

## Fix 1 — top-level `generatedAt` on the swing upsert
`lib/services/swingRecommendationService.ts` (~L1227): `upsertSwingAnalysisJob`
now binds `generatedAt: new Date()` TOP-LEVEL (NOT just inside `payload`) — the
SQLite mirror's `generated_at` column becomes populated, so the reconcile hands
full columns to Prisma. Fix 2 heals the pre-fix rows.

## Fix 2 — push-sink fallback `generatedAt → created_at`
`lib/sqlitePushSinks.ts` (~L497 zone): swing pushes use `() => (row.generatedAt as
string) ?? row.created_at` with `tbl.date(...)` cast — a pre-fix mirror row with
NULL `generated_at` now falls back to its `created_at` text instead of sending
`:undefined` → no more Prisma 23502 NOT NULL / 23503 FK cascade; the ~6h probe no
longer blanks/destroys swing rows.

## Fix 3 — `getAiCallsMerged` memory-ring cutoff filter
`lib/services/ai/ai-monitoring.ts` (L331-340): `cutoff = Date.now() -
timeframeMinutes*60*1000`; ring entries with `entry.timestamp < cutoff` are
skipped, and `timeframeMinutes` is now passed to `getPersistedAiCalls` — the
"Last hour" filter finally applies to the merged view (comment: "v3.38.1 fix;
previously only getAiStatsMerged re-filtered after merging").

## Tests
- `lib/__tests__/ai-monitoring.test.ts` **(+86)** — NEW describe
  `getAiCallsMerged memory-buffer timeframe filter (v3.38.1)`: 60-min vs 1-min
  `timeframeMinutes`, ring row excluded without `getAiStatsMerged` involvement,
  limit counted correctly — implements the asserted-only `getAiCallsMerged` path
  (real fn replaces mock in `mockDefault`) + verifies timeframe is passed to the
  persisted tier; `@/lib/sqlite` mock gains `enqueueWriteBehind: jest.fn()`.
  **5/5 total**.
- `lib/__tests__/sqlite.test.ts` **(+30)** — `23502 regression`: full 12-col
  payload + OTHER-SWING row; asserts `params[3]` is the `created_at` binding and
  the `job-null-gen` row is seeded (fails pre-fix sink shape).
- `lib/__tests__/swingRecommendationService.test.ts` **(+21)** — `creates with
  top-level generatedAt`: upsert mock's first arg carries a Date instance at
  top-level `generatedAt`, payload carries the serialized string. Swing service
  suite **40/40 total**.

## Verification
- Full suite **88 suites / 1207 pass / 4 skip / 0 fail**; `npx tsc --noEmit`
  **46 = exact baseline (0 new)**; no schema change → no migration; no new
  packages · diff 6 files +157/−3.
- Live-verified :3000 (dev server PID 19820): AI-monitoring "Last hour" page
  clean; `GET /api/admin/ai/monitoring?type=calls&limit=100` clean empty /
  `database` source; stats `{ stats }` shape; served-source comment present;
  0 console errors. Swing 23502/23503 verified via regression tests + code
  review (the stale `dbErrorRing` in-memory entries pre-date the fix; a restart
  clears them).