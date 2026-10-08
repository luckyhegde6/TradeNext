# v3.42.0 — Google Sheets tracking (Spec 19)

> **Branch**: `feature/google-sheets-tracking` (on `main` @ `67eb3fe`) — **COMMITTED `a6e4e6e` + PUSHED + PR #133 MERGED into `main` (2026-10-06)**
> **Spec**: `.agents/specs/19-google-sheets-tracking.md` · **Plan**: `.agents/plans/19-google-sheets-tracking.md`
> **Status**: CODE + TESTS + VERIFICATION + DOCS DONE — tsc **46 exact baseline (0 new; prod 0)** · lint **0 errors (1155 pre-existing warnings, byte-identical to v3.41.3)** · **118/118 suites (1601 pass / 4 skip / 0 fail, +62)** · quickbuild **189/189** ✓ · **Phase 4 live check NOT RUN** (OAuth consent not performed) · **COMMITTED `a6e4e6e` + PUSHED + PR #133 MERGED (2026-10-06)**

## Why

TradeNext already owns every one of these events in Postgres, but the user wanted one **durable, human-readable, append-only log** in a Google Sheet they can open, filter, pivot, and share — outside the app, without building a UI. Spec 19 adds that as a **strictly optional, flag-gated, fire-and-forget export**: swing signals, daily recommendations, screener hits, saved-config custom scans, and decision-engine traces, one tab each, into a single Tracker spreadsheet.

Design constraints that shaped everything:

- **Zero blast radius when off.** The four producers (swing analysis, the daily-recommendation cron, the unified screener, the custom-scan route) and the decision engine must behave byte-identically for anyone who does not opt in — no network calls, no SDK load, no new Prisma writes.
- **Never lose a delivered signal.** An OAuth failure, an expired refresh token, or a Sheets 5xx must not turn a swing analysis into a failed job or a cron run into a failure.
- **Never touch user data.** The sheet belongs to the user. The exporter may only ever append.

## What changed

