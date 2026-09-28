# Spec Document — Google Sheets Admin Console (connection, sync, metrics, auth)

> Status: **DRAFT — awaiting human approval.** No implementation started.
> Supersedes nothing. Builds directly on Spec 19 (`19-google-sheets-tracking.md`, commit `a6e4e6e`).
> Reference app: `https://ais-dev-…run.app/` — **NOT reachable by the agent** (Google-auth-walled);
> this spec is derived from the user-supplied feature prompt + the real TradeNext codebase.

---

## 1. Overview

**What**: Adds a user-facing **admin console** for the Spec 19 Google Sheets Tracker, plus the
missing auth/persistence plumbing to drive it: a persisted sheet link (Prisma + SQLite mirror),
a per-tab high-water-mark "Sync now", a 5th `Performance & Metrics` tab, 1-click sheet creation,
an in-app OAuth consent callback with encrypted token storage, and Google Sign-In as a login method.

**Why**: Spec 19 shipped **headless** — verified by inspection: zero pages, zero components, zero
API routes reference `googleSheets`. It is armed by 5 env vars and mints its refresh token via a
throwaway local script. An operator cannot see whether it works, cannot point it at their sheet
without editing env, and cannot trigger or inspect a sync. The reference app demonstrates the UX
gap (link a sheet, Quick Sync, per-tab status).

**Scope — IN**
1. Admin tab: Sheets status, per-tab health, sheet link CRUD, "Sync now" (all / per tab).
2. `GoogleSheetsConfig` singleton in Prisma + SQLite mirror.
3. 5th `Performance & Metrics` tab (append-only KPI rows, aggregated from existing data).
4. OAuth consent **callback route** + AES-256-GCM secret layer + `Secret`-model token storage.
5. 1-click sheet creation via Drive API (`drive.file` scope).
6. Google Sign-In as an additional NextAuth provider.

**Scope — OUT**
- Any **two-way / read-back** sync. Spec 19's append-only invariant (Lesson 141) is preserved.
  The reference prompt asks for two-way + overwrite; that is **explicitly rejected** here.
- Editing/clearing existing sheet rows. No bulk overwrite, no row deletion, ever.
- Per-*user* sheets. The tracker is a single operator-owned sheet (one config row).
- Folding the reference app's 5 scanners / trade journal / charts — all already exist in TradeNext
  and are strictly more capable (98 TradingView + 117 Chartink templates, `SwingSignal` model,
  `NSEStockChart`, Laya decision engine).

**Depends on**: Spec 19 (`a6e4e6e`) — `lib/services/googleSheets/{auth,tabs,rows,exporter}.ts`.

---

## 2. Phasing (mandatory — do not merge phases)

Each phase is independently reviewable and revertible. Phase 1 delivers the majority of the
user-visible value at the lowest risk.

| Phase | Scope | Risk | Depends on |
|-------|-------|------|------------|
| **1** | Config model + migration + SQLite mirror + admin tab + status + **Sync now** (high-water mark) | Low | — |
| **2** | AES-256-GCM secret layer + `Secret` token storage + OAuth callback route | **High** (secrets) | 1 |
| **3** | `drive.file` scope + 1-click sheet creation | Medium (scope increase) | 2 |
| **4** | Google Sign-In provider | **Highest** (auth) | 1 |

**Phase 3 forces a re-consent** for any existing token: a token minted under the Phase-2
sheets-only scope cannot create spreadsheets. This is a breaking operational change and must be
called out in `.env.example` + release notes.

---

## 3. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/google-sheets/status` | admin | Env/config status (booleans only), per-tab header state, last sync marks |
| PUT | `/api/admin/google-sheets/config` | admin | Set/clear `sheetId`, `displayName` |
| POST | `/api/admin/google-sheets/sync` | admin | `Sync now` — body `{ tab?: TrackerTab }`, defaults to all |
| GET | `/api/auth/google/callback` | public | OAuth consent callback (Phase 2) |
| POST | `/api/admin/google-sheets/create-sheet` | admin | 1-click spreadsheet creation (Phase 3) |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| — | `app/admin/layout.tsx` | one `navItems` entry (array at lines 9–35) |

