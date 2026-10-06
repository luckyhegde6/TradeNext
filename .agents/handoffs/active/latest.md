# Live Resume — v3.45.0 Spec 21 Degraded SQLite execution engine + preemptive plan-limit switch

> Updated: 2026-10-06 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Degraded-mode + SQLite-first execution engine for the worker/cron core — recommendations + corp-actions (Spec 21) |
| **Branch** | `feature/google-sheets-tracking` (`f0c73c7`; parents `4010a26` sqlite repair + `8dce103` CI fix) |
| **State** | CODE + TESTS + GATES + DOCS **DONE** · **UNCOMMITTED** — one authorized Spec 21 commit + PR #133 update pending explicit user go-ahead |
| **In-flight** | None — Phase 7 docs complete (TODO/Primer/agent-memory/session-todos/HANDOFF/latest + session archive) |
| **Blocked** | Commit/push/PR/merge/deploy — awaiting explicit user approval (no auto-commit/push/PR/merge/deploy). Stale-CI note: one very old CI run on this branch is RED from a prior quickbuild+win32-compat change (deepmerge override `f0c73c7`); current local gates GREEN. |
| **Side note** | v3.44.0 legal pages COMMITTED + PUSHED (`fb29b16` → `66db159` → `ac24ede`, PR #133). v3.43.0 Sheets console `645cf85` + `aba7fa6` ride along on this branch. PR #132 (v3.41.3 Laya) remains OPEN and unrelated. P6003 hold premise proved FALSE — breaker never opened in prod; hold ended 2026-10-02. |

## What's done (v3.45.0)

- **Mode**: `lib/services/degradedMode.ts` — modes `auto|force|off`, precedence `off > forced > breaker > threshold`, hysteresis enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed; `_degraded_state` persists operator mode only; unreadable ops → not active; **zero Prisma ops in the degraded branch incl. transitively via mirror writers** (Lesson 156).
- **Leader**: `lib/services/degradedLeader.ts` — Netlify-Blobs ETag-CAS degraded leader, 10-min lease / 60-s renew, fail-closed; identity memoized on `globalThis` as `${LEADER_SELF}#${randomUUID()}`.
- **Worker engine**: `lib/services/worker/{degradedExecutor,degradedQueue,degradedTaskRegistry}.ts` + `lib/services/corpActionPurpose.ts` — SQLite queue (90-min dedup by CRON id, 5-task drain bound, 30-min stale-`running` reclaim), 29-type task registry with 2 degraded-safe (`recommendations`, `corp_actions`); mode-only gate at 3 worker/cron sites (`worker-engine.ts` ~341/~713, `cron-daemon.ts` `fireJob` ~255) ABOVE the unchanged `if (isPlanLimitBreakerOpen()) return;` (spec §E ordering, user correction).
- **Route + audit**: admin `GET/POST /api/admin/degraded-mode` (mode + stats + queue + leader) + 5 audit tags (`DEGRADED_MODE_ENTERED/EXITED/SET`, `DEGRADED_JOB_SKIPPED`, `DEGRADED_LEADER_UNAVAILABLE`).
- **Tests**: 6 new suites (~144 tests) incl. Lesson 157 2×2 gate matrix (worker-engine **36/36**, cron-daemon **25/25**) — full Jest **134/134 suites · 1972 pass / 4 skip / 0 fail**.
- **Gates**: tsc **46 exact (0 new; prod 0)** · lint **0 errors (1158 warnings, baseline 1155)** · quickbuild **199/199** · doc budget **91.4/100 KB**.
- **Docs**: `.agents/changelog/versions-v3.45.md` + CHANGELOG + versions-index + Lessons 152–157 + TODO/Primer/agent-memory/session-todos/HANDOFF/latest + session archive `2026-10-06-degraded-sqlite-engine/`. **AGENTS.md row DEFERRED** (32,666/32,768 B cap — Lesson 142 trap); recorded in the changelog, to be filled when AGENTS.md is next slimmed.

## Not done (deliberately)

- Commit as v3.45.0 — ONE authorized commit (code + docs); update PR #133. Needs explicit user go-ahead.
- Push/merge/deploy — needs explicit user approval. No auto-push/PR/merge/deploy.
- Full cross-browser e2e re-run post-commit → PR gate.
- Undiagnosed prod findings (recorded for next pass, NOT acted on): follower snapshot-upload coordination (w/o changing `preserve-mirror`) · 34 Chartink HTTP 419s · prod FCP 25235 ms / TTFB 20975 ms · `themeColor` viewport warnings · redeployment requirement. `swingPerformanceService.test.ts` dated-fixture fix handled as a separate concern.

## Next steps

1. **User decision: approve ONE v3.45.0 commit** (all Spec 21 code + docs) + PR #133 update — on explicit request only.
2. Before any public share/arm: rotate the Testing-mode token if still live (~minted Sep 28 ⇒ expired ~Oct 5); never print the OAuth refresh token.
3. Deploy path after approval: push → PR → merge → Netlify; include full Jest + cross-browser e2e at the PR gate.

## Gotchas / lessons for this handoff

- **User corrected a breaker-first guard violation** → spec §E ordering: `isDegradedModeActive()` gates alone at the 3 worker/cron sites; the unchanged breaker check stays below. Recorded as a correction note under the plan's `### Deviation log`.
- **Lesson 156**: zero Prisma ops in the degraded branch INCLUDING transitively — mirror writers (SQLite sync) are the only write path in degraded mode.
- **Lesson 157**: gate matrices must assert both halves (Prisma branch reaches its target AND degraded branch does NOT; and vice versa) — 2×2, not spot checks.
- Windows cmd: no `tail` (use findstr/find). Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- AGENTS.md is at cap — do NOT edit it (version row deferred by user decision).

## Remaining-merge state of PREVIOUS workstreams

- v3.44.0 (legal): committed + pushed — `fb29b16` → `66db159` → `ac24ede` (PR #133 open).
- v3.43.0 (Sheets console): committed `645cf85` + `aba7fa6` — push/merge pending user (rides on this branch).
- v3.41.3 (Laya): pushed, PR #132 OPEN — merge/deploy pending user.
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.