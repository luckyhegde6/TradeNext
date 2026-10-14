# Session Flow — 2026-10-10 — Spec 27 Async Google Sheets Re-scan

Execution path + code touched, in order.

## Phase 0 — Spec + plan (done)
- Wrote `.agents/specs/27-async-rescan.md` (454 lines) and `.agents/plans/27-async-rescan.md` (159 lines). Human approval received.

## Phase 1 — Service helper (DONE, verified)
- `lib/services/googleSheets/rescanService.ts`
  - Added exported type `CustomRescanPrecheck` + `precheckCustomRescan(configId)` (breaker → `db_unavailable`; `findUnique` null → `not_found`; `asFilterGroup` null → `no_filter_group`; catch → `db_unavailable`|`error`; returns the config + filterGroup on success).
  - Refactored `rescanCustomConfig` to call `precheckCustomRescan` first and reuse `config`/`filterGroup` (no second read).
- verify: `npx jest lib/__tests__/googleSheetsRescan.test.ts` → **34 passed**; `npx tsc --noEmit` → **46** (baseline).

## Phase 2 — Worker executor + registry (DONE, verified)
- `lib/services/worker/worker-service.ts`
  - Added `case "google_sheets_rescan"` after `fscore_single` (before `default`).
  - Added `executeGoogleSheetsRescan(payload)` (dynamic import of `rescanService`; validates tab; screener → `rescanScreener`, custom → `rescanCustomConfig(readRescanConfigId(payload))`; throws on `ok:false`; returns summary incl. `rowLimit`).
  - Added small helper `readRescanConfigId(payload)`.
- `lib/services/worker/degradedTaskRegistry.ts`
  - Union + `DEGRADED_TASK_TYPES` (29 → 30; new entry LAST to match switch order) + `REGISTRY.google_sheets_rescan` (`degradedSafe: false`, reason = irreversible external append + Prisma-only ScanConfig).
- verify: `npx jest lib/__tests__/degradedTaskRegistry.test.ts` → **11 passed**; `npx tsc --noEmit` → **46**.

## Phase 3 — Route enqueue (DONE, verified)
- `app/api/admin/google-sheets/rescan/route.ts`: validate → precheck(custom) → `spawnRegularTask` → audit enqueue → **202** `{success, queued, taskId, tab}`; validation + precheck statuses kept (404/409/503/500); scan never invoked in-request.
- verify: route unit tests rewritten to enqueue contract → **34 passed** (all suites); `npx tsc --noEmit` → **46**.

## Phase 4 — Console enqueue + poll (DONE, verified)
- `app/admin/google-sheets/page.tsx`: `RescanResponse` → queued shape `{queued, taskId, tab}`; on enqueue → poll `GET /api/admin/workers?taskId=` (3 s × 200 like existing sync); completed → rebuild notice from `task.result` then `await load()`; AbortController cleanup; timeout → "track it on the Workers page".
- verify: admin page renders, zero console errors (Playwright snapshot); live click verified (below).

## Phase 5 — Tests (DONE, verified)
- `lib/__tests__/googleSheetsRescanTask.test.ts` (NEW — executor: screener ok path, custom ok precheck, ok:false → throws, invalid tab → throws, readRescanConfigId).
- `lib/__tests__/googleSheetsRescan.test.ts` (route block rewritten: 202 enqueue contract, validation/precheck statuses, scan never invoked, audit on enqueue).
- verify: `npx jest` full → **134/134 suites**; `npx tsc --noEmit` → **46** (prod 0); `npm run lint` → 0 on changed files.

## Phase 5b — Live happy-path verification (DONE, record in spec §16)
- Fixed stale `.next` 404s first: purged `.next`, relaunched dev server (PID 6612, `tn-dev.log`/`tn-dev.bat`; daemon boot 11:30:10).
- Clicked screener Rescan in the real console → 202 enqueue → task `bbd49e8c-0da9-480b-a148-c1aecc1388f9`:
  - 11:34:00 spawned · 11:40:38 executing · 11:40:52 `completed` `{appended:1410,total:1410,delegatedExport:true}` (13 s scan).
  - 6-min pending = old server's 15-min leader-lease expiry (dev artifact; worker engine started 11:40:08; see D7).
  - Console screener queue 2904 → 4314; `invalid_grant` append = pre-existing env (expired GS OAuth), non-fatal, rows captured in ledger.

## Phase 6 — Docs (NEXT → done in this session)
- `.agents/changelog/versions-v3.48.md` (NEW), AGENTS.md row (cap-aware, 30.6→<32.0 KB), CHANGELOG index line,
  TODO.md top block swap (v3.47 → v3.48; v3.47 archived to `.agents/changelog/todo-quick-reference-archive.md`),
  Primer, agent-memory, Lessons **L160** (leader-lease delay trap), handoff `latest.md`, spec §15 DoD ticked + §16 as-built.

## Files touched so far
- `lib/services/googleSheets/rescanService.ts`
- `lib/services/worker/worker-service.ts`
- `lib/services/worker/degradedTaskRegistry.ts`
- `app/api/admin/google-sheets/rescan/route.ts`
- `app/admin/google-sheets/page.tsx`
- `lib/__tests__/googleSheetsRescan.test.ts`, `lib/__tests__/googleSheetsRescanTask.test.ts`
- `.agents/specs/27-async-rescan.md`, `.agents/plans/27-async-rescan.md`
- `.agents/sessions/2026-10-10-async-rescan/{decisions,flow}.md`
