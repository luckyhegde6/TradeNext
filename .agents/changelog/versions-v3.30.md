# v3.30.0 — Daemon control-plane cadence + SQLite mirror touch-freshness + `upsertCronJob` Date-binding fix + Netlify WASM staging

- **Date**: Sep 07 2026
- **Branch**: `fix/v3.29.1-header-watchlist` (on top of committed v3.29.2 `1e907f1` — v3.29.2 is now committed, NOT "commit pending" as the v3.29.2 changelog entry says)
- **Status**: Code + tests + verification committed `8af65cc`; Date-binding fix + docs + commit pending user (this commit)
- **Spec/Plan**: small operational increment (cadence/throttling + SQLite freshness + WASM staging) — no new spec (follows the v3.25.0–v3.28.0 SQLite-first control-plane work)

## User directive (confirmed)

- "i don't want to see this every time — defaults in `.env` on Netlify" — the db-health dashboard surfaces repeated plan-limit breaker / ops warnings during healthy operation; the fix here addresses the root-cause noise sources (mostly boot-time SQLite-init failure + unthrottled control-plane loops), documented below.
- "Commit fix + doc the whole v3.30.0" + "also check unstaged changes and commit them" — this entry covers the committed `8af65cc` scope AND the follow-up `upsertCronJob` Date-binding fix (uncommitted until this commit).
- "Continue if you have next steps" — no push/merge/deploy without separate explicit approval.

## Design

### Phase 1 — Throttled control-plane cadence (`lib/services/leader.ts`, `cron-daemon.ts`, `worker-engine.ts`)

Cold-start + repair loops wrote/read the control plane far too often, multiplying Accelerate ops and
db-health noise:

- `leader.ts` — **`LEADER_STALENESS_MS = 15 * 60_000`** (was 5 min) and **`LEADER_HEARTBEAT_MS = 300_000`** (was 60s): a 5-min staleness window meant a single missed heartbeat (deploy pause / event-loop stall) let a cold-start standby steal the lock — every multi-instance burst then re-elected repeatedly. 15-min staleness + 5-min heartbeat keeps a single writer per role without noisy re-elections.
- `cron-daemon.ts` — **`SWING_DRAIN_INTERVAL_MS = 900_000`** (new constant): the swing-analysis job drain (`maybeProcessSwingAnalysis`) ran on the 60s resync tick; a drained queue then re-checked every tick for 15 min. The drain now runs on a dedicated 15-min interval, so the fast resync tick only syncs cron rows/heartbeat.
- `worker-engine.ts` — **`REAP_INTERVAL_MS = 300_000`** (was 60s): the stale-task reaper (`reapStaleWorkerTasks`) + liveness reads dropped from every poll to every 5 min.

### Phase 2 — SQLite mirror touch-freshness (`lib/sqlite.ts` + `worker-engine.ts`)

`discoverPendingTask()` (SQLite-first pending-task read) required the mirror to be fresh
(`isControlMirrorFresh("worker_task", 15 min)`) — but the mirror's freshness comes from
`upsertWorkerTask` writes, which only happen when tasks are actually created/completed. An idle system
(with a ready DB, so `discoverPendingTask` returns early with `null`) never touched the mirror, so the
freshness telemeter went stale and every poll fell back to Prisma.

**Fix**: NEW `SqliteFallback.touchControlMirror(table, db?)` — re-marks `control_write_at:<table>` = NOW in
`_backup_meta` (non-empty gate; best-effort, never throws). `discoverPendingTask()` calls
`touchControlMirror("worker_task")` on the ready-DB early-return path so the mirror's freshness tracks the
poll cadence, not task activity.

### Phase 3 — SQLite schema-init comment-semicolon fix (`lib/sqlite.ts`)

The SCHEMA_SQL constant carried stray `;` characters inside `--` SQL comments. sql.js's `exec` treats the
`;` as a statement terminator → `near "Prisma": syntax error` on EVERY boot → SQLite never became ready →
every SQLite-first read silently fell back to Prisma (and db-health showed repeated "SQLite Not Ready"
warnings). Comments now use `/* … */` blocks (or `;`-free `--`) so the multi-statement init string parses
cleanly. **This is the root cause of most recurring db-health noise.**

