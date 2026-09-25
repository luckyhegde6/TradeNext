# Implementation Plan — Google Sheets Tracking Export

> Generated from spec: `.agents/specs/19-google-sheets-tracking.md`

## Spec Reference

- **Spec**: `.agents/specs/19-google-sheets-tracking.md`
- **Branch**: `feature/google-sheets-tracking` (from `main` `67eb3fe`)
- **Created**: 2026-09-25
- **Auth**: OAuth2 user-consent (refresh token, server-side) · **Write timing**: real-time fire-and-forget
- **Status (2026-09-25)**: **Steps 1, 4–17, 19–26 DONE** · **Steps 2, 18 NOT RUN (need the user: OAuth consent / live smoke)** · **Step 3 PARTIAL (`.env.example` documented; real `.env` + Netlify vars not populated)** · **UNCOMMITTED — no push / PR / merge / deploy.** Detail: `.agents/changelog/versions-v3.42.md`; lessons: **141** (export contract) + **142** (doc-budget + CRLF traps). Verification: tsc **46 exact (0 new; prod 0)** · lint **0 errors** (1155 pre-existing warnings, byte-identical to v3.41.3; 0 in new files) · tests **118/118 suites (1601 pass / 4 skip / 0 fail, +62)** · quickbuild **189/189** · **E2E not run (no UI change)** · doc budget **90.9/100 KB**.

### Deviations from the plan (as implemented)

