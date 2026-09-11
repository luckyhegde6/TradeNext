# v3.36.0 — Swing steady-state serve fix — done/failed analysis jobs served INDEFINITELY; `force=1`-only regeneration with performance kick (no auto-re-scan on a plain load)

- **Date**: Sep 11 2026
- **Branch**: `fix/workers-tasks-monitoring` (issue #119 branch, on top of PR #118 merge `10e2a00`; code + tests **VERIFIED, commit/push pending user** — merge/deploy PENDING USER)
- **Status**: Code + tests VERIFIED; live-verified on :3000 (all 5 behavior points + 0 console errors); commit/push pending; merge/deploy PENDING USER
- **Plan / Spec**: none — user-directed steady-state fix ("Ready to commit and push"): plain `/api/recommendations/swing` loads must NOT re-scan/re-analyze when a done or in-flight job already exists

## Root cause
The swing analysis pipeline (issue #119 workstream) generated AI analysis on EVERY
plain load at steady state. After a job finished (`done`) or was still running
(`pending`/`running`), a plain tab refresh hit the serve path and re-ran the full
screener + AI pipeline — burning NSE requests and OpenRouter tokens with NO new
data, and making the Swing tab slow again on every visit. Only `force=1` should be
able to trigger a regeneration.

## Fix
`lib/services/swingRecommendationService.ts` — rewrite the serve path
(`latestJob && !forceRefresh` block, ~L988-1135; `SWING_JOB_STALE_MS` L649,
`jobToResponse` L653-682, `maybeProcessSwingAnalysis` L860-900):

- **Existing done/failed result served INDEFINITELY** — no age gate, no
  auto-regeneration on a plain load. The new comment block at the top of the serve
  path documents: `// USER-DIRECTED: serve the existing DONE/FAILED analysis
  // indefinitely on plain loads — only force=1 regenerates.`
- **`force=1` is the ONLY regeneration trigger** — it supersedes pending/running
  jobs AND now kicks `checkSwingPerformance()` for the superseded job (new
  `Swing performance check starting` live-verified at 17:18:25 after a prior done
  job existed).
- **Liveness semantics** (new `staleBefore` logic): `staleBefore =
  Date.now() - SWING_JOB_STALE_MS`; staleness anchor = `pending → createdAt`,
  `running → startedAt`, else `NaN`; stale when `!NaN && < staleBefore`.
- **Newest-TERMINAL (done/failed) fallback**: when the newest job is fresh
  in-flight, fall back to the newest done/failed job (so a terminal result still
  shows while a stale/non-terminal later job is stuck).
- **Prisma fallback**: when the SQLite mirror is empty, fall back to Prisma and
  serve a done job without re-scanning.
- **Durable pending job on plain first load**: when mirror + Prisma are both
  empty, CREATE a durable pending job (NO in-memory-only run) so the processor
  picks it up — first load still kicks analysis, but through a durable job.
- No schema change; no migration; no new packages.

## Tests
- `lib/__tests__/swingRecommendationService.test.ts` — **57/57 PASS**; 5 new:
  - "serves an old done job indefinitely — no regeneration on plain loads"
  - "serves the newest done job when a stale pending job hides behind it — no auto-regen"
  - "falls back to Prisma when the mirror is empty and serves a done job without re-scanning"
  - "creates a durable pending job on a plain first load (mirror + Prisma empty), no in-memory-only run"
  - "kicks a performance check when force-refreshing with a prior done job"

## Verification
- Live :3000 (log `%TEMP%\opencode\next-dev.log`): 17:16:05 first plain load →
  durable job `7d841b4e-19e0-436b-8d31-54c544f2714d` + processor batches 1–4;
  11 polls 17:16:19–17:18:00 all `Swing served from DB job (in flight),
  status=running` — ZERO re-scans; 17:18:05 `Swing analysis complete, total=20,
  succeeded=20, failed=0`; 17:18:10 plain load after done → served from memory
  cache, NO `Swing run starting`; 17:18:25 force=1 → `Swing run starting` +
  `Swing performance check starting` (perf-kick confirmed live) → new durable job
  `01fd4204-2dc1-44f0-89fd-22c169779dea`; 8 post-force polls in-flight, no
  re-scans. Console: 64 msgs, 0 errors/warnings, all API 200.
- `npx tsc --noEmit` **46 = exact baseline (0 new)** · no schema change → no
  migration · no new packages · diff = 2 files +266/−12 (service + test)

## Notes / Next
- Docs pass: AGENTS.md row + CHANGELOG index row + TODO.md row + Primer.md
  (Last Updated + Current Project Status) + Lessons.md #116 + agent-memory.md
  entry + this file.
- Two commits on explicit user approval: (1) the 2 code files, (2) `docs: update
  changelog [skip ci]`; then push `origin fix/workers-tasks-monitoring`; then
  resume issue #119 (worker task busying/heartbeats/UI log viewer per issue body
  `C:\Users\lucky\AppData\Local\Temp\opencode\issue-workers.md`).