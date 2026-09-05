# Spec Document — Screener / Backtest / Watchlist UI/UX Audit Fixes (v3.29.0)

> Generated from the 2026-09-04 UI/UX audit session (Playwright-verified on :3000). Scope = the 3 confirmed defects
> found during the Chartink-scanner / backtesting / screener-stocks / watchlist audit. Enhancements are listed as deferred.
> Save to `.agents/specs/07-ui-ux-audit-fixes.md`; plan in `.agents/plans/07-ui-ux-audit-fixes.md`.

## 1. Overview

**What**: Fix three verified UI/UX defects found in the audit of Chartink scanners (TemplatesPanel), backtesting,
screener results, and the watchlist:

1. **Watchlist AI "Analyze" is a silent failure with an `[object Object]` error message** — the error path builds
   `new Error(err.error)` where the API returns `{ error: { message, code, retryable } }`, and the resulting error
   is stored in page state that only the (never-opened) AI modal renders → the user gets zero feedback when AI
   analysis fails (observed with OpenRouter credits exhausted — `AI credits exhausted — try after 6 hours…`).
2. **Backtest 404s on symbols not in the `symbols` static table** even though the backtest data chain
   (memory → `backtest_history` temp table → `daily_prices` → NSE) could resolve them — e.g. RBLBANK (a real
   NSE symbol seen in live Chartink runs) → hard `404 Symbol "RBLBANK" not found` with no hint.
3. **Mobile menu is missing the "Alerts" link** — desktop header has Alerts; the mobile hamburger groups
   (Dashboard/Portfolio/F&O, Market Data, Platform, Administration) omit it, so price-alert users can't reach
   `/alerts` on mobile except by direct URL.

**Why**: All three are user-facing correctness/accessibility gaps surfaced by the audit (console logs showed the
`/api/ai/query` 500 with `X-RateLimit-*` headers; the backtest 404 and the mobile nav gap were observed live).
No DB schema, no migrations, no new dependencies.

**Scope**:
- **IN**: the 3 fixes above + their unit/component tests + docs (AGENTS.md row, CHANGELOG detail, TODO row,
  Primer, agent-memory, Lessons, session memory).
- **OUT (deferred, may follow in a later increment)**: per-row source badge (Chartink vs TV fallback) in the
  screener results table; "Add Symbol" hint when the autocomplete suggestion isn't selected; removal of the dead
  AI modal code path (the modal render block is kept as the future display vehicle); data-gap UX beyond the
  backtest fall-through (e.g. symbol search overlay).

**Depends on**: Nothing new. Fixes touch `app/watchlist/page.tsx`, `app/components/AiActionButton.tsx`,
`app/api/backtest/run/route.ts`, mobile-menu markup (in `app/Header.tsx` component tree), and their test files.

---

## 2. Routes

