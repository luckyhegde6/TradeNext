---
handoff_version: "1.1"
session_id: "sess-20260905-v3290-uiux-audit-fixes"
agent: "system"
timestamp: "2026-09-05T00:00:00Z"
status: "in_progress"
priority: "high"
parent_session: "sess-20260905-v3285-nse-scrip-list"
child_sessions: []
checkpoint: "v3.29.0 UI/UX audit fixes — backtest symbol-gate softening + AI-failure error surfacing (extractErrorMessage) + mobile-nav Alerts + [object Object] throw-site fix — code + tests + verification + docs complete: tsc 46 exact baseline, targeted 23/23, full suite 1043 pass / 4 skip / 1 fail (= documented pre-existing intelligence flake only); Playwright live-verified; commit pending user (push carries v3.28.5 6700076 — do not amend)"
---

# Active Session Handoff

## Context
- **Task**: v3.29.0 — UI/UX audit fixes (spec/plan 07) on top of v3.28.5 `6700076` (committed, unpushed): (1) **backtest symbol-gate softening** — v3.28.5's `isBacktestSymbolAllowed` 404-gate removed so unknown/unlisted symbols fall through to `getBacktestData` instead of a misleading 404; (2) **AI-failure error surfacing** — watchlist AI-panel 500s were swallowed and the throw-site rendered `[object Object]`; NEW `extractErrorMessage` helper + `AiActionButton` `error` prop fix both; (3) **mobile-nav Alerts** — logged-in quick-access grid gains F&O Analytics + Alerts.
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (HEAD = v3.28.5 `6700076`, 17 files, unpushed). Do not amend `6700076` or `c90f052`; the plan-07 push carries `6700076` along.

## Progress
- [x] **P1 backtest gate softened** (`app/api/backtest/run/route.ts`): no symbol 404 — `symbolUpper` :73, `findUnique` :80, `symbolSource = symbolRecord ? "known" : "unlisted"` :83 (labeling only), warn fall-through log :85-91, `getBacktestData(symbolUpper)` :97, only no-data failure = `barCount < 50 → 400` :99-103, `symbolSource` echoed :178, `runtime="nodejs"` :29. `isBacktestSymbolAllowed` REMOVED from `lib/services/symbolReference.ts` (dead code; file now exports only `mergeSymbolSuggestions`). `symbolReference.test.ts` **11 → 7** (4 gate tests removed with the helper).
- [x] **P2 AI-failure surfacing**: NEW `lib/aiErrorMessage.ts` `extractErrorMessage(err, fallback = "AI analysis failed")` (unwraps `Error.message` string / nested `{error:{message}}`); `app/components/AiActionButton.tsx` gains `error?: string | null` :20 → red status line :114-116 (hidden while loading); `app/watchlist/page.tsx` import :8, throw-site normalization `err.error || HTTP <status>` :254 (was `[object Object]` when `err.error` was an object), `setAiError(extractErrorMessage(err))` :268, passes `error={aiError}`.
- [x] **P3 mobile nav** (`app/Header.tsx`): logged-in quick-access `grid-cols-2` :312 → Dashboard / Portfolio / **F&O Analytics** :334 / **Alerts** :337 (desktop `/alerts` :141, `/fo` :147). Live-verified 375×812.
- [x] **Tests (NEW)**: `lib/__tests__/backtestSymbolFallthrough.test.ts` 4 (node-env; unlisted+enough bars → 200 `symbolSource:"unlisted"`; unlisted <50 bars → 400; listed → 200 `symbolSource:"known"`; unauthenticated → 401); `lib/__tests__/watchlistAiError.test.ts` 8 (error normalization incl. nested `{error:{message}}` shapes, `[object Object]` regression); `app/components/__tests__/AiActionButton.test.tsx` 4 (path deviation from convention; uses plain `test(` not `it(`).
- [x] **Verification**: tsc **46 = exact baseline (0 new)**; targeted 4 suites **23/23**; full suite **1043 pass / 4 skip / 1 fail** — 1 = documented pre-existing `intelligence.test.ts` async flake (excluding it: **72 suites / 1043 pass / 4 skip / 0 fail from these changes**). Net suite delta **+12** (16 new, 4 removed) vs the 1031 pre-v3.29.0 observed baseline. No schema change → no migration.
- [x] **Live verification (Playwright, :3000, admin session)**: `RBLBANK` backtest → **200** `symbolSource:"unlisted"`, 70 bars; simulated AI 500 `{error:{message:"AI provider unavailable (simulated 500)"}}` → red line shows extracted text, button stays enabled; 375×812 hamburger grid shows Dashboard/Portfolio/F&O Analytics/Alerts; `[object Object]` regression re-verified fixed; test watchlist deleted via UI. Dev server PID 34672 pre-existing, left running (do not kill).
- [x] **Docs (v3.29.0)**: NEW `.agents/changelog/versions-v3.29.md`; `.agents/CHANGELOG.md` index row; `AGENTS.md` version-table row; `TODO.md` quick-ref row; `Primer.md` (Last Updated + Current Project Status); `agent-memory.md` entry; `.agents/session-todos.md`; this file; NEW `.agents/sessions/2026-09-05-fix-v3.28.1-sqlite-self-heal/decisions.md` + `flow.md`.
- [x] **Earlier branch state (unchanged)**: v3.28.5 `6700076` committed, unpushed (17 files); v3.28.4 `c90f052` committed + pushed; v3.28.3 `a1dd094` committed + pushed; v3.28.2 `5a63fc4` committed + pushed; v3.28.1 `718b5d2` committed; v3.28.0 SQLite-first NSE store uncommitted (incl. regression-fix `8020dee`); v3.27.0 Accelerate (spec/plan `db5a5cc`); v3.26.0 PR #114 merged `3605c64`.
- [x] **Notes from verification**: pre-existing LSP diagnostics unrelated to v3.29.0 (ignore): `scripts/test-prod-db.ts` (`datasources` not in `PrismaClientOptions`); `lib/__tests__/db-utils.test.ts`, `lib/__tests__/document-normalize.test.ts`, `lib/__tests__/stock-analysis-prompt.test.ts` (module-alias resolution while the dev server holds the module graph).