- **Test file names differ** — steps 14–15 were planned as `googleSheetsRows.test.ts` + `googleSheetsExporter.test.ts`; as implemented they are `lib/__tests__/googleSheetsAuth.test.ts` (**13/13** — flag gate / singleton / dynamic import / header policy) + `lib/__tests__/googleSheetsTracking.test.ts` (**43/43** — tabs, rows, exporter, retry, missing-env). Same coverage, fewer files.
- **Header-ensure policy is stricter than step 5** — planned "`values.update` header if mismatch"; implemented **blank→write, match→no-op, mismatch→`warn` + append by column position** (the user's header is never rewritten). The spec's own §4.B-vs-§11 contradiction was resolved in favour of append-only; rationale recorded in the `tabs.ts` docblock and **Lesson 141**.
- **Decision sink is registered lazily, not at import time** — step 8 says "export module registers `exportDecision` sink when flag on"; implemented `registerDecisionTraceSink` + registration on the **first recorded trace** (covers evaluate / ping / POC-A screener / POC-B autoseed gate, incl. the bootstrap trace), which keeps the flag-off path byte-identical.
- **Retry set is broader than step 7's "1 retry/backoff"** — implemented as one ~1 s retry for HTTP **401 / 408 / 429 / 5xx** (401 included because a failed access-token refresh can clear on retry).
- **Step 13 audit scope is reduced for one tab** — `GOOGLE_SHEETS_APPEND_{SUCCESS,FAILED}` are emitted for the 4 run-level tabs; the per-evaluation `decisions` tab is **log-only** on success, because one Prisma write per trace would break the v3.19+ write-behind plan-limit budget (Lesson 99).
- **Step 12 is narrowed** — the custom-scan hook exports `offset === 0` only, so a long paginated run cannot re-append page 1.
- **No new surface** — no API route, no Prisma model, no migration, no UI, no OpenAPI change (as intended).

---

## Implementation Steps

> Ordered steps. Each step is atomic — verifiable independently.

### Phase 0: Dependency + Env (user-assisted)

> **Status: step 1 DONE · step 2 NOT RUN (user) · step 3 PARTIAL.** `googleapis@182.0.0` installed. OAuth consent NOT performed → no refresh token exists. `.env.example` block documented (with the 7-day testing-mode expiry warning) + `scripts/dev-checks/google-oauth-consent.mjs` written; the real local `.env` and Netlify vars are still unpopulated.

1. **Install `googleapis`** → `npm install googleapis` (ask permission first) → verify: `npm ls googleapis` shows version
2. **User creates OAuth2 credentials** (walkthrough in §Integration below): Google Cloud Console → project → enable **Google Sheets API** → OAuth 2.0 Client ID (Desktop app) → consent screen (add yourself as test user) → one-time browser consent flow (documented locally, not committed) → capture **refresh token** → verify: user has 4 values (client ID, client secret, refresh token, sheet id)
3. **Add env vars** to local `.env` + Netlify: `GOOGLE_SHEETS_TRACKING_ENABLED`, `GOOGLE_SHEET_ID=1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` → verify: `.env` populated (gitignored), `.env.example` documented with placeholders

### Phase 1: Core Module

> **Status: steps 4–7 DONE** — `auth.ts` · `tabs.ts` · `rows.ts` · `exporter.ts` created; tsc clean after each.

4. **Create `lib/services/googleSheets/auth.ts`** — lazy `getOAuth2Client()` + `getSheetsClient()` singletons → verify: `npx tsc --noEmit` (0 new)
5. **Create `lib/services/googleSheets/tabs.ts`** — `TRACKER_TABS` registry + `ensureHeaders(tab)` (one-time per-process guard, `values.get` A1 → `values.update` header if mismatch) → verify: header sets match spec §5
6. **Create `lib/services/googleSheets/rows.ts`** — pure encoders `swingRow` / `dailyRecRow` / `screenerRow` / `customScanRow` / `decisionRow` → verify: `npx tsc --noEmit` (0 new)
7. **Create `lib/services/googleSheets/exporter.ts`** — `exportRows(tab, rows)` (flag gate → ensureHeaders → `values.append` USER_ENTERED, 1 retry/backoff, never throw), + wrappers `exportSwing/exportDailyRecs/exportScreeners/exportCustomScan/exportDecision` → verify: `npx tsc --noEmit` (0 new)

### Phase 2: Hooks

> **Status: steps 8–13 DONE** — lazy decision-trace sink + 4 fire-and-forget producer hooks + 2 audit tags.

8. **Decision sink** — modify `lib/services/decision/monitoring.ts`: add `registerDecisionTraceSink(fn)`; call sinks inside `trackDecisionTrace` (try/catch, never throw); export module registers `exportDecision` sink when flag on → verify: existing `decisionMonitoring.test.ts` still passes + new sink tests
9. **Swing hook** — in `lib/services/swingRecommendationService.ts` after analysis completes (SwingStock list available) → `exportSwing(stocks).catch(logger.error)` fire-and-forget → verify: `npx tsc --noEmit`
10. **Daily recs hook** — in `lib/services/dailyRecommendationService.ts` at run completion (run + stocks in scope) → `exportDailyRecs(run, stocks).catch(...)` → verify: `npx tsc --noEmit`
11. **Screener hook** — in `lib/services/chartinkUnifiedScreenerService.ts` POC A block (~L446-484) after scores computed → `exportScreeners(results, opts).catch(...)` → verify: `npx tsc --noEmit`
12. **Custom scan hook** — in `app/api/screener/configs/[id]/run/route.ts` after run items produced → `exportCustomScan(runCtx, items).catch(...)` → verify: `npx tsc --noEmit`
13. **Audit tags** — add `GOOGLE_SHEETS_APPEND_SUCCESS` / `GOOGLE_SHEETS_APPEND_FAILED` (+ `GOOGLE_SHEETS_DISABLED`-equivalent not needed) to `lib/audit.ts` → verify: tags exported, unit test references

### Phase 3: Tests

> **Status: steps 14–17 DONE** — see the deviations note above for the as-implemented test file names. Full verify green: tsc **46 exact (0 new; prod 0)** · lint **0 errors (1155 pre-existing warnings, 0 in new files)** · tests **118/118 suites (1601 pass / 4 skip / 0 fail, +62)** · quickbuild **189/189** ✓.

14. **`lib/__tests__/googleSheetsRows.test.ts`** — encoder coverage per spec §12 → verify: `npm run test` green
15. **`lib/__tests__/googleSheetsExporter.test.ts`** — flag gate, append args, retry/backoff, missing-env, sink registration → verify: `npm run test` green
16. **Extend `decisionMonitoring.test.ts`** — sink invoked per kind, sink exception swallowed → verify: `npm run test` green
17. **Full verify** → `npx tsc --noEmit` (46 exact) · `npm run lint` (0) · `npm run test` (all suites) · `npm run quickbuild` → verify: all green

### Phase 4: Live Check (optional, manual)

> **Status: step 18 NOT RUN — deliberately skipped.** No OAuth consent has been performed, so there is no refresh token, no live credential, and **nothing has been appended to the live Tracker sheet**. The feature is verified by unit tests only. To run it later: `node scripts/dev-checks/google-oauth-consent.mjs` once (prints a Google auth URL) → put the returned refresh token in the local `.env` as `GOOGLE_OAUTH_REFRESH_TOKEN` → set `GOOGLE_SHEETS_TRACKING_ENABLED=true` → **delete the helper script** → trigger one recommendation / swing / screener run on `:3000` and confirm rows land in `daily-rec` / `swing` / `decisions`. Re-running is safe (append-only). A 401 storm after ~7 days means "re-consent" (Google Cloud `External`+`Testing` apps issue 7-day refresh tokens), not a code bug.

18. **Live smoke** (user provides real creds in local `.env`): set flag true → trigger one recommendation run or swing analysis on :3000 → open the Tracker sheet → verify rows appended in `daily-rec`/`swing`/`decisions` → verify: rows present, header row written once, existing tabs untouched

### Phase 5: Documentation

> **Status: steps 19–26 DONE** — `AGENTS.md` v3.42.0 row + latest-version pointer · `.agents/changelog/versions-v3.42.md` detail + `.agents/CHANGELOG.md` index row · `TODO.md` quick-reference block · `Primer.md` (Last Updated + Current Project Status) · `agent-memory.md` activity entry · **Lessons 141 + 142** + `Lessons.md` update log · session memory `decisions.md` + `flow.md` in `.agents/sessions/2026-09-25-google-sheets-tracking/` · `.agents/session-todos.md` + `.agents/handoffs/active/latest.md` resume context.
>
> **Doc-budget gate**: `node scripts/dev-checks/check-doc-sizes.mjs` → **OK, 90.9/100 KB total**, every injected file within the 32 KB per-file cap. Adding the `TODO.md` row had pushed it to 33.1 KB, so the oldest superseded blocks (v3.41.0/1/2, all committed, detail in `versions-v3.41.md`) were archived to `.agents/changelog/todo-quick-reference-archive.md` behind a one-line pointer → 29.3 KB (**Lesson 142**).

19. **AGENTS.md** — version row v3.42.0 → verify: row added
20. **CHANGELOG** — `.agents/changelog/versions-v3.42.md` created + index updated → verify: detail doc exists
21. **TODO.md** — quick-reference row → verify: row added
22. **Primer.md** — current project status → verify: updated
23. **agent-memory.md** — activity entry → verify: added
24. **Lessons.md** — new lesson if pattern/bug discovered → verify: added if applicable
25. **Session memory** — `decisions.md` + `flow.md` in `.agents/sessions/2026-09-25-google-sheets/` → verify: files exist
26. **session-todos.md + handoffs/active/latest.md** — resume context → verify: updated

---

## Integration Walkthrough (for the user — OAuth2 user consent)

1. **Google Cloud Console** → create/select project (e.g. `tradenext-tracker`).
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → OAuth consent screen** → External → add your email as **Test user** (publish or keep testing — test mode is fine for personal use; refresh token valid until app is verified/expired).
4. **APIs & Services → Credentials** → Create credentials → **OAuth client ID** → Application type: **Desktop app** → copy **Client ID** + **Client secret**.
5. **One-time consent (must run once to mint the refresh token)** — e.g. via a tiny throwaway script using `googleapis`' `OAuth2Client` (`generateAuthUrl` with `/auth/spreadsheets` + `getToken(code)`), run locally by the user, then DELETE the script. Result: a **refresh token** (server-side only, never committed; store in Netlify env + local `.env`).
   - Netlify secret note: refresh tokens don't rotate on each use (unlike standard OAuth2 refresh-token rotation when access tokens expire in ~1h; googleapis handles refresh automatically).
6. **Env vars** (Netlify UI → Site → Environment variables, plus local `.env`):
   ```
   GOOGLE_SHEETS_TRACKING_ENABLED=true
   GOOGLE_SHEET_ID=1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ
   GOOGLE_OAUTH_CLIENT_ID=<client-id>
   GOOGLE_OAUTH_CLIENT_SECRET=<client-secret>
   GOOGLE_OAUTH_REFRESH_TOKEN=<refresh-token>
   ```
   ⚠️ Do NOT put the secret/refresh token in `NEXT_PUBLIC_*` or commit anywhere. Sheet stays "viewer" for anonymous — the OAuth user is the sheet owner, so no sharing needed.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| swingRow maps all fields | googleSheetsRows.test.ts | SwingStock → row (nested JSON, null analysis) |
| dailyRecRow maps run+stock | googleSheetsRows.test.ts | Recommendation → row |
| screenerRow includes POC A | googleSheetsRows.test.ts | decisionScore/decisionGate present |
| customScanRow serializes JSON | googleSheetsRows.test.ts | filters/data stringified |
| decisionRow maps all fields | googleSheetsRows.test.ts | TraceEntry → row, gateDistribution JSON |
| Encoders never throw | googleSheetsRows.test.ts | null/undefined → "" |
| Flag off → disabled, no IO | googleSheetsExporter.test.ts | zero googleapis calls |
| Flag on → append args correct | googleSheetsExporter.test.ts | values.append payload |
| Header ensure before append | googleSheetsExporter.test.ts | values.update header on first write |
| 429 → retry once → failed | googleSheetsExporter.test.ts | retry/backoff logic |
| Missing env → failed, no crash | googleSheetsExporter.test.ts | error path |
| Sink invoked per kind | decisionMonitoring.test.ts | registerDecisionTraceSink behavior |
| Sink exception swallowed | decisionMonitoring.test.ts | trackDecisionTrace never throws |

> **As implemented**: the row/exporter cases above live in `googleSheetsTracking.test.ts` (43/43) and the flag/singleton cases in `googleSheetsAuth.test.ts` (13/13); `decisionMonitoring.test.ts` gained 6 cases. See the deviations note near the top.

### E2E — none (no UI; live smoke optional per Phase 4)

---

## Verification Checklist

```bash
npx tsc --noEmit                    # 46 exact (0 new)
npm run test                        # all suites green (new 2 suites + extended)
npm run lint                        # 0
npm run quickbuild                  # all pages build
npm ls googleapis                   # dependency installed
```

**Result (2026-09-25)** — tsc **46 exact (0 new; prod 0/0)** ✅ · `npm run test` **118/118 suites, 1601 pass / 4 skip / 0 fail (+62)** ✅ · `npm run lint` **0 errors** (1155 pre-existing warnings, byte-identical to v3.41.3; **zero in the new files**) ✅ · `npm run quickbuild` **189/189** ✅ · `npm ls googleapis` → **182.0.0** ✅ · E2E **not run (no UI change)**. Three pre-existing high-severity Prisma / `deepmerge-ts` audit findings were left untouched (out of scope).

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| OAuth refresh token expiry (test-mode app, 7-day refresh-token expiry in testing) | Publish the app OR re-run consent periodically; document token lifetime | No — flag off means export silently disabled + `error` log |
| Sheets API rate limits | One batched append per producer-run; no per-row calls | No |
| Sheet schema drift (user edits headers) | Append by column position; never touch existing rows; `warn` only | No |
| Multi-instance cold start races header ensure | Per-process singleton guard; header ensure is idempotent (`values.get` → `update` only on mismatch) | No |
| Export blocking a producer | Strict fire-and-forget, `.catch`, no await in producers | No |
| Secret leak in repo | OAuth creds env-only; `SECRETS_SCAN_OMIT_PATHS` review; never commit `.env` | No |

---

## Documentation Checklist

- [x] **AGENTS.md** — v3.42.0 row (+ latest-version pointer)
- [x] **CHANGELOG** — `.agents/changelog/versions-v3.42.md` + index
- [x] **TODO.md** — quick-reference row
- [x] **Primer.md** — current project status
- [x] **agent-memory.md** — activity log entry
- [x] **Lessons.md** — new lessons (**141** — the export contract; **142** — the doc-budget + CRLF traps found while writing this pass)
- [x] **Session memory** — `decisions.md` + `flow.md`
- [x] **session-todos.md** — current session updated
- [x] **handoffs/active/latest.md** — resume context
- [x] **Plan status** — steps/phase markers + deviations recorded (above); Phase 4 recorded as NOT RUN

> Note: the plan's original `flow.md` location (`.agents/sessions/2026-09-25-google-sheets/`) was implemented as `.agents/sessions/2026-09-25-google-sheets-tracking/`.

---

## Pre-Commit Gate

> **Status: steps 1–4 and 6 already run GREEN as part of Phase 3. Steps 5 and 7 remain to be executed at commit time. The commit itself is PENDING USER APPROVAL — do not auto-commit, push, PR, merge, or deploy.**

1. `npx tsc --noEmit` — 46 exact (0 new) ✅
2. `npm run test` — all pass ✅
3. `npm run lint` — 0 ✅
4. `npm run quickbuild` — passes ✅
5. `git status` — no junk artifacts, no secrets in diff (`.env` untracked) ⬜ run at commit time
6. Documentation updated per checklist ✅
7. Engineering checklist (`.agents/rules/checklist.md`) validated ⬜ run at commit time

**Commit-time reminders**: stage the feature + docs files; **never** commit real OAuth credentials or `.env`; keep `lib/services/laya/weights/` out of the commit; delete `scripts/dev-checks/google-oauth-consent.mjs` only if the user has captured the refresh token.
