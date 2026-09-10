# v3.32.0 — Admin Time Synchronisation (on-demand Postgres NOW() probe + persisted server-clock offset)

- **Date**: Sep 10 2026
- **Branch**: `fix/sqlite-init-reserved-keyword` → **MERGED to `main` via PR #117** (`38a27bf` merge; `e74ae54` feat · `df7959d` docs · `b75deb0` docs update). v3.32.1 hotfix (below) on `main` working tree, commit pending user
- **Status**: v3.32.0 MERGED + deployed via PR #117; **v3.32.1 post-merge hotfix** (db-health body-parsed-once) code+tests verified + live re-verified, docs + commit pending user (no push/merge/deploy without explicit approval)
- **Spec**: `.agents/specs/10-admin-time-correction.md` · **Plan**: `.agents/plans/10-admin-time-correction.md`

## User directive (confirmed)

> "in admin db health screen display server time and db time. and also admin can enter ist time so if server time is misaligned it can be corrected through admin entered input for timezone corrections."

## Root causes found

1. **Netlify host clock treats IST wall-clock as UTC** — stored cron `nextRun` values carry a ≈ **+5.5h skew** ("IST-as-UTC"). `calculateNextRun(cron, from = new Date())` (`lib/cron-parser.ts:83`) is UTC-correct but takes its default `from` from the **server clock**, so the skew propagates into every next-run computation and due-job gating.
2. **`parseIstDateTimeLocal` validity guard bug** — the round-trip check compared the parsed-UTC result against the IST input, silently producing a wrong epoch on any non-IST host. Fixed: epoch = `Date.UTC(y, m-1, d, h, min) − offset`, validity = `toIstIso(parsed).slice(0, 16) === input`.

## Design — per phase (plan `10-admin-time-correction.md`)

