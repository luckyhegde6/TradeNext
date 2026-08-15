# HANDOFF.md - Agent Orchestration State

> **Every agent MUST read this file at session start to understand the current orchestration state.**
> This is the central coordination point for all AI agents working on TradeNext.

---

## Current State

```yaml
status: "in_progress"              # ready | in_progress | handoff_required | recovery
current_agent: "system"          # Current agent type
next_agent: null                 # Next agent to process (if handoff_required)
handoff_version: "1.0"
last_updated: "2026-08-15T14:45:00Z"
feature: "v3.11.2-recs-cache-module-graph-singleton"
```

## Handoff Required?

**No active handoff.** Session v3.11.3 (Full serverless purge — Netlify treated as a persistent server) on branch `fix/cron-tz-swing-perf` (on top of v3.11.2, which is committed + pushed as `84d86ca` + `0cf44a2`; v3.11.0 `6c4ef41` + v3.11.1 `b2d9423` committed but unpushed; work-in-progress, NOT committed): removed every "serverless" branch/opt-out/Blob dependency the v3.11.0 in-process daemon made obsolete. **`CRON_DAEMON_DISABLED` opt-out REMOVED** from `instrumentation.ts` + `cron-daemon.ts` — the daemon must self-start on Netlify now (⚠️ BREAKING vs v3.11.0 doc; `NEXT_RUNTIME`/`NEXT_PHASE` build/Edge guards kept). **Blob logging REMOVED**: `lib/netlify-logger.ts` deleted (`git rm`), `@netlify/blobs` dropped (41 packages removed); `lib/logger.ts` + `worker-logger.ts` stripped all Blob/serverless branches; monitoring route/page dropped `serverless:` fields + amber ephemeral-logs banner; ai-monitoring copy + `app/llms.txt` updated; ~25-file comment sweep (incl. docs/architecture.html ×6, prisma/schema.prisma). **`DataFetcher.test.tsx` describe.skip REWRITTEN** for the current `apiUrl`+`render` render-prop API with `useApi` mocked — **9/9 pass** (was 0 skipped). **Suite 709 pass / 4 skip** (was 700/11; 4 skips = intentional client-cache); `npx tsc --noEmit` **46 errors — DOWN from 71 baseline, 0 new** (rewrite removed ~25 stale errors). `git grep` proves 0 functional serverless/blob references in code (prisma schema boilerplate kept; "server-logs" monitoring tab names kept). Docs updated (AGENTS.md v3.11.3 row, CHANGELOG index + versions-v3.md, TODO.md row, Primer, agent-memory, Lessons #77, session-todos, handoff latest.md, serverless-logging.md superseded). **Remaining: commit v3.11.3 (pending user) → push `fix/cron-tz-swing-perf` (contains unpushed v3.11.0/v3.11.1 too) → PR (ask first); NO deploy** (Netlify must NOT set `CRON_DAEMON_DISABLED=1` anymore; netlify.toml ships no functions dir; remove Netlify cron UI entries after deploy).

---

## Agent Pipeline

| Step | Agent | Status | Handoff |
|------|-------|--------|---------|
| 1 | GH Helper | ⏳ Idle | - |
| 2 | Integrator | ⏳ Idle | - |
| 3 | QA | ⏳ Idle | - |
| 4 | DevOps | ⏳ Idle | - |
| * | Observability | ⏳ Idle | - |

## Active Handoff

No active handoff. Session ph19 code + docs complete; pending test run, deploy, and prod verification. See `.agents/session-todos.md` for the current session todo list and `.agents/handoffs/active/latest.md` for session state.

---

## Quick Links

| File | Purpose | Must Read? |
|------|---------|------------|
| `.agents/session-todos.md` | Current session todo list | ✅ Yes |
| `.agents/handoffs/active/latest.md` | Current session handoff | ✅ Yes |
| `.agents/handoffs/SCHEMA.md` | Handoff file format | ✅ Yes |
| `Primer.md` | Project status | ✅ Yes |
| `Lessons.md` | Rules & corrections | ✅ Yes |
| `AGENTS.md` | Full development guide | 📖 Reference |
| `agent-memory.md` | Activity log | 📖 Reference |
| `.agents/learning/README.md` | Self-learning system | 📖 Reference |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist | 📖 Reference |
| `.agents/security-checklist.md` | Security checklist | 📖 Reference |
| `.agents/linear-history.md` | Git flow & branching (warn-only main) | 📖 Reference |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code) | 📖 Reference |
| `.agents/documentation-standards.md` | Documentation standards | 📖 Reference |
| `.agents/docs/` | Subsystem deep-dives (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) — read before editing those subsystems | 📖 Reference |
| `.githooks/` | Versioned git hooks (enabled via `core.hooksPath`) | 📖 Reference |

---

## Orchestration Rules

1. **Start**: Read HANDOFF.md → Read latest.md → Read Primer.md → Read Lessons.md
2. **Work**: Update handoff files as you go; log in agent-memory.md
3. **Handoff**: Use `/handoff` command when switching agents or completing
4. **Complete**: Archive handoff → Update HANDOFF.md to `ready` → Update docs
5. **Recovery**: If session crashes, next agent reads latest.md and continues

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| v1.0 | 2026-07-16 | Initial handoff orchestration system |
| v1.1 | 2026-08-06 | Session ph19 (prod reliability fixes): updated state, added session-todos + pre-commit + security references |
| v1.2 | 2026-08-06 | Session ph19: added gardenify docs links (linear-history, code-hygiene, documentation-standards, .githooks/) |
| v1.3 | 2026-08-06 | Added `.agents/docs/` subsystem deep-dive reference (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) |
| v1.4 | 2026-08-07 | Session ph20 (recommendation performance tracking, v3.5.0): updated state to ph20, session-todos refreshed |
| v1.5 | 2026-08-07 | Session ph21 (carry-forward, v3.5.1): target/SL ₹0 fix + SSE live prices + HistoryTab null-guard; state updated to ph21 |
| v1.6 | 2026-08-08 | Session v3.5.3 (Playwright e2e suite): state updated to e2e docs/commit phase; feature `playwright-e2e-suite` |
| v1.7 | 2026-08-11 | Session v3.5.7 (auth join→approve→login fix + server logs `logs/` dir): state updated; feature `v3.5.7-auth-login-fix-logs-dir`; commit/PR pending, no deploy |
