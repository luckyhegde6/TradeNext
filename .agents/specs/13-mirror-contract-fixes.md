# Spec Document — Mirror-Contract Fixes (bugs 15 / 16 / 17)

> Scope approved by user 2026-09-18: "15 + 16 + high-impact 17"; heartbeat POST auth: **add auth**.
> Session: `.agents/sessions/2026-09-18-v340ctx/`.

## 1. Overview

**What**: Fix three live-verified production bugs found on 2026-09-18 (v3.40.1 live-site
verification). All three share one root cause family: the SQLite-mirror fallback path is a
*second implementation* of an API contract, and it does not match the Prisma path's shape.

**Why**: Production is in a Prisma Postgres P6003 plan-limit hold until 2026-10-02, so the
mirror paths are the *primary* paths right now. Where the mirror returns raw snake_case rows,
camelCase consumers (calendar, admin tables, dividend calendar) render nothing — and where a
route has **no** mirror fallback, it 500-loops and crashes the UI.
Refs: `BUGS.md` rows 15/16/17; `Lessons.md` 129 (fallback branch = second contract
implementation) + 130 (unguarded `.filter` on `{error}` body → Error Boundary).

**Scope**:
- **IN** — (16) mirror row → camelCase mapper + IST-correct calendar day key; (15) `/api/alerts`
  mirror fallback + alerts-page array guard/error state; (17-high) `/api/admin/workers/status`
  auth (GET **and** POST) + mirror fallback + admin-page poll backoff; `/api/dividends/calendar`
  mirror fallback.
- **OUT** — remaining bug-17 endpoints (`/api/admin/monitoring`, `/api/admin/users`,
  `/api/admin/workers` list, `/api/admin/cron`, `/api/screener/saved`) → recorded as a tracked
  follow-up in `BUGS.md`. An external machine key for the heartbeat POST (POST is admin-session
  gated; the in-process worker engine writes heartbeats via **direct Prisma**, not HTTP).

**Depends on**: `lib/sqlite.ts` mirror (`getCorporateActions`, `getAlerts`, `getWorkerStatuses`),
`lib/db-utils.ts` (`isDbUnavailableError`, `isPlanLimitBreakerOpen`).

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | None (fix-only change set) |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/corporate-actions/combined` | Mirror branches (`sqlite_mirror`, `sqlite_backup`) map rows to the Prisma camelCase contract |
| GET | `/api/alerts` | `isDbUnavailableError` → SQLite mirror fallback (user-scoped); `action=count` too |
| GET | `/api/admin/workers/status` | **Add** `auth()` admin guard (was unauthenticated); `isDbUnavailableError` → mirror fallback |
| POST | `/api/admin/workers/status` | **Add** `auth()` admin guard (was unauthenticated write) |
| GET | `/api/dividends/calendar` | Via service: `isDbUnavailableError` → mirror fallback for dividends |

---

## 3. Database Schema

**N/A — no schema change.** No Prisma model added or modified. No migration. The mirror tables
(`corporate_action`, `alert`, `worker_status`) already exist.

---

## 4. Functions to Implement

### A. `lib/services/corpActionMirror.ts` (created)

#### `mapMirrorCorporateAction(row: Record<string, unknown>): MirrorCorporateAction`

- Maps a raw `corporate_action` mirror row (snake_case: `company_name`, `action_type`,
  `ex_date`, `old_fv`, `new_fv`, `dividend_per_share`, `dividend_yield`,
  `book_closure_start_date`, `book_closure_end_date`, `announcement_date`, …) to the exact
  camelCase shape produced by the Prisma path in `combined/route.ts:353-363`.
- Tolerant of already-camelCase input (idempotent) so it is safe if the mirror shape changes.
- Coerces numerics (`dividendPerShare`, `dividendYield`) to `number | null`; dates/strings pass
  through as ISO strings or `null`. Never throws.

### B. `lib/services/dividendCalendarService.ts` (modified)

#### `fetchDividends()` — add mirror fallback

- In the existing `catch`, if `isDbUnavailableError(error)` (or `isPlanLimitBreakerOpen()`),
  read `getSqliteFallback().getCorporateActions(500)`, filter `action_type === "DIVIDEND"` and
  `ex_date` within `[startDate, endDate]`, map via `mapMirrorCorporateAction`, project to
  `DividendEvent` (`currentPrice: null`). Return `[]` only if the mirror is also empty.
- Preserves the existing never-throws contract.

### C. `app/api/alerts/route.ts` (modified)

#### `getMirrorAlerts(userId: number): Alert[]`

- `getSqliteFallback()?.getAlerts({ limit: 500 })` → filter `Number(row.userId) === userId`
  (mirror returns all users) → coerce to the Prisma `getUserAlerts` shape:
  `{ id, type, symbol, condition, triggered: Boolean(triggered), triggeredAt, seen: Boolean(seen), createdAt }`.
- Returns `[]` when the mirror is unavailable.

### D. `app/api/admin/workers/status/route.ts` (modified)

#### `mapMirrorWorkerStatus(row: Record<string, unknown>)`

- `worker_id → workerId`, `worker_name → workerName`, `current_task_id → currentTaskId`,
  `cpu_usage → cpuUsage`, `memory_usage → memoryUsage`, `last_heartbeat → lastHeartbeat`
  (+ `id`, `status`). Sort by `lastHeartbeat` desc; honour `includeOffline`.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/corpActionMirror.ts` | **Created** | Shared snake_case → camelCase mirror mapper |
