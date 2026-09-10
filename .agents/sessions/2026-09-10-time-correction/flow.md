# Session Flow — 2026-09-10 — v3.32.0 Admin Time Synchronisation

> Execution trace for the v3.32.0 session. Format per `.agents/sessions/README.md`.

## Symptom → Root-cause trace
1. User reported admins need to see server time AND db time in the db-health screen, and to enter an IST time so a misaligned server clock can be corrected (timezone corrections).
2. Trace: `probe_time` never validated against the real DB locally (Postgres not running) → **Deferred** (D4).
3. Root cause hunt: Netlify host clock treats IST wall-clock as UTC → stored cron `nextRun` skew ≈ +5.5h; `calculateNextRun(cron, from = new Date())` is UTC-correct but `from` = server clock.
4. Secondary bug found while fixing: `parseIstDateTimeLocal` round-trip guard compared parsed-UTC vs IST input → silently rejected valid IST inputs → corrupt epochs. Fixed via `toIstIso(parsed).slice(0,16) === input` (D2).

## Changes
| File | Change |
|------|--------|
| `lib/sqlite.ts` | NEW `probeDbTimeNow()` (`SELECT NOW()` via `$queryRawUnsafe`, 10s timeout, `IST_OFFSET_MINUTES = 330`, `TIME_ALIGN_TOLERANCE_MS = 60_000`) + `persistTimeCorrection`/`deleteTimeCorrection`/`restoreTimeCorrection`/`persistTimeProbe`/`restoreTimeProbe` (`_backup_meta` keys `time_correction`/`time_probe_db`; types `:1753-1789`, interface `:247-257`, fallback `:5978-5983`); `parseIstDateTimeLocal` round-trip fix |
| `lib/services/timeCorrection.ts` (NEW) | Correction engine: `offsetMinutes = trueNow − serverNow`; `applyOffset` identity@0; `getCorrectedNow()`/`getCronFrom()` lazy read-through no cache; `getTimeDiagnostics()` |
| `app/api/admin/db-health/route.ts` | POST `probe_time` (`:395-425`, 30s throttle → 200-throttled; PG-down → 200 `available:false`; audit `ADMIN_DB_SYNC`/`time-probe`) + `set_time_correction`/`clear_time_correction`; GET zero-Prisma `time` block |
| `app/admin/utils/db-health/page.tsx` | **Time Synchronisation card** (`:247/505-515/1540`): server/IST/DB time, misalignment badge, probe + correction input |
| `lib/audit.ts` | +`ADMIN_DB_TIME_CORRECTION_SET` / `ADMIN_DB_TIME_CORRECTION_CLEARED` |
| `lib/services/recommendationCronService.ts` | `getCronFrom()` at `:5/:118` |
| `lib/services/worker/worker-engine.ts` | `getCronFrom()` nextRun `:598/:631`; `getCorrectedNow()` due-claim `:645/:657` |
| `lib/__tests__/sqlite.test.ts` | +probe persist/restore describe (71/71 total) |
| `lib/__tests__/timeCorrection.test.ts` (NEW) | 20/20 — full manual `@/lib/sqlite` mock, no `process.env.TZ` |
| Docs | `.agents/changelog/versions-v3.32.md` (NEW), AGENTS.md row, CHANGELOG index row, TODO.md row, Primer (Last Updated + Current Project Status), agent-memory entry, Lessons #111 + Update Log, session-todos Current section, HANDOFF.md, plan + spec → IMPLEMENTED status, `.agents/sessions/2026-09-10-time-correction/` (decisions.md + flow.md), `.agents/handoffs/active/latest.md` |

## Verified
- Targeted suites: timeCorrection **20/20**, sqlite **71/71**, recommendationCronService, worker-engine → **118/118**
- Full suite: **1106 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake)
- `npx tsc --noEmit`: **46 = exact baseline (0 new)**
- No migration; no new packages; diff 7 modified +565/−10

## Verification matrix
| Item | Status |
|------|--------|
| Probe persist/restore round-trip (`_backup_meta`) | ✅ sqlite.test.ts 71/71 |
| `applyOffset` identity @ 0 / −330 | ✅ timeCorrection.test.ts |
| `getTimeDiagnostics` shape | ✅ timeCorrection.test.ts |
| `getCronFrom` / due-claim wiring | ✅ worker-engine + recs suites |
| `parseIstDateTimeLocal` round-trip regression | ✅ timeCorrection.test.ts |
| 30s probe throttle → 200-throttled | ✅ route + sqlite mock |
| Live `probe_time` DB check | ⏸ **Deferred** (Postgres/Docker not running) |

