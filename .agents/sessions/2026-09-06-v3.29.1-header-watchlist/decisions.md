# Session Decisions — 2026-09-06 (v3.29.1)

## Context
- Continued from v3.29.0 (merged to `main` via `d7e54cf`). This session = the carry-over item: user-requested **browser + Chrome DevTools visual test of `/watchlist`** (logged-out + logged-in), which also re-validated the carried **header overflow fix** (`app/Header.tsx`, CSS-only).
- Actual git state (docs were stale on branch state): HEAD = `main` @ `d7e54cf` "Merge branch 'fix/v3.28.1-sqlite-self-heal' into main"; v3.29.0 committed `4563713` + merged. v3.28.5 = `6700076`.

## Decisions
1. **Watchlist logged-out skeleton is a real bug — fix now (user approved)**. Root cause: `app/watchlist/page.tsx` :303 `if (status === "loading" || loading)` dead-codes the `unauthenticated` branch because the local `loading` flag only clears inside `fetchWatchlists()` (authenticated-only). Fix = `if (status === "loading" || (status === "authenticated" && loading))` (1 line, authenticated UX unchanged). E2E structurally misses logged-out branches — cover with a regression unit-test, not another e2e.
2. **Header fix stays CSS-only** — no markup/prop changes; verified via Playwright DOM probes (372 overflow checks + 9-width quick-check loop) rather than a screenshot.
3. **Docs: do NOT rewrite historical rows** (v3.28.5 / v3.29.0 docs describe their state at write time). Write v3.29.1 entries against ACTUAL current state: "on `main`, on top of merged v3.29.0 `d7e54cf`; commit pending user".
4. **Windows cmd quirk (tooling)**: `&` is a command separator, NOT a bash background operator — `npx tsc --noEmit … & echo TSC-STARTED` keeps tsc in the FOREGROUND and the tool's 30s kill truncated it (log left SIZE=0). Run tsc foreground with a full timeout (120s) and check the log file; verify any `start /B cmd /c` run by polling the output file, not the tool's return.
5. **Verification gate** unchanged: tsc 46 = exact baseline (0 new) + new spec 3/3 + full-suite numbers with the documented `intelligence.test.ts` flake excluded from attribution.
6. **No commit/push/merge/deploy without explicit user approval.** Dev server PID 42644 (`cmd /c npm run dev > dev-server.log 2>&1`) left running — do not kill; `dev-server.log` therefore stays (open handle).

## Source of truth
- `git status --short` + `git log --oneline -3` (`d7e54cf` merge, `4563713` v3.29.0, `6700076` v3.28.5).
- Live browser: Chrome DevTools MCP page 16 (logged-in demo) + page 17 (isolated logged-out context).