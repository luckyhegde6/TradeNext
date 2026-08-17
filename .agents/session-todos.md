# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-17) — v3.14.0 (Swing signals + screener fix + spec-driven dev) — branch `docs-readme-refs-agentic-coding`

**Working tree**: CLEAN. v3.14.0 code + tests + screener fix + spec-driven workflow + docs ALL COMPLETE — suite **758 pass / 4 skip**; `npx tsc --noEmit` **46 = exact baseline, 0 new**. Branch `docs-readme-refs-agentic-coding` with commits `2ff33f9` (v3.14.0) + `98b595b` (screener fix) pushed.

### Completed
- [x] **Swing signal persistence**: `SwingSignal` model, `swingPerformanceService.ts`, worker task, admin trigger, audit tags, worker-logs
- [x] **Spec-driven development workflow**: templates, rules, checklist v1.3
- [x] **Advanced screener fix**: Fix A (scanClause capture 150/150) + Fix D (try/catch + warning UI)
- [x] **Docs updated**: AGENTS.md, CHANGELOG, TODO, Primer, Lessons #82/#83, agent-memory, session-todos, HANDOFF.md
- [x] **Code committed + pushed**: `2ff33f9` (v3.14.0) + `98b595b` (screener fix)

### Pending
- [ ] **Create PR** on GitHub (`docs-readme-refs-agentic-coding` → `main`)
- [ ] **Live-verify :3000** after PR merge

### Pending (carried forward — other branches / later sessions)
- [ ] Prod DB fetch failures (reaper + processor `fetch failed` — transient Prisma Accelerate proxy issue, self-healing, LOW priority)
- [ ] Post-deploy (v3.10.0): verify swing indicators render + MCP `getHistoricalData` 200
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan`
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88)
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs + Netlify cron UI entries removal
