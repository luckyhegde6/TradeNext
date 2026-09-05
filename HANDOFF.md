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
last_updated: "2026-09-05T00:00:00Z"
feature: "v3.28.4-recs-read-first-edge-cache"
```

## Handoff Required?

**Branch `fix/v3.28.1-sqlite-self-heal` (on top of v3.28.3 `a1dd094`) — v3.28.4 read-first recommendations route + edge-cache of heavy latest-run reads: code + regression test + docs VERIFIED; COMMITTED `c90f052` + PUSHED (user-approved; no auto-merge/deploy).**
- **v3.28.4 — Read-first recommendations route + edge-cache the heavy latest-run reads** (user-approved "Both" fix, on top of v3.28.3): **(1) Key collision** — `app/api/recommendations/route.ts` wrote its serialized `responseBody` under the **service's** `LATEST_KEY` (`"recommendations:latest"`), clobbering the `LatestCacheEntry {runId, newestRunId, data}` → the cross-instance fingerprint check read `cached.runId === undefined` → the heavy stocks-include query (95 rows) re-ran on **EVERY request** (db-health read-tier `recommendations.prisma` 14/14 huge-query misses). **(2)** Heavy reads unedge-cached despite v3.27.0's `withAccelerateCache`.
- **Fix**: route gains `ROUTE_CACHE_KEY = "recommendations:api:latest"` + `ROUTE_CACHE_TTL_SECONDS = 60` + typed `RouteRecommendationsCacheBody`, with a read-first memory fast path after the breaker block (`servedFrom: "memory_cache"`, `recordRead("recommendations.memory", {hit:true})`, zero Prisma); all three legacy `"recommendations:latest"` refs (breaker fallback, `set`, DB-error fallback) switched to the route key — the service key is never touched by the route. `getLatestRecommendations`' two heavy `findFirst` reads (`latestRun` stocks-include + `newestRun` lightweight select) wrapped in `withAccelerateCache({ttl: 60, swr: 30})`; **fingerprint probes stay uncached** (cross-instance staleness guard); `findFirst`+`include` payload falls back to the bare model through the wrapper → re-used the existing `as RunWithStocks | null` cast at the `serializedStocks` usage.
- **Tests**: factory gains the pure `withAccelerateCache` stub (spread preserves keys — existing `where/select` assertions still pass) + NEW regression asserting fingerprint calls lack `cacheStrategy` while heavy calls[2]/[3] carry `{ttl:60, swr:30}` → `dailyRecommendationService.test.ts` **34/34**.
- **Verification**: tsc **46 = exact baseline (0 new)**; targeted recs 34/34 + readTier/recPerf 25/25; full suite **1004 pass / 4 skip / 2 fail** (2 = documented pre-existing `intelligence.test.ts` async cache-flake; excluding it: 72 suites / 1004 pass / 4 skip / 0 fail). No schema change → no migration. Also removed the orphaned duplicate `# v3.28.2` header at EOF of `.agents/changelog/versions-v3.28.md`.
- **Docs updated (all)**: AGENTS.md v3.28.4 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.28.md`, TODO.md, Primer.md, agent-memory.md, session-todos, this file.
- **Next**: merge/deploy v3.28.1-4 when approved (v3.28.4 `c90f052` committed + pushed); then proceed with the user-approved UI/UX spec for Chartink scanners / backtest / screener stocks / watchlist.
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) still pending merge against `main`; v3.28.0 + v3.27.0 diffs also pending user commit; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14); deferred **daily recommendation job failures** (Issue 3).

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
