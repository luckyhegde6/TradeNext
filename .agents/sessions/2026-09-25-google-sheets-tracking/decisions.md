# Session decisions — 2026-09-25 · v3.42.0 Spec 19 Google Sheets tracking

## Decision 1 — Master switch is the exact string `"true"`, and flag-off is a byte-identical no-op
- **Decision**: `isTrackingEnabled()` returns `process.env.GOOGLE_SHEETS_TRACKING_ENABLED === "true"`. Anything else — including `"1"` or `"TRUE"` — is off. Off means zero network calls and the `googleapis` SDK is never loaded.
- **Why**: The feature writes to the user's own spreadsheet; a typo'd or accidentally-truthy env var must not start appending rows. Byte-identical off also means the four producer hooks are provably no-ops (`exportRows` returns `"disabled"` before touching the client), which is what keeps the plan-limit write budget and request latency unchanged for everyone who does not opt in.
- **Trade-off**: Someone writing `TRUE` gets silence rather than a warning. Accepted — the failure mode is "no export", never "corrupt export", and `.env.example` documents the exact accepted value.

## Decision 2 — Append-only, and header drift is preserved, never corrected
- **Decision**: The exporter only ever calls `values.append` (`USER_ENTERED`). `ensureHeaders()` runs at most once per tab per process: blank tab → write the header row; matching first row → no-op; **non-empty but different → log `warn` and append by column position anyway**. The header row the user owns is never rewritten, and existing data rows are never touched.
- **Why**: The user's spreadsheet is the durable record. Rewriting a customised header would silently shift every column under rows the user owns — an irreversible data-integrity failure. A `warn` + positional append loses nothing (a drifted column lands in the wrong header, visibly) and never destroys anything.
- **Trade-off**: A genuinely drifted tab silently mislabels new rows until someone reads the log. Chosen over "fix it automatically" because the exporter cannot distinguish "user's newer schema" from "our stale schema".

## Decision 3 — One batched append per producer-run, one retry, no per-row calls
- **Decision**: A run with hundreds of stocks/days/decisions is ONE `values.append` request. On a transient failure (HTTP 401 / 408 / 429 / 5xx) wait `RETRY_BACKOFF_MS = 1_000` and retry exactly once; anything non-transient fails immediately.
- **Why**: Per-row appends would blow the Sheets API rate limit (60 writes/min/user) on any real daily-recommendation run and add seconds of latency to a fire-and-forget path. 401 is included deliberately: a failed access-token refresh (e.g. an expired test-mode refresh token) can clear on the next attempt, and one 1 s retry is cheap insurance.
- **Trade-off**: A partial write is not resumable — but the retry re-appends only when the append itself threw, and Sheets appends are atomic per request, so the realistic loss is one run, not a half-written tab.

## Decision 4 — The exporter can never throw into business logic
- **Decision**: `exportRows` wraps everything in try/catch and returns `"disabled" | "enabled" | "failed"`. Missing `GOOGLE_SHEET_ID`/OAuth env, an unknown tab, a header-ensure failure, or a Sheets error are all logged (pino) + audited (best-effort) and reported as a value. Producers call the wrappers fire-and-forget with `.catch(logger.error)`.
- **Why**: These producers are the swing analysis, the daily recommendation cron, the screener, and the decision engine. A 401 from an external spreadsheet must not turn a delivered swing signal into a failed analysis job. The invariant is stated in the exporter's header docblock so future hooks copy it.
- **Trade-off**: Failures are invisible unless someone reads logs/audits. Accepted — an export is a convenience mirror of data the app already owns in Postgres.

## Decision 5 — Success audit is emitted for the four run-level tabs but NOT for `decisions`
- **Decision**: `GOOGLE_SHEETS_APPEND_SUCCESS` fires for `swing`, `daily-rec`, `screener`, `custom`. `decisions` appends once per engine evaluation, so its success is pino-only; failures still audit on both paths.
- **Why**: Auditing every decision trace would be one Prisma write per trace — the exact write amplification that the v3.19+ write-behind / plan-limit discipline exists to prevent. The audit log is for run-level events; `decisions` is already visible in the Decision Engine monitoring tab.
- **Trade-off**: A long run of successful decision exports leaves no audit trail. Accepted and documented in the exporter's header note.

