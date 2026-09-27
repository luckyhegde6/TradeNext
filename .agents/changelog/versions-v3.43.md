# v3.43.0 — Spec 20 Google Sheets Admin Console

> **Status:** CODE + TESTS + BUILD + DOCS DONE. **UNCOMMITTED** — no push / PR / deploy.
> **Branch:** `feature/google-sheets-tracking` (parent `2fbf0c7`; v3.42.0 = `a6e4e6e`)
> **Spec / plan:** `.agents/specs/20-google-sheets-admin-console.md` · `.agents/plans/20-google-sheets-admin-console-phase1.md`

## What it does

Turns the Spec 19 fire-and-forget sheet export into an **operable** system: an admin console to see
per-tab queue state, drain captured rows, recover rows that can never be appended, project tracker
performance as a metrics history, and re-run a scan to produce fresh rows.

**Invariants preserved throughout (append-only, positional, single-writer):**

- The sheet is **append-only**. No `values.clear`, no `values.update` on data, no delete-range
  anywhere except the deliberately guarded ledger-removal path.
- Sheets stay **positional**. Header mismatch → `warn` + append by position; the user's header is
  never rewritten.
- Producer code still **never throws** on export failure. Every hook is fire-and-forget and returns
  `"disabled" | "enabled" | "failed"`.
- Ledger **DELETE is the only destructive action** in the subsystem, and it is guarded on every
  server side of the decision (below).

## Workstreams

### 1. Ledger deletion (the recovery path)

A row can be captured but **structurally impossible** to append — a header that can no longer be
matched, or an unresolvable tab. Those rows park forever and make every future Sync fail at the same
row. `DELETE /api/admin/google-sheets/ledger` is the recovery.

Guards, all re-checked server-side regardless of what the client believed:

| Guard | Rationale |
| --- | --- |
| `isPlanLimitBreakerOpen()` → `503` | Never destroy rows while the DB is held; a later read may legitimately resolve. |
| Config/sheet existence → `503` | Can't prove the tab exists → can't prove ownership. |
| Unknown tab → `400`; `decisions` → `400` | `decisions` has no tab in the sheet by design. |
| Shared `ledgerRowIsUnreadable()` re-validation | The seqs may have become readable since the console listed them (e.g. a re-scan landed a new header). |
| All-or-nothing delete | Partial deletion of a poisoned block hides the cause. Returns `409` naming the offending seq instead. |
| 200-item cap | Bounded blast radius. |
| Audit + real deleted-row count | The count is what the DB says, not what was requested. |

**NEW shared helper `ledgerRowIsUnreadable()`** — single source of truth for "can this row ever be
appended", used by both the discovery scan and the delete path, so the console can never offer to
delete a row the server would accept as valid.

### 2. Metrics tab (tracker performance as a sheet history)

`metrics` becomes the **5th syncable tab** (11 columns):
`snapshotAt, totalTracked, active, targetAchieved, stopLossHit, expired, winRate, netPnlAbs, netPnlPct, avgReturnPct, grossPnlAbs`.

- Source is `RecommendationTracker`. Active picks are **excluded from P&L**; `target_achieved` marks
  against `targetPrice`, `stop_loss_hit` against `stopLoss`, `expired` against the last known
  `currentPrice`.
- `winRate = targetAchieved / (targetAchieved + stopLossHit) * 100`; percentages are `0..100`.
- **Non-computable values stay `null`/blank.** The console renders them `—`, never `0`. "no closed
  picks yet" and "zero return" are different facts, and a fabricated zero would be a silent lie in
  the one place an operator records history.
- Under the **P6003 plan-limit hold** the read degrades explicitly to `ok:false, reason:"db_unavailable"`
  and **no row is queued** — a zero-filled snapshot would be indistinguishable from a real one.
- Appends as exactly one row per snapshot, then Sync writes it like any other captured row.

### 3. Re-scan (fresh rows, separate from Sync)

Sync drains rows that were *already captured*; Re-scan produces *new* ones. Merging them would make a
drain click fire network scans, so they are deliberately **two buttons**.

