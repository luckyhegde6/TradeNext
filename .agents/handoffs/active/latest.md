# Live Resume — v3.45.0 Spec 21 Degraded SQLite execution engine + preemptive plan-limit switch

> Updated: 2026-10-06 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Degraded-mode + SQLite-first execution engine for the worker/cron core — recommendations + corp-actions (Spec 21) |
| **Branch** | `feature/google-sheets-tracking` (v3.45.0 `138d69a`; parents `f0c73c7` deepmerge override, `4010a26` sqlite repair + `8dce103` CI fix; security-fix `a433039` pushed) |
| **State** | CODE + TESTS + GATES + DOCS **DONE** · **COMMITTED** `138d69a` (code + docs) + **security-deps fix** `a433039` + **PUSHED** + **PR #133 all 9 checks GREEN** + **MERGED into `main`** per explicit user approval (2026-10-06) |
| **In-flight** | None — merge complete; docs-status update committed as the final docs commit |
| **Blocked** | Nothing code-side. Remaining (user-controlled): Netlify deploy; 5 default-branch Dependabot alerts (1 high / 4 moderate — pre-fix deps on `main`) clear once the merged deps ship. Stale-CI note resolved: the old RED run was the pre-security-fix head; `a433039` gate all-green. |
| **Side note** | v3.44.0 legal pages COMMITTED + PUSHED (`fb29b16` → `66db159` → `ac24ede`, PR #133). v3.43.0 Sheets console `645cf85` + `aba7fa6` ride along on this branch. PR #132 (v3.41.3 Laya) was MERGED `4b68e30` (2026-09-25). P6003 hold premise proved FALSE — breaker never opened in prod; hold ended 2026-10-02. |

## What's done (v3.45.0)

- **Mode**: `lib/services/degradedMode.ts` — modes `auto|force|off`, precedence `off > forced > breaker > threshold`, hysteresis enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed; `_degraded_state` persists operator mode only; unreadable ops → not active; **zero Prisma ops in the degraded branch incl. transitively via mirror writers** (Lesson 156).
- **Leader**: `lib/services/degradedLeader.ts` — Netlify-Blobs ETag-CAS degraded leader, 10-min lease / 60-s renew, fail-closed; identity memoized on `globalThis` as `${LEADER_SELF}#${randomUUID()}`.
- **Worker engine**: `lib/services/worker/{degradedExecutor,degradedQueue,degradedTaskRegistry}.ts` + `lib/services/corpActionPurpose.ts` — SQLite queue (90-min dedup by CRON id, 5-task drain bound, 30-min stale-`running` reclaim), 29-type task registry with 2 degraded-safe (`recommendations`, `corp_actions`); mode-only gate at 3 worker/cron sites (`worker-engine.ts` ~341/~713, `cron-daemon.ts` `fireJob` ~255) ABOVE the unchanged `if (isPlanLimitBreakerOpen()) return;` (spec §E ordering, user correction).
- **Route + audit**: admin `GET/POST /api/admin/degraded-mode` (mode + stats + queue + leader) + 5 audit tags (`DEGRADED_MODE_ENTERED/EXITED/SET`, `DEGRADED_JOB_SKIPPED`, `DEGRADED_LEADER_UNAVAILABLE`).
- **Tests**: 6 new suites (~144 tests) incl. Lesson 157 2×2 gate matrix (worker-engine **36/36**, cron-daemon **25/25**) — full Jest **134/134 suites · 1972 pass / 4 skip / 0 fail**.
- **Gates**: tsc **46 exact (0 new; prod 0)** · lint **0 errors (1158 warnings, baseline 1155)** · quickbuild **199/199** · doc budget **91.4/100 KB**.
- **Docs**: `.agents/changelog/versions-v3.45.md` + CHANGELOG + versions-index + Lessons 152–157 + TODO/Primer/agent-memory/session-todos/HANDOFF/latest + session archive `2026-10-06-degraded-sqlite-engine/`. **AGENTS.md row DEFERRED** (32,666/32,768 B cap — Lesson 142 trap); recorded in the changelog, to be filled when AGENTS.md is next slimmed.

## Not done (deliberately)

- ~~Commit as v3.45.0 (ONE code + docs commit)~~ — **DONE** `138d69a`, pushed.
- ~~Security-deps fix~~ — **DONE** `a433039` (next 16.3.8 / nodemailer 10.0.15 / fast-uri+sharp+source-map-js overrides / security.yml prod-only audit), pushed; PR #133 all 9 checks GREEN.
- ~~Merge PR #133~~ — **DONE** per explicit user approval (2026-10-06).
- Netlify deploy — user-controlled (separate step, no auto-deploy).
- Full cross-browser e2e re-run at the PR gate — covered by the PR test check (green).
- Undiagnosed prod findings (recorded for next pass, NOT acted on): follower snapshot-upload coordination (w/o changing `preserve-mirror`) · 34 Chartink HTTP 419s · prod FCP 25235 ms / TTFB 20975 ms · `themeColor` viewport warnings · redeployment requirement. `swingPerformanceService.test.ts` dated-fixture fix handled as a separate concern.

## Next steps

1. **DONE — v3.45.0 committed `138d69a`** (all Spec 21 code + docs); **security-deps fix `a433039`** pushed; **PR #133 merged into `main`** per explicit user approval (2026-10-06).
2. Before any public share/arm: rotate the Testing-mode token if still live (~minted Sep 28 ⇒ expired ~Oct 5); never print the OAuth refresh token.
3. Deploy path (user-controlled): Netlify deploy of merged `main`; confirm the 5 default-branch Dependabot alerts (1 high / 4 moderate) clear after the merge.

## Gotchas / lessons for this handoff

- **User corrected a breaker-first guard violation** → spec §E ordering: `isDegradedModeActive()` gates alone at the 3 worker/cron sites; the unchanged breaker check stays below. Recorded as a correction note under the plan's `### Deviation log`.
- **Lesson 156**: zero Prisma ops in the degraded branch INCLUDING transitively — mirror writers (SQLite sync) are the only write path in degraded mode.
- **Lesson 157**: gate matrices must assert both halves (Prisma branch reaches its target AND degraded branch does NOT; and vice versa) — 2×2, not spot checks.
- Windows cmd: no `tail` (use findstr/find). Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.
- AGENTS.md is at cap — do NOT edit it (version row deferred by user decision).

## Remaining-merge state of PREVIOUS workstreams

- v3.44.0 (legal): committed + pushed — `fb29b16` → `66db159` → `ac24ede` + `4010a26` (PR #133 MERGED 2026-10-06).
- v3.43.0 (Sheets console): committed `645cf85` + `aba7fa6` — pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.