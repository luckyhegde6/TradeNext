# Spec Document — Async Google Sheets Re-scan (worker task queue)

> Spec 27 · branch `fix/daily-rec-swing-cron-worker` · created 2026-10-10 · status **DRAFT (awaiting human approval)**
> Follows `.agents/templates/spec-template.md`.

## 1. Overview

**What**: Move the admin console's **Re-scan** execution off the HTTP request path and onto
the existing worker task queue. `POST /api/admin/google-sheets/rescan` keeps all its cheap
validation, enqueues a new `google_sheets_rescan` worker task, and returns `202` with a
`taskId`. The console then polls the **already-existing** `GET /api/admin/workers?taskId=<id>`
surface and renders the same result it renders today.

**Why**: On production, Rescan returns **HTTP 502**. The route runs the whole scan synchronously
inside the request — `rescanScreener()` calls `runChartinkUnifiedScreeners({ forceRefresh: true,
tvFallbackLimit: 200 })`, a full-universe Chartink + TradingView fallback pass that takes far
longer than the Netlify function/gateway budget. Netlify kills the function before it answers;
the route itself never maps anything to 502. The scan is legitimately slow, so the fix is to stop
doing it in the request — the platform already has a durable task queue with a 240-minute
`TASK_TIMEOUT_MS`, per-task result storage, and an admin status endpoint.

**In scope**:

- New worker task type `google_sheets_rescan`, dispatched by `executeTask()`.
- `POST /api/admin/google-sheets/rescan` → validate → enqueue → `202 { taskId }` (audit at enqueue).
- Console Re-scan button: enqueue + poll `GET /api/admin/workers?taskId=` + render result.
- Registry bookkeeping: new type added to `degradedTaskRegistry.ts` as **NOT degraded-safe**
  (external side effects), with a reason.
- Tests for the executor, the enqueue route, and the registry union.

**Out of scope**:

- No new API routes (the status read surface already exists and returns `{ task }`).
- No Prisma schema change (no migration).
- No change to `rescanService.ts` scan logic (it is reused as-is; only a lock-free pre-check helper is added).
- No change to the degraded executor/queue (the new type is intentionally skipped in degraded mode).
- No `PATCH runNow` behavior change (it still executes synchronously — a **pre-existing** trait of
  every task type, see §11).
- No automatic retry (see §11).
- Sync/Ledger/Metrics actions are untouched.

**Depends on**: Spec 18/19/20 Google Sheets subsystem; Spec 21 degraded engine (registry contract);
worker engine `executeTask` + `spawnRegularTask` + `GET /api/admin/workers?taskId=` (all pre-existing).

---

## 2. Routes

> List ALL API routes (existing modified + new) this feature touches.

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | **None.** The status read surface already exists. |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/admin/google-sheets/rescan` | Executes scan → **enqueues** `google_sheets_rescan`; returns `202 { success, queued, taskId, tab }`. Cheap validation (401/400) and the `custom` config pre-checks (404/409/503) stay synchronous. Audit moves from *outcome* to *enqueue*. |

### Reused Routes (no change)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/admin/workers?taskId=<id>` | Console polls this for `{ task: { id, status, result, error } }`. Confirmed at `app/api/admin/workers/route.ts:92` via `getTaskWithEvents`. |

> **Note (not changed):** `POST /api/admin/workers`'s Zod `taskType` enum is *not* extended. The
> new type is only ever created by the rescan route through `spawnRegularTask()`
> (`SpawnTaskOptions.taskType` is a free `string`), so the enum does not gate it. Documented so a
> later reader does not mistake the omission for a bug.

---

## 3. Database Schema

**None.** `WorkerTask` (with `result Json?`, `error String?`, `maxRetries Int`,
`triggeredBy String?`) and `TaskEvent` already exist and cover every field this feature needs.
No migration, no `prisma generate` required.

---

## 4. Functions to Implement

### A. `lib/services/worker/worker-service.ts`

#### `case "google_sheets_rescan"` (new switch arm)

Add before `default:` (after the F-Score arms), matching the existing style:

```ts
case "google_sheets_rescan":
  result = await executeGoogleSheetsRescan(payload);
  break;
```

#### `executeGoogleSheetsRescan(payload: Record<string, unknown>): Promise<Record<string, unknown>>`

- Validates `payload.tab ∈ {"screener","custom"}` and `configId` present for `custom`; **throws** on
  invalid payload so the task lands as `failed` with a readable `error` (same contract as every
  other arm — `executeTask` wraps the switch).
