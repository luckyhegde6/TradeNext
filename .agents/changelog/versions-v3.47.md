# v3.47.0 — Specs 25 + 26 (scheduled-execution reliability + Google-Sheets header-label fix)

> Branch `fix/daily-rec-swing-cron-worker` (base `main` = v3.46.0 MERGED via PR #134). Spec 25 COMMITTED `480cd3b` (2026-10-09, 14 files +821/−274, pre-commit green); Spec 26 COMMITTED as part of the same version row (see below). MERGE + DEPLOY remain user actions (D9).

## Spec 25 — Scheduled-execution reliability (catch-up re-fire, UTC daemon, degraded-executor next_run)

**Problem.** Three compounding failures left the recommendations/swing cron work out-of-tune:

1. **Netlify suspension + no catch-up**: Netlify suspends idle instances ~2h, so node-cron ticks stop. `checkScheduledJobs` only polls *due* jobs — a `nextRun` that elapsed while the instance was suspended was never re-discovered or re-fired.
2. **Timezone drift**: daemon `defaultTimeZone` was not explicitly UTC; jobs scheduled in IST could drift around DST/local-time boundaries (a system job warning existed only for non-UTC overrides).
3. **Degraded-executor no-op advance**: when a cron job ran through the degraded SQLite path, the mirror `next_run` was NOT advanced — so a legitimately-executed degraded job stayed due and kept re-firing.

**Fix.**
- `catchUpMissedCronJobs()` in `lib/services/worker/worker-engine.ts` (~L791) with `CRON_CATCHUP_WINDOW_MS=15min`: missed ≤15min are **spawned** with the same guards as `checkScheduledJobs` (skip `running`); stale re-armed advance is **never fired**. Wired at daemon boot + 5-min resync tick (`cron-daemon.ts`).
- Daemon defaults to **UTC** (`DEFAULT_TIMEZONE = "UTC"`); per-job timezone override retained; non-UTC system-job warning kept.
- Degraded execution path (`runDegradedPathIfActive` :309-333, spawn advance :729/:762) documented for the **BUG A follow-up** below.

**Smoke verification (live dev daemon, logs `dev-server.log`, timestamps UTC).**
- 13:49:58 degraded enqueue → completed 13:50:43, `stockCount: 10870` (recommendations runner through SQLite).
- 13:54:59 re-enqueue → killed mid-run → durable `running` row survives restart in mirror table **`_degradated_task`** (`logs/sqlite-mirror.sqlite`, 36 tables). The 30-min stale-reclaim is gated on degraded-ACTIVE, so dormant leftover is harmless by design. This **corrects** the earlier belief that the queue was in-memory-only — it IS SQLite-persisted (`_degradated_task`, not `degraded_queue`).
- Catch-up spawn advances `next_run` via `calculateNextRun` (:729/:762), so a single in-window missed tick runs at most once.
- **Restore verified 3 ways**: Prisma psql (`nextRun` 2026-10-12 ×4), mirror file dump, and live daemon boot `Recomputed` ×4 `changed=false`.

**Edge cases found (recorded, follow-ups).**
- **BUG A (open follow-up)**: the degraded executor does NOT advance the mirror `next_run` on completion — so while degraded, a recurring job legitimately re-fires every 5-min tick (90-min pending/running dedup previously masked a 3rd fire). Fix idea: advance mirror `next_run` in degraded completion using the same `calculateNextRun` as spawn.
- BUG B (confirmed non-issue): `POST /api/admin/degraded-mode` = 405 (route is GET+PATCH only) — leave as-is.

**Gates (Spec 25).** tsc **46 exact (prod 0**, all pre-existing test-file errors) · targeted Jest **93/93 (4/4)** (`worker-engine`, `cron-daemon`, `recommendationCronService`, `daemon-sqlite-first`) · pre-commit hook green (tsc prod clean, context budget 91.8/100 KB). Lesson **159**.

## Spec 26 — Google Sheets header-label fix (client HeaderState aligned to server contract)

**Problem.** `app/admin/google-sheets/page.tsx` declared its own disjoint `HeaderState` (`"match" | "mismatch" | "empty" | "unreadable" | "absent" | "unknown"`), but the server emits exactly four states from `lib/services/googleSheets/tabs.ts` (`classifyHeader`) and `statusService.ts`: `"matched" | "drifted" | "absent" | "unknown"`. Every healthy tab (`matched`/`drifted`) fell through to the defensive fallback and rendered **"unknown"** — confirmed live on prod 2026-10-09 (`custom`/`metrics` matched, page showed "unknown").

**Fix** (`app/admin/google-sheets/page.tsx` only — server contract untouched, per spec OUT).
- Drop the local union; `import type { HeaderState } from "@/lib/services/googleSheets/tabs"` (type-only, erased at runtime → client-safe; prevents future drift).
- `HEADER_BADGE` now keyed by the four server states and **exported** (the only prod change beyond the map, needed by the test):
  - `matched` → "header ok" (green, unchanged label/cls)
  - `drifted` → "header drifted" (amber)
  - `absent` → **"no header yet" (blue)** — was red "tab missing" (absent ≠ broken, just uncreated)
  - `unknown` → "unknown" (gray, defensive fallback kept at render :546 `?? HEADER_BADGE.unknown`)

**Verification.** NEW `lib/__tests__/googleSheetsHeaderBadge.test.ts` **5/5** (every server state defined; labels asserted incl. `absent !== "tab missing"`). Browser check on live dev `/admin/google-sheets` (admin session): all six tabs render badges, **zero console errors** (only pre-existing themeColor metadata warning — untouched). Dev has no live spreadsheet headers, so all tabs read `unknown` locally — the "matched → header ok" visual is prod-only and covered by the mapping unit test. Gates: tsc **46 exact (no new)** · eslint **0** (2 touched files) · targeted Jest 5/5 + GS suites. No migration, no route change, no swagger change, no new deps.

## Files changed (Specs 25 + 26)

- `lib/services/worker/worker-engine.ts` (catch-up :791, spawn advance :729/:762, degraded gate :309-333)
- `lib/services/worker/cron-daemon.ts` (`DEFAULT_TIMEZONE = "UTC"` :33, per-job override :260-261, warning :266-272)
- `lib/services/recommendationCronService.ts` (+ 4 test suites: worker-engine, cron-daemon, recommendationCronService, daemon-sqlite-first)
- `app/admin/google-sheets/page.tsx` (HeaderState import, HEADER_BADGE exported 4-key map)
- `lib/__tests__/googleSheetsHeaderBadge.test.ts` (NEW)
- Docs: `.agents/specs/25-scheduled-execution-reliability.md` + `.agents/plans/25-*.md`, `.agents/specs/26-google-sheets-header-label-fix.md` + `.agents/plans/26-*.md`, `HANDOFF.md`, `Primer.md`, `Lessons.md` (Lesson 159), `agent-memory.md`, session archive `2026-10-09-ops-counter-fixes/` (flow addendum + decisions D14/D15)