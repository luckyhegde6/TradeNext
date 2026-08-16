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
last_updated: "2026-08-16T17:10:00Z"
feature: "v3.12.0-swing-async-analysis-prod-stability-backfill"
```

## Handoff Required?

**No active handoff.** Session v3.12.0 on branch `fix/swing-async-analysis` (**COMMITTED + PUSHED — PR #95 open**, `f1f5a91` code + `7910ed0` docs): (1) **Swing tab prod failure FIX — request-time split**: `GET /api/recommendations/swing` ran the FULL pipeline synchronously (34 Chartink templates + AI analysis 38–52s/batch) → Netlify's 30s request wall killed the tab forever (`Duration: 30000 ms` in prod logs). Fix: returns the fast screener feed instantly with `analysisStatus:"pending"` + `runSwingAnalysisInBackground()` (module-guarded fire-and-forget, dedupe, `flushSwingAnalysis()` test hook) → patches analysis, honest `analysisStatusAfterBatch`, persists trackers, audits, re-sets the same 30-min cache key (pending self-expires at 10-min `SWING_PENDING_TTL`); `SwingTab` pulsing "AI targets generating…" badge + SWR function-form `refreshInterval`. (2) **Prod-stability batch**: perf-check live-price fallback (cap 50, chunked `getStockQuote` — prod perf had 130 trackers but only 8 with `daily_prices` rows); **prod `daily_prices` backfill APPLIED (user-approved)** — 3 passes, **21,195 bars, 0 errors** → coverage **8 → 115/130 tracking trackers (88%)**, prod **37,387 rows / 602 tickers** (15 stragglers = NSE 200-with-empty-data, probed; covered by fallback); heartbeat-aware worker reaper (fail-safe `{0,0}`); Prisma per-query timeout (`PRISMA_QUERY_TIMEOUT_MS` 120s); worker-logger `resolveLogsDir()`; error serialization (worker-engine/cron-daemon); `scripts/fetch-swing-prices-to-prod.ts` import fixed; verdicts read-only verified. **Verification**: suite **722 pass / 4 skip** (was 711/4); tsc **46 = exact baseline 0 new**; live-verified :3000 (6s pending → 225ms done, 20/20 AI targets, 0 console errors). Docs updated (AGENTS.md v3.12.0 row, CHANGELOG index + versions-v3.md, TODO rows, Primer Session 19, Lessons #78–80, agent-memory, session-todos, handoff latest.md, session `2026-08-16-a6d2f41`). **Remaining: user merges PR #95 → Netlify rebuild = deploy → post-deploy smoke** (Swing tab instant load + targets ~2–3 min; `/api/recommendations` `latestRun` healthy; Performance Check shows Current/Return % for the 130 trackers). Also deleted fully-merged branch `feat/v3.6.1-recs-defaults-bridge-context` (local + remote) at user request.

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

No active handoff. Session v3.12.0 committed (`f1f5a91` code, `7910ed0` docs) + pushed — **PR #95 open, merge pending** (Netlify rebuild = deploy). See `.agents/session-todos.md` for the current session todo list and `.agents/handoffs/active/latest.md` for session state.

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