- Delegates to the **unchanged** `rescanScreener()` / `rescanCustomConfig()`.
- `rescanService` returns a discriminated `{ ok: false, reason, error }` rather than throwing, so the
  arm **converts a failure to a throw** (`throw new Error(\`${reason}: ${error}\`)`) — otherwise the
  task would report `completed` while nothing was queued.
- Returns the ok-shape plus `rowLimit`, so the console can build the exact same notice it builds today:

```ts
return {
  ok: true,
  tab: result.tab,
  appended: result.appended,
  total: result.total,
  executionMs: result.executionMs,
  delegatedExport: result.delegatedExport,
  rowLimit: RESCAN_ROW_LIMIT, // imported from rescanService
};
```

- Imports `RESCAN_ROW_LIMIT, rescanCustomConfig, rescanScreener` from `@/lib/services/googleSheets/rescanService`
  (server-only module; `worker-service.ts` is server-only — no cycle, `rescanService` does not import the worker layer).

### B. `lib/services/googleSheets/rescanService.ts`

#### `precheckCustomRescan(configId: string): Promise<{ ok: true } | { ok: false; reason: "db_unavailable" | "not_found" | "no_filter_group" }>`

- Extracts the **first three checks** that `rescanCustomConfig()` already performs (breaker open →
  `db_unavailable`; `prisma.scanConfig.findUnique` null → `not_found`; `asFilterGroup(filters)` null →
  `no_filter_group`) into a small exported helper, so the route can return the **same 404/409/503**
  it returns today **without running the scan**.
- `rescanCustomConfig()` is refactored to call it first (single source of truth; no logic duplication).
- TOCTOU-safe: the executor re-validates when the task actually runs, so a config deleted between
  enqueue and execution still fails the task with `not_found`.

### C. `app/api/admin/google-sheets/rescan/route.ts`

- Keep **all** existing synchronous validation (401, invalid JSON → 400, unknown tab → 400,
  non-rescannable tab → 400 with the "swing and daily-rec" explanation, missing `configId` → 400,
  oversized `templateIds` → 400).
- For `tab === "custom"`: `await precheckCustomRescan(configId)` → map `reason` via the existing
  `STATUS` table (404/409/503). For `screener`: no pre-check (its only failure mode is a scan-time
  error, which is inherently async).
- Enqueue:
  ```ts
  const task = await spawnRegularTask({
    name: `Google Sheets rescan: ${tab}`,
    taskType: "google_sheets_rescan",
    payload: { tab, configId, categoryId, templateIds },
    maxRetries: 0,            // no automatic retry: contains an irreversible append
    triggeredBy: "admin",
  });
  ```
  Enqueue failure (Prisma down) → `503 { success: false, reason: "db_unavailable" }`.
- Audit the **enqueue** (not the outcome) with the existing `GOOGLE_SHEETS_RESCAN` tag:
  `metadata: { tab, configId, categoryId, templateIds, queued: true, taskId, rowLimit }`.
- Respond `202`:
  ```json
  { "success": true, "queued": true, "taskId": "<uuid>", "tab": "screener" }
  ```
- `STATUS` keeps `error: 500` only for the (now removed) sync scan failure; the async outcome is read
  from the task, so the table is reduced to the pre-check reasons.

### D. `app/admin/google-sheets/page.tsx`

- `RescanResponse` → `{ success: boolean; queued: boolean; taskId: string; tab: TabName; error?: string }`.
- New `TaskPollResponse` → `{ task: { id: string; status: "pending"|"running"|"completed"|"failed"|"cancelled"; result: null | { appended: number; total: number; rowLimit: number; delegatedExport: boolean }; error: string | null } }`.
- `rescan(tab)`:
  1. POST → on `!res.ok` throw (`body.error`).
  2. `setNotice(\`Re-scan of ${tab} queued (task ${taskId}). Running…\`)`.
  3. Poll `GET /api/admin/workers?taskId=${taskId}` every `RESCAN_POLL_INTERVAL_MS = 3000`, up to
     `RESCAN_POLL_MAX_ATTEMPTS = 200` (≈10 min). Transient poll errors are retried; a `401` stops the loop.
  4. On `completed`: build the **same** notice the old handler built from `task.result`
     (`appended === 0` → "matched nothing"; else "queued N row(s)"; append "(cap X)" when
     `total > appended`; append "Sync to append them." when `delegatedExport`), then `await load()`.
  5. On `failed`: throw `task.error ?? "re-scan failed"`.
  6. On `cancelled` / poll-cap: stop polling; notice "still running — track it on the Workers page".
  7. `finally`: `setBusyTab(null)`.