- `screener` → `runChartinkUnifiedScreeners({ forceRefresh: true, ... })`. That fresh path already
  appends internally, so the route **does not** call a second export (which would double-append).
  The UI says "queued … Sync to append them" because the producer owns the append.
- `custom` → reuses `runCustomScan()` (extracted from the screener-config route into
  `lib/screener/customScanRunner.ts`) then awaits `exportCustomScan()` with a **fresh
  `randomUUID()`**, so its count is *appended*, not queued.
- `RESCAN_ROW_LIMIT = 200`. Disabled/failed exports report `appended: 0` — never a fake count.

**`lib/screener/customScanRunner.ts`** is the reusable half: full-universe scan, required-column
extraction, filtering, sorting, pagination, totals, and timing — extracted so the config route and
Re-scan cannot drift apart. The config route's auth, ownership, response shape, fire-and-forget
export, and `offset === 0` export gating are unchanged.

### 4. Status / unreadable discovery

- `getUnreadableSeqs()` scans from SQLite `seq = 0`, **intentionally ignoring the tab cursor** — a
  poisoned row is exactly the one a cursor would skip past. Capped at `UNREADABLE_REPORT_CAP = 200`
  with one row of over-fetch.
- **Resolved `queued` / `remaining` semantics:** they count every row still marked undelivered, not
  only rows a future drain can replay. That deliberately **includes marker-write residue** (the append
  reached the sheet but the `delivered` write failed — the cursor advances to prevent duplicates, and
  retention pruning eventually removes the residue) and rows parked behind an unreadable row. Calling
  this "replayable" would under-report a queue the operator must reason about.

### 5. Admin console

`app/admin/google-sheets/page.tsx`: `metrics` typing, queued/retained/unreadable state, exact
unreadable seqs behind a disclosure, per-tab screener/custom Rescan (custom takes a `configId`),
confirmed removal (**cancelling issues no request**), Metrics Preview/Append, and nullable-metric
rendering. All admin APIs are server-side `auth()` + `role === "admin"`; the client redirect is UX
only, and full spreadsheet IDs are never returned.

## Tests

| Suite | Count | Notes |
| --- | --- | --- |
| `googleSheetsStatus.test.ts` | 15 | env gate, header states, per-tab order |
| `googleSheetsSync.test.ts` | 35 | cursors, caps, unreadable scan, marker residue |
| `sqlite.test.ts` | 92 | **real sql.js** read-by-seq guard |
| `googleSheetsAdminRoutes.test.ts` | 54 | auth, ledger DELETE, metrics |
| `googleSheetsRescan.test.ts` | 34 | screener/custom re-scan |
| `googleSheetsMetrics.test.ts` | 26 | KPI math, positional contract, degradation |
| `googleSheetsLedgerCapture.test.ts` | 21 | delivered state, provenance, replay safety |
| `customScanRunner` + `screenerConfigRunRoute` | 23 | runner + export gating |
| `e2e/admin-google-sheets.spec.ts` | 7 (×3 browsers) | **collects; not executed** — see below |

**Real-SQLite guard.** `GS_LEDGER_ROWS_BY_SEQ_SQL` contains a `{{SEQS}}` placeholder that production
expands to one `?` per seq. The new test in `sqlite.test.ts` runs that SQL through the real sql.js
build, mirroring the expansion, and covers placeholder expansion, binds, subsets,
ordering-independent selection, `tab`, `delivered`, and `row_json`. This was added because a fully
mocked SQLite module cannot catch a placeholder/bind-count bug — the failure mode this code is most
exposed to.

**E2E design — routes mocked, deliberately.** The admin APIs are mocked with `page.route()` for three
reasons: OAuth consent is a one-shot manual step CI cannot perform; a real append is **irreversible**
by design, so a test run would permanently pollute the user's sheet; and the ledger is durable state a
test must not depend on. The assertions are therefore on the console's own contract — which request it
sends and what it tells the operator — which is the part the spec owns. Server behaviour of the same
routes is covered by the Jest suites above. Admin credentials are env-only, and the spec **self-skips**
with a reason when absent.

