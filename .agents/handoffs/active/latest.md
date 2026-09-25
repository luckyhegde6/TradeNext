# Handoff — Active (latest)

> SCHEMA v1.1 · read at session start after `@HANDOFF.md`. Live resume context — update after every session; archive to `.agents/handoffs/` history when superseded.

## Status

| Field | Value |
|-------|-------|
| **Task** | v3.42.0 Spec 19 — Google Sheets tracking (append-only export of 5 event streams) |
| **Branch** | `feature/google-sheets-tracking` (branched from `main` `67eb3fe`) — **work UNCOMMITTED** |
| **State** | CODE + TESTS + VERIFICATION + DOCS **DONE** · **UNCOMMITTED** — no push, no PR, no merge, no deploy |
| **Gate** | `GOOGLE_SHEETS_TRACKING_ENABLED === "true"` (exact string) — flag-off is byte-identical (zero network calls, SDK never loaded) |
| **Blocked** | **Partly** — Phase 4 live validation needs the user (OAuth consent + optional live smoke). Nothing is technically blocked. |
| **Side note** | v3.41.3 is COMMITTED (`3c765b9`) on `feature/ph22-decision-engine` with **PR #132 OPEN** — merge/deploy still pending user. Unrelated branch. |

## What's done (v3.42.0)

- **NEW `lib/services/googleSheets/auth.ts`** — OAuth2 user consent, sheets-only scope, exact-`"true"` flag gate, lazy `globalThis` OAuth2/Sheets singletons, **dynamic `import("googleapis")`** so the CJS SDK never enters the Next build graph. `googleapis@182.0.0` added.
- **NEW `lib/services/googleSheets/tabs.ts`** — `TRACKER_TABS` column contracts 24/16/12/13/16 (`swing` / `daily-rec` / `screener` / `custom` / `decisions`); once-per-process header ensure — blank→write, match→no-op, **mismatch→`warn` + append by column position**; the user's header is never rewritten.
- **NEW `lib/services/googleSheets/rows.ts`** — pure positional encoders; custom-scan % amount = `close * pct / (100 + pct)`; screener `price`→`close`.
- **NEW `lib/services/googleSheets/exporter.ts`** — **one batched `values.append` (`USER_ENTERED`) per producer-run**, one ~1 s retry for transient HTTP only (401/408/429/5xx — a failed access-token refresh can clear on retry), never throws → `"disabled" | "enabled" | "failed"`; best-effort audit inside its own try/catch; **success audit deliberately omitted for `decisions`** (one Prisma write per trace would break the v3.19+ write-behind plan-limit budget).
- **Producer hooks (fire-and-forget, never awaited)** — `swingRecommendationService` · `dailyRecommendationService` · `chartinkUnifiedScreenerService` · `app/api/screener/configs/[id]/run` (custom export `offset === 0` only, so a long paginated run cannot re-append page 1).
- **Decision-trace stream** — `lib/services/decision/monitoring.ts` NEW `registerDecisionTraceSink` + **lazy sink registration on the FIRST recorded trace** (covers evaluate / ping / POC-A screener / POC-B autoseed gate, incl. the bootstrap trace). Lazy registration keeps the flag-off path byte-identical and still delivers the first event.
- **Audits + env** — `GOOGLE_SHEETS_APPEND_{SUCCESS,FAILED}` audit tags; `.env.example` block with the 7-day testing-mode refresh-token expiry warning; throwaway `scripts/dev-checks/google-oauth-consent.mjs`.
- **No new surface** — no API route, no Prisma model, no migration, no UI, no OpenAPI change.
- **Tests** — NEW `lib/__tests__/googleSheetsAuth.test.ts` 13/13 · NEW `lib/__tests__/googleSheetsTracking.test.ts` 43/43 (tabs + rows + exporter) · +6 cases in `lib/__tests__/decisionMonitoring.test.ts`.
- **Verified** — tsc **46 exact (0 new; prod 0)** · lint **0 errors** (1155 pre-existing warnings, byte-identical to v3.41.3; **zero in the new files**) · tests **118/118 suites (1601 pass / 4 skip / 0 fail, +62)** · quickbuild **189/189** ✓ · **E2E not run — no UI change** · 3 pre-existing high-severity Prisma / `deepmerge-ts` audit findings untouched.
- **Docs** — `AGENTS.md` row + latest pointer · `.agents/changelog/versions-v3.42.md` · `.agents/CHANGELOG.md` index · `TODO.md` quick-ref · `Primer.md` · **Lessons 141 + 142** + update log · `agent-memory.md` · session `decisions.md` + `flow.md` (`.agents/sessions/2026-09-25-google-sheets-tracking/`) · this handoff · `.agents/session-todos.md` · plan status banner + per-phase markers + deviations.
- **Doc-budget gate green** — `check-doc-sizes.mjs` **OK, 90.9/100 KB total**, all five injected files within the 32 KB per-file budget. Adding the v3.42.0 row had pushed `TODO.md` to 33.1 KB, so the oldest superseded blocks (v3.41.0/1/2) were archived to `.agents/changelog/todo-quick-reference-archive.md` behind a one-line pointer — it now sits at 29.3 KB, below its pre-v3.42.0 size (**Lesson 142**).

