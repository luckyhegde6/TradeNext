# Spec Document — Admin Time Synchronisation (server/DB time display + IST correction)

> Branch: `feat/admin-time-correction` (from current worktree state — user decides)
> Date: 2026-09-10
> ✅ **IMPLEMENTED 2026-09-10** — all IN-scope items delivered (Spec §1–§7); verification in the plan + `.agents/changelog/versions-v3.32.md`. **MERGED to `main` via PR #117 (`38a27bf`; `e74ae54` feat · `df7959d` docs · `b75deb0` docs update); post-merge hotfix in v3.32.1 (db-health POST body-parsed-once — commit pending user).**

## 1. Overview

**What**: The admin DB-health screen (`/admin/utils/db-health`) gains a **Time Synchronisation** card that (a) shows Server time (ISO + timezone + UTC offset), derived IST, and the last-known Postgres DB time side by side with a misalignment badge, and (b) lets the admin enter the **correct current IST wall-clock time**; the app derives an offset from it and persists a **server-time correction** that is applied to all scheduling time computations (next-run calculation / due-job gating). The correction survives restarts via the SQLite `_backup_meta` mirror, like the existing ops-counter/cron heartbeat persistence. **No Prisma schema change → no migration. GET stays zero-Prisma (v3.23.x rule).**

**Why**: User: "in admin db health screen display server time and db time. and also admin can enter ist time so if server time is misaligned it can be corrected through admin entered input for timezone corrections." Postgres (`SELECT NOW()`) is authoritative and correct; the Netlify app-server clock/timezone handling drifts (diagnosed: stored cron `nextRun` values fit "IST wall-clock treated as UTC", i.e. a +5.5h skew). Since `calculateNextRun(cron, from = new Date())` (`lib/cron-parser.ts:83`) is UTC-correct and takes its default `from` from the **server clock**, a persisted offset applied at the `from`/`now` call sites fixes next-run math regardless of host clock skew.

**Scope (IN)**:
- GET `/api/admin/db-health` adds a `time` block (server/IST/DB display + correction status) — zero Prisma.
- POST actions: `probe_time` (on-demand `SELECT NOW()`, throttled ≥30s), `set_time_correction`, `clear_time_correction`.
- NEW `lib/services/timeCorrection.ts` (pure helpers + persistence + `getCorrectedNow()`).
- NEW SQLite `_backup_meta` meta helpers (`persist/restore/delete TimeCorrection`, `persist/restore TimeProbe`) following the `persistOpsCounter`/`persistDbErrorCounts` pattern (`lib/sqlite.ts:1582-1706`).
- Wire `getCorrectedNow()` into the 4 known scheduling call sites (below).
- UI card + tests.

**Scope (OUT)**:
- Node-cron's own in-process firing clock cannot be shifted by a JS offset — path-A timer drift stays OS-clock-bound (documented limitation).
- NOT in scope: the pre-existing 42601 `admin_announcement` sync defect, cron-silence investigation cleanup, any Prisma/DB schema change, deploy-operator fixes (e.g. setting TZ env on Netlify — still recommended long-term).
- No change to `lib/cron-parser.ts` internals (it stays pure UTC; callers pass the corrected `from`).

**Depends on**: Existing `_backup_meta` persistence machinery (v3.21.1/v3.22.0), SQLite-first zero-Prisma GET contract (v3.23.x/v3.31.0), adminAuth middleware on the route (already present).

---

## 2. Routes

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/db-health` | Response gains `time` block (zero-Prisma) |
| POST | `/api/admin/db-health` | New actions `probe_time`, `set_time_correction`, `clear_time_correction` |

POST body for correction actions:

```typescript
type SetTimeCorrectionBody = { istDateTime: string }; // "YYYY-MM-DDTHH:mm", datetime-local format, Asia/Kolkata wall clock
```

---

## 3. Database Schema

**No Prisma schema change. No migration. No new tables.** Persistence uses the existing SQLite `_backup_meta` key/value mirror (in-memory sql.js, restored like `ops_counter`; a fresh deploy reset is acceptable and documented in UI).

| `_backup_meta` key | value (JSON) | Written by | Read by |
|--------------------|--------------|------------|---------|
| `time_correction` | `{ offsetMinutes, istInput, appliedAt, serverNowIso }` | `set_time_correction` POST | GET + `getCorrectedNow()` |
| `time_probe_db` | `{ dbIso, probedAt }` | `probe_time` POST | GET (last-known DB time) |

---

## 4. Functions to Implement

### A. `lib/services/timeCorrection.ts` (NEW — pure core + persistence wrapper)

Constant: `IST_OFFSET_MINUTES = 330` (India has no DST).

#### `toIstIso(d: Date): string`
Format `d` as `YYYY-MM-DDTHH:mm:ss+05:30` IST wall clock via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", ... })` parts. Never throws, `en-CA` gives ISO-ish date.

