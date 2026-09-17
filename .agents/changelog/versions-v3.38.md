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

# v3.38.2 — Dependabot vulnerability-fix batch (next/third-parties bumps + mysql2 override + @netlify/blobs removal)

- **Date**: Sep 13 2026
- **Branch**: `fix/db-health-ops-count-manual-sync` (on top of pushed v3.38.1 `36f2c9b`)
- **Commit**: feature commit (package.json + package-lock.json) + docs commit
- **Status**: Committed + pushed; **PR #121 OPEN** — merge/deploy PENDING USER
- **Plan**: user directive "run npm audit --fix and fix what can be fixed" — the dependabot batch

## User directive
`npm audit --fix` + fix what can be fixed; do not break the build and do not downgrade Prisma.

## Changes (package.json + package-lock.json only — no schema/migration, no new packages)
1. **Dependency bumps**: `next` 16.3.1→**16.3.5**, `eslint-config-next`→**16.3.5**, `@next/third-parties` 16.2.0→**16.3.5**, `csv-parse` 6.1.0→**7.0.2**, `morgan` 1.11.0→**1.12.1**, `nodemailer` 9.0.3→**9.1.1**.
2. **Removal**: `@netlify/blobs` — v3.11.3 (full serverless purge) leftover; zero code references (only `@netlify/streaming-storage` remains).
3. **NEW `overrides` block**:
   - `mysql2` → **3.24.4** — GHSA-rgwj-5xj2-c3m3 (HIGH, prototype pollution via `createPool`/`createConnection` config); `prisma` pins exact `3.22.0` through its mysql adapter chain → override resolves 3.24.4 (`npm ls mysql2` verified).
   - `@eslint/eslintrc` → `{ "js-yaml": "4.3.2" }` — GHSA-2rj7-9f4x-w5w5 (code injection via `!!` prefix), eslint-config-next chain.
   - `@istanbuljs/load-nyc-config` → `{ "js-yaml": "3.15.2" }` — same advisory via istanbul's `^3.13.1`.
   - `@humanfs/node` → **0.16.8** — latest.
   - `fast-uri` → **3.1.6** — CVE-2025-6613 (DoS via `encodeURIComponent`), pinned 2.x via `@fastify/ajv-compiler`.
4. **Audit outcome**: `npm ls` clean; `npm audit` → **0 critical / 3 high** (all remaining = `deepmerge-ts` 7.1.5 via `@prisma/config`; GHSA-ggr8-5vv4-36mx affects <8.0.0 and NO 7.x patched release exists; the only "fix" would be downgrading Prisma 7→6 which breaks Prisma Postgres → documented, do NOT override; automated dependabot PRs for deepmerge-ts will keep failing until the upstream patch lands).

## Verification
- Full suite: **88/88 suites / 1207 pass / 4 skip / 0 fail**, exit 0
- `npx tsc --noEmit`: **46 = exact baseline (0 new)**
- `npm run quickbuild`: OK
- no migration, no schema change, no new packages

---

# Follow-up fix — `set_ops_counter` response now returns `queryConsumption` (`f470e6d`, Sep 15 2026)

- **Branch**: `fix/sqlite-upsert-worker-undefined-bind` (PR #126) — committed + pushed; merge/deploy PENDING USER
- **Commit**: `f470e6d` — `fix(admin): set_ops_counter response includes queryConsumption` (3 files, +49/−1)
- **Why**: the db-health "Sync Operations Count" card's update flow read `queryConsumption` from the POST response, but v3.38.0's `set_ops_counter` returned only `{ success, totalOperations }` → the plan/query-consumption bar showed stale/absent data after an admin Update/Reset until the next GET.

## Changes (3 files, +49/−1 in `f470e6d`)
1. **`app/api/admin/db-health/route.ts`** — `set_ops_counter` success path now returns `queryConsumption: buildQueryConsumption(getOpsMonthlyState(), { reads: dbOpsCounter.reads, writes: dbOpsCounter.writes }, Number(process.env.DB_PLAN_LIMIT_OPS_MONTHLY) || 200_000)` + `monthlyPlanLimit` (mirrors the GET `:212` block; `Math.max` high-water preserved; live counter NOT zeroed — v3.38.0 display-only override).
2. **`app/admin/utils/db-health/page.tsx`** (`:441`) — `totalOperations` display hardened to `(body.queryConsumption?.totalOperations ?? 0).toLocaleString()`.
3. **`lib/__tests__/dbHealthRoute.test.ts`** — regression: pre-seeds day `2026-09-09` (100r/20w), POSTs `set_ops_counter` 400r/50w `scope:"today"`, asserts `entry === { reads: 400, writes: 50 }` + full `queryConsumption` shape in the response.

## Verification
- `dbHealthRoute` **17/17**; full suite **88/88 suites / 1218 pass / 4 skip / 0 fail**, exit 0
- `npx tsc --noEmit`: **46 = exact baseline (0 new)**
- no schema change → no migration; no new packages
- Live-verified :3000 — both set/reset flows render the alert + ops-usage bar; 0 console errors