- **(Phase 1) Types/keys** (`lib/sqlite.ts:1753-1789`) — `TimeCorrectionRecord`, `TimeProbeRecord`, `_backup_meta` keys `time_correction` / `time_probe_db` + guards.
- **(Phase 2) Persistence** (`lib/sqlite.ts`) — `persistTimeCorrection` `:1792`, `deleteTimeCorrection` `:1805`, `restoreTimeCorrection` `:1815`, `persistTimeProbe` `:1831`, `restoreTimeProbe` `:1844`, `probeDbTimeNow` `:1866-1878` (`SELECT NOW()` via `$queryRawUnsafe`, 10s timeout, `IST_OFFSET_MINUTES = 330`, `TIME_ALIGN_TOLERANCE_MS = 60_000`); `SqliteFallback` interface `:247-257` + fallback entries `:5978-5983`.
- **(Phase 3) Correction engine** — NEW `lib/services/timeCorrection.ts` (pure, testable): `offsetMinutes = trueNow − serverNow` (fast clock +5.5h → `-330`); `applyOffset(_, 0)` = identity; **lazily applied** via `getCorrectedNow()` / `getCronFrom()` (read-through persisted correction each call, no cache); `getTimeDiagnostics()`; header documents the node-cron in-process OS-bound limitation (durable fix = correct `TZ`/`UTC` env on Netlify).
- **(Phase 4) Device API/UI** — `app/api/admin/db-health/route.ts` POST `probe_time` (`:395-425`, 30s throttle → HTTP 200 `{success:false, probed:false, message:"Probe throttled — wait 30s between probes"}`; Postgres down → 200 `{success:false, probed:false, available:false}`; success → `{probed:true, ...probe, time: getTimeDiagnostics()}`; audit `ADMIN_DB_SYNC`/`time-probe` metadata `{available, latencyMs, dbIso}`), `set_time_correction`, `clear_time_correction`; GET gains a zero-Prisma `time` block. UI `app/admin/utils/db-health/page.tsx` — **Time Synchronisation card** (`:247`, `:505-515` probe POST, `:1540` heading: Server/IST/DB time, misalignment badge, probe button + status, correction input + Save/Clear). `lib/audit.ts` +2 actions: `ADMIN_DB_TIME_CORRECTION_SET` / `ADMIN_DB_TIME_CORRECTION_CLEARED` (`// Admin time-correction actions (v3.32.0)`).
- **(Phase 5) Scheduling wiring** — `lib/services/recommendationCronService.ts` `:5`/`:118` uses `getCronFrom()`; `lib/services/worker/worker-engine.ts` `:8`/`:598`/`:631` (`getCronFrom()` for nextRun), `:645`/`:657` (`getCorrectedNow()` for the due-claim `nextRun: { lte: now }`).
- **(Phase 6) Tests** — NEW `lib/__tests__/timeCorrection.test.ts` **20/20** (full manual `jest.mock("@/lib/sqlite")` factory-closure store — `__esModule: true`, NO `...actual` spread, `jest.requireMock` casts; explicit no-`process.env.TZ` policy — unreliable on Windows, V8 caches `getTimezoneOffset`); `sqlite.test.ts` **71/71** (+ probe write/restore describe block).
- **(Phase 7) Docs** — this file + the standard v3.32.0 doc set (AGENTS.md row, CHANGELOG index, TODO.md row, Primer, agent-memory, Lessons #111, session-todos, latest.md handle, HANDOFF.md, sessions archive).

## Verification

- Targeted 4 suites: `timeCorrection` 20/20 + `sqlite` 71/71 + `recommendationCronService` + `worker-engine` → **118/118**.
- Full suite: **1106 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` async cache-flake).
- `npx tsc --noEmit`: **46 = exact baseline (0 new)**.
- No schema change → **no migration**; no new packages.
- Diff: **7 modified files, +565/−10** (`app/admin/utils/db-health/page.tsx` +232, `lib/sqlite.ts` +173, `app/api/admin/db-health/route.ts` +114, `lib/__tests__/sqlite.test.ts` +38, `lib/services/worker/worker-engine.ts` 10, `lib/services/recommendationCronService.ts` 5, `lib/audit.ts` +3) + 4 new untracked files (spec, plan, `timeCorrection.ts`, `timeCorrection.test.ts`).
- **Deferred**: live `probe_time` DB verification (local Postgres/Docker not running this session) — run on prod db-health once deployed, or locally with Docker up.

---

# v3.32.1 — db-health POST double-`req.json()` hotfix (parse the body ONCE, reuse `requestBody`)

- **Date**: Sep 10 2026
- **Branch**: on `main`, post-merge of v3.32.0 (PR #117 `38a27bf`); working tree = fix + regression test, commit pending user
- **Status**: code+tests verified (**5/5**) + live re-verified; docs complete; **commit pending user** (no push/merge/deploy without explicit approval)

## Root cause

POST `app/api/admin/db-health/route.ts` reads `req.json()` at the top (~:238) to derive `action`, then BOTH `restore` (~:272) and `set_time_correction` (~:434) RE-READ the body. A Web `Request` body stream is **single-use** (`bodyUsed` = true after the first `json()`), so the second read throws → both actions 400'd with the wrong message:
- `restore` → `"Invalid restore payload"` — **broken since v3.21.2** (the base64 backup-restore feature never worked through the UI as wired).
- `set_time_correction` → `"Invalid payload"` — inherited the same pattern in v3.32.0 (masking the real zod `"istDateTime is required"` error).

## Fix (surgical, route only)

Hoisted the body parse to the very top of POST:

```ts
let action = "sync_sqlite";
let requestBody = {};
try { requestBody = (await req.json()) ... }
```

with `// v3.32.1 fix: parse the body ONCE here and reuse requestBody`. `restore` reuses `requestBody as { data?: string; file?: string }` (unparseable body → `{}` → existing `"Missing base64 sqlite data"` 400 stays honest); `set_time_correction` reuses `requestBody as { istDateTime?: string }` (missing field → zod `"istDateTime is required"` instead of the masked `"Invalid payload"`).

## Tests & verification

- NEW `lib/__tests__/dbHealthRoute.test.ts` — **5/5** (node env; real `Request` objects via a `jsonPost` helper that enforces `bodyUsed` — the regression fails pre-fix).
- tsc **46 = exact baseline (0 new)**; no migration; no new packages.
- Live re-verify (Playwright :3000 admin db-health): Save Correction → `"Correction saved: server clock is 1 min SLOW (offset 1)"` + chip + footnote `"Active offset: 1 min"`; Clear → `"No correction saved — using the raw server clock"`; 0 console errors.
- **Deferred**: live `probe_time` DB check (local Postgres not running); durable fix = correct `TZ`/`UTC` env on Netlify (v3.32.0).