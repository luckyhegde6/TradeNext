# Spec Document — Google Sheets Tracking Export (Swing / Daily Recs / Screeners / Custom Scans / Decisions)

> Branch: `feature/google-sheets-tracking` · Version target: v3.42.0 · Created: 2026-09-25

## 1. Overview

**What**: Append rows to the user's **TradeNext Tracker** Google Sheet (spreadsheet `1mRDK40yv2_RAgRitEZZutF1UmMJEBy9ccrjxeDYDXzQ`, tabs `swing` · `daily-rec` · `screener` · `custom` · `decisions`) whenever TradeNext's analysis pipelines emit data: swing signals (with AI analysis), daily recommendation runs, unified screener results (Chartink/TradingView, incl. POC A decision scores), custom scan runs, and Decision Engine evaluations/gates. Export uses the official Google APIs (googleapis SDK) with **OAuth2 user-consent** auth, writes are **real-time and fire-and-forget** (never block an HTTP response), and everything is gated behind a `GOOGLE_SHEETS_TRACKING_ENABLED` flag (off = byte-identical current behavior).

**Why**: Track and analyse decisions + outcomes over time in a spreadsheet the user already maintains — swing signals, daily picks, screener hits, custom scans, and decision scores/gates side by side for post-hoc analysis (win-rate, score drift, gate calibration). The Decision Engine traces are currently in-memory-only (ring buffer, last 500, lost on restart); the sheet becomes the durable log.

**Scope**:
- IN: new `lib/services/googleSheets/` module (auth client, tab/header registry, row encoders, fire-and-forget exporter with retry); hook wiring at the five producer sites; `trackDecisionTrace` sink registration so all 4 decision kinds (evaluate/ping/poc-a-screener/poc-b-autoseed-gate) export; `.env.example` + Netlify env vars; unit tests (mocked googleapis); docs sweep.
- OUT: no UI changes, no Prisma schema changes, no new API routes, no reading from the sheet (append-only), no historical backfill, no automated OAuth consent flow (one-time user browser consent documented; refresh token stored server-side).

