# Session flow — 2026-09-25 · v3.42.0 Spec 19 Google Sheets tracking

## Approval
- User approved spec `.agents/specs/19-google-sheets-tracking.md` + plan `.agents/plans/19-google-sheets-tracking.md` → implementation on branch `feature/google-sheets-tracking` (base `main` @ `67eb3fe`). Work is **uncommitted** — no push/PR/deploy.

## Phase 0 — Dependency + Env
- `npm install googleapis@182.0.0` (permission granted by user; brings `google-auth-library@11.1.0`). `package.json` + `package-lock.json` touched.
- `.env.example`: NEW "Google Sheets Tracking (spec 19)" block — `GOOGLE_SHEETS_TRACKING_ENABLED=false`, `GOOGLE_SHEET_ID=`, `GOOGLE_OAUTH_CLIENT_ID=`, `GOOGLE_OAUTH_CLIENT_SECRET=`, `GOOGLE_OAUTH_REFRESH_TOKEN=`, plus the testing-mode 7-day refresh-token expiry warning and the pointer to the consent script. **No credential values committed.**
- User created the Google Cloud OAuth2 credentials (Desktop app, Sheets API enabled, self added as test user) and provided the spreadsheet id `1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ`; the sheet already carries the 5 tabs.

## Phase 1 — Core Module (NEW `lib/services/googleSheets/`)
- `auth.ts` — `isTrackingEnabled()` (exact `"true"`), `trackerSheetId()`, `GOOGLE_SCOPES` (`https://www.googleapis.com/auth/spreadsheets`), `GOOGLE_OAUTH_REDIRECT_URI` (`http://localhost`), lazy `getOAuth2Client()` / `getSheetsClient()` on `globalThis` singletons, `_resetGoogleSheetsClients()` test seam, `logTrackingStatus()`. Type-only imports from `googleapis`; the SDK is loaded via dynamic `import()` so the Next build graph never pulls it unless tracking is armed. Missing-env throw names VARIABLES only, never values.
- `tabs.ts` — `TrackerTab` union (`swing | daily-rec | screener | custom | decisions`), `TRACKER_TABS` column contracts (24 / 16 / 12 / 13 / 16 columns), `isTrackerTab()` guard, `ensureHeaders()` (once per tab per process, `_resetHeaderGuard()` test seam): blank tab → `values.update` header `RAW`; match → no-op; **mismatch → `warn` + append by position, user header untouched**. Never throws; un-marks the tab on failure so a later export can retry.
- `rows.ts` — pure positional encoders `swingRow` / `dailyRecRow` / `screenerRow` / `customScanRow` / `decisionRow` + `cell()` (null/undefined → `""`, objects → JSON). Custom-scan percentage amount = `close * pct / (100 + pct)`; `screenerRow` maps source `price` → the `close` column; `gateDistribution`/nested objects stringified.
- `exporter.ts` — `exportRows(tab, rows)` + wrappers `exportSwing` / `exportDailyRecs` / `exportScreeners` / `exportCustomScan` / `exportDecision` + `registerDecisionSheetSink()`. Contract: flag off → `"disabled"` with zero IO; `values.append` `USER_ENTERED` once per producer-run; single retry after `RETRY_BACKOFF_MS = 1_000` on HTTP 401/408/429/5xx; never throws (returns `"failed"`); best-effort audit via dynamic `@/lib/audit` import. `GOOGLE_SHEETS_APPEND_SUCCESS` deliberately NOT emitted for `decisions` (one trace = one Prisma write would break the v3.19+ write-behind budget).

## Phase 2 — Hooks
- `lib/services/decision/monitoring.ts` — NEW `registerDecisionTraceSink()` + sinks invoked inside `trackDecisionTrace` (try/catch, never throws); lazily calls `registerDecisionSheetSink()` on the first recorded trace when armed → all four trace kinds (`evaluate`, `ping`, POC A screener, POC B autoseed gate) export, including the bootstrap trace.
- `lib/services/swingRecommendationService.ts` — `exportSwing(stocks)` after the `SwingStock[]` list is complete.
- `lib/services/dailyRecommendationService.ts` — `exportDailyRecs(run, stocks)` at run completion.
- `lib/services/chartinkUnifiedScreenerService.ts` — `exportScreeners(results, ctx)` after POC A scores are computed.
- `app/api/screener/configs/[id]/run/route.ts` — `exportCustomScan(runCtx, items)` after the run's items are produced; only `offset === 0` is exported.
- All four producers are fire-and-forget (`.catch(logger.error)`), never awaited.
- `lib/audit.ts` — NEW `GOOGLE_SHEETS_APPEND_SUCCESS` / `GOOGLE_SHEETS_APPEND_FAILED` action types.
- `.env.example` — spec-19 env block (Phase 0).

