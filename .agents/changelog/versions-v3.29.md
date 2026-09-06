# v3.29.0 — UI/UX audit fixes: backtest symbol-gate softening + AI-failure error surfacing + mobile-nav Alerts + [object Object] throw-site fix

- **Date**: Sep 05 2026
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.5 `6700076`)
- **Status**: Complete (code + tests + verification + docs); commit/push pending user approval
- **Spec**: `.agents/specs/07-ui-ux-audit-fixes.md` · **Plan**: `.agents/plans/07-ui-ux-audit-fixes.md`

## User directive (confirmed)

Continue executing plan 07 **"UI/UX audit fixes"** against a local-reality baseline after the v3.28.5
scrip-list landing (audit was spec'd pre-v3.28.5; three of its fixes touch symbols). Minor scope tightening —
the plan's watchlist-phase focus is a subset of this deliverable; AI-failure surfacing applies to the
existing watchlist AI panel plus the shared `AiActionButton`.

## Design

### Phase 1 — Backtest symbol-gate softening (no hard 404 on symbol presence)

The v3.28.5 gate let `isBacktestSymbolAllowed(symbol, hasDbRecord)` reject unknown symbols with a 404 —
but a static-table miss is NOT proof of a bad ticker: fresh listings, BE/BZ series, and symbols whose
`symbols` row lags all fall into "unlisted" while `getBacktestData` (memory → `backtest_history` →
`daily_prices` → live NSE) can still serve them. The v3.29.0 route:

- **always falls through** to `getBacktestData(symbolUpper)` (:97) — the only no-data failure is the
  existing `barCount < 50 → 400` guard (:99-103);
- derives `symbolSource = symbolRecord ? "known" : "unlisted"` (:83) solely for **source labeling** —
  returned on the success payload (:178) and logged at warn when unlisted (:85-91);
- because the gate logic vanished, **`isBacktestSymbolAllowed` was REMOVED from `lib/services/symbolReference.ts`**
  (dead code — zero remaining call sites; the 4 gate tests moved out of `symbolReference.test.ts`,
  11 → **7**);
- `runtime = "nodejs"` stays explicit (:29).

Live-verified (Playwright): POST `/api/backtest/run` with `symbol: "RBLBANK"` (unlisted) →
**200**, `symbolSource: "unlisted"`, 70 bars. Unknown tickers with <50 bars still get the honest 400.

### Phase 2 — AI failure surfacing (watchlist + shared button)

The watchlist AI panel swallowed provider errors — `setAiError` (L268) received an **Error-typed** value
(rendering `[object Object]`) or nothing at all. Two changes:

1. **NEW `lib/aiErrorMessage.ts`** — `extractErrorMessage(err, fallback = "AI analysis failed")`:
   unwraps `Error` → `err.message`; plain strings as-is; nested `{ error: { message } }` (the real
   `/api/ai/query` 500 body) → the inner message; null/undefined/empty → fallback.
2. **`app/components/AiActionButton.tsx`** gains `error?: string | null` — renders a **small red status
   line** under the button (:114-116, `error && !isLoading` so loading never doubles the error).
   `app/watchlist/page.tsx` passes `error={aiError}` and the throw-site (:254) now normalizes
   `err.error || HTTP <status>` into a string before throwing, so the catch's
   `setAiError(extractErrorMessage(err))` (L268) always shows text.

Live-verified (Playwright): intercepted `/api/ai/query` → simulated 500
`{ error: { message: "AI provider unavailable (simulated 500)" } }` — the red line shows the extracted
message and the Analyze button stays enabled.

Bonus regression in the same pass: the watchlist throw-site previously produced `[object Object]` when
`err.error` was an object — fixed by the normalization above.

### Phase 3 — Mobile nav Alerts (logged-in quick-access grid)

`app/Header.tsx` mobile menu — the logged-in quick-access `grid-cols-2` block (L312) was missing the
**Alerts** and **F&O Analytics** links; both are now in the grid alongside Dashboard/Portfolio
(`MobileNavLink` /fo :334, /alerts :337 — the li items were always functionally fine in the full list;
the grid shortcut now matches).

Live-verified (Playwright, 375×812): hamburger → quick access shows Dashboard / Portfolio / **F&O
Analytics** / **Alerts**.

## Tests

**NEW `lib/__tests__/backtestSymbolFallthrough.test.ts` (4, node-env pragma)** — unlisted symbol with
enough bars → 200 + `symbolSource: "unlisted"` (no 404); unlisted + <50 bars → 400 (the only no-data
failure); listed symbol → 200 + `symbolSource: "known"`; unauthenticated → 401.

**NEW `lib/__tests__/watchlistAiError.test.ts` (8)** — thrown string as-is; `Error` instance message;
string `err.error` preferred over `err.message`; nested `{ error: { message } }` (real 500 shape); missing
both → fallback; null/undefined input; empty strings → fallback; custom fallback.

**NEW `app/components/__tests__/AiActionButton.test.tsx` (4)** — renders the red error status line when
`error` prop passed; no error line when undefined/null; error hidden while loading; rate-limit badge
unchanged by the error prop.

**`lib/__tests__/symbolReference.test.ts` 11 → 7** — the 4 `isBacktestSymbolAllowed` gate tests removed
with the helper (dead code — see Phase 1).

## Verification

- **tsc**: `npx tsc --noEmit` **46 = exact baseline (0 new)**.
- **Targeted**: `backtestSymbolFallthrough` 4/4 + `watchlistAiError` 8/8 + `AiActionButton` 4/4 +
  `symbolReference` 7/7 = **23/23**.
- **Full suite**: **1043 pass / 4 skip / 1 fail** — the 1 = documented pre-existing
  `lib/__tests__/intelligence.test.ts` async cache-flake (fails run-to-run regardless; `intelligence.ts`/
  `cache.ts` untouched — excluding it **72 suites / 1043 pass / 4 skip / 0 fail from these changes**).
- **No schema change → no migration.**
- Playwright live-verified all three phases (see Design) + the `[object Object]` bonus fix; dev server
  PID 34672 left running; test watchlist cleaned up via UI.

## Files

**Created**: `lib/aiErrorMessage.ts`, `lib/__tests__/backtestSymbolFallthrough.test.ts`,
`lib/__tests__/watchlistAiError.test.ts`, `app/components/__tests__/AiActionButton.test.tsx`,
`.agents/changelog/versions-v3.29.md`, `.agents/sessions/2026-09-05-fix-v3.28.1-sqlite-self-heal/`.

**Modified**: `app/api/backtest/run/route.ts` (gate softening + `symbolSource`),
`app/components/AiActionButton.tsx` (`error` prop + red line), `app/watchlist/page.tsx` (throw-site
normalization + `extractErrorMessage`), `app/Header.tsx` (mobile grid F&O/Alerts),
`lib/services/symbolReference.ts` (removed `isBacktestSymbolAllowed`), `lib/__tests__/symbolReference.test.ts`
(11 → 7), plus this doc set (AGENTS.md, CHANGELOG index, TODO.md, Primer, agent-memory, session-todos,
handoff).

**Commit**: pending user. Branch push will carry v3.28.5 `6700076` (still unpushed, 17 files) alongside.

---

# v3.29.1 — Header overflow fix + Watchlist logged-out infinite-skeleton fix (browser/DevTools visual-verification batch)

- **Date**: Sep 06 2026
- **Branch**: `main` (on top of merged v3.29.0 `d7e54cf`)
- **Status**: Complete (code + tests + live-browser verification + docs); commit pending user approval
- **Spec/Plan**: follow-up increment to `.agents/specs/07-ui-ux-audit-fixes.md` / `.agents/plans/07-ui-ux-audit-fixes.md` (carried over the watchlist visual-verification phase the v3.29.0 plan subset touched on)

## Design

### Phase 1 — Header overflow fix (`app/Header.tsx`, CSS-only)

The logged-in nav overflowed at partial widths (`lg`: 1024–1279px hides the center cluster, but the left
cluster + right auth cluster could still wrap/overflow at 1440–1600px). Fix is CSS-only — `hidden xl:flex`
groups kept, container/grid tuned so the clusters stay on one row. Verified with Playwright audit probes:
**372 DOM overflow checks + a 9-width quick-check loop — 0 overflow** at 1440 and at 375 on
watchlist/alerts/screener/advanced-screener; full e2e **87 passed / 2 flaky / 0 failed**.

### Phase 2 — Watchlist logged-out infinite-skeleton FIX (`app/watchlist/page.tsx`, 1 line)

Found during the user-requested browser + Chrome DevTools visual observation of `/watchlist` logged-out.
The render guard `if (status === "loading" || loading)` (:303) was supposed to fall through to the
"Please sign in to view your watchlist." card when `status === "unauthenticated"` — but the local
`loading` state (`useState(true)`) is ONLY cleared inside `fetchWatchlists()`, which runs only when
`status === "authenticated"` → for logged-out visitors `loading` stayed `true` forever and the
`unauthenticated` branch was **dead code** (infinite skeleton). E2E never caught it: the watchlist spec
logs in first, so no spec exercised the logged-out view.

Fix: `if (status === "loading" || (status === "authenticated" && loading))` — the local flag is now gated
to the authenticated path. Authenticated UX unchanged.

### Phase 3 — Live verification (Chrome DevTools)

- **Logged-out** (isolated browser context): `/watchlist` → "Please sign in to view your watchlist." +
  SIGN IN header; **0 skeletons**.
- **Logged-in** (demo): "Demo AI Watchlist" — RELIANCE **● LIVE** ₹1,310.90 / -23.90 (-1.79%); OHLC
  columns (VOLUME/OPEN/HIGH/LOW); Analyze / + Add Symbol / Delete / ✕ actions; **0 console errors**
  (Web Vitals GOOD: TTFB 228ms, CLS 0.00, LCP 1180ms); **no overflow** at 375×812 (table scrolls inside
  `overflow-x-auto`, mobile menu present) or at 2696.

## Tests

**NEW `app/watchlist/__tests__/page.test.tsx` (3/3, TSX path deviation like the AiActionButton test)**:
unauthenticated → sign-in prompt + **no skeleton** (regression — fails pre-fix); loading → skeleton;
authenticated-empty → "You haven't created any watchlists yet." + CTA. Mocks: `next-auth/react`
`useSession`, global `fetch`, `AiActionButton`, `Autocomplete`, `useLivePrices`.

## Verification

- **tsc**: `npx tsc --noEmit` **46 = exact baseline (0 new)**.
- **Targeted**: watchlist page test **3/3**.
- **Baselines (this session)**: full jest suite **1043 pass / 4 skip / 1 fail** (1 = documented
  pre-existing `intelligence.test.ts` flake); full e2e **87 passed / 2 flaky / 0 failed**.
- **No schema change → no migration.**
- Live-browser verified both auth states + mobile (see Design Phase 3).

## Files

**Created**: `app/watchlist/__tests__/page.test.tsx`.

**Modified**: `app/Header.tsx` (CSS-only overflow fix), `app/watchlist/page.tsx` (:303 loading-guard fix),
plus this doc set (AGENTS.md, CHANGELOG index + versions-v3.29.md, TODO.md, Primer, agent-memory,
Lessons, session-todos, handoff).

**Commit**: pending user (no push/merge without approval).