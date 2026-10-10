# Implementation Plan — Async Google Sheets Re-scan (worker task queue)

> Generated from spec: `.agents/specs/27-async-rescan.md`
> Save to `.agents/plans/27-async-rescan.md`

## Spec Reference

- **Spec**: `.agents/specs/27-async-rescan.md`
- **Branch**: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`)
- **Created**: 2026-10-10
- **Status**: ✅ **COMPLETE** — approved, implemented, tests + gates green, **live-verified** (task `bbd49e8c-0da9-480b-a148-c1aecc1388f9` 11:34 → 11:40:52 `{appended:1410,total:1410,delegatedExport:true}`). Phases 1–6 + verification + docs DONE. **COMMIT PENDING USER** (D9; merge/push/deploy = user actions).

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step → verify: [check]`

### Phase 1: Service helper (extract, no behavior change) ✅

1. **Extract `precheckCustomRescan(configId)`** in `lib/services/googleSheets/rescanService.ts` (breaker → `db_unavailable`; `findUnique` null → `not_found`; `asFilterGroup` null → `no_filter_group`) → verify: existing `googleSheetsRescan.test.ts` service assertions still green.
2. **Refactor `rescanCustomConfig()` to call `precheckCustomRescan()` first** → verify: `npm run test -- googleSheetsRescan` — all `rescanCustomConfig` cases unchanged (404/409/503/no-export).

### Phase 2: Worker executor ✅

3. **Add `executeGoogleSheetsRescan(payload)`** in `lib/services/worker/worker-service.ts` (validate tab/configId; throw on `ok:false`; return ok-shape + `rowLimit`) → verify: `npx tsc --noEmit` (0 new).
4. **Add `case "google_sheets_rescan":`** before `default:` → verify: new unit test dispatches it; `executeTask(id, "google_sheets_rescan", { tab: "screener" })` reaches `rescanScreener`.
5. **Register the type** in `lib/services/worker/degradedTaskRegistry.ts` (union + `DEGRADED_TASK_TYPES` + `REGISTRY` entry, `degradedSafe: false` + reason) → verify: `npm run test -- degradedTaskRegistry` — union matches switch (29 → 30), safe+unsafe partition covers all.

### Phase 3: Route (enqueue) ✅

6. **Rewrite `POST /api/admin/google-sheets/rescan`** to validate → `precheckCustomRescan` (custom) → `spawnRegularTask({ taskType: "google_sheets_rescan", maxRetries: 0, triggeredBy: "admin" })` → audit enqueue → **202** `{ success, queued, taskId, tab }`; spawn failure → 503 → verify: route unit tests green; `runChartinkUnifiedScreeners`/`runCustomScan` **not** called by the route.
7. **Reduce `STATUS` table** to the pre-check reasons (drop sync `error: 500`, `not_found`/`no_filter_group`/`db_unavailable` stay) → verify: tsc + route tests.

### Phase 4: Console (enqueue + poll) ✅

8. **Update `RescanResponse`** → `{ success, queued, taskId, tab, error? }`; add `TaskPollResponse` → verify: `npx tsc --noEmit`.
9. **Rewrite `rescan(tab)`** to POST → poll `GET /api/admin/workers?taskId=` (3 s, ≤200 tries) → render result from `task.result` / throw on `task.error`; add `AbortController` unmount cleanup → verify: page renders; button disables + notice appears; no setState-after-unmount warning.
10. **Live check on :3000** (dev server PID 14676, admin login) → verify: click Rescan on `screener`; observe `…` → "queued… Running…"; either a result notice (if the scan finishes) or a clear failure; **0 console errors**.

### Phase 5: Tests ✅

11. **Create `lib/__tests__/googleSheetsRescanTask.test.ts`** (executor: screener/custom dispatch, throw-on-failure, invalid payload, empty scan) → verify: `npm run test -- googleSheetsRescanTask`.
12. **Update `lib/__tests__/googleSheetsRescan.test.ts`** route block to the enqueue contract (keep every validation case; add 202 shape, spawn args, precheck mapping, spawn-failure 503, audit-enqueue, "scan never runs in request") → verify: suite green.
13. **Registry test** re-run (should pass purely from step 5) → verify: `npm run test -- degradedTaskRegistry`.

### Phase 6: Documentation ✅