#### `getIstNowIso(): string`
`toIstIso(new Date())`.

#### `parseIstDateTimeLocal(s: string): Date | null`
`"YYYY-MM-DDTHH:mm"` treated as Asia/Kolkata wall clock → UTC instant via `Date.UTC(y, mo-1, d, h - 5, mi - 30)`. Returns `null` for NaN/short input.

#### `computeCorrectionOffsetMinutes(istInput: string, serverNow: Date): number | null`
`Math.round((parseIst(istInput).getTime() - serverNow.getTime()) / 60000)`; `null` if parse fails. **Sign semantics**: `offsetMinutes = trueNow − serverNow`. Example (IST-as-UTC skew): admin enters `01:49`, server clock reads `07:19:30Z` → offset `−330` min; `getCorrectedNow()` = `serverNow + (−330)` = true `01:49:30Z`.

#### `applyOffset(nowMs: number, offsetMinutes: number): Date`
`new Date(nowMs + offsetMinutes * 60000)`.

#### `formatOffsetMinutes(offsetMinutes: number): string`
`"+330"` / `"-330"` / `"0"`.

#### `saveCorrection(c)`, `loadCorrection()`, `clearCorrection()`
Persist/read/delete the `time_correction` `_backup_meta` row via the sqlite helpers (below). `loadCorrection` returns `null` when absent/unparseable.

#### `saveDbProbe(probe)`, `loadDbProbe()`
Persist/read the `time_probe_db` row (last-known DB time for GET).

#### `getCorrectedNow(): Date`
`applyOffset(Date.now(), loadCorrection()?.offsetMinutes ?? 0)` — a clean `now` for scheduling math.

#### `getCronFrom(): Date`
Alias of `getCorrectedNow()` for `calculateNextRun` call sites (explicit intent at call sites).

#### `getTimeDiagnostics(now = new Date()): TimeDiagnostics`
Combines everything for the GET `time` block — server fields, derived IST, last DB probe, correction status, `misaligned` flag:

```typescript
type TimeDiagnostics = {
  serverIso: string; serverUtcOffsetMinutes: number; serverTz: string;
  istIso: string;
  dbIso: string | null; dbProbeAt: string | null;
  misaligned: boolean | null; // null when no DB probe yet
  correctedNowIso: string;
  correction: { enabled: boolean; offsetMinutes: number; istInput: string; appliedAt: string } | null;
};
```

`misaligned = dbIso != null && |Date.parse(dbIso) − getCorrectedNow()| > 60_000`.

### B. `lib/sqlite.ts` — 4 thin `_backup_meta` helpers (mirror `persistOpsCounter:1582` / `restoreOpsCounter:1604` / `persistDbErrorCounts:1682` / `restoreDbErrorCounts:1706`)

| Function | Behavior |
|----------|----------|
| `persistTimeCorrection(db, json)` | `INSERT OR REPLACE INTO _backup_meta (key, value) VALUES ('time_correction', json)` |
| `restoreTimeCorrection(db)` | `SELECT value FROM _backup_meta WHERE key = 'time_correction' LIMIT 1` → parsed JSON or `null` |
| `deleteTimeCorrection(db)` | `DELETE FROM _backup_meta WHERE key = 'time_correction'` |
| `persistTimeProbe(db, json)` / `restoreTimeProbe(db)` | same pattern for `time_probe_db` |

Exported through the module-level exports (pattern: `:5807-5809`), non-fatal try/catch, no Prisma.

### C. Wiring — corrected `now` at the scheduling call sites

| Site | Change |
|------|--------|
| `lib/services/recommendationCronService.ts:117/:186` (create + self-heal upsert) | `calculateNextRun(def.cronExpression, getCronFrom())` |
| `lib/services/worker/worker-engine.ts:597/:630` (`spawnDueCronJob` nextRun advance) | use `getCorrectedNow()` |
| `lib/services/worker/worker-engine.ts:653` (`checkScheduledJobs` due gate `nextRun: { lte: now }`) | `const now = getCorrectedNow()` |