## Phase 3 — Tests
- NEW `lib/__tests__/googleSheetsAuth.test.ts` **13 tests** — flag gate (exact `"true"`), sheet-id resolution, missing-env error names variables only, client singletons + reset seam.
- NEW `lib/__tests__/googleSheetsTracking.test.ts` **43 tests** — row encoders per tab, header-ensure policy (blank / match / mismatch-preserved), append args, retry-once on transient, no-retry on non-transient, flag-off = zero googleapis calls, exporter never throws.
- `lib/__tests__/decisionMonitoring.test.ts` — **+6 tests** for sink registration, per-kind invocation, and exception swallowing.

## Phase 4 — Live check: **NOT RUN (skipped, optional/manual)**
- Requires real credentials in local `.env` + the one-time browser consent. The OAuth consent run was **not performed**, so no `GOOGLE_OAUTH_REFRESH_TOKEN` exists yet and no rows have been appended to the live Tracker sheet.
- `scripts/dev-checks/google-oauth-consent.mjs` (NEW, fail-fast one-time helper) is smoke-tested and ready; **delete it after use**.

## Phase 5 — Verification gate (ALL GREEN)
| Gate | Result |
|------|--------|
| `node scripts/dev-checks/check-tsc-baseline.mjs` | total **46** = baseline **46**, delta **+0**; prod **0** = baseline **0**, delta **+0** |
| `npm run test` | **118/118 suites · 1601 pass / 4 skip / 0 fail** (+62: auth 13 + tracking 43 + decision sink 6) |
| `npm run lint` | **0 errors**, 1155 warnings — byte-identical to the v3.41.3 baseline; **zero warnings in new/touched Google Sheets files** |
| `npm run quickbuild` | successful — **189/189** static pages |
| E2E | **none run** — no UI change in this feature (matches plan §Test Strategy) |
| Dependency audit | 3 pre-existing high-severity Prisma / `deepmerge-ts` findings, **not** introduced or fixed by this feature |

