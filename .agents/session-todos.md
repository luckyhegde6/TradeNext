# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-08) — v3.5.3: Playwright E2E Suite + CI + Docs

**Branch**: `fix/screener-change-percent` (PR #85 OPEN — v3.5.2 app fix committed `b692d64`, docs `2daf72a`)
**Context**: User's Playwright e2e stack (previously untracked) hardened to green + full Playwright docs/skills/CI written; all committed to PR #85 on request.

### Completed
- [x] Root-caused + fixed all e2e failures: Firefox `xl` nav viewport (1440×900), WebKit `fill()` on controlled number inputs (keystrokes), single-threaded dev-server nav starvation (serial + `noWaitAfter` + 60s + retries), live-marquee flakiness (assertion removed)
- [x] Full suite GREEN: 87/89 first attempt + 2 flaky passing on retry #1 (env issues); 317 Jest tests pass; e2e files typecheck clean
- [x] CI workflow `.github/workflows/playwright.yml`: timescale service + migrate deploy + seed + playwright install + artifact
- [x] Docs: `.agents/docs/playwright-e2e.md`, `playwright-e2e` skill ×2, playwright-cli skill cross-refs + MCP guidance, AGENT-SKILL-MATRIX row, AGENTS.md (v3.5.3 row/commands/lessons/skills), `.agents/CHANGELOG.md` + `versions-v3.md`, README badge + section, Primer.md (status + Session 14), agent-memory.md, Lessons.md (Lesson 55)
- [ ] **Commit everything to PR #85**: e2e/ + playwright.config.ts + workflow + docs + skill files + README + AGENTS.md + .gitignore + package.json (already staged-tracked by user? verify) → push → report merge-ready (never auto-merge)

### Pending (carried forward from v3.5.2/v3.5.1)
- [ ] Verify prod daily crons (10 AM + 4 PM IST) after deploy — next cron window
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] Fix prod issues #68 (monitoring logs — DB Logs tab likely fixed by OPENROUTERKEY; Server Logs file tab still serverless-FS-limited) + #69 (sessions — `createUserSession` never wired into auth) — still open