### Phase 4 — Netlify WASM staging (`scripts/copy-sql-wasm-netlify.mjs` + `package.json`)

Netlify's publish dir is `.next` — so `public/sql-wasm.wasm` (bootstrap source for sql.js `initSqlJs`)
never ships to the deployed output. NEW `scripts/copy-sql-wasm-netlify.mjs` copies
`public/sql-wasm.wasm` → `.next/sql-wasm.wasm` after the Next.js build; wired into the `quickbuild` and
`build` npm scripts; non-fatal when the source file is missing (dev-only).

### Phase 5 — `upsertCronJob` Date-binding fix (`lib/sqlite.ts`)

Prisma `CronJob` rows carry real `Date` instances for `lastRun` / `nextRun` / `createdAt` — the caller is
cron-daemon.ts's re-seed loop (`sqlite?.upsertCronJob?.(j)` with the raw Prisma row). Binding them raw
(`String(date)`) yields a **locale-formatted** value — e.g. `"Sat Sep 06 2026 10:30:00 GMT+0530 (India Standard Time)"` —
which breaks the ISO read-back: `reconcileControlToPrisma` re-reads the SQLite column via
`new Date(String(col))` (:2678-2679), and `new Date(localeString)` round-trips unreliably (the 12h
reconcile could then write corrupt `nextRun`/`lastRun` back to Prisma).

**Fix**: `toIso(v)` helper — `v == null ? null : v instanceof Date ? v.toISOString() : String(v)` — applied
to the `lastRun` / `nextRun` / `createdAt` binds (with the existing `?? now` fallbacks). `syncFromPrisma`
already ISO-normalises (:2524-2525); this path now must too. Same latent pattern exists in
`upsertWorkerTask` / `upsertWorkerStatus` (raw binds) — mentioned here, left untouched (surgical rule).

## Tests

- `lib/__tests__/sqlite.test.ts` — mock INSERT regex upgraded to
  `/INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+(\w+)/i`; `INSERT OR REPLACE` + `ON CONFLICT` semantics now
  remove-then-push on PK. **NEW `describe("upsertCronJob Date binding (v3.30.0)")` (2)**: ISO `Date`
  instances bound as `toISOString()` not locale strings (regression — fails pre-fix); re-upsert with the
  same id replaces the row (OR REPLACE). `beforeEach` clears the shared sql.js mock store.
- `lib/__tests__/daemon-sqlite-first.test.ts` (+2): `discoverPendingTask` ready-DB path calls
  `touchControlMirror("worker_task")`; touch-to-Prisma early return is best-effort/no-throw.
- `lib/__tests__/leader.test.ts`: constants updated for the new cadence.
- **Run**: targeted **96/96** (sqlite 40 incl. the 2 new Date-binding tests
  + daemon-sqlite-first + dbOpTiering + leader + historical); `npx tsc --noEmit` **46 = exact baseline
  (0 new)**; **no schema change → no migration**.

## Files

**Created**: `scripts/copy-sql-wasm-netlify.mjs`, `.agents/changelog/versions-v3.30.md`.

**Modified**: `lib/services/leader.ts` (cadence constants), `lib/services/worker/cron-daemon.ts`
(`SWING_DRAIN_INTERVAL_MS`), `lib/services/worker/worker-engine.ts` (`REAP_INTERVAL_MS` +
`touchControlMirror` call), `lib/sqlite.ts` (SCHEMA_SQL comment fix + `touchControlMirror` +
`upsertCronJob` `toIso`), `lib/__tests__/sqlite.test.ts`, `lib/__tests__/daemon-sqlite-first.test.ts`,
`lib/__tests__/leader.test.ts`, `package.json` (quickbuild/build WASM copy), plus this doc set
(AGENTS.md, CHANGELOG index, TODO.md, Primer, agent-memory, Lessons, session-todos, latest.md, HANDOFF.md).

**Commits**: `8af65cc` (Phases 1–4 + first test batch) + this commit (Phase 5 Date-binding fix + docs).
No push/merge/deploy without explicit user approval; PR #114 (v3.29.2 pre-merge) stays held.