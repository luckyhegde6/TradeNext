# Spec Document — 31: Google Sheets Production Env Arming + Verification

> Spec 31 of branch `fix/daily-rec-swing-cron-worker` (targets v3.49.0). This is fix candidate **#4 (Sheets)** from the 2026-10-11 recommendations live analysis.

## 1. Overview

**What**: Complete the Google Sheets tracking arming in **production** so the Spec 19–27 stack (env-gated export, admin console, async rescan) works live: set the missing environment variables on Netlify, verify the console status transitions from "env missing" to "tracking on", and confirm a real append + the Spec 27 async rescan path end-to-end.

**Why**: Live analysis + status service show prod is missing the OAuth refresh token (`GOOGLE_OAUTH_REFRESH_TOKEN`) and the master switch (`GOOGLE_SHEETS_TRACKING_ENABLED !== "true"`). `statusService.getStatus()` reports `oauthConfigured.refreshToken: false` / `envEnabled: false`, so `trackingEnabled: false` — no rows are ever appended. The code is DONE (Specs 19–27 in `main`/PR #135); only the environment blocks it. This spec is primarily **env + verification** with a small **test-only** harness addition.

**Scope**:
- **IN**: (1) inventory of the exact env vars the stack reads (`lib/services/googleSheets/auth.ts`); (2) the Netlify env upsert procedure (admin/user action — D9: agent does NOT touch prod env without explicit user approval; this spec documents + verifies, the USER performs the actual set via Netlify UI; if a `DEPLOY_GUARD`-style token flow exists it is NOT reused here — this is plain env config); (3) a verification script (`scripts/google-sheets/verify-prod-env.ts`) that calls the LIVE status endpoint + a real append smoke-test (gated by the same guards, fail-open, NO secrets logged); (4) updated console guidance so the "env missing" state shows exactly which var and the consent URL is discoverable.
- **OUT**: Changing export logic; fixing the async rescan (verified live already); OAuth credential rotation; any new spreadsheet creation (ops uses existing spreadsheet id `sheetId` from the console config / `GOOGLE_SHEETS_SPREADSHEET_ID`).

**Depends on**: Env vars must exist BEFORE this spec is exercised live: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_SHEETS_TRACKING_ENABLED=true`, `GOOGLE_SHEETS_SPREADSHEET_ID` (the tracker spreadsheet). `lib/services/googleSheets/auth.ts`, `statusService.ts`, `exporter.ts`, `app/api/admin/google-sheets/*` (Spec 20/27).

---

## 2. Routes

### Modified Routes
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/google-sheets/config` | (already returns config; no change unless we add `envHints` — see §4C) |
| GET | `/api/admin/google-sheets` (console) | No route change; the console already renders `statusService.getStatus()` — the UI just flips from "missing" to "tracking on" once env is set |

No new routes (verification is a script, not an HTTP endpoint — keeps the admin surface stable).

---

## 3. Database Schema

### A. New Model: `None`

No schema change.

### B. Modifications to Existing Models

None.

### C. Migration Notes

N/A.

---

## 4. Functions to Implement

### A. `scripts/google-sheets/verify-prod-env.ts` (NEW — standalone script, not imported by app)

- **Purpose**: verify prod env arming WITHOUT exposing secrets.
- Flow:
  1. `fetch("https://tradenext6.netlify.app/api/admin/google-sheets/config")` — requires admin session; if 401, print "run with admin cookie/`x-api-key`" and exit 1 (fail-closed: do not bypass auth).
  2. Print booleans using the SAME contract as `statusService` (never echo values): `envEnabled`, `dbConfigured`, `oauthConfigured.{clientId,clientSecret,refreshToken}`, `trackingEnabled`, `sheetIdMasked`.
  3. If `trackingEnabled === false` → print the MISSING var names from the payload (the status service already reports them as booleans; the script maps `refreshToken:false` → "GOOGLE_OAUTH_REFRESH_TOKEN is missing") and exit 2.
  4. If `trackingEnabled === true` → run the append smoke test: build ONE `smoke-test-<ISO>` row for the `metrics` tab via the same exporter path (the least-destructive tab — metrics is per-run stats, one added row is safe) and print `appendOk: true/false`.
  5. Never logs OAuth values; uses `logger`-style console only for the *presence* booleans.
- Exit codes: 0 = armed + smoke append ok; 1 = auth/network; 2 = env missing (with guidance).

### B. `lib/services/googleSheets/statusService.ts` (MODIFIED — additive, no behavior change)

- Add `missingEnvVars: string[]` to `SheetsStatus` — computed from the same `isSet()` checks, listing ONLY the names of missing required vars (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_SHEETS_TRACKING_ENABLED`, `GOOGLE_SHEETS_SPREADSHEET_ID` as required by `auth.ts` + config). This lets the console render "Missing: GOOGLE_OAUTH_REFRESH_TOKEN" instead of three opaque booleans.
- **Never** includes values; only names.

### C. `app/admin/google-sheets/page.tsx` (MODIFIED — display only)

- In the "Not armed" card, when `envEnabled === false || oauthConfigured.refreshToken === false`: list each missing var from `missingEnvVars` with a code chip, and render the OAuth consent-URL guidance text (short, points to the docs/existing consent URL) so an admin can self-serve instead of hunting.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `scripts/google-sheets/verify-prod-env.ts` | **Created** | Prod verification + smoke append |
| `lib/services/googleSheets/statusService.ts` | Modified | Add `missingEnvVars: string[]` |
| `app/admin/google-sheets/page.tsx` | Modified | Armed-state card lists missing vars + consent guidance |
| `lib/__tests__/googleSheetsStatus.test.ts` | Modified | `missingEnvVars` assertions |
| `.env.example` | Modified | Document the 5 GS vars with comments (already partially there — ensure all 5 present + consent URL note) |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/googleSheets/auth.ts` | `isTrackingEnabled`, `getOAuth2Client` | Guard + smoke |
| `@/lib/services/googleSheets/statusService.ts` | `getStatus` | Verify booleans |
| `@/lib/services/googleSheets/exporter.ts` | append path | Smoke append |
| `@/lib/logger` | logger | Script logging (no secrets) |

---

## 7. API Contract

### GET /api/admin/google-sheets/config (unchanged)

```json
{
  "success": true,
  "config": { "sheetIdMasked": "1AbC…XyZ", "displayName": "…", "enabled": true, "lastSyncAt": "…", "tabMarks": { … } }
}
```

### `SheetsStatus` addition
```json
{
  "envEnabled": true,
  "oauthConfigured": { "clientId": true, "clientSecret": true, "refreshToken": true },
  "missingEnvVars": [],
  "trackingEnabled": true,
  "perTab": [ … ]
}
```

(When unarmed: `"missingEnvVars": ["GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_SHEETS_TRACKING_ENABLED"]`.)

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Armed-state card (modified) | `app/admin/google-sheets/page.tsx` | Missing-var chips + consent guidance |

### States
- **Armed** (envEnabled + refreshToken + sheetId): existing "tracking on" — now with zero `missingEnvVars`, no extra text
- **Unarmed**: lists `missingEnvVars` chips + one-line consent URL note
- **Partial** (some OAuth vars missing): lists only the missing names

### Responsive / Dark mode: chips stack inline; inherits card styles.

---

## 9. Rules & Guardrails

- [ ] NEVER log/echo OAuth values or refresh token — booleans + names ONLY
- [ ] Verification script does NOT bypass auth (admin session/x-api-key required)
- [ ] Smoke append is gated by the same guards (env + config + sheetId) — a failed append is fail-open `appendOk:false` with error text, never a throw
- [ ] Prod env is set by the USER via Netlify (D9: agent never writes prod env)
- [ ] `missingEnvVars` only ever contains var NAMES
- [ ] Additive contract — no breaking status change

---

## 10. Expected Behavior

1. With prod env missing refresh token + master switch: `getStatus()` returns `envEnabled:false`, `oauthConfigured.refreshToken:false`, `missingEnvVars:["GOOGLE_SHEETS_TRACKING_ENABLED","GOOGLE_OAUTH_REFRESH_TOKEN"]`, `trackingEnabled:false`.
2. Console armed-state card renders the missing-var chips + consent guidance; no secrets shown.
3. `verify-prod-env.ts` against a non-armed prod exits 2, prints the missing var names and guidance.
4. After USER sets all 5 vars + redeploys: `verify-prod-env.ts` exits 0; status shows `envEnabled:true, trackingEnabled:true, missingEnvVars:[]`; smoke append row lands on the metrics tab.
5. Spec 27 async rescan from the console still completes (already live-verified — re-run once armed to confirm env doesn't regress the queue path).
6. Full Jest suite green; no regression in `googleSheetsStatus.test.ts` (new `missingEnvVars` cases) or auth tests.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Status read fails | `getStatus` never throws (existing) — keep | `warn` in script |
| `verify-prod-env.ts` network/auth fail | exit 1 with helpful text | script |
| Smoke append fails (Sheets 4xx/5xx) | `appendOk:false` + sanitized error (no OAuth values), exit 2 | script |
| Env partially set | `missingEnvVars` lists exactly the missing names | — |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/googleSheetsStatus.test.ts`)

- [ ] `missingEnvVars` contains the missing names when env unset
- [ ] `missingEnvVars` is `[]` when all five env vars set
- [ ] Partial OAuth (clientId set, refreshToken unset) → `missingEnvVars` includes only the missing
- [ ] Existing env/oauth booleans unchanged (regression guard)

### Script Verification (manual/live, not Jest)

- [ ] Against local dev with env unset → exit 2 + names
- [ ] (After user arming) against prod → exit 0 + append

### E2E

- [ ] Existing `e2e/google-sheets*.spec.ts` (Spec 20/27 suite) still passes (console renders — route contracts unchanged)

---

## 13. Performance Considerations

- One status read + one smoke append per script run — negligible
- No changes to hot paths

---

## 14. Security Considerations

- **Secrets**: the single most sensitive part of this spec — every output path (status payload, missingEnvVars, script stdout) carries NAMES/booleans only. Review each log line for accidental value echo.
- **Auth**: script requires admin session/API key; console card is admin-only (page route is admin-gated).
- **Audit**: smoke append flows through the existing export audit tags (no new tag needed; if desired add `GS_SMOKE_APPEND` — decide at implementation, default: reuse existing append audit with `purpose:"smoke"` metadata).

---

## 15. Definition of Done

- [ ] `missingEnvVars` added to `SheetsStatus` + tests
- [ ] Console card lists missing vars + consent guidance
- [ ] `scripts/google-sheets/verify-prod-env.ts` created with exit codes 0/1/2 + no-secret guarantee
- [ ] `.env.example` documents all 5 GS vars + consent URL
- [ ] `npx tsc --noEmit` 0 new; `npm run lint` 0
- [ ] Full Jest suite green
- [ ] **USER ACTION**: set the 5 prod env vars on Netlify + redeploy; agent waits for explicit confirmation
- [ ] Post-arming live-verify: status `trackingEnabled:true, missingEnvVars:[]`, script exit 0, append row on metrics tab, async rescan re-run
- [ ] Docs updated (AGENTS.md, CHANGELOG, Todo-ref, Primer, agent-memory, session docs, session-todos)

---

## 16. Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Netlify build fails on secrets scan if a test/script hardcodes OAuth | Script reads from env only; ADD `scripts/google-sheets/` to `SECRETS_SCAN_OMIT_PATHS` if it ever embeds sample values (it mustn't) | No |
| Refresh token expiry (Google 7-day inactive rotation) | Spec documents re-consent URL; console guidance points to it | No |
| Env set but sheet id mismatch | `verify-prod-env.ts` prints masked id from live config for cross-check | No |
| Prod env change requires redeploy | Documented in steps; D9 — user owns | No |