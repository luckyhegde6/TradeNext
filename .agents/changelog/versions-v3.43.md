# v3.43.0 — Spec 20 Google Sheets Admin Console

> **Status:** CODE + TESTS + BUILD + DOCS DONE. **COMMITTED** as `645cf85` (51 files, +7,574/−114) — no push / PR / deploy.
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
   process (`node --import tsx scripts/dev-checks/laya-forward.ts`) to load the 503 MB ONNX chain. One
   full-suite run with `workers: 2` reported 16 failing tests, which this version initially recorded as
   a real failure — a mistake: **re-running the entire suite came back green**, `126/126` suites and
   `1813` pass / `4` skip / `0` fail, with `layaAgent.test.ts` 69.2 s and `layaDecisionModel.test.ts`
   8.8 s, weights present (7 files, 527,680,766 bytes). So the `ETIMEDOUT` is CPU/memory contention,
   **not** a missing-model gap and **not** a defect. It was first deferred as a one-line timeout raise
   belonging to v3.41.3's subsystem (**Lesson 145**); the user then approved it, and executing the
   deferral showed the **documented cap was never the binding one** (**Lesson 147** — see below).

3. **Pre-existing — the OpenAPI document omits `401` on 112 operations** across unrelated paths.
   All six new Sheets routes *do* declare 401. Not touched.
4. **The one-off `openapi` structural check initially failed** with `FAIL: openapi not exported`.
   Cause was the check script's assumption, not the route: only `GET` is exported.
5. **The pre-commit hook blocked the commit on a fake value.** `.githooks/pre-commit` assembles the
   join-password literal at runtime and matched a digit run inside the OpenAPI example `sheetId`
   (a 26-character fake ID). It is an example, not a credential, and no test asserts it; the example
   value was changed to a different 10-digit tail rather than reaching for `--no-verify`. Note the
   corollary: the offending run is deliberately **not** quoted in these docs, because doing so re-arms
   the same check for the next commit.

## Follow-up (committed separately)

The v3.43.0 commit `645cf85` was kept to a single subsystem, so the approved Laya timeout fix landed as
its own commit. Deriving it re-derived the finding: the binding clocks were the **Jest hook** caps, not
the child-process cap the deferral named.

| Suite | `execFileSync` cap | Jest hook cap (binding) |
|---|---|---|
| `layaAgent.test.ts` | `120_000` → `300_000` | `60_000` (explicit) → `300_000` |
| `layaDecisionModel.test.ts` | `120_000` → `300_000` | **none** ⇒ Jest `5_000` default → `300_000` |

The repo sets **no `testTimeout`** anywhere, so `layaDecisionModel`'s untimed `beforeAll` was running a
503 MB cold load against a **5 s** cap and passing only on a warm page cache (that suite completes in
6.4 s). Raising the documented `120_000` would have changed nothing. **Lesson 147** — enumerate every
clock in the chain and fix the minimum; an untimed hook inherits your framework's default; and
re-derive a deferred finding when you execute it instead of transcribing it. Verified in isolation:
`layaAgent` 37.7 s, `layaDecisionModel` 6.4 s, **19/19 pass**; tsc baseline **46 exact / prod 0 / +0**;
scoped ESLint clean; 2 test files, 4 values, no production code.

## Live verification (2026-09-28) — full chain executed against the real spreadsheet

OAuth consent **performed** (Testing-mode token, sheet owner); the complete flow ran live against the real
"TradeNext Tracker" sheet via in-memory session probes + a pure-OAuth read-back script:

1. **A1 header-probe bug found + fixed (Lesson 149)** — `readHeaderState` probed `${tab}!A1` (a 1×1 cell),
   so ANY populated multi-column header misclassified as `drifted` (the console would never write a header
   on a genuinely empty tab either). Unit mocks injected full rows **regardless of the requested range** and
   the e2e mock hardcoded `matched`, so every automated gate was green. Fix = probe `${tab}!1:1` (whole
   first row); write target stays `A1`; range pins added in `googleSheetsStatus.test.ts` and
   `googleSheetsTracking.test.ts`. **Uncommitted** (`lib/services/googleSheets/tabs.ts` + 2 test files).
