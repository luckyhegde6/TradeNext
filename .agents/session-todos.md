# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-08) — v3.5.2: Screener `change` = % Fix

**Branch**: `fix/screener-change-percent` (from main @ `c7a30ba`)
**Context**: ~60 screener templates using `change_percent` matched 0 stocks on NSE; TV `change` IS the % change; `change_percent` null/unsupported as column/filter/sort.

### Completed
- [x] Root-cause: TV `change` = % change on NSE (RELIANCE 1334.8 vs 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink); `change_percent` probe `>1` → 0 rows
- [x] Rewrite "Short Term Breakouts" template → `thr("change","gt",0,"relative_volume_10d_calc","gt",1,"Perf.5D","gt",3)` → **250 stocks (was 0), 18/20 Chartink overlap**
- [x] Mass-fix all 57 remaining `change_percent` → `change` template args (grep: 0 remain)
- [x] Add `Perf.5D` to `FILTER_FIELDS` (`condition-tree.ts`) + FilterBuilder FIELD_OPTIONS
- [x] Fix `getTopMovers` (gainers change>3, losers change<-3, active vol>1M) + advanced route `percentChange ?? change` (removed ₹-formula)
- [x] UI semantics: `change` labeled "Change (%)"; ₹ derived `close*pct/(100+pct)` in ScannedResultsTable; % Change column sortable
- [x] Verification: 45 screener tests pass; tsc clean on 6 touched files (71 pre-existing errors all in untouched test files); Playwright — template loads 3 conditions, Run Scan "250 stocks found · 574ms", sortable % values real (SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%), zero console errors
- [x] Docs updated: AGENTS.md (v3.5.2 row), `.agents/CHANGELOG.md` index + `versions-v3.md`, CHANGELOG.md ([3.5.2]), TODO.md, Primer.md (status + Session 13), `.agents/changelog/screener.md` fix section, `.agents/session-todos.md`, latest.md handoff
- [ ] **Commit 6 files** (`screener-templates.ts`, `condition-tree.ts`, `tradingview-service.ts`, `app/api/screener/advanced/route.ts`, `ScannedResultsTable.tsx`, `FilterBuilder.tsx`) — leave user's Playwright files untracked; push + PR if that's the workflow

### Pending (carried forward from ph21)
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy — next cron window
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] Fix prod issues #68 (monitoring logs — DB Logs tab likely fixed by OPENROUTERKEY; Server Logs file tab still serverless-FS-limited) + #69 (sessions — `createUserSession` never wired into auth) — still open