## Decisions
- Do NOT rewrite historical v3.28.5 doc rows that mention `isBacktestSymbolAllowed` — they describe v3.28.5 state; the removal/supersession is documented in the v3.29.0 changelog instead.
- Backtest route: a static-table miss (fresh listing / BE-BZ series / unsynced row) is NOT proof of a bad ticker → always fall through to the data chain; `symbolSource` is a label, never a gate. Only `<50 bars` fails.
- AI errors: extract at the throw site with `extractErrorMessage` (never render raw `err.error` objects) and surface via the button's `error` prop; button stays enabled after a failure so the user can retry.
- Test convention deviation accepted (documented): `app/components/__tests__/AiActionButton.test.tsx` lives under `app/components/__tests__/` with plain `test(` — intentional, noted so future convention-driven refactors don't "normalize" it away.
- Verification gate = tsc 46 exact baseline + targeted suites + full suite with documented `intelligence.test.ts` flake excluded from attribution.
- No auto commit/push/merge/deploy without explicit user approval.

## Blockers
- **v3.29.0 commit + push pending explicit user approval** (push carries v3.28.5 `6700076`; do not amend). Merge/deploy of the whole v3.28.x chain still held by user; v3.28.0/v3.27.0 diffs + PR #114 doc reconcile + BUGS.md #14 (Prisma Postgres Phase 0, Dec 1 2026 Accelerate retirement) remain pending.
- Deferred: **daily recommendation job failures** (Issue 3) — distinct follow-up.

## Next Move
1. Commit plan-07 changes (code + tests + docs) and push `fix/v3.28.1-sqlite-self-heal` (carries `6700076`) — only on explicit user approval.
2. Await explicit user approval to merge `fix/v3.28.1-sqlite-self-heal` → `main` + deploy.
3. Remind user: v3.28.0/v3.27.0/v3.26.0 commits + PR #114 doc reconcile + BUGS.md #14 Phase 0 + deferred daily-recommendation failure investigation (Issue 3).