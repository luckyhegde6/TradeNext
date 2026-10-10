# Session Decisions — 2026-10-10 — Spec 27 Async Google Sheets Re-scan

Branch: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`).

## D1 — Spec 27 + plan written before any code (approved)
- **Decision**: Produce `.agents/specs/27-async-rescan.md` + `.agents/plans/27-async-rescan.md`, get human approval, then implement. User approved both ("Approve both, start Phase 1").
- **Reason**: Spec-driven development gate is mandatory for features. The prod 502 has a clear root cause; a written spec makes the queue migration reviewable before touching a shipped console.

## D2 — Vehicle: existing worker task queue, NOT the degraded queue
- **Decision**: Add a new dispatchable task type `google_sheets_rescan` to `executeTask`, executed by the in-process worker daemon.
- **Reason**: `executeTask` already stores an executor return value in `WorkerTask.result` (`worker-engine.ts:458`), already marks `completed`/`failed` from the wrapper, and `GET /api/admin/workers?taskId=` already exposes `{ task }`. No schema change, no new route. The degraded queue is for DB-outage resilience and its registry is exhaustive; a re-scan has external irreversible side effects, so it is explicitly NOT degraded-safe.

## D3 — `precheckCustomRescan` returns the config (single read)
- **Decision**: `precheckCustomRescan(configId)` returns `{ ok:true, config, filterGroup }` on success (not just `{ ok:true }`), and `rescanCustomConfig` REUSES it instead of re-reading.
- **Reason**: AvБOIDS a second `prisma.scanConfig.findUnique` (op budget) and keeps ONE source of truth for the checks (breaker / not_found / no_filter_group) so route and service cannot drift — the same drift the file's header warns about for `screener`/`custom` double-export.

## D4 — `precheckCustomRescan` never throws; reason union includes `error`
- **Decision**: Wrap the read in try/catch → `db_unavailable` (plan-limit hold / `isDbUnavailableError`) or `error` (anything else). Route keeps the FULL status map (404/409/503/500).
- **Reason**: A `findUnique` failure must not become a bare throw (route would 500 with no text) and must not be mislabelled `db_unavailable`. This refines the approved spec step 7 ("reduce STATUS table") — the `error:500` row stays because precheck can now yield `error` before any scan runs. Spec updated to as-built.

## D5 — Failed scan ⇒ THROW in the executor
- **Decision**: `executeGoogleSheetsRescan` throws on `outcome.ok === false` and on an invalid payload.
- **Reason**: The engine marks the task from the wrapper's `success`. If a failed scan returned normally, the task would show `completed` and the console would report a false success. `rescanService` RETURNS errors, so the executor converts them.

## D6 — No auto-retry (`maxRetries: 0`)
- **Decision**: Route spawns with `maxRetries: 0`.
- **Reason**: A re-scan appends rows to a Google Sheet — irreversible. The engine has no auto-retry loop anyway (only manual `PATCH retry`); `0` states the intent and documents the decision on the row.

## D7 — Live happy-path verification is the truth (2026-10-10)
- **Decision**: Verify the full loop against the running dev server (enqueue via real UI click → poll → task lifecycle in `tn-dev.log` → console state) before docs; treat any gap as a bug.
- **Findings (all recorded in spec §16)**:
  - Task `bbd49e8c-…` sat `pending` 11:34→11:40 because the **worker engine only started when the old server's ~15-min DB leader lease expired** (`Starting background worker engine … interval=30000` 11:40:08) — dev-env artifact of killing PID 28612 for the `.next` purge; NOT a code bug. On prod, Netlify keeps an instance alive; graceful drain means no such gap.
  - Task then ran the FULL path: claim 11:40:38 → `rescanScreener` hits=1410, 13 s → `completed` with `{appended:1410,total:1410,delegatedExport:true}` 11:40:52. Console screener queue 2904 → 4314.
  - `invalid_grant` on header-ensure/append is the pre-existing local env (expired GS OAuth, visible since 11:32:53 BEFORE the task) — rows captured in the append ledger, `delegatedExport=true`, task still `completed`. Correct: append auth failure is non-fatal; only `ok:false` throws (D5).
  - **No behavior regression vs the pre-change synchronous rescan**: same `rescanScreener`, same non-fatal auth path — only the HTTP request now returns 202 (~15 s) instead of blocking ~7 min in a Netlify function.

## Out of scope (documented)
- `PATCH runNow` remains synchronous for ALL task types (pre-existing footgun) — can hit the same gateway ceiling. Not changed here.
- BUG A (degraded executor never advances mirror `next_run`) — unrelated, still open.
- `page.tsx:125` LSP error (`HEADER_BADGE` not a valid Next.js page export, from Spec 26) — flagged, separate concern.