### New Pages

| Path | Phase | Purpose |
|------|-------|---------|
| `/admin/google-sheets` | 1 | Console UI |

---

## 4. Database Schema

### A. New Model: `GoogleSheetsConfig` (Phase 1)

```prisma
model GoogleSheetsConfig {
  id           String    @id @default("singleton") // exactly one row; no userId
  sheetId      String?                            // plaintext — a sheet ID is not a secret
  displayName  String?
  enabled      Boolean   @default(false)          // UI switch; env flag remains the master gate
  lastSyncAt   DateTime?                         // coarse, all-tabs
  tabMarks     Json?                             // { "swing": "ISO", "daily-rec": … } high-water marks
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@map("google_sheets_config")
}
```

`tabMarks` is a `Json` map (not a child table) — it is small, read on every export, and avoids a
second migration. Phase 1 migration: `add_google_sheets_config`.

### B. Modifications to Existing Models

```prisma
// Phase 4 only — User model
model User {
  // ... existing fields ...
  googleSub String? @unique   // Google's stable user id; NULL for credentials-only users
  avatarUrl String?
}
```

**No adapter tables.** With `strategy: "jwt"` and no `@auth/prisma-adapter`, we deliberately do
**not** add `Account`/`Session`/`VerificationToken`. Google sign-in is handled by manual upsert
(§4.F) — a smaller, auditable surface than a full adapter.

### C. Migration Notes

- `prisma migrate dev --name add_google_sheets_config` (dev) / `migrate deploy` (prod).
- ⚠️ Per template: if the local DB lacks a `_prisma_migrations` ledger, use
  `migrate diff --to-schema-datamodel` + `db execute` instead.
- SQLite mirror: the new table must be added to the mirror's schema-creation + table list in
  `lib/sqlite.ts`, or the mirror silently diverges. **This is the most commonly missed step.**
- ⚠️ The repo is under a **P6003 plan-limit hold until 2026-10-02** (per `AGENTS.md` v3.40.3).
  DDL is normally not metered, but the migration must be applied to the *remote* DB with care.

---

## 5. Functions to Implement

### A. `lib/services/googleSheets/configService.ts` (Phase 1)

- `getConfig(): Promise<GoogleSheetsConfig>` — singleton read; returns defaults if row absent (never throws).
- `setSheetId(sheetId: string | null): Promise<GoogleSheetsConfig>` — validates via Zod (Google sheet-ID shape `/^[A-Za-z0-9-_]{20,}$/`), mirrors to SQLite, audits `GOOGLE_SHEETS_CONFIG_UPDATED`.
- `getTabMark(tab: TrackerTab): Promise<string | null>` / `setTabMark(tab, iso)`.
- Resolver: `resolveSheetId(): Promise<string | null>` — **DB first, env fallback** (`GOOGLE_SHEET_ID`), so Spec 19's env-only deployment keeps working byte-identically.

### B. `lib/services/googleSheets/syncService.ts` (Phase 1) — the "Sync now" core

**The design problem this solves**: Spec 19's exporters take *live domain objects*
(`exportSwing(SwingStock[])`, `exportDailyRecs`, `exportScreeners`, `exportCustomScan`,
`exportDecision`). There is no "sync everything" entry point and **no per-row ledger**. A naive
`Sync now` that re-queries recent rows would **re-append every historical row as duplicates**.