## Decision 6 — `googleapis` is dynamically imported; clients are `global` singletons
- **Decision**: `auth.ts` imports only *types* from `googleapis` and `await import("googleapis")` inside the lazy `getOAuth2Client()` / `getSheetsClient()`. Both clients cache on `globalThis` (`_googleSheetsOAuthClient`, `_googleSheetsSheetsClient`) with `_resetGoogleSheetsClients()` as the test seam. This mirrors the `lib/services/laya/tokenizer.ts` lazy-singleton pattern.
- **Why**: Keeps the CJS SDK out of the Next build graph and out of every process that never arms tracking. `global` caching means a dev-mode module reload (and the Jest module registry) reuses one client instead of rebuilding the auth stack per call.
- **Trade-off**: `google-auth-library` is a transitive dependency rather than a direct one — the OAuth client type is re-exported by `googleapis`, so the declared surface stays a single package.

## Decision 7 — The decision sink is registered lazily FROM `monitoring.ts`, not from the producers
- **Decision**: `monitoring.ts` gains `registerDecisionTraceSink(fn)` and invokes sinks inside `trackDecisionTrace` (try/catch, never throws). `exporter.ts` exposes `registerDecisionSheetSink()`, and `monitoring.ts` calls it on the FIRST recorded trace when the flag is armed.
- **Why**: Registering at module import time would load the exporter in processes that never export, and would not work for a process that only serves `/api/decision/evaluate`. Registering on the first trace (a) keeps the flag-off path byte-identical and SDK-free, and (b) delivers the bootstrap trace too — the very first evaluation of a fresh process is exactly the one a user would otherwise lose.
- **Trade-off**: A process that never records a trace never registers the sink, so a run that produces no decision is also an export that produces no rows. Correct by construction.

## Decision 8 — Row-encoding details that are easy to get wrong
- **Decision**: (a) Custom-scan `amount` from a percentage filter uses `close * pct / (100 + pct)`; (b) the `screener` tab's `close` column takes the screener hit's `price` field (the approved rename, so headers stay stable across a later source-field change); (c) `exportCustomScan` exports only `offset === 0` — the first page of a paginated run — so a long result set cannot append the same page repeatedly.
- **Why**: (a) the naive `close * pct / 100` is wrong for a percentage-of-price filter and would make the tracked amount disagree with the user's own maths. (b)/(c) are both about "one row per real event, not per API page" — the same append-only-log integrity rule as Decision 2.
- **Trade-off**: Custom scans only record their first page, so a 500-stock result set is under-represented in the sheet. Chosen deliberately: a 5000-row append per page would be noise, and the sheet is a tracker, not a data warehouse.

## Decision 9 — The OAuth consent helper is a throwaway, not a shipped script
- **Decision**: `scripts/dev-checks/google-oauth-consent.mjs` exists to capture a refresh token once (Desktop-app client, loopback redirect, sheets scope only, fail-fast on missing env). It is documented as a one-time user step and **must be deleted after use**; no credential ever lands in the repo.
- **Why**: There is no headless way to obtain a user-consent refresh token, so the step has to be a script the user runs. Shipping it long-term invites someone to run it casually and leak a client secret through a shell history. `.env.example` documents the env names and the 7-day testing-mode refresh-token expiry, which is the actual operational gotcha.
- **Trade-off**: Re-arming after a token expiry means re-creating the helper. Acceptable — that is a once-a-7-days (or once-forever, if the app is published) user action, not a runtime dependency.

## Decision 10 — Version v3.42.0, documented uncommitted, no commit/push/PR/deploy claims
- **Decision**: Record v3.42.0 as CODE + TESTS + VERIFIED + docs DONE, on `feature/google-sheets-tracking` off `main` `67eb3fe`, with the OAuth consent/live smoke still outstanding. Do not state or imply any commit, push, PR, merge, or deployment.
- **Why**: Nothing in this workstream has been committed, and the repo's rules (and the user's standing directive) forbid agents claiming or performing git/deploy actions without explicit approval. `Phase 4` live check is therefore recorded as SKIPPED/not-run rather than complete.
- **Trade-off**: The version row is "open". That is the honest state; the next agent resumes from `.agents/session-todos.md` and `handoffs/active/latest.md`.