**Depends on**: Decision Engine (v3.41.x, merged via PR #132), swing/recommendation/screener services (existing), `@/lib/logger`, `@/lib/audit` patterns. New npm deps: `googleapis` (+ `google-auth-library` transitive).

---

## 2. Routes

No new routes, no modified routes. All writes happen inside existing services (server-side, nodejs runtime).

---

## 3. Database Schema

No Prisma schema changes. The sheet IS the store. (Google Sheets API, not DB.)

---

## 4. Functions to Implement

### A. `lib/services/googleSheets/auth.ts`

#### `getOAuth2Client(): OAuth2Client`

- Lazily builds a google-auth-library `OAuth2Client` from env (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`).
- Singleton via module-level cache + `global` guard (mirror tokenizer/WASM lazy pattern).
- Throws descriptive error if any of the 3 vars is missing (caller catches; export is fire-and-forget).

#### `getSheetsClient(): sheets_v4.Sheets`

- `google.sheets({ version: "v4", auth: await getOAuth2Client() })`, cached.

### B. `lib/services/googleSheets/tabs.ts`

- `export const TRACKER_TABS` — 5 entries: `swing`, `daily-rec`, `screener`, `custom`, `decisions`, each with `headers: string[]`.
- `ensureHeaders(tab)` — one-time per-process guard: reads `A1` range once (`values.get` with `majorDimension:"ROWS"`); if the first row ≠ headers, does `values.update` with the header row (append-only thereafter; never delete user data).
- Tab header sets (see §5).

### C. `lib/services/googleSheets/rows.ts` — pure encoders (unit-testable, no IO)

- `swingRow(stock: SwingStock): string[]`
- `dailyRecRow(stock: StockWithTracker, run: RunWithStocks | null): string[]` (or the run summary shape from §5)
- `screenerRow(result): string[]` (single Chartink/TradingView unified-run hit with POC A score/gate)
- `customScanRow(item: ScanResultItem-ish, runCtx): string[]`
- `decisionRow(entry: DecisionTraceEntry): string[]`

All encoders coerce to strings, `JSON.stringify` nested objects (indicators, gateDistribution), ISO-8601 timestamps.

### D. `lib/services/googleSheets/exporter.ts`

#### `exportRows(tab: TrackerTab, rows: string[][]): Promise<void>`

- `spreadsheets.values.append({ spreadsheetId, range: `${tab}!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: rows } })`.
- Called only when `GOOGLE_SHEETS_TRACKING_ENABLED === "true"`.
- Retry: 1 retry with exponential backoff (~1s) on transient (429/5xx); log + audit on final failure; NEVER throws to caller.

#### `exportSwing(stocks: SwingStock[])`, `exportDailyRecs(run, stocks)`, `exportScreeners(results, opts)`, `exportCustomScan(runCtx, items)`, `exportDecision(entry: DecisionTraceEntry)`

- Thin wrappers: flag-check → `ensureHeaders` → map rows → `exportRows`.
- Fire-and-forget call sites `.catch(...)` (see §10) — producers never await.

### E. `lib/services/decision/monitoring.ts` — MODIFIED

- Add optional sink registration: `registerDecisionTraceSink(fn: (e: DecisionTraceEntry) => void)` and call all registered sinks inside `trackDecisionTrace` (sinks never throw; wrapped in try/catch). GoogleSheets registers `exportDecision` when its flag is enabled. This is the SINGLE decision hook (covers all 4 kinds incl. future kinds) with zero changes to `client.ts`/POC A/POC B call sites.

---

## 5. Tab Header Sets (append-able rows)

### `swing` — one row per SwingStock with AI analysis
`postedAt, symbol, name, price, change, changePercent, volume, marketCap, screenerCount, screenerNames, families, templateIds, source, momentumScore, indicators, action, confidence, entryPrice, targetPrice, stopLoss, timeHorizon, logic, riskFactors, analysisError`

### `daily-rec` — one row per recommendation stock of the run
`runDate, runId, symbol, price, change, changePercent, volume, screenerAttribution, screenerCount, aiRecommendation, confidence, targetPrice, stopLoss, timeHorizon, status, reasoning`

### `screener` — one row per unified-run hit (post-POC-A)
`capturedAt, runId, symbol, name, close, changePercent, volume, screenerNames, category, source, decisionScore, decisionGate`

### `custom` — one row per scan config run item
`runAt, configId, configName, userId, filters, matchCount, symbol, name, price, change, pChange, volume, data`

### `decisions` — one row per DecisionTraceEntry
`timestamp, kind, mode, provider, status, latencyMs, attempts, error, questionCount, questionTypes, gate, reason, scoredCount, gateDistribution, noulAmount, allowed`

---

## 6. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/googleSheets/auth.ts` | **Created** | OAuth2 + Sheets client singleton |
| `lib/services/googleSheets/tabs.ts` | **Created** | Tab registry + header ensure |
| `lib/services/googleSheets/rows.ts` | **Created** | Pure row encoders |
| `lib/services/googleSheets/exporter.ts` | **Created** | Fire-and-forget append + wrappers |
| `lib/services/decision/monitoring.ts` | Modified | Trace-sink registration |
| `lib/services/swingRecommendationService.ts` | Modified | Fire-and-forget `exportSwing` after analysis completes |
| `lib/services/dailyRecommendationService.ts` | Modified | Fire-and-forget `exportDailyRecs` at run completion |
| `lib/services/chartinkUnifiedScreenerService.ts` | Modified | Fire-and-forget `exportScreeners` (POC A block) |
| `app/api/screener/configs/[id]/run/route.ts` | Modified | Fire-and-forget `exportCustomScan` per scan run |
| `lib/audit.ts` | Modified | `GOOGLE_SHEETS_*` audit tags |
| `.env.example` | Modified | Google OAuth vars documented (no secrets) |
| `package.json` | Modified | `googleapis` dependency |
| `lib/__tests__/googleSheetsRows.test.ts` | **Created** | Encoder unit tests |
| `lib/__tests__/googleSheetsExporter.test.ts` | **Created** | Exporter/flag/retry tests |
| `lib/__tests__/decisionMonitoring.test.ts` | Modified | Sink registration tests |

---

## 7. API Contract

No HTTP routes. Internal fire-and-forget contract:

```typescript
type ExportResult = "enabled" | "disabled" | "failed"; // never thrown to producer
exportRows(tab, rows): Promise<ExportResult>
```

---

## 8. UI/UX Requirements

No UI component. (Optional future: an admin status row — OUT of scope.)

---

## 9. Rules & Guardrails

- [ ] Gated by `GOOGLE_SHEETS_TRACKING_ENABLED === "true"` — off = byte-identical behavior
- [ ] Fire-and-forget only — never `await` in producers; `.catch(logger.error)`
- [ ] Sinks/exporters never throw into business logic
- [ ] Secrets (`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`) NEVER in client, logs, or `NEXT_PUBLIC_*`; gitignored `.env`
- [ ] `SECRETS_SCAN_OMIT_PATHS` reviewed — no hardcoded credentials added to repo
- [ ] Logging via `@/lib/logger` only
- [ ] No Prisma in the new module (sheet is external store)
- [ ] Export is append-only; never overwrite/delete user sheet data
- [ ] Rate limits respected: one append per producer-run (batched rows), ~1 retry
- [ ] Runtime `nodejs` (OAuth/network)

---

## 10. Expected Behavior

1. `GOOGLE_SHEETS_TRACKING_ENABLED` unset/false → all wrappers return `"disabled"`, zero network calls, zero behavior change.
2. Flag true + valid env → after a recommendation run completes, `daily-rec` has one row per stock.
3. Flag true + valid env → swing analysis completion appends rows to `swing`.
4. Flag true + valid env → unified screener run (with POC A) appends scored rows to `screener`.
5. Flag true + valid env → custom scan run appends item rows to `custom`.
6. Flag true + valid env → every `trackDecisionTrace` call appends a row to `decisions` via the registered sink (no change to engine code).
7. Missing OAuth env → wrapper logs `error`, returns `"failed"`, producer continues unaffected.
8. Sheets API 429/5xx → 1 retry with backoff; final failure logged + audited, producer unaffected.
9. First write to a tab writes the header row first (other rows remain untouched).
10. NaN/undefined values coerce safely (empty string) — no exceptions from encoders.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Flag off | Return `"disabled"` immediately, no IO | `debug` |
| Missing env vars | Log descriptive error, return `"failed"` | `error` |
| OAuth token refresh failure | Retry once (1s backoff); else fail + audit | `error` |
| Append 429/5xx | Retry once; final failure logged + `GOOGLE_SHEETS_APPEND_FAILED` audit | `error` |
| Encoder exception | Catch, log, return `"failed"` (never throw) | `error` |
| Header mismatch on existing tab | Do NOT alter user tab — log `warn`, append anyway (columns by position) | `warn` |

---

## 12. Test Strategy

### Unit — `lib/__tests__/googleSheetsRows.test.ts`
- [ ] `swingRow` maps all SwingStock fields (incl. nested indicators/logic JSON, null analysis)
- [ ] `dailyRecRow` maps run + stock fields (null confidence → "")
- [ ] `screenerRow` includes decisionScore/decisionGate when present
- [ ] `customScanRow` serializes filters/data JSON
- [ ] `decisionRow` maps all 10+ DecisionTraceEntry fields, nested gateDistribution JSON
- [ ] Encoders never throw on null/undefined

### Unit — `lib/__tests__/googleSheetsExporter.test.ts`
- [ ] Flag off → `"disabled"`, no googleapis call
- [ ] Flag on → calls `values.append` with `{spreadsheetId, range: "swing!A1", valueInputOption:"USER_ENTERED"}`
- [ ] First write → `ensureHeaders` writes header row before append
- [ ] 429 → retries once then `"failed"` (mock rejections)
- [ ] Missing env → `"failed"` without crashing
- [ ] `exportDecision` registered sink → `trackDecisionTrace` invokes it

### Unit — `lib/__tests__/decisionMonitoring.test.ts` (extend)
- [ ] sink registration called on every trace kind
- [ ] sink exception is swallowed (never throws from `trackDecisionTrace`)

### E2E — none (no UI). Live check: run a real run with flag on + real creds (optional, manual).

---

## 13. Performance Considerations

- **Batching**: one `append` call per producer-run (dozens–hundreds of rows in one request)
- **Fire-and-forget**: export never adds to producer latency or request duration
- **No caching**: writes only; per-process header-ensure guard avoids repeated `values.get`
- **Rate limit**: daily recs = 1 call/day; swing = on job completion; scans = per run; decisions = per evaluation (only when flag on) — far under Sheets 300 writes/min default

---

## 14. Security Considerations

- **Secrets**: OAuth client secret + refresh token live ONLY in server env (Netlify env vars + local `.env`, gitignored). Never logged, never client-visible.
- **OAuth scope**: `https://www.googleapis.com/auth/spreadsheets` (read+write, sheet-scoped); refresh token from one-time user consent flow (documented in plan, §Integration).
- **Audit**: `GOOGLE_SHEETS_APPEND_SUCCESS` / `GOOGLE_SHEETS_APPEND_FAILED` audit tags for state-changing exporter outcomes (tag names follow existing audit style).
- **No injection**: values are data only (USER_ENTERED); user-controlled sheet content is never read/evaluated.

---

## 15. Definition of Done

- [ ] All functions implemented per §4
- [ ] All files created/modified per §6
- [ ] Flag-gated (off = byte-identical) verified by test
- [ ] All 5 tabs append correct rows (unit-verified shapes)
- [ ] `npx tsc --noEmit` passes (0 new errors beyond 46 baseline)
- [ ] `npm run lint` passes
- [ ] `npm run test` — all suites pass (new suites green)
- [ ] `npm run quickbuild` passes
- [ ] Sink registration covered by tests (decision monitoring untouched behavior)
- [ ] `.env.example` documents the 4 Google env vars (no secrets)
- [ ] Audit tags added
- [ ] Docs updated: AGENTS.md row, `.agents/changelog/versions-v3.42.md`, TODO quick-ref, Primer, agent-memory, Lessons (if pattern found), session memory
- [ ] Live-verified on :3000 with flag on (manual: real run appends rows) — optional, user provides creds
- [ ] 0 console errors / no new artifacts in `git status`