`lib/cron-parser.ts` stays pure (UTC-correct); do not change its default.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/timeCorrection.ts` | **Created** | Pure helpers + persistence + `getCorrectedNow()`/`getCronFrom()`/`getTimeDiagnostics()` |
| `lib/sqlite.ts` | Modified | 4 thin `_backup_meta` meta helpers (time correction + db probe) |
| `app/api/admin/db-health/route.ts` | Modified | GET → `time` block; POST → `probe_time` / `set_time_correction` / `clear_time_correction` (Zod + throttle + audit) |
| `app/admin/utils/db-health/page.tsx` | Modified | "Time Synchronisation" card (display + probe button + correction form) |
| `lib/services/recommendationCronService.ts` | Modified | `getCronFrom()` at calculateNextRun sites |
| `lib/services/worker/worker-engine.ts` | Modified | `getCorrectedNow()` at :597/:630/:653 |
| `lib/audit.ts` | Modified | +2 tags: `ADMIN_DB_TIME_CORRECTION_SET`, `ADMIN_DB_TIME_CORRECTION_CLEARED` |
| `lib/__tests__/timeCorrection.test.ts` | **Created** | Pure-helper tests |
| `lib/__tests__/sqlite.test.ts` | Modified | +2 meta roundtrip tests |

---

## 6. Dependencies

### New Packages
None.

### Internal Dependencies

| Module | Used For |
|--------|----------|
| `@/lib/sqlite` | `_backup_meta` meta helpers (via `ensureSqliteBackup` + helpers) |
| `@/lib/prisma` | ONLY in POST `probe_time` (`$queryRaw\`SELECT NOW()\``) — never in GET |
| `@/lib/audit` | correction audit tags |
| `@/lib/logger` | request/throttle/error logging |
| zod | POST body validation (already a route dep) |

---

## 7. API Contract

### GET /api/admin/db-health

Existing response gains `time` (see `TimeDiagnostics` above). Example (skewed server, no probe yet):

```json
{
  "time": {
    "serverIso": "2026-09-10T07:19:30.000Z",
    "serverUtcOffsetMinutes": 330,
    "serverTz": "Asia/Kolkata",
    "istIso": "2026-09-10T12:49:30+05:30",
    "dbIso": null,
    "dbProbeAt": null,
    "misaligned": null,
    "correctedNowIso": "2026-09-10T12:49:30.000Z",
    "correction": null
  }
}
```

### POST /api/admin/db-health `{ action: "probe_time" }`

- Throttle: skip if last probe <30s ago (return existing last probe + `throttled: true`).
- Runs `SELECT NOW()` via `prisma.$queryRaw` (1 read / manual click; fits 200K ops/mo).
- Persists `{dbIso, probedAt}` to `time_probe_db`; returns full `time` block.
- DB down → 200 with `time.dbIso` = last known (or null), `warning: "DB time probe failed"`, no throw.

### POST /api/admin/db-health `{ action: "set_time_correction", istDateTime: "YYYY-MM-DDTHH:mm" }`

- Zod: `z.object({ action: z.literal("set_time_correction"), istDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) })`.
- `offsetMinutes = computeCorrectionOffsetMinutes(istDateTime, new Date())`; `null` → 400 "Invalid IST datetime".
- Persists `time_correction` JSON; audit `ADMIN_DB_TIME_CORRECTION_SET` (metadata: istDateTime, offsetMinutes).
- Returns `{ success: true, computed: { istDateTime, offsetMinutes, appliedAt }, time }`.

### POST /api/admin/db-health `{ action: "clear_time_correction" }`

- Deletes `time_correction` row; audit `ADMIN_DB_TIME_CORRECTION_CLEARED`.
- Returns `{ success: true, time }`.

---

## 8. UI/UX Requirements

`app/admin/utils/db-health/page.tsx` — new **"Time Synchronisation"** card (place near the existing stat cards / above DB Logs).

- **Display row** (read-only, updates with the 30s auto-refresh): Server time (ISO + `serverTz` + UTC offset), IST (derived), DB time (last probe; "Not probed" when null), Misalignment badge.
- **Badge logic**: db unknown → gray "DB time —"; `|db − corrected now| ≤ 60s` → emerald "Aligned"; else amber "Server vs DB ±Xm".
- **Probe button**: "Probe DB time" → POST `probe_time`; shows spinner while probing + `throttled` notice when clicked too soon.
- **Correction form**: `datetime-local` input (default prefilled with current IST), **Apply** button → POST `set_time_correction`; on success shows active correction card (`offsetMinutes` formatted + `appliedAt`), **Clear** button POSTs `clear_time_correction`. Inline note: "Postgres DB time is authoritative. Enter current IST to correct server-clock drift in scheduling computations." Amber note when correction is **enabled**.
- **States**: loading (skeleton rows) / error (retry via existing data refresh) / data / empty (db not probed).

---

## 9. Rules & Guardrails

- [x] No Prisma in client components
- [x] GET stays **zero-Prisma** (v3.23.x / v3.31.0 contract) — DB probe only via explicit POST action
- [x] All inputs validated via Zod (invalid → 400, nothing persisted)
- [x] Errors return safe defaults (probe failure → last-known/null + warning, no throw)
- [x] Logging via `@/lib/logger` only
- [x] Audit trail for state-changing operations (set/clear correction)
- [x] No schema change → no migration; no new packages
- [x] SQLite `_backup_meta` only — zero Prisma writes for correction persistence

---

## 10. Expected Behavior

