# Implementation Plan — Google Sheets Production Env Arming + Verification

> Generated from spec: `.agents/specs/31-google-sheets-prod-env-arming.md`
> Save to `.agents/plans/31-google-sheets-prod-env-arming.md`

## Spec Reference

- **Spec**: `.agents/specs/31-google-sheets-prod-env-arming.md`
- **Branch**: `fix/daily-rec-swing-cron-worker` (base `main` = PR #134 MERGED; Spec 26 at `44156e6`)
- **Created**: 2026-10-11
- **Status**: ⏳ **DRAFT — pending human spec review & approval before implementation (spec-driven gate)**

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step → verify: [check]`

### Phase 1: Status surface (`lib/services/googleSheets/statusService.ts`)

1. **Add `missingEnvVars: string[]` to `SheetsStatus`** — computed from the same `isSet()` checks used for `envEnabled`/`oauthConfigured`; include ONLY missing names of the required set (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_SHEETS_TRACKING_ENABLED`, `GOOGLE_SHEETS_SPREADSHEET_ID` — exact set = what `auth.ts` + config actually read; grep before finalising) → verify: `npx tsc --noEmit` (0 new); status tests.

2. **Never emit values** — only names; add a code comment + test asserting no env value leaks into the payload → verify: test.

### Phase 2: Console guidance (`app/admin/google-sheets/page.tsx`)

3. **In the "not armed" card**: when `envEnabled === false || !oauthConfigured.refreshToken` render each `missingEnvVars` name as a code chip + one-line consent-url note (point to the docs/consent URL — text only, no clickable secret) → verify: page renders chips at 375/768/1440; 0 console errors.

### Phase 3: Verification script (`scripts/google-sheets/verify-prod-env.ts`)

4. **Create the script** (standalone, not imported by app): fetch live `https://tradenext6.netlify.app/api/admin/google-sheets/config` (admin session via `x-api-key` header from env or cookie flag); print presence booleans ONLY (from the same contract); if `trackingEnabled === false` → print missing names + guidance, exit 2; else run ONE append smoke-test row (`metrics` tab, `smoke-test-<ISO>` purpose, via the exporter path) → `appendOk: true/false`; exit 0/1/2. **Never log OAuth values.** → verify: `npx tsx scripts/google-sheets/verify-prod-env.ts` local (unarmed → exit 2 + names); tsc types clean.

5. **If the script embeds no secrets** (it mustn't): confirm `SECRETS_SCAN_OMIT_PATHS` in `netlify.toml` does NOT need a new entry — verify by repo secrets scan (keep `scripts/` scriptable without secrets). If any sample value is unavoidable, add the file to omit paths (documented; prefer env-only).

### Phase 4: Env + docs

6. **`.env.example`**: ensure all 5 GS vars documented with comments + consent-URL note → verify: file lists them.

7. **USER ACTION — set prod env on Netlify** (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_SHEETS_TRACKING_ENABLED=true`, `GOOGLE_SHEETS_SPREADSHEET_ID`) + redeploy. **Agent waits for explicit user confirmation; agent NEVER writes prod env (D9).** → verify: user reports done + deploy green.

### Phase 5: Live verification (post-arming, with user)

8. **Verify live**: status shows `envEnabled:true, trackingEnabled:true, missingEnvVars:[]`; script exit 0 + append row visible on metrics tab; double-check NO secret echoed anywhere → verify: curl + script output + console screenshot.

9. **Re-run Spec 27 async rescan** from the console once armed (regression guard for the queue path under env-on) → verify: task completes (poll via `/api/admin/workers?taskId=`).

### Phase 6: Docs

10. **`.agents/changelog/versions-v3.49.md`** — Spec 31 detail (env inventory, verification evidence) → verify: file exists, indexed.
11. **AGENTS.md** — version row (32 KB cap watch, Lesson 142 — defer into changelog if capped) → verify: row added or deferral noted.
12. **TODO.md / Primer.md / agent-memory.md** — status + activity entries → verify: each updated.
13. **Lessons.md** — add if reusable pattern (env-arming verification without secret echo) → verify: entry appended.
14. **Session memory** — `.agents/sessions/2026-10-11-recs-live-analysis/` updates → verify: files reflect Spec 31.
15. **`.agents/session-todos.md` + `.agents/handoffs/active/latest.md`** → verify: updated.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `missingEnvVars` lists missing names when env unset | `googleSheetsStatus.test.ts` | Core addition |
| `[]` when all five env vars set | `googleSheetsStatus.test.ts` | Armed case |
| Partial OAuth → only missing names listed | `googleSheetsStatus.test.ts` | Precision |
| No env VALUE leaks into payload (names only) | `googleSheetsStatus.test.ts` | Secret hygiene |
| Existing env/oauth booleans unchanged | `googleSheetsStatus.test.ts` | No regression |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `verify-prod-env.ts` local unarmed → exit 2 + names (no secrets) | Script behavior |
| Post-arming script → exit 0 + `appendOk:true` | Live verification (user-triggered) |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Existing `e2e/google-sheets*.spec.ts` still green | Console contract unchanged |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking (baseline: 46 error lines, prod 0)
npx tsc --noEmit

# Tests — RUN ALONE, never chained with ';'
npm run test -- googleSheetsStatus
npm run test            # full suite

npm run lint

# Script (local, unarmed — expect exit 2 + missing names, no secrets)
npx tsx scripts/google-sheets/verify-prod-env.ts

# Hygiene
git status        # no junk (*.yaml, screenshots, dev-server.log), no secrets
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Netlify secrets scan trips on the script | Script env-only — no hardcoded values required; add omit-path only if genuinely needed | No |
| Refresh-token expiry after inactivity | Consent guidance surfaced in console; docs note re-consent | No |
| Env set but sheet-id mismatch | Script prints masked id for cross-check | No |
| Redeploy required after env change | User owns deploy step (D9); documented | No |
| Smoke row pollutes metrics tab | Single row, clear `smoke-test-` purpose; metrics tab is per-run stats (safe) | No |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row (or documented deferral at 32 KB cap, Lesson 142)
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.49.md` + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit. **Commit only on explicit user request; merge/deploy user-only (D9).**

1. `npx tsc --noEmit` — 0 new errors (baseline 46)
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated