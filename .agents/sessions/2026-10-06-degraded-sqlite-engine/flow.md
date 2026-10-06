# Execution Flow — 2026-10-06 (v3.45.0 Spec 21 Degraded SQLite execution engine)

## Objective
Preemptive degraded-mode + SQLite-first execution engine for the worker/cron core (recommendations + corp-actions) so plan-limit budget exhaustion cannot hard-fail those daily jobs.

## Sequence
1. Branch `feature/google-sheets-tracking` base `f0c73c7` (deepmerge override; parents `4010a26` sqlite repair + `8dce103` CI fix) — Spec 21 work sits on the branch carrying v3.44.0 (pushed, PR #133) + v3.43.0 (unpushed).
2. `lib/services/degradedMode.ts` — mode precedence `off > forced > breaker > threshold`, hysteresis (enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed), `_degraded_state` (operator mode only), unreadable ops → not active.
3. `lib/services/degradedLeader.ts` — Netlify-Blobs ETag-CAS degraded leader (10-min lease / 60-s renew, fail-closed).
4. `lib/services/worker/{degradedQueue,degradedTaskRegistry,degradedExecutor}.ts` + `lib/services/corpActionPurpose.ts` — SQLite queue (90-min dedup by CRON id, 5-task drain bound, 30-min stale-`running` reclaim), 29-type registry, 2 degraded-safe.
5. **USER CORRECTION**: breaker-first guard → `isDegradedModeActive()` alone gates at 3 sites (`worker-engine.ts` ~341/~713, `cron-daemon.ts` `fireJob` ~255) per spec §E ordering (degraded branch ABOVE the unchanged breaker check); correction note added to the plan's `### Deviation log`.
6. Admin `GET/POST /api/admin/degraded-mode` (mode + stats + queue + leader) + 5 audit tags.
7. Tests: 6 new Jest suites (~144 tests) incl. Lesson 157 2×2 gate matrix; worker-engine **36/36**, cron-daemon **25/25**.
8. Gates: Jest **134/134 · 1972 pass / 4 skip / 0 fail** · tsc **46 exact (prod 0)** · lint **0 errors (1158 warnings)** · quickbuild **199/199** · doc budget **91.4/100 KB**.
9. Docs phase: `versions-v3.45.md` + CHANGELOG + versions-index + Lessons 152–157 + TODO/Primer/agent-memory/session-todos/HANDOFF/latest + session archive. AGENTS.md untouched (32,666/32,768 B cap deferral — Lesson 142).
10. Handoff: awaiting user go-ahead for ONE authorized v3.45.0 commit + PR #133 update (no auto-commit/push/PR/merge/deploy).

## Files touched (Spec 21)
- NEW `lib/services/degradedMode.ts`, `lib/services/degradedLeader.ts`, `lib/services/corpActionPurpose.ts`
- NEW `lib/services/worker/degradedExecutor.ts`, `lib/services/worker/degradedQueue.ts`, `lib/services/worker/degradedTaskRegistry.ts`
- MOD `lib/services/worker/worker-engine.ts` (≈341, ≈713), `lib/services/worker/cron-daemon.ts` (`fireJob` ≈255)
- NEW `app/api/admin/degraded-mode/route.ts`
- NEW 6 Jest suites + route tests
- DOCS: `.agents/changelog/versions-v3.45.md`, `.agents/CHANGELOG.md`, `.agents/changelog/versions-index.md`, `Lessons.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/session-todos.md`, `HANDOFF.md`, `.agents/handoffs/active/latest.md`, this archive

## Config & constants
- Hysteresis: enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed
- Queue: 90-min dedup (CRON id) · 5-task drain bound · 30-min stale-`running` reclaim
- Leader: 10-min lease / 60-s renew · ETag-CAS on Netlify Blobs · fail-closed
- Registry: 29 task types, 2 degraded-safe (`recommendations`, `corp_actions`)

## Handoff conditions
- Re-verify gates only if code changes; commit/push/PR/merge/deploy on explicit user request only.