14. **`.agents/changelog/versions-v3.48.md`** — Spec 27 detail (root cause 502, design, evidence, gates) → verify: file exists, indexed.
15. **AGENTS.md** — compact version-row (mind the 32 KB cap, Lesson 142; if capped, record in the changelog only) → verify: row added or deferral noted.
16. **TODO.md / Primer.md / agent-memory.md** — status + activity entries → verify: each updated.
17. **Lessons.md** — add if a reusable pattern emerges (sync-request → queue migration; "status read surface already exists") → verify: entry appended.
18. **Session memory** — `.agents/sessions/<date>-<hash>/decisions.md` + `flow.md` → verify: files exist.
19. **`.agents/session-todos.md` + `.agents/handoffs/active/latest.md`** → verify: updated.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| screener payload → `rescanScreener({categoryId,templateIds})` | `googleSheetsRescanTask.test.ts` | Dispatch + arg passthrough |
| custom payload → `rescanCustomConfig(configId)` | `googleSheetsRescanTask.test.ts` | Dispatch + configId |
| `ok:false` → arm throws | `googleSheetsRescanTask.test.ts` | Failure maps to task `failed`, not `completed` |
| invalid tab / missing configId → throw | `googleSheetsRescanTask.test.ts` | Payload guard |
| empty scan (`appended:0`) reported faithfully | `googleSheetsRescanTask.test.ts` | Empty is a real answer |
| `precheckCustomRescan` → not_found / no_filter_group / db_unavailable | `googleSheetsRescan.test.ts` | Pre-check parity with old sync statuses |
| POST screener → 202 `{queued,taskId}` + spawn called (`maxRetries:0`) | `googleSheetsRescan.test.ts` | Enqueue contract |
| POST custom missing config → 404, nothing enqueued | `googleSheetsRescan.test.ts` | Pre-check runs sync |
| POST breaker open → 503, nothing enqueued | `googleSheetsRescan.test.ts` | Pre-check ordering |
| POST spawn throws → 503 | `googleSheetsRescan.test.ts` | Enqueue failure handling |
| POST validation set (tab/config/templates/JSON) → 400 | `googleSheetsRescan.test.ts` | Validation preserved |
| POST never calls the scan | `googleSheetsRescan.test.ts` | The whole point (no sync scan) |
| audit called once with `{queued:true,taskId,rowLimit}` | `googleSheetsRescan.test.ts` | Enqueue audit |
| union + array + registry match switch | `degradedTaskRegistry.test.ts` | No drift; new type unsafe |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `executeTask` wrapper → `{ success:false, error }` on arm throw | Task marked `failed` by the engine (existing contract) |
| GET `/api/admin/workers?taskId=` returns `{ task: { status, result, error } }` | Poll read surface (existing; assert shape) |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| — (optional, non-blocking) | Enqueue notice + button disabled; never assert append counts |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking (baseline: 46 error lines, prod 0)
npx tsc --noEmit

# Tests — RUN ALONE, never chained with ';'
npm run test
npm run test -- googleSheetsRescan
npm run test -- googleSheetsRescanTask
npm run test -- degradedTaskRegistry

npm run lint

# Build — kill dev server PID 14676 first (Lesson 150)
npm run quickbuild

# Hygiene
git status        # no junk (*.yaml, screenshots, dev-server.log), no secrets
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Task stays `pending` on Netlify after instance suspension | Documented + visible on Workers page; poll shows pending; picks up on next warm poll (~30 s) | No |
| No auto-retry may need a manual re-click after a transient scan error | `maxRetries: 0` is deliberate (irreversible append); operator re-clicks Rescan | Yes (auto-retry forever out of scope) |
| `PATCH runNow` still executes synchronously for this type | Pre-existing for **all** task types; documented, out of scope | Yes |
| Config deleted between enqueue and run | Executor re-validates → task `failed` `not_found`; console shows it | No |
| In degraded/hold mode the task is skipped | Intended (external side effect); visible as pending; recovers with DB | No |
| Poll cap reached (~10 min) while scan still runs | Notice points to the Workers page; button re-enables (task continues server-side) | No |
| `precheckCustomRescan` duplicates a check the executor also makes | Accepted: single requested read, keeps 404/409/503 UX; TOCTOU-safe via executor re-check | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [x] **AGENTS.md** — version row (or documented deferral at 32 KB cap, Lesson 142) — v3.48.0 row added (31,170 B, under cap)
- [x] **CHANGELOG** — `.agents/changelog/versions-v3.48.md` + index update
- [x] **TODO.md** — quick-reference row
- [x] **Primer.md** — current project status
- [x] **agent-memory.md** — activity log entry
- [x] **Lessons.md** — Lesson **160** (dev-server kill delays worker start by leader-lease TTL)
- [x] **Session memory** — `.agents/sessions/2026-10-10-async-rescan/{decisions,flow}.md`
- [x] **session-todos.md** — current session updated
- [x] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit. **Commit only on explicit user request; merge/deploy user-only (D9).**

1. `npx tsc --noEmit` — 0 new errors (baseline 46)
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