## Not done (deliberately)

- **Phase 4 live validation NOT RUN** — OAuth consent was never performed, so there is **no refresh token and nothing has been appended to the live Tracker sheet** (`1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ`). The feature is verified by unit tests only.
- **Not committed / pushed / PR'd / merged / deployed** — awaiting explicit user approval.
- `scripts/dev-checks/google-oauth-consent.mjs` is a **one-time throwaway** — it contains no credentials, and it exists only so the consent step is reproducible while iterating. **It is currently uncommitted**, same as the rest of this feature; delete it from the commit (or after consent) rather than shipping it.
- **Deploy watch-item** — `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` does not list the two new test files. They contain only a deliberate fake fixture (`GOOGLE_OAUTH_CLIENT_SECRET = "SUPER-SECRET-VALUE"`), and the sibling `lib/__tests__/predeployPreserveRoute.test.ts` sets `DEPLOY_GUARD_TOKEN = "test-token"` without being omitted either, so this is expected to pass. If a Netlify build ever fails with "Secrets scanning found secrets in build", append `lib/__tests__/googleSheetsAuth.test.ts,lib/__tests__/googleSheetsTracking.test.ts` to that list.

## Next steps (for the next agent)

1. **Do NOT auto-commit, push, PR, merge, or deploy.** Ask the user first.
2. If the user wants live validation: have them run `node scripts/dev-checks/google-oauth-consent.mjs` once (prints a Google auth URL), then paste the returned refresh token into their local `.env` as `GOOGLE_SHEETS_REFRESH_TOKEN`, set `GOOGLE_SHEETS_TRACKING_ENABLED=true`, and **delete the helper script**. Then a single swing/daily-rec/screener run appends to the live sheet; re-running is safe (append-only). Expect a 401 storm after ~7 days → re-consent, not a bug (Google Cloud `External`+`Testing` apps issue short-lived refresh tokens).
3. If the user wants the commit: stage the feature + docs files, run the pre-commit workflow (`.agents/pre-commit-workflow.md`) + hygiene checklist, then commit as **v3.42.0** on `feature/google-sheets-tracking` (46+ files; do not commit any credentials, `.env`, or the laya `weights/` dir).
4. Docs verified this pass: `check-doc-sizes.mjs` **OK 90.9/100 KB** · `git diff --check` clean · no real secrets in the change set · every table row I added is cell-consistent with its siblings (one real defect found and fixed — the CHANGELOG row had 2 unescaped `|` in `` `disabled|enabled|failed` ``). Full log: `flow.md` → `## Validation`.
4. Nothing else is outstanding for this feature. The next feature batch is whatever the user picks (Laya P4–P6 follow-ups are still open on the other branch).

## Gotchas / lessons (recent)

- **Never rewrite data you do not own** — on header drift, `warn` + append by position; rewriting a user's customised header shifts every column under rows they own (Lesson 141).
- **`TODO.md` is a per-file-budgeted index, not a log** — the 32 KB per-file cap binds before the 100 KB total, and a version row is ~2.3 KB, so archive superseded blocks instead of appending forever (Lesson 142).
- **Docs are CRLF** — a scripted `split("\n")`/`join("\n")` rewrite silently injects bare LF; prefer the editor tools (Lesson 142).
- **Batch once per run** — Sheets allows ~60 writes/min/user; per-row appends would rate-limit a real daily-recommendation run (Lesson 141).
- **Never throw from the exporter into business logic** — a 401/5xx must not fail a delivered swing analysis, the recommendation cron, the screener, or the decision engine; return a value and log (Lesson 141).
- **Exact-string flag gate** — a typo must only ever mean "no export", never "unexpected writes into the user's sheet"; the dynamic import keeps the flag-off path free of the SDK.
- **Audit on the right cadence** — run-level success audits for the 4 low-frequency tabs, log-only for the per-evaluation `decisions` tab (Lesson 99 write-behind budget).
- **Lazy sink registration, not import-time** — a sink wired at import time both loads the exporter in processes that never export and misses the bootstrap trace.
- **Testing-mode OAuth expiry** — Google Cloud `External` + `Testing` apps issue refresh tokens that expire after **7 days**; document it and treat a 401 storm as "re-consent".
- LSP module-resolution diagnostics in decision-engine files are pre-existing sandbox noise; the baseline TypeScript gate is authoritative.
