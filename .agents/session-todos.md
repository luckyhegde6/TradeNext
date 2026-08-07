# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-07) — ph21: Carry-Forward — Target/SL ₹0.00 Fix + SSE Live Prices + HistoryTab Null-Guard (v3.5.1)

**Branch**: `fix/ph21-carryforward-perftab` (from main after PR #81 merged `bf584e2`)
**Context**: PR #81 (ph20 v3.5.0) MERGED 2026-08-07. Live-site check confirmed Performance tab ₹0.00 target/SL bug.

### Completed
- [x] Root-cause target/SL ₹0.00: prod AI fails (netlify.toml `[build.environment]` lacks `OPENROUTERKEY`; key only local `.env`) → `getDefaultRecommendation()` literal 0s overwrote price-based defaults
- [x] Fix `lib/services/ai/recommendation-agent.ts` — price-based fallback (`price*1.1`/`price*0.95`, guarded `price>0`); `normalizeRecommendation` no longer persists literal 0
- [x] Tests updated (`recommendation-agent.test.ts` 25 pass) + new `lib/__tests__/useLivePrices.test.ts` (4 pass); full suite 317 passed / 11 skipped / 0 failed
- [x] Backfill script `scripts/backfill-recommendation-targets.ts` **run on local dev DB**: 149 rows fixed, 0 zero-target remain (verified via temp `.verify-targets.cjs`, deleted)
- [x] `useLivePrices` infinite-loop fix (`symbolsRef` stable callbacks, `slice().sort()`, guarded empty setState) — was 196 console errors on empty watchlist
- [x] SSE wiring: `HoldingsTable` (live price/value/P&L overlay + ● Live badge), `watchlist/page.tsx` (`liveQuoteFor` + badge), `MarqueeBanner` (30s refresh)
- [x] HistoryTab null-guard: `top-stocks` API coalesces `"HOLD"`/`0`; HistoryTab renders "—" for null confidence
- [x] Verification: tsc + eslint clean on touched files; Playwright — `/recommendations`, `/portfolio` (live RELIANCE ₹1,327.60 +1.76%), `/watchlist` (loop fixed, 0 errors), mobile 375px clean; `/api/recommendations/performance` returns non-zero targets
- [x] Docs updated: AGENTS.md (v3.5.1 row), `.agents/CHANGELOG.md` + `versions-v3.md`, CHANGELOG.md ([Unreleased]), Primer.md, agent-memory.md, Lessons.md (52-53)
- [x] **Committed + pushed + PR #82 opened** (3 commits: fix b7b6742, feat 370bcd4, docs 31c8f90) — never auto-merge

### Pending
- [ ] Merge PR #82 → deploy (Netlify) → verify prod
- [ ] PROD DB backfill: run `scripts/backfill-recommendation-targets.ts` against remote DB (needs user: Netlify `OPENROUTERKEY` env + remote DB access) — without the key, future runs still fall back to price-based defaults (now non-zero, so less urgent)
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] Fix prod issues #68 (monitoring logs) + #69 (sessions) — still open
