# Session Decisions — 2026-09-05-fix-v3.28.1-sqlite-self-heal (v3.29.0 UI/UX audit fixes)

Branch: `fix/v3.28.1-sqlite-self-heal` on top of v3.28.5 `6700076` (committed, unpushed; the plan-07 push carries it). Mandatory session-memory per `.agents/rules/session-decisions-flow.md`.

## Decisions (with reasoning)

1. **Remove `isBacktestSymbolAllowed` (P1)** — v3.28.5's 404-gate treated a symbol-reference miss as "bad ticker". Fresh listings / BE-BZ series / unsynced rows are valid symbols the data chain could serve. Gate removed → the route always falls through to `getBacktestData`; `prisma.symbol.findUnique` (:80) is used ONLY to label `symbolSource = "known"|"unlisted"` (:83, echoed :178). Only failure = `barCount < 50 → 400`. Live proof: RBLBANK (unlisted) → 200 with 70 bars.
2. **Do not rewrite history** — AGENTS.md/CHANGELOG/TODO v3.28.5 rows that mention `isBacktestSymbolAllowed` stay as-is (they document v3.28.5 state); the removal is documented in the v3.29.0 changelog instead.
3. **Extract AI errors at the throw site (P2)** — `err.error` can be an object (→ `[object Object]`) and provider 500s were swallowed entirely. NEW `lib/aiErrorMessage.ts::extractErrorMessage` unwraps `Error.message` / string / nested `{error:{message}}`; the watchlist throw-site normalizes `err.error || HTTP <status>` (:254) and passes `error={aiError}` into `AiActionButton` (red status line, hidden while loading; button stays enabled → user can retry).
4. **Mobile nav completeness (P3)** — the logged-in quick-access grid was missing F&O Analytics + Alerts vs the desktop nav; add both to the `grid-cols-2` (:312) so mobile 375px matches desktop.
5. **Test convention deviation accepted** — `app/components/__tests__/AiActionButton.test.tsx` (plain `test(`, folder under `app/components`) deviates from the `lib/__tests__` + `it(` convention; intentional (co-locates with the component); documented so future refactors don't normalize it away.
6. **Verification gate** — tsc 46 exact baseline + targeted 23/23 + full suite 1043/4/1 (1 = documented pre-existing `intelligence.test.ts` flake, excluded from attribution) + Playwright live verification against the running dev server (PID 34672, pre-existing — never killed).
7. **Commit/push discipline** — no commit/push/merge without explicit user approval; commit plan-07 as a separate commit; `6700076` is NOT amended; the push carries it together with the new commit.

## Follow-ups
- Await user approval → commit plan-07 (code + tests + docs) + push branch.
- Merge/deploy of the v3.28.x chain held by user. v3.28.0/v3.27.0 diffs + PR #114 doc reconcile + BUGS.md #14 (Phase 0 Prisma Postgres, Dec 1 2026 Accelerate retirement) + daily-recommendation job failure investigation (Issue 3) still pending.