> No new routes. One modified API route.

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/backtest/run` | Replace the hard 404 gate (`prisma.symbol.findUnique` miss) with a fall-through: resolve data via `getBacktestData` and let the existing ≥50-bar check be the only failure mode. Response gains an optional `dataSource`-independent `symbolSource: "known" \| "unlisted"` hint so the UI can warn "symbol not in the local universe". |

---

## 3. Database Schema

No schema changes → no migration.

---

## 4. Functions to Implement

### A. `app/api/backtest/run/route.ts` (modified)

#### Symbol-presence softening

- Remove the `if (!symbolRecord) → 404` hard gate.
- Keep the `prisma.symbol.findUnique` lookup ONLY to compute `symbolSource` (`"known"` when found, `"unlisted"`
  when missing) — the lookup is 1 indexed read, existing pattern.
- `getBacktestData(symbolUpper)` already returns safe `{ barCount, ohlcv, source }` and never throws for a
  fetch failure (falls through the chain). The existing `barCount < 50 → 400` guard remains the real
  "no data" failure.
- Response gains `symbolSource` (server-derived, mirrors client display needs).
- No behavior change for symbols already in the table; **RBLBANK-style unlisted symbols now backtest via
  NSE/daily_prices when ≥50 bars are available** (RBLBANK resolves via NSE → the audit's API check proved the
  NSE path works for RELIANCE).

### B. `app/watchlist/page.tsx` (modified)

#### Error-message extraction

- Replace the `err.error || …` construction with a safe extractor:
  `const message = typeof err.error === "string" ? err.error : err.error?.message ?? err.message ?? "AI analysis failed";`
  (single local helper — no new module; the API contract nests the message at `error.message`, which is exactly
  what the 500 body returned in the audit).

#### Failure surfacing on the Analyze path

- `analyzeWithAI(...)` currently returns only `{ remaining, limit }`. Extend the return to include the error
  message when the fetch fails, and have `AiActionButton` accept/display it:
  - `AiActionButton` gains an optional `error?: string | null` prop rendered as a small red status line under
    the button (mirrors the existing rate-limit badge pattern, lines 92-108) — non-rate-limit AI failures
    become visible instead of silent.
  - Watchlist passes `aiError` (already computed in `analyzeWithAI`'s catch) into the button's `error` prop.
- Result/success is unchanged (rate badge + spinner); a success payload still has no dedicated panel — that
  remains deferred with the modal rewiring.

### C. Mobile nav — Alerts link (modified in the header mobile menu)

#### Add "Alerts" to the mobile menu

- Add the existing Alerts link (`/alerts`) to the mobile hamburger navigation (the "Dashboard/Portfolio/F&O"
  group or its own row next to Watchlist) so mobile users reach the alerts feature.
- Surgical: reuse the exact href/icon convention of the existing mobile `Link`s. Verify at 375px + desktop that
  the desktop header is untouched.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `app/api/backtest/run/route.ts` | Modified | Soften symbol 404 → `symbolSource` hint; keep ≥50-bar guard |
| `app/watchlist/page.tsx` | Modified | Error extractor + pass `aiError` to `AiActionButton` |
| `app/components/AiActionButton.tsx` | Modified | New `error?: string \| null` prop + red status line |
| `app/Header.tsx` (or the mobile-menu component it renders) | Modified | Add Alerts link to mobile menu |
| `lib/__tests__/watchlistAiError.test.ts` | **Created** | Pure extractor tests (extract helper to `lib/aiError.ts` OR export from page — prefer a tiny pure module so tests don't mount the page; see section 12) |
| `lib/__tests__/aiActionButton.test.tsx` | **Created** | Component test: error line renders, rate badge unchanged |
| `lib/__tests__/backtestSymbolFallthrough.test.ts` | **Created** | Route-level test of the softened gate (mock `@/lib/prisma` + `getBacktestData`): unlisted symbol w/ ≥50 bars → 200 + `symbolSource:"unlisted"`; unlisted w/ <50 bars → 400; listed symbol → 200 + `"known"` |

> NOTE (decision during implementation): to keep the error extractor unit-testable without mounting the page,
> extract it to `lib/aiErrorMessage.ts` (pure, zero-dependency). If page-level export fits the repo conventions
> better, prefer that and drop the new file — final call at implementation, documented in the plan.

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `prisma.symbol.findUnique` | Compute `symbolSource` (no longer a gate) |
| `@/lib/services/backtestDataService` | `getBacktestData` | OHLCV chain (unchanged) |
| `@/lib/logger` | `logger.warn/info` | Log the unlisted-symbol fall-through |

---

## 7. API Contract

### POST /api/backtest/run (200 — symbol listed or unlisted with ≥50 bars)

```json
{
  "success": true,
  "run": { "id": "clx…", "name": "Backtest: RBLBANK - 9/4/2026", "status": "completed", "totalTrades": 2, "winRate": 50, "totalPnl": -1.2, "maxDrawdown": 3.1, "sharpeRatio": 0.4 },
  "metrics": { "totalTrades": 2, "winRate": 50, "totalReturn": -1.2, "maxDrawdownPercent": 3.1, "sharpeRatio": 0.4 },
  "trades": [ { "entryDate": "2026-09-01T00:00:00Z", "exitDate": "2026-09-03T00:00:00Z", "entryPrice": 246.9, "exitPrice": 246.1, "quantity": 100, "pnl": -80, "pnlPercent": -0.32, "exitReason": "stop_loss" } ],
  "barCount": 250,
  "dataSource": "nse",
  "symbolSource": "unlisted"
}
```

### POST /api/backtest/run (400 — barCount < 50, unchanged)

```json
{ "error": "Insufficient historical data for RBLBANK. Found 12 bars, need at least 50." }
```

### POST /api/backtest/run (401 / 400 validation — unchanged)

Unauthenticated → `{ "error": "Unauthorized" }`; missing/empty symbol or entryFilter, invalid
`initialCapital` → existing 400 shapes.

---

## 8. UI/UX Requirements

### Watchlist Analyze failure state

- **Before**: click Analyze → spinner → button restored, no message (AI quota error invisible).
- **After**: click Analyze → spinner → red status line under the button with the real message, e.g.
  `AI analysis failed after 3 attempts: AI credits exhausted — try after 6 hours or wait for the daily reset.`
- Rate-limit badge (green/amber/red counts) behaviour is unchanged.
- Loading state, enabled/disabled logic unchanged.

### Backtest dialog on unlisted symbols

- `BacktestDialog` continues to call the same POST; on success the run renders normally (table + metrics).
- Optionally (deferred): a subtle "not in local symbol universe — fetched live" note when
  `symbolSource === "unlisted"`. NOT part of this spec's DoD unless trivial; primary goal is removing the
  blocking 404 with zero UI change.

### Mobile nav

- 375px: hamburger menu contains "Alerts" link alongside the other primary links; desktop header unchanged;
  no overflow, no console errors.

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components
- [ ] No schema change → no migration
- [ ] Errors return safe defaults, never expose internals (`[object Object]` is the bug we're killing)
- [ ] Logging via `@/lib/logger` only (no `console.log`); log a `warn` on the unlisted-symbol backtest fall-through
- [ ] Surgical changes only — no refactors of unrelated code (AI modal rewiring, source badges = deferred)
- [ ] Match existing style (small status-line pattern mirrors AiActionButton's rate badge)
- [ ] `runtime = "nodejs"` kept on the backtest route

---

## 10. Expected Behavior

1. `POST /api/backtest/run` with a symbol absent from `symbols` but with ≥50 resolvable bars (e.g. RBLBANK)
   → **200** with `symbolSource: "unlisted"`, full metrics/trades; no 404.
2. Same route with <50 resolvable bars → **400** "Insufficient historical data" (unchanged guard).
3. Same route with a known symbol (e.g. RELIANCE) → **200** with `symbolSource: "known"` (behavior identical
   to today otherwise).
4. Watchlist Analyze with a failing AI call → the real provider message (not `[object Object]`) appears as a
   red status line under the Analyze button.
5. Watchlist Analyze with a healthy AI call → spinner → rate badge updates; no error line.
6. Mobile hamburger menu (375px) shows an Alerts link → navigates to `/alerts`; desktop header still shows all
   existing links.
7. `npm run test`, `npx tsc --noEmit` (46-baseline), `npm run lint` all pass after the change.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Backtest symbol missing from `symbols` table | Fall through to `getBacktestData`; ≥50-bar guard decides; response carries `symbolSource:"unlisted"` | `warn` (once per run, with symbol) |
| Backtest data chain fully exhausted (0 bars) | 400 "Insufficient historical data" (existing) | `warn` |
| Watchlist AI fetch fails (network / provider / quota) | Extracted real message surfaces under Analyze button; rate badge unaffected | `warn` (existing call sites) |
| Watchlist AI returns non-Error / object payload | Extractor degrades to `"AI analysis failed"` (never `[object Object]`) | `error` |
| Mobile menu link addition | No new failure mode | — |

---

## 12. Test Strategy

### Unit Tests

- `watchlistAiError` extractor (`lib/aiErrorMessage.ts` or page export): object-shape `{error:{message}}` →
  real message; string error → passthrough; missing/`null` payload → default; Error instance → `message`.
  4 tests.
- `AiActionButton`: renders red error line when `error` prop set; hides it when cleared; rate-limit badge
  unaffected; loading/disabled unchanged. 3-4 tests.
- Backtest route (mock `@/lib/prisma` + `getBacktestData`): unlisted + ≥50 → 200 `symbolSource:"unlisted"`;
  unlisted + <50 → 400; listed → 200 `"known"`; missing symbol/entryFilter/initialCapital → 400; no session → 401.
  6 tests.

### E2E

- Optional (deferred): extending `e2e/` for watchlist AI failure is environment-dependent (quota) — skip;
  the component test covers the visual. Backtest via UI already covered live; no new e2e this increment.

---

## 13. Performance Considerations

- `prisma.symbol.findUnique` stays 1 indexed read (unchanged cost) — only the *response* changes.
- No new caches, no loops, no N+1.
- Backtest fall-through for unlisted symbols may hit the NSE path more often than today (when daily_prices is
  cold) — same cost as the RELIANCE success path already proved, bounded by `getBacktestData`'s existing
  memory/temp-table caching and the ≥50-bar guard.

---

## 14. Security Considerations

- No auth changes; backtest route stays `auth()`-gated (401 verified).
- No new input surface: symbol validation stays as-is (uppercased, typed string), no injection vectors added.
- Error messages now surfaced never include stack traces or internals (extractor returns provider text only).

---

## 15. Definition of Done

- [ ] All 3 fixes implemented per sections 4-5
- [ ] Backtest route: unlisted symbol w/ ≥50 bars → 200 + `symbolSource:"unlisted"` (live-verified with a
      real Chartink-hit symbol absent from `symbols`)
- [ ] Watchlist Analyze failure shows the provider message (not `[object Object]`) under the button
- [ ] Mobile menu contains Alerts at 375px (Playwright-verified, desktop header unchanged)
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` passes (46 = exact baseline, 0 new)
- [ ] `npm run lint` passes
- [ ] 0 console errors in browser (watchlist + backtest + mobile nav)
- [ ] No schema change → no migration
- [ ] Documentation updated (AGENTS.md version row, CHANGELOG detail, TODO row, Primer, agent-memory,
      Lessons if new pattern, session memory (`decisions.md` + `flow.md`), session-todos, handoff latest)
- [ ] Deferred items (source badges, autocomplete hint, modal rewiring) explicitly listed as deferred
- [ ] No commit/push/merge without explicit user approval