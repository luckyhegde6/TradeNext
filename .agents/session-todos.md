# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-06) — Prod Reliability Fixes (v3.4.1)

- [x] Fix `runDailyRecommendations` Prisma transaction timeout (interactive `$transaction` → `runInChunks` bounded-concurrency helper)
- [x] Fix AI monitoring persistence (fire-and-forget `persistAiCallToDb`; merged DB+memory reads in `/api/admin/ai/monitoring`; source badge in admin page)
- [x] Cap daily recommendations to top 50 (`rankAndCapRecommendations` — screenerCount + marketCap + momentum composite score)
- [x] Fix Telegram daily recommendations not updating (invalidate cache after performance check; broadcast always sends; handlers prefer tracker live prices)
- [x] History tab: show Predicted vs Current price + return % (top-stocks API joins `recommendation_trackers`)
- [x] Add DB-backed logs tab to admin monitoring (new `type=db-logs` in `/api/admin/monitoring` + tab in monitoring page)
- [x] Prod UI/UX audit (2026-08-06) documented in TODO.md
- [x] Port gardenify agentic patterns (session-todos, pre-commit workflow, security checklist)
- [x] Run full typecheck (`npx tsc --noEmit`) — zero errors in modified production files
- [x] Update docs (AGENTS.md version history, HANDOFF.md, Primer.md, agent-memory.md, Lessons.md, TODO.md)
- [x] Run full test suite (`npm run test`) — 269 passed, 11 skipped, zero regressions (test mock updated for `.catch()` fire-and-forget; cap test updated to 50)
- [x] Create tracked `.githooks/` (pre-commit enhanced, post-commit, pre-push) + `git config core.hooksPath .githooks`
- [x] Port gardenify docs: `.agents/linear-history.md`, `.agents/code-hygiene.md`, `.agents/documentation-standards.md`
- [x] Update AGENTS.md operating model (Git Hooks, Agent Operating Model, Plugins & MCP + ponytail recommendation) + v3.4.2 version entry
- [x] Update `.agents/pre-commit-workflow.md` (hook reference + new doc links) and `.agents/session-todos.md`
- [x] Run full typecheck + test suite one final time before commit
- [x] Commit v3.4.2 (hooks + gardenify docs port)
- [ ] Deploy to Netlify + verify on prod (recommendations stale-data fix, Telegram updates, history prices, DB logs tab)
- [ ] Verify prod daily cron runs successfully (10:00 AM IST) after deploy

## Carried Forward

- [ ] Re-seed demo holdings on prod (empty Portfolio for demo user)
- [ ] Wire live-price SSE hooks into Portfolio/Watchlist tables
- [ ] Persist default `HOLD` label when AI analysis falls back (fix bare "🟡 %" history cards)
- [ ] F&O Analytics UI (services + API done, UI pending)