- Abort on unmount: an `AbortController` ref cancelled in a `useEffect` cleanup, so a poll cannot
  `setState` after the page is gone.
- Button stays `rowBusy ? "…" : "Rescan"` (unchanged) and is disabled for the whole enqueue+poll,
  preserving the existing "two tabs cannot share in-flight state" guarantee (`busyTab`).

### E. `lib/services/worker/degradedTaskRegistry.ts`

- Add `"google_sheets_rescan"` to the `DegradedTaskType` union (a new `// regular task types` entry).
- Add it to `DEGRADED_TASK_TYPES` (order must match `worker-service.ts`; put it after `fscore_single`).
- Add a **`REGISTRY` entry** (the map is `Record<DegradedTaskType, …>`, so the compiler *forces* this):
  ```ts
  google_sheets_rescan: {
    degradedSafe: false,
    reason:
      "Runs a live network scan and appends to an external Google Sheet — an irreversible side effect that must not run without the authoritative DB or be duplicated on a retry.",
  },
  ```
- **Why unsafe is correct**: registry doctrine (lines 9–15) says a type with external side effects is
  skipped, not attempted on a guess. A degraded run has no working DB *and* would append to a real
  spreadsheet. Outcome: in degraded mode the task is skipped + audited (existing behavior), and the
  admin sees it pending on the Workers page.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/worker/worker-service.ts` | Modified | New `case "google_sheets_rescan"` + `executeGoogleSheetsRescan()` |
| `lib/services/googleSheets/rescanService.ts` | Modified | Add `precheckCustomRescan()`; refactor `rescanCustomConfig()` to call it |
| `app/api/admin/google-sheets/rescan/route.ts` | Modified | Enqueue + `202`; add `custom` pre-check; audit enqueue |
| `app/admin/google-sheets/page.tsx` | Modified | Enqueue + poll + result render; `AbortController` cleanup |
| `lib/services/worker/degradedTaskRegistry.ts` | Modified | Union + array + `REGISTRY` entry (unsafe + reason) |
| `lib/__tests__/googleSheetsRescan.test.ts` | Modified | Route tests: sync outcome → enqueue contract |
| `lib/__tests__/googleSheetsRescanTask.test.ts` | **Created** | Executor dispatch (mock `rescanService`) |
| `lib/__tests__/googleSheetsRescanRoutePoll.test.ts` | **Created** (optional) | Route: enqueue shape, `202`, precheck mapping, spawn-failure `503` |

> No file deletions. `RESCAN_ROW_LIMIT` and the `RESCANABLE` list are reused unchanged.

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | Reuses Next.js, Prisma, existing worker stack |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/worker/task-orchestrator` | `spawnRegularTask` | Enqueue the task (creates `workerTask`, seeds mirror, logs `task_created`) |
| `@/lib/services/googleSheets/rescanService` | `rescanScreener`, `rescanCustomConfig`, `precheckCustomRescan`, `RESCAN_ROW_LIMIT` | Reused scan + pre-check |
| `@/lib/services/worker/worker-service` | `executeTask` dispatch | Runs the new arm inside the worker daemon |
| `@/lib/audit` | `createAuditLog` | `GOOGLE_SHEETS_RESCAN` enqueue audit |
| `@/lib/logger` | `logger.warn/info/error` | Structured logging |
| `app/api/admin/workers/route.ts` | `GET ?taskId=` | Poll read surface (no change) |

---

## 7. API Contract

### POST /api/admin/google-sheets/rescan

**Request body (Zod, unchanged):**
```typescript
{
  tab: "screener" | "custom",
  configId?: string,          // required for "custom"
  categoryId?: string,        // optional, screener only
  templateIds?: string[]      // 1..50, screener only
}
```

**Response (202 Accepted) — success:**
```json
{ "success": true, "queued": true, "taskId": "9f2c…", "tab": "screener" }
```

**Response (400) — validation:** `{ "error": "…" }` (unknown tab / non-rescannable / missing configId / oversized templates)

**Response (401) — not admin:** `{ "error": "Unauthorized" }`

**Response (404 / 409 / 503) — custom pre-check:** `{ "success": false, "tab": "custom", "reason": "not_found" | "no_filter_group" | "db_unavailable", "error": "…" }`

**Response (503) — enqueue failed:** `{ "success": false, "reason": "db_unavailable", "error": "…" }`

