# Session Archive — 2026-10-06 (v3.45.0 Spec 21 Degraded SQLite execution engine + preemptive plan-limit switch)

> Reference: `.agents/rules/session-decisions-flow.md`. Branch `feature/google-sheets-tracking`, base `f0c73c7` (parents `4010a26` + `8dce103`). Full detail: `.agents/changelog/versions-v3.45.md`.

## Decisions

1. **Scope (Spec 21)** — After the 2026-10-02 P6003 hold-lift premise proved FALSE (the plan-limit breaker never opened in prod), the v3.41.2 Prisma-read fallbacks are vestigial. Adopt a preemptive, plan-limit-budget-driven degraded engine over trying to trigger the plan-limit breaker. (Owner: system + user-approved spec)
2. **Mode-only gate (USER CORRECTION)** — A breaker-first guard violated spec §E ordering (degraded branch must sit ABOVE the unchanged `if (isPlanLimitBreakerOpen()) return;`). Fix: `isDegradedModeActive()` alone gates at 3 worker/cron sites — `worker-engine.ts` ~341/~713, `cron-daemon.ts` `fireJob` ~255; the unchanged breaker check stays below. Recorded as a **correction note** under the plan's `### Deviation log`, not a deviation row. (Owner: user)
3. **Mode precedence** — `off > forced > breaker > threshold`: operator `off` beats forced; forced beats breaker; breaker beats threshold. (Owner: system)
4. **Hysteresis thresholds** — enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed — avoids flapping at the boundary (Lesson 154). (Owner: system)
5. **Persistence of operator mode only** — `_degraded_state` persists the OPERATOR MODE only, never the computed active state; computed state is always derived from live input on boot (Lesson 155: a stale persisted "active" would starve recovery). (Owner: system)
6. **Unreadable ops → not active** — a degraded execution attempt must not silently skip a task (Lesson 155 catch→[] starvation); unreadable ops → degraded mode is NOT active → rethrow, task stays queued. (Owner: system)
7. **Zero Prisma incl. transitive (Lesson 156)** — the degraded branch performs zero Prisma operations, including transitively through mirror writers; SQLite sync is the only write path in degraded mode; outbox flows continue via mirror writers. (Owner: system)
8. **Queue semantics** — SQLite queue with 90-min dedup by CRON id, 5-task drain bound, 30-min stale-`running` reclaim. (Owner: system)
9. **Degraded leader** — Netlify-Blobs ETag-CAS lease (10-min lease / 60-s renew, fail-closed); identity memoized on `globalThis` as `${LEADER_SELF}#${randomUUID()}`. (Owner: system)
10. **Registry scope** — 29-type task registry with 2 degraded-safe task types (`recommendations`, `corp_actions`). (Owner: system)
11. **AGENTS.md deferral (Lesson 142)** — 32,666/32,768 B cap — do NOT edit AGENTS.md this version; record the v3.45.0 row in `.agents/changelog/versions-v3.45.md` and fill the table when AGENTS.md is next slimmed. (Owner: system + user)
12. **Lesson numbering 152–157 audit** — verified: 152 real-sql.js bind-arity, 153 `db.run(...).changes` vs `getRowsModified()`, 154 hysteresis comparisons, 155 catch→[] starvation, 156 transitive Prisma ban, 157 2×2 gate matrix. No holder-id lesson — citation dropped. (Owner: system)
13. **Undiagnosed findings → docs only (defer)** — follower snapshot-upload coordination (w/o changing `preserve-mirror`), 34 Chartink HTTP 419s, prod FCP 25235 ms / TTFB 20975 ms, `themeColor` viewport warnings, redeployment requirement — recorded in TODO + changelog for the next pass, NOT acted on now. (Owner: system)