- **`lib/services/googleSheets/auth.ts`** — OAuth2 user-consent layer. `GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]` (sheets only), `GOOGLE_OAUTH_REDIRECT_URI = "http://localhost"` (Desktop-app client). `isTrackingEnabled()` requires the **exact** string `"true"`; `trackerSheetId()` resolves `GOOGLE_SHEET_ID`. Lazy `getOAuth2Client()` / `getSheetsClient()` cached on `globalThis` (`_googleSheetsOAuthClient`, `_googleSheetsSheetsClient`) with `_resetGoogleSheetsClients()` as the test seam. **`googleapis` is imported dynamically inside the lazy init** and only as *types* statically, so the CJS SDK never enters the Next build graph or a flag-off process (mirrors the `lib/services/laya/tokenizer.ts` lazy-singleton pattern). Missing-env throw names the missing **variables** only, never their values.
- **`lib/services/googleSheets/tabs.ts`** — `TrackerTab` = `swing | daily-rec | screener | custom | decisions`; `TRACKER_TABS` column contracts (24 / 16 / 12 / 13 / 16 columns). `isTrackerTab()` guards typos before they reach the API. `ensureHeaders(tab)` runs **at most once per tab per process** (globalThis `Set`, `_resetHeaderGuard()` test seam) and follows a three-way policy: blank tab → write the header row (`values.update`, `RAW`); matching first row → no-op; **non-empty but different → `warn` and append by column position, the user's header untouched**. Never throws; on failure the tab is un-marked so a later export retries.
- **`lib/services/googleSheets/rows.ts`** — pure positional encoders `swingRow` / `dailyRecRow` / `screenerRow` / `customScanRow` / `decisionRow` + `cell()` (null/undefined → `""`, objects → JSON). Row-encoding decisions: custom-scan percentage-filter amount = **`close * pct / (100 + pct)`** (the naive `close * pct / 100` disagrees with the user's own maths); `screenerRow` maps the source `price` field into the approved `close` column so headers stay stable; `gateDistribution` and other nested objects are stringified.
- **`lib/services/googleSheets/exporter.ts`** — the fire-and-forget core. `exportRows(tab, rows)` → `"disabled" | "enabled" | "failed"`, **never an exception**: flag off → `"disabled"` with zero IO; unknown tab / missing `GOOGLE_SHEET_ID` / Sheets error → logged + best-effort audited (`GOOGLE_SHEETS_APPEND_FAILED`) + `"failed"`. Armed path = `ensureHeaders()` then **ONE batched `values.append`** (`USER_ENTERED`) for the whole run; on a transient failure (HTTP **401 / 408 / 429 / 5xx**) wait `RETRY_BACKOFF_MS = 1_000` and retry **exactly once**, then give up. 401 is included deliberately — a failed access-token refresh (e.g. an expired testing-mode refresh token) can clear on the next attempt. Wrappers: `exportSwing` / `exportDailyRecs` / `exportScreeners` / `exportCustomScan` / `exportDecision` (+ re-exported `cell()`), each with its own defensive try/catch. **Audit asymmetry:** `GOOGLE_SHEETS_APPEND_SUCCESS` is emitted for the four run-level tabs but **NOT for `decisions`** — auditing one row per engine evaluation would be one Prisma write per trace and would break the v3.19+ write-behind / plan-limit discipline; `decisions` success is pino-only.
- **`lib/services/decision/monitoring.ts`** — NEW `registerDecisionTraceSink(fn)`; sinks are invoked inside `trackDecisionTrace` under try/catch and can never throw back into the recorder. The sink is registered **lazily from inside the monitoring module on the first recorded trace** (and only when the flag is armed) via `registerDecisionSheetSink()` → all four trace kinds (`evaluate`, `ping`, POC A screener, POC B autoseed gate) export, **including the bootstrap trace of a fresh process**.
- **Producer hooks** (all fire-and-forget, `.catch(logger.error)`, never awaited):
  - `lib/services/swingRecommendationService.ts` — `exportSwing(stocks)` once the `SwingStock[]` list is complete (post-AI-analysis).
  - `lib/services/dailyRecommendationService.ts` — `exportDailyRecs(run, stocks)` at run completion.
  - `lib/services/chartinkUnifiedScreenerService.ts` — `exportScreeners(results, ctx)` after POC A scores are computed.
  - `app/api/screener/configs/[id]/run/route.ts` — `exportCustomScan(runCtx, items)`; **only `offset === 0`** is exported, so a paginated run cannot append the same page repeatedly.
- **`lib/audit.ts`** — NEW `GOOGLE_SHEETS_APPEND_SUCCESS` / `GOOGLE_SHEETS_APPEND_FAILED` action types.
- **`.env.example`** — NEW "Google Sheets Tracking (spec 19)" block documenting the 5 variables, the exact accepted flag value, the one-time consent step, and the **testing-mode 7-day refresh-token expiry** warning. Placeholders only.
- **`scripts/dev-checks/google-oauth-consent.mjs`** — NEW one-time, fail-fast consent helper (Desktop-app loopback flow, sheets scope). Smoke-tested; **must be deleted after the user captures a refresh token** — no credential is ever committed.
- `googleapis@182.0.0` (+ transitive `google-auth-library@11.1.0`) added to `package.json` / lockfile.
- **No new API route, no Prisma model, no migration, no UI, no OpenAPI change** — this feature is invisible from the app surface by design.

## Tests

- NEW `lib/__tests__/googleSheetsAuth.test.ts` **13** — flag gate (only exact `"true"`; `"1"`/`"TRUE"` off), sheet-id resolution, missing-env error names variables only, client singletons + `_resetGoogleSheetsClients()` seam.
- NEW `lib/__tests__/googleSheetsTracking.test.ts` **43** — per-tab row encoders (incl. the `close * pct / (100 + pct)` amount and the `price`→`close` mapping), header-ensure policy (blank writes / match no-ops / **mismatch is preserved**), append payload args, retry-once on transient vs fail-fast on non-transient, flag-off = **zero googleapis calls**, and "the exporter never throws" across every failure mode.
- `lib/__tests__/decisionMonitoring.test.ts` **+6** — sink registration, per-kind invocation, and sink-exception swallowing.
- Full suite: **118/118 · 1601 pass / 4 skip / 0 fail** (**+62** tests). The 4 skips are the pre-existing intentional client-cache IndexedDB suites.
- `node scripts/dev-checks/check-tsc-baseline.mjs`: total **46** = baseline **46** (delta **+0**); prod **0** = baseline **0** (delta **+0**).
- `npm run lint`: **0 errors**, 1155 warnings — **byte-identical to the v3.41.3 baseline**, and **zero warnings in the new/touched Google Sheets files**.
- `npm run quickbuild`: **189/189** static pages.
- **E2E: none run** — there is no UI change (matches plan §Test Strategy).
- Dependency audit: **3 pre-existing high-severity** Prisma / `deepmerge-ts` findings. Not introduced by this feature and deliberately not force-fixed here.

## Env / flag contract

`GOOGLE_SHEETS_TRACKING_ENABLED=true` **plus** all of `GOOGLE_SHEET_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` → export armed. Anything less → every producer is a byte-identical no-op. Spreadsheet id `1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ` (5 tabs pre-created by the user).

**Operational gotcha:** a Google Cloud app in **External + Testing** publishing status issues refresh tokens that expire after **7 days**. Publish the app (or move it to an internal Workspace project) for tokens that keep working; otherwise re-run the consent script when exports start failing with 401.

## Not done / deliberate omissions

- **OAuth consent was not run** — no `GOOGLE_OAUTH_REFRESH_TOKEN` exists yet, so nothing has ever been appended to the live Tracker sheet.
- **Phase 4 live smoke (plan step 18) NOT RUN** — needs real credentials in local `.env`; recorded as skipped, not complete.
- **No commit / push / PR / merge / deploy.** Everything on this branch is uncommitted working-tree state pending explicit user approval.
- **Dependency-audit findings not addressed** (pre-existing Prisma / `deepmerge-ts`).
- **Custom scans record only `offset === 0`** — long result sets are under-represented by design; the sheet is a tracker, not a warehouse.

## Docs

`AGENTS.md` (v3.42.0 row) · `.agents/changelog/versions-v3.42.md` (this file) · `.agents/CHANGELOG.md` index · `TODO.md` · `Primer.md` · `agent-memory.md` · `Lessons.md` (**Lessons 141–142**) · `.agents/session-todos.md` · `.agents/handoffs/active/latest.md` · `.agents/plans/19-google-sheets-tracking.md` (status banner + per-phase markers + as-implemented deviations; steps 19–26 checked, Phase 4 marked not-run, Pre-Commit Gate annotated) · session memory `.agents/sessions/2026-09-25-google-sheets-tracking/{decisions,flow}.md`.

---