| `app/api/corporate-actions/combined/route.ts` | Modified | Apply mapper in both mirror branches |
| `app/markets/calendar/page.tsx` | Modified | Local-time day key (fix IST off-by-one) |
| `app/api/alerts/route.ts` | Modified | Mirror fallback for list + count |
| `app/alerts/page.tsx` | Modified | `Array.isArray` guard + error state (no crash) |
| `app/api/admin/workers/status/route.ts` | Modified | Auth on GET + POST; mirror fallback on GET |
| `app/admin/utils/workers/page.tsx` | Modified | Poll backoff after repeated failures |
| `lib/services/dividendCalendarService.ts` | Modified | Mirror fallback in `fetchDividends` |
| `lib/__tests__/corpActionMirror.test.ts` | **Created** | Mapper unit tests |
| `lib/__tests__/alertsMirrorFallback.test.ts` | **Created** | Alerts mirror fallback + user scoping |
| `lib/__tests__/workersStatusRoute.test.ts` | **Created** | 401 unauth (GET/POST) + mirror fallback shape |
| `lib/__tests__/dividendCalendarMirror.test.ts` | **Created** | Dividend mirror fallback on DB error |
| `BUGS.md` | Modified | Mark 15/16 done, narrow 17, add follow-up row |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/db-utils` | `isDbUnavailableError`, `isPlanLimitBreakerOpen` | Gate fallbacks |
| `@/lib/sqlite` | `getSqliteFallback`, `getCorporateActions`, `getAlerts`, `getWorkerStatuses` | Mirror reads |
| `@/lib/logger` | `logger.warn/error` | Structured logging |

---

## 7. API Contract

### GET /api/corporate-actions/combined (mirror branches)

**Response (200)** — now identical in shape to the Prisma path:
```json
{ "data": [ { "id": 1, "symbol": "RELIANCE", "companyName": "Reliance Industries",
  "actionType": "DIVIDEND", "exDate": "2026-09-22T00:00:00.000Z", "companyName": "…",
  "oldFV": null, "newFV": null, "dividendPerShare": 12.5, "dividendYield": 1.01 } ],
  "source": "sqlite_mirror" }