**Chosen approach — per-tab high-water mark** (matches the reference app's "clear sync timestamps"):

- `syncTab(tab: TrackerTab): Promise<{ tab: TrackerTab; appended: number; skipped: boolean; reason?: string }>`
  1. `ensureHeaders(tab)` (reuses Spec 19 guard — never rewrites a user header).
  2. Read `tabMarks[tab]`; query rows with `createdAt > mark`, `orderBy: createdAt asc`, capped (200/tab/sync).
  3. Encode via `rows.ts` (`swingRow` / `dailyRecRow` / `screenerRow` / `customScanRow` / `decisionRow`).
  4. `exportRows(tab, rows)` — the existing generic append (one batched `values.append`).
  5. Advance the mark **only on `ExportResult === "enabled"`**; on `"disabled"`/`"failed"` leave it (so the next sync retries).
- `syncAll(): Promise<SyncTabResult[]>` — sequential, **not** `Promise.all` (avoids N concurrent Sheets calls against quota/rate limits).
- `decisions` tab is **excluded from backfill** — the trace ring buffer holds only the last 500
  in-memory entries and is not queryable history. Backfilling it would fabricate rows.

### C. `lib/services/googleSheets/statusService.ts` (Phase 1)

- `getStatus(): Promise<SheetsStatus>` — **booleans/enums only, never secret values**:
  `{ envEnabled, dbConfigured, sheetIdMasked, oauthConfigured: { clientId, clientSecret, refreshToken }, trackingEnabled, perTab: [{ tab, headerState: "matched"|"drifted"|"absent"|"unknown", lastMark }] }`
- `sheetIdMasked` — e.g. `1AbC…XyZ` (last 4). Full ID is not secret but is not echoed to logs.

### D. `lib/services/crypto/secretBox.ts` (Phase 2)

**Currently there is NO encryption implementation** — verified: `grep createCipheriv|prisma.secret`
across `lib/` and `app/` returns nothing. The `Secret` model's `// Encrypted value (AES-256-GCM)`
comment is an unimplemented promise.

- `encrypt(plaintext: string): Promise<{ value: string; hint?: string }>` — AES-256-GCM, random 12-byte IV, auth tag appended, output `v1:iv:tag:ciphertext` (base64url). Key from `SECRETS_ENCRYPTION_KEY` (32 bytes, base64).
- `decrypt(payload: string): Promise<string>` — throws on tag mismatch (tamper-evident).
- `isEncrypted(value: string): boolean` — version-prefix check for migration safety.
- Never logs plaintext or ciphertext. Never returns plaintext to a client.

### E. `lib/services/googleSheets/oauthCallback.ts` (Phase 2)

- `buildConsentUrl(state: string): string` — `access_type=offline`, `prompt=consent`, scopes
  `GOOGLE_SCOPES` (+ `drive.file` in Phase 3), `redirect_uri` = the app's own origin + `/api/auth/google/callback`.
- `handleCallback(code: string, state: string): Promise<{ ok: boolean; hint: string }>`
  - **CSRF**: `state` must be a signed, short-lived, single-use value bound to the admin session
    (HMAC over session id + nonce, nonce stored server-side or in a signed httpOnly cookie).
  - Exchanges `code` → tokens; encrypts `refresh_token` via `secretBox`; upserts `Secret`
    (`name: "google_oauth_refresh_token"`), stores `hint` (e.g. `…abcd`).
  - **Never** returns the token to the browser.
- Requires `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in env (client secret stays server-side).

### F. `lib/services/googleSheets/drive.ts` (Phase 3)

- `createTrackerSpreadsheet(): Promise<{ spreadsheetId: string; url: string }>` — `drive.spreadsheets.create` with the 5 tab names + frozen header row, via a **dynamic** `import("googleapis")` (keeps the CJS SDK out of the build graph, mirroring Spec 19).
- Audits `GOOGLE_SHEETS_SPREADSHEET_CREATED`. Returns the URL for the UI's "open in Docs" link.

### G. Google sign-in (Phase 4) — `lib/auth.ts` modifications

- Add `Google({ clientId, clientSecret, authorization: { params: { scope: "openid email profile" } } })` to `providers`, reading creds from env.
- **`authorize`/upsert policy (the security-critical part)** — in the `jwt` callback or a `signIn` event, when `account.provider === "google"`:
  1. If `email_verified !== true` → reject (log + audit). Never trust an unverified Google email.
  2. If a `User` exists with that email → **link** by setting `googleSub` (do **not** create a duplicate, do **not** reset the password).
  3. Else → **do NOT create a live `User`.** Create a pending `JoinRequest` carrying the Google
     identity (`email`, `name`, `googleSub`, `avatarUrl`) and require **admin approval**, exactly
     as the existing email signup flow does. *(Human decision, 2026-09-26: the Google path must
     NOT bypass the join-request approval gate.)* A Google user without an approved `User` row
     cannot sign in — they see "awaiting admin approval".
  4. **Block auto-admin**: a Google user never gets `role: "admin"` from their Google profile, and
     an approved Google user is always `role: "user"`. Admin is assigned manually.
  5. On approval, the `JoinRequest → User` promotion must carry `googleSub` across so the next
     sign-in links instead of creating a second `JoinRequest`.
- ⚠️ **Existing bug to fix for this to be safe**: the `jwt` callback does
  `createUserSession({ userId: parseInt(user.id, 10) })`. A Google user's `sub` is a **string**
  (`"0a1b2c3d4e5f…"`), so `parseInt` yields the wrong id. Because we upsert a real numeric `User.id`
  and return that, the existing parse stays valid — **this is a hard requirement, not optional.**

---

## 6. Files to Change

| File | Change | Phase |
|------|--------|-------|
| `prisma/schema.prisma` | **Created** `GoogleSheetsConfig`; `User.googleSub`/`avatarUrl` | 1 / 4 |
| `lib/services/googleSheets/configService.ts` | **Created** | 1 |
| `lib/services/googleSheets/syncService.ts` | **Created** | 1 |
| `lib/services/googleSheets/statusService.ts` | **Created** | 1 |
| `lib/services/googleSheets/rows.ts` | Modified — add `metricsRow` (5th tab) | 1 |
| `lib/services/googleSheets/tabs.ts` | Modified — add `"metrics"` to `TrackerTab` + `TRACKER_TABS` | 1 |
| `lib/services/googleSheets/auth.ts` | Modified — DB-then-env sheet resolution | 1 |
| `lib/sqlite.ts` | Modified — mirror the new table | 1 |
| `app/api/admin/google-sheets/{status,config,sync}/route.ts` | **Created** | 1 |
| `app/admin/google-sheets/page.tsx` | **Created** | 1 |
| `app/admin/layout.tsx` | Modified — `navItems` entry | 1 |
| `lib/services/googleSheets/metricsService.ts` | **Created** — KPI aggregation | 1 |
| `lib/services/crypto/secretBox.ts` | **Created** | 2 |
| `app/api/auth/google/callback/route.ts` | **Created** | 2 |
| `lib/services/googleSheets/drive.ts` | **Created** | 3 |
| `app/api/admin/google-sheets/create-sheet/route.ts` | **Created** | 3 |
| `lib/auth.ts` | Modified — `Google` provider + upsert policy | 4 |
| `app/api/openapi/route.ts` | Modified — document the 5 routes | 1–3 |
| `lib/audit.ts` | Modified — new audit tags | 1–3 |
| `.env.example` | Modified — `SECRETS_ENCRYPTION_KEY`, `GOOGLE_LOGIN_ALLOWED_DOMAINS`, `drive.file` note | 1–4 |
| `lib/__tests__/googleSheets{Config,Sync,Status,Metrics}.test.ts` | **Created** | 1 |
| `lib/__tests__/secretBox.test.ts` | **Created** | 2 |
| `e2e/admin-google-sheets.spec.ts` | **Created** | 1 |

---

## 7. Dependencies

| Package | Version | Reason | Phase |
|---------|---------|--------|-------|
| `googleapis` | **already installed** (Spec 19) | Sheets + Drive | 1–3 |
| — | — | Google sign-in uses the **native** `next-auth/providers/google`; **no** `@auth/prisma-adapter` (see §5.G) | 4 |

---

## 8. API Contract

### GET `/api/admin/google-sheets/status`
```json
{ "success": true, "data": {
  "envEnabled": true, "dbConfigured": true, "sheetIdMasked": "1AbC…XyZ",
  "oauthConfigured": { "clientId": true, "clientSecret": true, "refreshToken": false },
  "trackingEnabled": true,
  "perTab": [{ "tab": "swing", "headerState": "matched", "lastMark": "2026-09-25T10:00:00.000Z" }]
} }
```
`400` on failure. **Never** returns a secret value — booleans only.

### PUT `/api/admin/google-sheets/config`
Body: `{ "sheetId": "1AbC…", "displayName": "My Tracker", "enabled": true }` (Zod-validated; `sheetId: null` clears).
`200` `{ "success": true, "data": { …config } }` · `400` Zod · `401` non-admin.

### POST `/api/admin/google-sheets/sync`
Body: `{ "tab": "swing" }` (optional — omit for all).
```json
{ "success": true, "data": { "results": [
  { "tab": "swing", "appended": 42, "skipped": false },
  { "tab": "decisions", "appended": 0, "skipped": true, "reason": "backfill_unsupported" }
] } }
```

---

## 9. UI/UX Requirements

`/admin/google-sheets` (client component, mirrors `app/admin/decision/page.tsx` structure):

- **Status panel** — 5 env/config rows, green/amber/red dots, **no values shown**, copy-to-clipboard for the *names* only.
- **Sheet link card** — input + "Link existing sheet" + "Create new sheet" (Phase 3) + "Open in Google Docs" external link.
- **Per-tab table** — tab name, header state badge, last-synced-at, row count, "Sync" button.
- **Sync now** — global button + per-tab; disabled while in flight; shows per-tab result; **confirm dialog** if any single sync would append > 100 rows.
- **Performance & Metrics preview** — computed KPIs, read-only, with a "Append KPI snapshot" action (append-only, never clears).

States: loading (skeleton) · empty ("Not linked yet") · error (message + Retry) · data.
Responsive 375 / 768 / 1440; dark mode via existing `dark:` tokens. Follow the Lesson-136/139 browser
quirks: desktop ≥1280 for `hidden xl:flex` nav; never assert live NSE values.

---

## 10. Rules & Guardrails

- [x] **Append-only is inviolable.** No read-modify-write, no `values.clear`, no `batchUpdate` of user ranges, no row deletion — ever (Lesson 141).
- [x] A user-customised header is **never** rewritten; on drift, warn + append by position.
- [x] No Prisma in client components; all DB access server-side.
- [x] All inputs Zod-validated.
- [x] Secrets never in client, never in logs, never in `NEXT_PUBLIC_*`.
- [x] `logger` only, no `console.log`.
- [x] Admin routes: `auth()` + `role === "admin"` + `runtime = "nodejs"`.
- [x] Audit every state-changing operation.
- [x] Spec 19's `GOOGLE_SHEETS_TRACKING_ENABLED === "true"` exact-string gate remains the master switch — the DB `enabled` flag can only be **more restrictive** (it can turn off; it cannot bypass the env gate).
- [x] Fire-and-forget for producer paths (unchanged); only the *manual* sync route awaits.
- [ ] ⚠️ **TODO/hygiene**: any test fixture with credential-shaped strings must be added to `SECRETS_SCAN_OMIT_PATHS` in `netlify.toml` (precedent: `lib/__tests__/predeployPreserveRoute.test.ts` ships un-omitted, so this is usually unnecessary — verify per file).

---

## 11. Expected Behavior

1. Flag off → status reports `trackingEnabled: false`; `Sync now` returns `skipped: true, reason: "disabled"` and makes **zero** network calls.
2. `Sync now` twice in a row with no new rows → second call appends 0 and does not advance/rewind the mark.
3. `Sync now` with a header-drifted tab → appends by position, header untouched, warning logged.
4. A sync interrupted mid-flight leaves the mark unchanged → next sync re-queries and appends (no silent data loss; at-least-once).
5. Sheet ID of invalid shape → `400`, row unchanged.
6. `decisions` tab is never backfilled.
7. Phase 2: callback with a mismatched/replayed `state` → `400`, no token written.
8. Phase 4: Google sign-in with `email_verified: false` → rejected.
9. Phase 4: Google sign-in never yields `role: "admin"`.
10. A user who already has a credentials account signs in with the same Google email → one account, original password still works.

---

## 12. Error Handling

| Scenario | Behavior | Level |
|----------|----------|-------|
| Sheets API 401/429/5xx | existing 1 s retry, then `"failed"`, mark **not** advanced | `warn` |
| OAuth env incomplete | status shows booleans; sync `skipped:"not_configured"` | `warn` |
| `drive.file` missing from token (Phase 3) | explicit "re-consent required" message | `warn` |
| Callback `state` mismatch | `400`, no DB write | `warn` |
| Decrypt auth-tag mismatch | `error`, refuse to proceed, never log the payload | `error` |
| Prisma unavailable (P6003 hold) | SQLite-mirror read; config write rejected with a clear message — **never** silently no-op | `error` |

---

## 13. Test Strategy

- **`googleSheetsConfig.test.ts`** — Zod validation, singleton defaults, DB-then-env resolution, mirror write.
- **`googleSheetsSync.test.ts`** — mark advance only on `"enabled"`; no duplicate append on re-run; 200-row cap; sequential `syncAll`; `decisions` skipped; disabled-flag zero-network.
- **`googleSheetsStatus.test.ts`** — no secret value ever appears in the payload (assert absence of the literal).
- **`googleSheetsMetrics.test.ts`** — KPI aggregation math (win rate, net P&L, counts).
- **`secretBox.test.ts`** — round-trip; **tamper detection** (flip a byte → throws); wrong key → throws; version prefix.
- **`googleAuthLinking.test.ts`** (Phase 4) — unverified email rejected; existing-user link; new user `role:"user"`; never admin.
- **E2E** `e2e/admin-google-sheets.spec.ts` — admin tab renders, non-admin gets 401, link + sync round-trip against a **mocked** Sheets client (no live Google calls in CI).

---

## 14. Security Considerations

- **Token at rest** (Phase 2): AES-256-GCM, key from `SECRETS_ENCRYPTION_KEY`. **Key loss = token loss** (re-consent required) — document it. Never log ciphertext.
- **CSRF on the callback** (Phase 2): signed, single-use, session-bound `state`. A missing/weak `state` is a token-theft vulnerability.
- **Account linking** (Phase 4): require `email_verified`; never auto-admin; new users are routed
  to a pending `JoinRequest` and **cannot sign in until an admin approves** — the Google path does
  not weaken the existing provisioning gate. `GOOGLE_LOGIN_ALLOWED_DOMAINS` remains available as an
  extra allowlist.
- **Scope creep** (Phase 3): `drive.file` grants access to files the app creates/opens. Justify in the consent screen text; it is broader than `spreadsheets`.
- **Rate/quota**: `syncAll` is sequential with a per-tab cap; a runaway sync could burn the Sheets quota — cap total rows per invocation.
- The sheet **ID** is not secret, but the admin UI still masks it in output to avoid leaking into screenshots/logs.

---

## 15. Definition of Done (per phase)

- [ ] Spec + plan approved by human; branch created from `main`/`a6e4e6e`
- [ ] Migration applied + `npx prisma generate` + SQLite mirror table added
- [ ] `node scripts/dev-checks/check-tsc-baseline.mjs` — 0 **new** errors
- [ ] `npm run lint` — 0 errors
- [ ] `npm run test` — all suites green (run **alone**; never chained with `;` on Windows)
- [ ] `npm run quickbuild` — page count ≥ 189, 0 new warnings
- [ ] OpenAPI documents every new route
- [ ] Audit tags present for all state-changing ops
- [ ] UI: loading/empty/error/data states; 375/768/1440; dark mode; 0 console errors
- [ ] Playwright verified on `:3000` (dev server started and stopped by the agent; **never** kill port 4096)
- [ ] Docs updated: `AGENTS.md`, `.agents/CHANGELOG.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `Lessons.md`, handoff, session `decisions.md`+`flow.md`
- [ ] `node scripts/dev-checks/check-doc-sizes.mjs` green (budget 100 KB; currently 90.2)
- [ ] `.env.example` documents every new var
- [ ] No secrets/junk in `git status`; throwaway `google-oauth-consent.mjs` **not** committed