2. **Chain, live**: csrf 200 → login 302 → session 200 (`admin@tradenext6.app`, role admin) → status 200
   (`tracking=true`, `metrics` = `matched` post-fix, other 5 tabs `absent`) → GET metrics 200
   (`ok:true, totalTracked=121, active=121`) → POST metrics 200 (`success=true, outcome=enabled, tab=metrics`)
   → POST sync `{tabs:["metrics"]}` 200 (`status=empty, rows=0, remaining=0` — nothing owed, the direct
   append already recorded `delivered=1`) → status after: `lastMark:null`, all queues 0.
3. **Sheet read-back**: row 2 at `A2` = `[2026-09-28T15:43:36.687Z, 121, 121, 0, 0, 0, "", 0, "", "", 0]` —
   11 positional columns, ratios `null`, P&L sums 0 — exactly the pinned contract. Two test rows total in
   the sheet (14:24:45.344Z pre-heal + 15:43:36.687Z; the first is kept as an audit record).
4. **Idempotence + exclusion**: a second sync of `metrics` returned `empty` (delivered marker holds, no
   duplicate re-drain); sync of `decisions` → `skipped` ("excluded by spec (in-memory only, not syncable)");
   status shows `metrics queued=0/1` (0 owed, 1 retained audit row). Earlier 400s in a probe were **probe-side**
   (a helper that dropped the caller's `headers`, sending the form body with `content-type: application/json`
   → Auth.js `JSON.parse` SyntaxError; Lesson 149), not an app bug — and retroactively explains the original
   `curl -c cookies.txt` 401s (jar serialization; only in-memory cookie probes ever worked).
5. **The documented "P6003 blocks the metrics projection" assumption was WRONG** — the projection ran live
   (`totalTracked=121, active=121`). Only session (admin login) and `ScanConfig` **writes** are held. The
   assumption was corrected in this changelog, the PR body, and `docs/google-sheets-setup.md`.
6. **Architecture confirmed live**: producers append DIRECTLY (awaited) + ledger `delivered=1`; Sync drains
   only UNDELIVERED rows; `lastMark` is the *drain* cursor, so `null` after a successful direct append is
   by-design, not a defect.
7. The P0 SQLite snapshot-restore fix (`lib/sqlite.ts` + `sqliteMirror.test.ts`) was verified live earlier
   (34 tables healed, persisted) and remains **uncommitted** alongside the A1 fix.
8. Jest 58/58 targeted; tsc **46 exact / prod 0 / +0 new** (0 hits on touched files); ESLint clean.
   Dev server booted once (PID 56228, 15:13:55 `Ready in 4.4s`); repeated "Auth route: Server starting"
   lines are lazy per-route Turbopack re-inits, not restarts.

## Blocked

- **P6003 plan-limit hold until 2026-10-02** still blocks the Prisma **session write** admin login needs on
  the remote DB and `ScanConfig` **reads** for custom Re-scan. The metrics projection runs fine (verified
  live above); the earlier "holds the metrics projection" assumption is corrected.
- `migrate reset` must not be run; `scripts/dev-checks/google-oauth-consent.mjs` is retained.
- Commits of the two uncommitted fix sets (P0 SQLite restore + A1 header-probe) are **pending user approval**.

## Not done (deliberate)

- No migration was run; the two `20260926000000_*` migrations are committed-but-unapplied.
- **Poisoned-row / guarded-delete recovery was NOT exercised live** — it is destructive on the user's real
  sheet and irreversible; it stays covered by 21 Jest tests + the e2e mocks. Live verification otherwise
  complete (consent, append, sync/drain semantics, idempotence, metrics projection — above).
- The pre-existing Laya child-process timeout was **not** changed by this commit — it was hardened in a
  separate follow-up commit (above, Lesson 147).