1. GET (no correction, no probe) → `time.misaligned === null`, `correction === null`, server fields populated.
2. POST `probe_time` on healthy DB → `time.dbIso` = `SELECT NOW()` result; `misaligned` computed on next GET.
3. POST `probe_time` twice <30s → second returns `throttled: true` + cached probe (no 2nd Prisma read).
4. POST `probe_time` with DB down → 200, `dbIso` = last known or null, `warning` set.
5. POST `set_time_correction` with IST-as-UTC skew (server at 07:19:30Z while true is 01:49:30Z): admin enters `"2026-09-10T01:49"` → `offsetMinutes === -330`; `getCorrectedNow()` returns the true instant.
6. `getCronFrom()` at `recommendationCronService` + worker-engine sites produces UTC-correct nextRuns (no +5.5h drift) when correction enabled.
7. POST `set_time_correction` with `"2026-13-99T99:99"` → 400, nothing persisted.
8. POST `clear_time_correction` → correction disabled; `getCorrectedNow()` = raw server now.
9. Correction + probe survive GET/POST round-trip via `_backup_meta` (same-process persistence).
10. UI: card renders in loading/data/empty states; Apply/Clear + Probe work; misalignment badge reflects data.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| `SELECT NOW()` fails (DB down) | 200 + last-known/null + `warning`, don't throw | `warn` |
| Invalid `istDateTime` | Zod/NaN → 400, nothing persisted | `warn` |
| `_backup_meta` unreadable (sqlite not ready) | correction treated as disabled + db fields null; probe still attempts Prisma | `warn` |
| Throttled probe click | 200 + cached probe + `throttled: true` | `debug` |

---

## 12. Test Strategy

### Unit — pure helpers (`lib/__tests__/timeCorrection.test.ts`, NEW, ~9)

- [ ] `toIstIso` renders IST wall clock with `+05:30` (TZ-pinned `Asia/Kolkata`; jest runs UTC → the 5.5h shift is visible)
- [ ] `parseIstDateTimeLocal("2026-09-10T01:49")` → `2026-09-10T01:49:00+05:30` instant (i.e. `2026-09-09T20:19:00Z`)
- [ ] `parseIstDateTimeLocal` invalid/NaN → `null`
- [ ] `computeCorrectionOffsetMinutes` IST-as-UTC skew → `-330` (regression for the diagnosed corruption)
- [ ] `computeCorrectionOffsetMinutes` aligned → `0`
- [ ] `applyOffset(07:19:30Z, -330)` → `01:49:30Z`
- [ ] `formatOffsetMinutes` `"+330"`/`"-330"`/`"0"`
- [ ] `getTimeDiagnostics` misaligned flag with probe: within 60s → false; >60s → true; no probe → null
- [ ] `getTimeDiagnostics` correction block shape (with/without correction; `@/lib/sqlite` mocked)

### Unit — sqlite meta (`lib/__tests__/sqlite.test.ts`, +2)

- [ ] persist/restore/delete `time_correction` roundtrip
- [ ] persist/restore `time_probe_db` roundtrip (mirror ops-counter mock style)

### Route-level (optional, mock pattern ref `adminAiConfigModelManagement.test.ts`)

- [ ] POST `set_time_correction` invalid body → 400
- [ ] POST `clear_time_correction` → success (if mock pattern is lightweight; else covered by pure + sqlite tests)

---

## 13. Performance Considerations

- Zero extra Prisma ops on GET.
- Probe = 1 Prisma read per manual admin click, throttled 30s.
- Correction = 0 Prisma writes (SQLite meta only).
- `getCorrectedNow()` does 1 tiny `_backup_meta` read per call — negligible; memoize per process tick if needed (not expected).

---

## 14. Security Considerations

- Admin-only route + existing `adminAuth` on POST/GET (already protected).
- `istDateTime` is Zod-validated; no SQL; no injection surface.
- No secrets touched; audit metadata excludes user input beyond the ISO string.
- Correction is an operational override — UI shows a persistent amber "correction enabled" notice.

---

## 15. Definition of Done

- [ ] All functions per section 4 implemented
- [ ] All files per section 5 created/modified
- [ ] GET + 3 POST actions working per section 2/7
- [ ] No Prisma schema change / no migration
- [ ] Unit tests written + passing (`npm run test` — targeted `timeCorrection.test.ts` + `sqlite.test.ts` first)
- [ ] `npx tsc --noEmit` — 0 new errors beyond baseline (46)
- [ ] UI states (loading/empty/error/data) implemented
- [ ] Responsive at 375px, 768px, 1440px
- [ ] Dark/light mode renders correctly
- [ ] Audit trail for set/clear correction
- [ ] Live-verified on :3000 (if dev server running): probe works, correction applied → nextRun math shifts by offset, 0 console errors
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons) + session memory (`decisions.md` + `flow.md`)
- [ ] No commit/push/merge without explicit user approval