## Phase 6 — Docs pass (DONE)
- `AGENTS.md` — NEW v3.42.0 version-history row (compact; detail lives in the changelog subfile) + latest-version pointer updated.
- `.agents/changelog/versions-v3.42.md` — NEW detail file for v3.42.0.
- `.agents/CHANGELOG.md` — index row for `versions-v3.42.md`.
- `TODO.md` — NEW v3.42.0 block at the top of Quick Reference; v3.41.3 marked as carried by open PR #132.
- `Primer.md` — Last Updated + NEW `### v3.42.0` Current Project Status entry.
- `agent-memory.md` — NEW v3.42.0 activity entry.
- `Lessons.md` — NEW **Lesson 141** (the export contract: never rewrite user data / batch once per run / never throw back) + **Lesson 142** (the doc-budget + CRLF traps hit while writing this pass) + Update Log rows.
- `.agents/session-todos.md` — NEW Current v3.42.0 block; v3.41.3 demoted to Prior.
- `.agents/handoffs/active/latest.md` — rewritten for v3.42.0.
- `.agents/plans/19-google-sheets-tracking.md` — status banner, per-phase status markers, an as-implemented **deviations** section (test file names, stricter header policy, lazy sink registration, broader retry set, reduced audit scope for `decisions`, `offset === 0` custom export), Documentation Checklist checked, verification results recorded, Phase 4 marked NOT RUN, Pre-Commit Gate annotated.
- Session memory: this `decisions.md` + `flow.md` (created under `2026-09-25-google-sheets-tracking/`, not the plan's original `2026-09-25-google-sheets/`).

## Phase 7 — Documentation validation
- Doc-budget check `scripts/dev-checks/check-doc-sizes.mjs` — see `## Validation` below.

## Validation

| Check | Result |
|-------|--------|
| `node scripts/dev-checks/check-doc-sizes.mjs` | **OK — 90.9/100 KB total**; all five injected files ok: `README.md` 18.7 KB · `AGENTS.md` 29.3 KB · `TODO.md` 29.3 KB · `.agents/rules/README.md` 3.5 KB · `.agents/rules/checklist.md` 10.0 KB |
| Line-ending consistency | all edited docs single-convention; `TODO.md` normalised back to **440 CRLF / 0 bare-LF** after a scripted line rewrite had injected 2 bare LFs (**Lesson 142**) |
| `AGENTS.md` v3.42.0 row | single line (2465 B), 6 pipes, leading + trailing `\|`; latest-version pointer updated to `versions-v3.42.md` |
| `.agents/CHANGELOG.md` index row | present, single line, links `./changelog/versions-v3.42.md` |
| `Lessons.md` | exactly **one** `### 141.` and **one** `### 142.` heading, both **before** `## Update Log`; no duplicate lesson numbers repo-wide |
| Markdown table integrity (escape-aware cell count vs sibling rows) | `AGENTS.md` v3.42.0 row = **3 cells** (matches every v3.41.x row) · `.agents/CHANGELOG.md` v3.42.0 row = **2 cells** (matches the File/Contents table) · 3 new archive rows = **3 cells** (own Version/What/Status table). **1 real defect found and fixed**: the CHANGELOG row shipped the exporter union as `` `disabled|enabled|failed` `` — 2 unescaped `\|` split the row into 4 cells, so it would have rendered broken on GitHub; now `` `disabled` \| `enabled` \| `failed` `` |
| Pre-existing ragged rows (NOT touched) | `AGENTS.md` v3.40.4/5/8 and 9 old `.agents/CHANGELOG.md` rows (v3.40, v3.33, v3.32, v3.31, v3.29.1, v3.29.0, v3.28.4, v3.28.1, v3.26, v3.22) carry unescaped `\|` at `HEAD` — pre-existing rendering debt, left alone per the surgical-changes rule |
| Plan integrity | all 6 phase status markers present; **Phase 4 NOT-RUN marker present**; Documentation Checklist fully checked; trailing newline restored |
| `git status --porcelain` | only intended files: 8 modified (7 docs + `.env.example`) and 7 untracked groups; **no junk artifacts** (no root `*.yaml`, no `dev-server.log`, no screenshots) |
| `git diff --check` | **clean** — no whitespace/conflict errors |
| Credential scan of the whole change set (`git diff HEAD` + all 12 untracked files) | **no real secrets.** The only match is `lib/__tests__/googleSheetsAuth.test.ts:114` `process.env.GOOGLE_OAUTH_CLIENT_SECRET = "SUPER-SECRET-VALUE"` — a deliberate fake fixture asserted at line 122 to never appear in error messages. The spreadsheet id (8 occurrences) is a public identifier, not a credential |
| ⚠️ Deploy watch-item (not changed) | `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` omits `lib/__tests__/sqlite.test.ts` but **not** the two new test files. Netlify scans every repo file, so if the build ever fails with "Secrets scanning found secrets in build", append `lib/__tests__/googleSheetsAuth.test.ts,lib/__tests__/googleSheetsTracking.test.ts` to that list. Left alone deliberately: the fixture is low-entropy, the sibling `lib/__tests__/predeployPreserveRoute.test.ts` (`DEPLOY_GUARD_TOKEN = "test-token"`) is likewise not omitted, and changing build config is outside a docs pass |
| Advisory | `.context/out` scratch = 12.2 MB > 5 MB retention threshold — **pre-existing, gitignored, not part of this change** |

## Next
1. **User action required**: run the OAuth consent (`scripts/dev-checks/google-oauth-consent.mjs`) to capture a refresh token, populate local `.env` (and Netlify env vars if the export should run in production), then **delete the helper script**. Remember: an app in Google Cloud `External` + `Testing` publishing status issues refresh tokens that expire after **7 days** — publish the app (or move it to an internal Workspace project) for tokens that keep working.
2. Optional live smoke (plan Phase 4 step 18): set the flag true, trigger one swing analysis / recommendation run on `:3000`, and confirm rows land in the right tabs.
3. Commit as **v3.42.0** on explicit user request only. No push / PR / deploy without separate approval.