**E2E was not executed.** No `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (or `ADMIN_*`) exists in `.env`
or the environment, no dev server was running, and admin login needs a Prisma session **write** — which
the P6003 hold currently rejects. The spec was verified to collect (7 tests × 3 browser projects) and
to lint clean, not to pass.

## Verification

- **tsc:** `46` known test diagnostics / `0` production, delta `+0` — exact baseline.
- **Jest (full):** **green** — `126/126` suites, `1813` pass / `4` skip / `0` fail, `124.9 s`.
  Sheets suites **142/142** on the targeted status + sync + SQLite re-run. An earlier full run in this
  version reported 16 failing Laya tests; the re-run disproved it as a failure — see Finding 2.
- **quickbuild:** OK, `196/196` pages (+7 vs v3.42.0's 189 — the new console + 6 admin routes).
- **ESLint:** new files clean (0 errors, 0 warnings on `e2e/admin-google-sheets.spec.ts`).
- **OpenAPI:** all six admin routes registered, each with `securityAdmin`, a summary, 2xx and 401.
  Verified by driving the exported `GET()` (the `openapi` const itself is **not** exported).
- **Browser verification NOT performed** — blocked on the same missing credentials as E2E.

## Findings

1. **Fixed — stale hardcoded registry count.** `googleSheetsStatus.test.ts` asserted
   `perTab.map(t => t.tab)` equalled `TABS` (6, once `metrics` was added) and then, one line later,
   `expect(s.perTab).toHaveLength(5)`. The test was internally inconsistent and failed. Now
   `toHaveLength(TABS.length)`, so adding a tab can never silently rot it again. **Lesson 144.**
2. **Pre-existing, NOT this work — Laya suites are load-sensitive (and an earlier report of them
   failing was itself wrong).** `layaDecisionModel.test.ts` and `layaAgent.test.ts` spawn a child
   process (`node --import tsx scripts/dev-checks/laya-forward.ts`) to load the 503 MB ONNX chain under
   a hard `timeout: 120_000`. One full-suite run with `workers: 2` exceeded that and reported 16 failing
   tests, which this version initially recorded as a real failure — a mistake: **re-running the entire
   suite came back green**, `126/126` suites and `1813` pass / `4` skip / `0` fail, with
   `layaAgent.test.ts` 69.2 s and `layaDecisionModel.test.ts` 8.8 s, weights present (7 files,
   527,680,766 bytes). So the `ETIMEDOUT` is CPU/memory contention against the fixed 120 s cap, **not** a
   missing-model gap and **not** a defect. Not fixed here: it belongs to v3.41.3's subsystem, and the
   evidence now points at flake-headroom rather than breakage — the one-line timeout raise *hardens a
   flake, it fixes no current failure*, so it is **deferred, needs a decision.** **Lesson 145.**
3. **Pre-existing — the OpenAPI document omits `401` on 112 operations** across unrelated paths.
   All six new Sheets routes *do* declare 401. Not touched.
4. **The one-off `openapi` structural check initially failed** with `FAIL: openapi not exported`.
   Cause was the check script's assumption, not the route: only `GET` is exported.

## Blocked

- **P6003 plan-limit hold until 2026-10-02** blocks all Prisma reads/writes. Consequences: admin
  login cannot create a session, `ScanConfig` reads for custom Re-scan fail, and the metrics
  projection degrades by design.
- **OAuth consent not performed** → no refresh token → no live append, no live re-scan, no
  `values.append` against a real sheet.
- `migrate reset` must not be run; `scripts/dev-checks/google-oauth-consent.mjs` is retained until
  consent is complete.

## Not done (deliberate)

- No migration was run; the two `20260926000000_*` migrations are committed-but-unapplied.
- No browser/UI verification (blocked).
- No live-sheet verification (blocked).
- The pre-existing Laya timeout was **not** changed.
