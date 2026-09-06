# Session Flow — 2026-09-06 (v3.29.1)

## Execution path
1. **Read docs for session start**: HANDOFF.md, latest.md, Primer.md, Lessons.md, session-todos.md, AGENTS.md.
2. **Git reality check**: `git status --short`, `git log --oneline -3` → HEAD = `main` @ `d7e54cf` (merge of `fix/v3.28.1-sqlite-self-heal`); v3.29.0 `4563713` merged; pending = `M app/Header.tsx`, `M app/watchlist/page.tsx`, `?? app/watchlist/__tests__/` + ~23 temp probe files.
3. **Header overflow verification** (carried fix): Playwright DOM audit — 372 overflow checks + 9-width quick-check loop across watchlist/alerts/screener/advanced-screener → **0 overflow** @1440 and @375; full e2e **87 passed / 2 flaky / 0 failed**.
4. **User-requested browser visual observation of `/watchlist`** (Chrome DevTools MCP):
   - Logged-out (isolated context, page 17): eternal skeleton → **BUG FOUND** (:303 dead-code branch; local `loading` never cleared because `fetchWatchlists()` is authenticated-only).
   - Logged-in demo (page 16): "Demo AI Watchlist" — RELIANCE ● LIVE ₹1,310.90 / -23.90 (-1.79%), OHLC table, Analyze/+ Add/Delete; 0 console errors; Web Vitals GOOD; no overflow @375×812 / @2696.
5. **User approved the fix** → applied 1-line change `app/watchlist/page.tsx` :303: `status === "loading" || (status === "authenticated" && loading)`.
6. **Regression test**: NEW `app/watchlist/__tests__/page.test.tsx` (3) — unauthenticated → sign-in + no skeleton (fails pre-fix), loading → skeleton, authenticated-empty → CTA; mocks `useSession`/`fetch`/`AiActionButton`/`Autocomplete`/`useLivePrices`. Jest **3/3**.
7. **Verification**: tsc `npx tsc --noEmit` **46 = exact baseline (0 new)**; full jest **1043 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); backtest probe clean; live browser re-verified both auth states.
8. **Docs (this step)**: AGENTS.md v3.29.1 row; `.agents/CHANGELOG.md` index row; `.agents/changelog/versions-v3.29.md` v3.29.1 section; TODO.md row; Primer.md (Last Updated + Current Project Status); agent-memory.md entry; Lessons.md #107 + Update Log bullet; `.agents/session-todos.md`; latest.md handoff rewrite; HANDOFF.md Current-State yaml refresh; this session folder.

## Code touched
- `app/Header.tsx` (CSS-only overflow fix — carried from session start, uncommitted)
- `app/watchlist/page.tsx` (:303 loading-guard fix — new this session, uncommitted)
- `app/watchlist/__tests__/page.test.tsx` (NEW, 3 tests — uncommitted)

## Tooling notes (Windows cmd)
- `&` = separator, not background operator → `npx tsc --noEmit … & echo TSC-STARTED` ran tsc foreground; the 30s tool kill truncated it (`tmp-tsc2.log` SIZE=0). Foreground run with 120s timeout succeeded.
- Playwright login needs a hydration wait: fill signin form → click Sign In → wait for header/avatar before the next step (specs already do this).
- Grep tool: `path` = a DIRECTORY + `include` filter (whole-repo greps get polluted by `.opencode/skills`, `.claude/skills`).

## Next (handed to user)
- Commit approval: `app/Header.tsx` + `app/watchlist/page.tsx` + `app/watchlist/__tests__/page.test.tsx` + this doc set. No push/merge/deploy without explicit approval.