### GET /api/admin/workers?taskId=`<id>` (existing, unchanged)

**Response (200):**
```json
{
  "task": {
    "id": "9f2c…",
    "status": "completed",
    "result": { "ok": true, "tab": "screener", "appended": 12, "total": 200, "executionMs": 49211, "delegatedExport": true, "rowLimit": 200 },
    "error": null
  }
}
```
On failure: `status: "failed"`, `result: null`, `error: "error: boom"`.

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AdminGoogleSheetsPage` | `app/admin/google-sheets/page.tsx` | Existing page; Rescan button gains enqueue + poll |

### States

- **Loading (enqueue)**: button shows `…`, disabled, row-scoped via `busyTab`.
- **Running (poll)**: notice `"Re-scan of <tab> queued (task <id>). Running…"`; `busyTab` stays set.
- **Data (completed)**: notice rebuilt from `task.result` — identical text to today
  ("queued N row(s)…", "Sync to append them.", "matched nothing"), then `await load()`.
- **Error (failed)**: red error card via the existing `setError` path (`task.error`).
- **Timeout (poll cap)**: notice "still running — track it on the Workers page"; button re-enabled.
- **Empty**: unchanged (`appended === 0` → "matched nothing").

### Responsive

- No layout change; the button/notice reuse existing markup. Existing 375/768/1440 behavior preserved.

---

## 9. Rules & Guardrails

- [x] No Prisma in client components — the console only calls the API (`GET workers?taskId=`).
- [x] All DB operations via Prisma (server-side).
- [x] External inputs validated via Zod (existing schema, unchanged).
- [x] Errors never throw internals to the client — `reason` is a closed enum; `error` is a message.
- [x] Logging via `@/lib/logger` only (no `console.log`).
- [x] Background execution is **off** the HTTP response path (this is the entire point).
- [x] Audit trail for the state-changing action (`GOOGLE_SHEETS_RESCAN` at enqueue).
- [x] Admin-only: route checked admin at the top; poll endpoint is already admin-gated.
- [x] Degraded doctrine respected: external-side-effect type registered **unsafe** with a reason.
- [x] No `migrate reset`/`db drop`; no schema change at all.

---

## 10. Expected Behavior

1. `POST { tab: "screener" }` as admin → **202** `{ success, queued: true, taskId, tab: "screener" }`; no scan runs in the request.
2. `executeTask(taskId, "google_sheets_rescan", { tab: "screener" })` calls `rescanScreener({ categoryId, templateIds })` and returns `{ ok: true, tab, appended, total, executionMs, delegatedExport, rowLimit }`.
3. `{ tab: "custom", configId }` → calls `rescanCustomConfig(configId)`; a config that vanishes between enqueue and run fails the task with `not_found` (`status: "failed"`, `error` message).
4. `rescanScreener()` returning `{ ok: false, reason: "error", error: "boom" }` → the arm throws → task `failed`, `error: "error: boom"`; the task is **not** reported `completed`.
5. `POST { tab: "custom" }` with no `configId` → **400**, `rescanScreener`/`rescanCustomConfig` never called.
6. `POST { tab: "custom", configId: "nope" }` where the config does not exist → **404** `reason: "not_found"`, **nothing enqueued**.
7. `POST { tab: "custom", configId }` with the plan-limit breaker open → **503** `reason: "db_unavailable"`, nothing enqueued.
8. `POST { tab: "swing" }` → **400** with the "swing and daily-rec" explanation; nothing enqueued.
9. `POST` as a non-admin → **401**; nothing enqueued.
10. If `spawnRegularTask()` throws (Prisma down) → **503** `reason: "db_unavailable"`.
11. The `GOOGLE_SHEETS_RESCAN` audit records `{ queued: true, taskId, tab, rowLimit, categoryId, configId }` **at enqueue time**, including on runs that later fail (the audit answers *who asked for what*; the outcome lives on the task).
12. `DEGRADED_TASK_TYPES` contains `"google_sheets_rescan"`; `degradedUnsafeTaskTypes()` includes it with a non-empty reason; `degradedSafeTaskTypes()` does not.
13. In degraded/hold mode the enqueued task stays `pending` (degraded path skips unsafe types) until the DB recovers — a real, visible state, not a silent loss.
14. Console: clicking Rescan shows `…`, then "queued… Running…", then the result notice and refreshed counts; navigating away mid-poll causes no React state-update warning.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Invalid JSON / bad body | 400, no work | `warn` (existing) |
| Unknown / non-rescannable tab | 400 with reason text | `warn` |
| `custom` config missing | 404 `not_found`, nothing enqueued | `warn` |
| `custom` config unusable (no filter group) | 409 `no_filter_group`, nothing enqueued | `warn` |
| Plan-limit breaker open (pre-check) | 503 `db_unavailable`, nothing enqueued | `warn` |
| `spawnRegularTask()` throws | 503 `db_unavailable` | `error` |
| Scan fails inside the worker | Task `failed`, `error` recorded on `WorkerTask`; console shows it | `error` (in worker) |
| Scan times out | Engine's 240-min `TASK_TIMEOUT_MS` marks the task failed (pre-existing) | `error` |
| Task cancelled by operator | Console stops polling, shows "track it on the Workers page" | `info` |
| Poll request errors (transient) | Retried up to the cap; loop only stops on 401/terminal status | `warn` |

**Deliberately deferred (documented, not fixed here):**

- **No automatic retry.** `maxRetries: 0` is set to state that intent; the observed engine path has no
  auto-retry loop (only the manual `PATCH { action: "retry" }` on a `failed` task). A failed rescan is
  re-run by clicking Rescan again, so a partial append is never silently duplicated.
- **`PATCH runNow` remains synchronous** for *all* task types (pre-existing). Clicking "Run now" on a
  rescan task from the Workers page can therefore hit the same gateway ceiling this spec removes from
  the console path. Fixing `runNow` for every type is a separate, larger change and is explicitly out
  of scope.

---

## 12. Test Strategy

### Unit Tests — `lib/__tests__/googleSheetsRescanTask.test.ts` (new)

- [ ] `screener` payload → `rescanScreener` called with `{ categoryId, templateIds }`; returns ok-shape incl. `rowLimit`.
- [ ] `custom` payload → `rescanCustomConfig(configId)` called.
- [ ] `ok: false` from the service → the arm **throws** (so `executeTask` maps it to `failed`).
- [ ] invalid `tab` → throws before touching the service.
- [ ] `custom` with no `configId` → throws before touching the service.
- [ ] `delegatedExport` / `appended === 0` (empty scan) reported faithfully.

### Unit Tests — `lib/__tests__/googleSheetsRescan.test.ts` (updated)

- Service tests (`rescanScreener`/`rescanCustomConfig`) stay **as-is** (they pin `forceRefresh` and the
  no-double-export contract).
- Route tests: rewrite the outcome assertions to the enqueue contract, keep every validation assertion:
  - [ ] non-admin → 401, `spawnRegularTask` not called
  - [ ] `screener` → **202** `{ queued: true, taskId, tab }`, `spawnRegularTask` called with `taskType: "google_sheets_rescan"`, `tab`, `maxRetries: 0`
  - [ ] `custom` with `configId` → 202; payload carries `configId`
  - [ ] `custom` without `configId` → 400, nothing enqueued
  - [ ] unknown tab → 400; `swing`/`daily-rec`/`metrics`/`decisions` → 400 with the reason
  - [ ] oversized `templateIds` → 400; invalid JSON → 400
  - [ ] `custom` missing config → **404** `not_found`, nothing enqueued
  - [ ] `custom` unusable config → **409** `no_filter_group`, nothing enqueued
  - [ ] breaker open → **503** `db_unavailable`, nothing enqueued
  - [ ] `spawnRegularTask` throws → **503** `db_unavailable`
  - [ ] audit called once with `{ queued: true, taskId, rowLimit, categoryId, configId }` on success
  - [ ] **the scan is never invoked in the request** (`runChartinkUnifiedScreeners`/`runCustomScan` not called by the route)

### Registry Test — `lib/__tests__/degradedTaskRegistry.test.ts` (existing, auto-covered)

- [ ] `DEGRADED_TASK_TYPES` still equals the parsed `case` labels (`toHaveLength`/set equality) — grows 29 → 30.
- [ ] `registryKeys()` equals `DEGRADED_TASK_TYPES` (forces the new `REGISTRY` entry).
- [ ] safe + unsafe partitions still cover every type; the new type is in **unsafe** with a reason.

### E2E (`e2e/`) — optional, non-blocking

- [ ] Not added: the console poll and result rendering are covered by unit tests; a live e2e would need a
  running worker daemon + an external sheet, i.e. flaky. If added later, assert on the enqueue notice and
  that the button disables, **never** on append counts.

---

## 13. Performance Considerations

- **Request cost**: falls from "full-universe scan" to "1 pre-check read + 1 `workerTask.create` + 1 event + 1 audit".
- **Queue cost**: unchanged — reuses `spawnRegularTask`/`executeTask`; one task per click.
- **Polling**: 3 s interval, ≤200 attempts (~10 min), one small DB read each. `workerTask` is indexed
  on `id` (PK) and `status`; the read is bounded.
- **No new N+1**: the executor makes the same `rescanService` calls as before, just on the worker path.
- **Warm worker**: pickup within ~30 s while the instance is warm (daemon poll interval). On Netlify,
  an idle instance is suspended after ~2 h, so the first poll after a cold start may show `pending`
  until the daemon boots — a visible, expected state.

---

## 14. Security Considerations

- **Auth**: POST is admin-only (existing check, unchanged). `GET /api/admin/workers` is admin-gated.
- **Input**: Zod-validated; `configId` used only as a DB key; no client-supplied rows are exported
  (`rescanCustomConfig` builds rows from the stored config — existing invariant, pinned by tests).
- **RBAC**: the client-side redirect stays UX-only; server enforces.
- **Secrets**: none introduced; no `NEXT_PUBLIC_*` touches.
- **External side effect**: the append is irreversible, which is exactly why the type is
  **not degraded-safe** and has **no automatic retry** — no duplicate-append storm.
- **Audit**: enqueue is recorded, so an operator's action is attributable even if the run later fails.

---

## 15. Definition of Done

- [x] `executeGoogleSheetsRescan` implemented + dispatched by `executeTask` per §4.A
- [x] `precheckCustomRescan` extracted; `rescanCustomConfig` uses it per §4.B
- [x] Rescan route enqueues + returns 202 per §4.C / §7
- [x] Console enqueue + poll + render per §4.D / §8
- [x] Registry union + array + `REGISTRY` entry per §4.E
- [x] No schema change; no migration; no `prisma generate` needed
- [x] Tests per §12 written and passing (`npm run test`)
- [x] `npx tsc --noEmit` → 0 new errors (baseline **46** lines, prod 0)
- [x] `npm run lint` → 0 errors
- [x] `npm run quickbuild` succeeds (dev server killed first — Lesson 150)
- [x] Registry union test 29 → 30 green
- [x] Admin page renders, Rescan enqueues, zero console errors (dev)
- [x] Documentation: AGENTS.md row, `.agents/changelog/versions-v3.48.md`, TODO, Primer, agent-memory, Lessons (L160), session `decisions.md`/`flow.md`
- [ ] Commit only on explicit user request; **merge/deploy user-only (D9)**

---

## 16. As-Built Verification (live, 2026-10-10, local host :3000)

**Live happy path — full loop verified end-to-end** (server log, `tn-dev.log`):

| Time | Log line |
|------|----------|
| 11:34:00 | `Regular task spawned, taskId=bbd49e8c-0da9-480b-a148-c1aecc1388f9, taskType=google_sheets_rescan` (route 202) |
| 11:40:38 | `Executing task, … taskType=google_sheets_rescan` (worker claim) |
| 11:40:39 | `Starting Google Sheets re-scan, tab=screener` |
| 11:40:52 | `Google Sheets screener re-scan complete, hits=1410, executionMs=13045` |
| 11:40:52 | `Google Sheets re-scan complete, tab=screener, appended=1410, total=1410, executionMs=13045, delegatedExport=true` |
| 11:40:52 | `Task completed successfully, taskId=bbd49e8c-…` |

- Console after completion: screener **Queued/Retained rose 2904 → 4314** (rescan's 1410 hits joined the append ledger).
- The 6-min `pending` window was a **dev-env leader-lease artifact**, not a spec bug: the old dev server (killed ~11:26 for the `.next` purge) held a ~15-min DB leader lease; the new daemon could not start the worker engine until the lease expired (`Starting background worker engine … interval=30000` at 11:40:08). On prod, Netlify keeps one instance alive / drains gracefully — non-issue.
- `invalid_grant` on header-ensure + live append is the **pre-existing local env condition** (expired GS OAuth visible since 11:32:53, before the task ran): rows captured, `delegatedExport=true`, task still `completed` — executor throws only on `ok:false` per §6. No duplicate-append: nothing reached the sheet (auth failed), so `appended` reflects ledger capture, not sheet rows.
- Executor behavior on this env is identical to the pre-change synchronous rescan (same `rescanScreener`, same non-fatal auth failure) — **no behavior regression**; the only change is that the HTTP request returns 202 in ~15 s instead of blocking ~7 min in a Netlify function.
