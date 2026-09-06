# HANDOFF.md - Agent Orchestration State

> **Every agent MUST read this file at session start to understand the current orchestration state.**
> This is the central coordination point for all AI agents working on TradeNext.

---

## Current State

```yaml
status: "in_progress"             # ready | in_progress | handoff_required | recovery
current_agent: "system"          # Current agent type
next_agent: null                 # Next agent to process (if handoff_required)
handoff_version: "1.0"
last_updated: "2026-09-06T00:00:00Z"
feature: "v3.29.1-header-overflow-watchlist-skeleton"
```

## Handoff Required?

**On `main` (HEAD `d7e54cf` = merge of `fix/v3.28.1-sqlite-self-heal`; v3.29.0 `4563713` merged) — v3.29.1 Header overflow fix + Watchlist logged-out infinite-skeleton fix: code + regression test + live-browser verification + docs DONE; COMMIT PENDING USER (no push/merge/deploy).**
- **Header overflow fix** (`app/Header.tsx`, CSS-only): logged-in nav no longer overflows at 1440–1600px — Playwright DOM audit of **372 overflow checks + 9-width quick-check loop** → 0 overflow @1440 + @375 on watchlist/alerts/screener/advanced-screener; full e2e **87 passed / 2 flaky / 0 failed**.
- **Watchlist logged-out infinite-skeleton BUG (found during user-requested browser + Chrome DevTools visual observation)**: `app/watchlist/page.tsx` :303 guard `if (status === "loading" || loading)` dead-coded the `unauthenticated` "Please sign in to view your watchlist." card — the local `loading` (`useState(true)`) only clears inside `fetchWatchlists()` (authenticated-only) → logged-out visitors saw an eternal skeleton; e2e missed it (watchlist spec logs in first). **Fix (1 line)**: `status === "loading" || (status === "authenticated" && loading)` (authenticated UX unchanged).
- **Tests**: NEW `app/watchlist/__tests__/page.test.tsx` **3/3** — unauthenticated → sign-in + no skeleton (fails pre-fix), loading → skeleton, authenticated-empty → CTA; mocks `useSession`/`fetch`/`AiActionButton`/`Autocomplete`/`useLivePrices`.
- **Verification**: tsc **46 = exact baseline (0 new)**; full jest **1043 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake, not attributable); no schema change → no migration.
- **Live verified (Chrome DevTools, :3000)**: logged-out isolated context → sign-in card, 0 skeletons; logged-in demo → "Demo AI Watchlist" (RELIANCE ● LIVE ₹1,310.90 / -23.90 (-1.79%), OHLC table, Analyze / + Add / Delete), 0 console errors (Web Vitals GOOD), no overflow @375×812 / @2696.
- **Docs updated (all)**: AGENTS.md v3.29.1 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.29.md` v3.29.1 section, TODO.md row, Primer.md, agent-memory.md, Lessons.md #107, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md` (rewritten as v3.29.1 handoff), this file, `.agents/sessions/2026-09-06-v3.29.1-header-watchlist/`.
- **Next**: commit v3.29.1 when approved (`app/Header.tsx`, `app/watchlist/page.tsx`, `app/watchlist/__tests__/page.test.tsx` + doc set). Dev server PID 42644 left running (do not kill); temp probe files cleaned.
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) pending merge against `main`; v3.28.0/v3.27.0 diffs pending user commit; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14); deferred daily recommendation job failures (Issue 3).

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

No active handoff. See `.agents/session-todos.md` for the current session todo list and `.agents/handoffs/active/latest.md` for session state.

---

## Quick Links

| File | Purpose | Must Read? |
|------|---------|------------|
| `.agents/session-todos.md` | Current session todo list | Yes |
| `.agents/handoffs/active/latest.md` | Current session handoff | Yes |
| `.agents/handoffs/SCHEMA.md` | Handoff file format | Yes |
| `@Primer.md` | Project status | Yes |
| `@Lessons.md` | Rules & corrections | Yes |
| `@AGENTS.md` | Full development guide | Reference |
| `@agent-memory.md` | Activity log | Reference |
| `.agents/learning/README.md` | Self-learning system | Reference |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist | Reference |
| `.agents/security-checklist.md` | Security checklist | Reference |
| `.agents/linear-history.md` | Git flow & branching (warn-only main) | Reference |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code) | Reference |
| `.agents/documentation-standards.md` | Documentation standards | Reference |
| `.agents/docs/` | Subsystem deep-dives (recommendations engine, tasks/cron/workers, monitoring & logging, alerts) — read before editing those subsystems | Reference |
| `.githooks/` | Versioned git hooks (enabled via `core.hooksPath`) | Reference |

---

## Orchestration Rules

1. **Start**: Read @HANDOFF.md → Read latest.md → Read @Primer.md → Read @Lessons.md
2. **Work**: Update handoff files as you go; log in @agent-memory.md
3. **Handoff**: Use `/handoff` command when switching agents or completing
4. **Complete**: Archive handoff → Update @HANDOFF.md to `ready` → Update docs
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
| v1.8 | 2026-08-17 | Session v3.14.0 (swing signal persistence + advanced screener fix + spec-driven dev): state updated to `ready`; branch `docs-readme-refs-agentic-coding` committed + pushed |
| v1.9 | 2026-08-25 | Session v3.19.2 (SQLite expanded + recovery sync + admin DB health dashboard): state updated to `ready`; branch `feature/ai-intelligence` committed + pushed |
| v1.10 | 2026-08-27 | Session v3.20.1 + v3.20.2 (DB ops optimization + DB Health enhancements + Daily Price Cache batch writer): state `in_progress`; branch `feat/db-health-price-cache`; commit/push/PR in progress |