## Execution order (as performed)
1. Batch A: cleaned 9 scratch files; created session dir; wrote `.agents/changelog/versions-v3.32.md`
2. Batch B1: AGENTS.md row ✅ · TODO.md row ✅ · session-todos Current swap ✅ · plan status ✅ · spec status ✅ · latest.md read ✅ · CHANGELOG row ❌(anchor) → re-read + ✅ · agent-memory entry ❌(anchor) → re-read + ✅ · latest.md rewrite ✅
3. Batch B2: Primer Last Updated ✅ · Lessons #111 ✅ · HANDOFF yaml ✅ · HANDOFF block re-read
4. Batch B3: HANDOFF Handoff-Required block → v3.32.0 ✅ · Primer anchor re-read
5. Batch B4: Primer Current Project Status section ✅ · Lessons Update Log bullet ✅
6. Batch B5: session archive decisions.md + flow.md ✅
7. Pre-commit check: `git status` + junk scan (pending — next step)

---

## 2026-09-10 | v3.32.1 — db-health POST double-`req.json()` hotfix (on `main`, post-merge of v3.32.0 PR #117 `38a27bf`)

Post-merge live triage of v3.32.0 exposed this hotfix on `main`.

### Symptom (live-verified)
POST `/api/admin/db-health` with `action: "restore"` → 400 `"Invalid restore payload"`; `action: "set_time_correction"` → 400 `"Invalid payload"` — while `probe_time` / `sync_sqlite` / other actions worked.

### Root cause
`app/api/admin/db-health/route.ts` reads `req.json()` at the POST top (~:238) for `action`; the `restore` branch (~:272) and `set_time_correction` branch (~:434) then RE-READ `req.json()`. A Web `Request` body stream is single-use (`bodyUsed` after the first `json()`) → the second read throws → caught and mapped to a generic 400. `restore` has been broken since v3.21.2 (when the top-level `action` read was introduced); `set_time_correction` inherited the pattern when v3.32.0 added it.

### Fix (surgical, route only)
- Hoisted the body read at the POST top: `let action = "sync_sqlite"; let requestBody = {}; try { requestBody = (await req.json()) ... }` with `// v3.32.1 fix: parse the body ONCE here and reuse requestBody`.
- `restore` reuses `requestBody as { data?: string; file?: string }` — unparseable body → `{}` → existing `400 "Missing base64 sqlite data"` path (honest error, no throw).
- `set_time_correction` reuses `requestBody as { istDateTime?: string }` — missing field → zod `400 "istDateTime is required"` (was masked `"Invalid payload"`).

### Regression tests (NEW `lib/__tests__/dbHealthRoute.test.ts`, 5/5)
Real `Request` via `jsonPost` helper that enforces `bodyUsed` — a body re-read inside the route throws exactly as in prod, so the regression proves the fix. Cases: restore valid base64 → 200; restore non-base64 → 400 `"Missing base64 sqlite data"`; set_time_correction with istDateTime (+ probe-db-unavailable fallback) → 200; set_time_correction without istDateTime → 400 `"istDateTime is required"`; unknown action → `sync_sqlite` default (200).

### Verification
`dbHealthRoute.test.ts` **5/5**; tsc **46 = exact baseline (0 new)**; no migration; no new packages. Live-verified (Playwright :3000 admin db-health): Save Correction → `"Correction saved: server clock is 1 min SLOW (offset 1)"` + chip + footnote `"Active offset: 1 min"`; Clear → `"No correction saved — using the raw server clock"`; 0 console errors.

### Working tree on `main`
HEAD `b75deb0`; PR #117 merge `38a27bf` present. Uncommitted: `M app/api/admin/db-health/route.ts`, `?? lib/__tests__/dbHealthRoute.test.ts`, + the v3.32.1 doc set (AGENTS.md, versions-v3.32.md, TODO.md, HANDOFF.md, Primer.md, Lessons.md #112, agent-memory.md, latest.md, flow.md (this), decisions.md (D6), session-todos.md, .agents/CHANGELOG.md). Planned commit message: `fix(admin): v3.32.1 db-health POST body-parsed-once (restore + set_time_correction)`.

### Steps
1. Root-cause trace: route POST reads `req.json()` ~:238 → re-reads at restore ~:272 + set_time_correction ~:434 → 400 on the second read → reproduced in a real-`Request` regression test.
2. Fix: parse body ONCE at POST top; reuse `requestBody` in both branches.
3. Regression: `dbHealthRoute.test.ts` 5/5 (`jsonPost` helper enforces `bodyUsed`).
4. Doc set: AGENTS.md v3.32.1 row + v3.32.0 MERGED amend; versions-v3.32.md v3.32.1 section; TODO.md row; HANDOFF.md; Primer.md; Lessons #112; agent-memory v3.32.1 entry; latest.md rewrite; flow/decisions append (this + D6); session-todos.md; .agents/CHANGELOG.md index.
5. Live verify: Save Correction / Clear on :3000 admin db-health (0 console errors).
6. Pre-commit check: `git status` + junk scan, then cleanup dev PID 12096 + temp log (keep MCP 4096 + pg docker 5432); commit pending user approval — no push/merge/deploy.