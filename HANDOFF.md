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
last_updated: "2026-09-10T12:00:00Z"
feature: "v3.32.1-db-health-body-once-fix"
```

## Handoff Required?

**v3.32.0 MERGED to `main` via PR #117 (`38a27bf` merge; `e74ae54` feat · `df7959d` docs · `b75deb0` docs update). Post-merge hotfix on `main` working tree = v3.32.1 (db-health POST double-`req.json()` → parse the body ONCE + reuse `requestBody`): code+tests verified (NEW `dbHealthRoute.test.ts` 5/5) + live re-verified; DOC COMMIT PENDING USER (no push/merge/deploy).**
- **(1) DB probe + persistence** (`lib/sqlite.ts`) — `probeDbTimeNow()` (`SELECT NOW()` via `$queryRawUnsafe`, 10s timeout, `IST_OFFSET_MINUTES = 330`, `TIME_ALIGN_TOLERANCE_MS = 60_000`) + `persistTimeCorrection`/`deleteTimeCorrection`/`restoreTimeCorrection`/`persistTimeProbe`/`restoreTimeProbe` (`_backup_meta` keys `time_correction`/`time_probe_db`; types `:1753-1789`, interface `:247-257`, fallback `:5978-5983`).
- **(2) Correction engine** — NEW `lib/services/timeCorrection.ts` (`offsetMinutes = trueNow − serverNow`; `applyOffset` identity@0; `getCorrectedNow()`/`getCronFrom()` lazy read-through, no cache; `getTimeDiagnostics()`); **REAL BUG FIXED**: `parseIstDateTimeLocal` round-trip guard → `toIstIso(parsed).slice(0,16) === input` (epoch = `Date.UTC(y,m-1,d,h,min) − offset`).
- **(3) Device API/UI** — POST `probe_time` (`route.ts:395-425`, 30s throttle → 200-throttled; PG-down → 200 `available:false`; audit `ADMIN_DB_SYNC`/`time-probe`) + `set_time_correction`/`clear_time_correction`; GET zero-Prisma `time` block; **Time Synchronisation card** (`page.tsx:247/505-515/1540`); `lib/audit.ts` +`ADMIN_DB_TIME_CORRECTION_SET`/`ADMIN_DB_TIME_CORRECTION_CLEARED`.
- **(4) Scheduling wiring** — `getCronFrom()` (`recommendationCronService.ts` + `worker-engine.ts` nextRun sites `:598`/`:631`); `getCorrectedNow()` at due-claim `:645`/`:657`.
- **Verification (v3.32.1)**: NEW `dbHealthRoute.test.ts` **5/5** (real `Request` via `jsonPost` helper enforcing `bodyUsed`; restore/set_time_correction reuse the ONCE-parsed body — regressions fail pre-fix) + live re-verified Save/Clear on :3000. **Verification (v3.32.0)**: NEW `timeCorrection.test.ts` 20/20 (full manual `@/lib/sqlite` mock, no `process.env.TZ`); sqlite.test.ts **71/71**; targeted **118/118**; full **1106 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake); tsc **46 = exact baseline (0 new)**; no migration; no new packages; diff 7 modified +565/−10 + 6 new files (2 code, 2 spec/plan, versions-v3.32.md, session archive).
- **Deferred**: live `probe_time` DB check (local Postgres not running); durable TZ fix = correct `TZ`/`UTC` env on Netlify.
- **Next**: stage EXACTLY the v3.32.1 working-tree files (M `app/api/admin/db-health/route.ts` + ?? `lib/__tests__/dbHealthRoute.test.ts` + the v3.32.1 doc set: AGENTS.md, versions-v3.32.md, TODO.md, HANDOFF.md, Primer.md, Lessons.md #112, agent-memory.md, latest.md, sessions archive flow/decisions, session-todos.md, .agents/CHANGELOG.md) → run `/pre-commit-check` → commit `fix(admin): v3.32.1 db-health POST body-parsed-once (restore + set_time_correction)` → no push/merge/deploy without explicit approval.
- **Unrelated open**: PR #114 (v3.26.0 fixes + Accelerate docs) pending merge against `main`; v3.28.0/v3.27.0 diffs pending user commit; Phase 0 (Prisma Postgres provisioning) REQUIRED before Dec 1 2026 Accelerate retirement (BUGS.md #14); deferred daily recommendation job failures (Issue 3); held (req text not provided — no guess-implement): `dailyRecommendationService` AI-unavailable fallback + rate re-capture wiring.

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
| v1.11 | 2026-09-09 | Session v3.31.0 (SQLite-first NSE read architecture + low-frequency Prisma sync, Plan 09): state `in_progress`; branch `fix/v3.29.1-header-watchlist`; code + tests committed `9303bd7`→`653b617` (9 commits); doc commit pending user |