```

### GET /api/alerts

**Response (200)**: `Alert[]` (unchanged bare-array contract). On DB-unavailable it is served
from the mirror, scoped to the session user. **Response (401)** unchanged.

### GET /api/admin/workers/status

**Response (401)** `{ "error": "Unauthorized" }` when unauthenticated (NEW).
**Response (200)**: `WorkerStatusDTO[]` (`workerId`, `workerName`, `status`, `currentTaskId`,
`cpuUsage`, `memoryUsage`, `lastHeartbeat`), from Prisma or the mirror.

### POST /api/admin/workers/status

**Response (401)** `{ "error": "Unauthorized" }` when unauthenticated (NEW). Body schema
(`heartbeatSchema`) unchanged.

---

## 8. UI/UX Requirements

- **`/alerts`**: on a non-array / failed response, show the existing error affordance instead of
  throwing — never blank the page (BUGS 15). Loading/empty states already exist.
- **`/markets/calendar`**: dividend/bonus/split markers must land on the correct local day;
  the month view must not be empty while the API returns rows.
- **`/admin/utils/workers`**: repeated poll failures must back off (10s → 20s → 40s → cap 60s)
  and stop the console-error storm (BUGS 17), with a visible "paused/retrying" hint.

---

## 9. Rules & Guardrails

- [x] No Prisma in client components
- [x] Server-side only mirror reads
- [x] Errors return safe defaults, never expose internals
- [x] Logging via `@/lib/logger` only (no `console.log`)
- [x] Admin routes protected by `auth()` + admin role
- [x] Mirror branch returns the **same** DTO shape as the Prisma branch (Lesson 129)

---

## 10. Expected Behavior

1. `/api/corporate-actions/combined` under breaker-open returns rows with `companyName`,
   `actionType`, `exDate`, `oldFV`/`newFV`, numeric `dividendPerShare`/`dividendYield`.
2. `/markets/calendar` renders the 40 mirror dividends on their correct dates (IST).
3. `/api/alerts` returns `200 []` (not 500) under the hold; the page renders empty state.
4. `/api/alerts` never returns another user's alerts.
5. `/api/admin/workers/status` returns 401 unauthenticated for GET and POST.
6. `/api/admin/workers/status` returns mirror worker rows (camelCase) for an admin under the hold.
7. `/admin/utils/workers` stops the 10s 500-loop after repeated failures.
8. `/api/dividends/calendar` reports non-zero `totalDividends` under the hold.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Prisma P6003 / DB down | Serve mirror; if mirror empty, safe default (`[]`) | `warn` |
| Mirror read throws | Safe default (`[]`); never 500 the fallback | `debug` |
| Unauthenticated admin GET/POST | 401 | — |
| Non-array API body in UI | Treat as `[]` + error state | `error` (client console) |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/`)

- [ ] `corpActionMirror` maps snake_case → camelCase; numeric coercion; null-safe; idempotent
- [ ] `dividendCalendarService` falls back to mirror on `isDbUnavailableError`; filters DIVIDEND + date window
- [ ] alerts route: mirror fallback scopes to `userId`; returns `[]` when mirror down; 401 unauth
- [ ] workers/status: 401 unauth GET + POST; mirror fallback shape; `includeOffline` honoured

### Integration / E2E (`e2e/`)

- [ ] `/alerts` renders (not Error Boundary) when `/api/alerts` is aborted/500 (route intercept)

---

## 13. Performance Considerations

- Mirror reads are local SQLite (`LIMIT` bounded). No new Prisma ops.
- No N+1: mapper is pure; reads batched per request.

## 14. Security Considerations

- `/api/admin/workers/status` GET+POST now require an admin session (was unauthenticated).
- Alerts mirror fallback is **scoped to the session user** (mirror helper returns all users).
- No secrets in logs; no new env vars.

---

## 15. Definition of Done

- [ ] All files per section 5 created/modified
- [ ] Mirror DTO shape equals Prisma DTO shape (asserted in tests)
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` — no new errors (baseline: 46)
- [ ] `npm run quickbuild` — production build clean
- [ ] UI states verified on :3000 (alerts error path, calendar markers, workers backoff)
- [ ] Remaining bug-17 endpoints recorded as a follow-up in `BUGS.md`
- [ ] Documentation updated (AGENTS.md, CHANGELOG, Primer, agent-memory, Lessons, session files)
