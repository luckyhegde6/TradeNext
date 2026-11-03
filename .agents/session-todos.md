## Current (2026-11-04 — Spec 40/41: SQLite sync amplification + DB Health runtime visibility + Sheets publish diagnostics)

Branch fix/sqlite-sync-startup-amplification, created from latest main after PR #153 merge. Specs/plans 40/41 are present.

- [x] Add bounded admin runtime endpoint for WorkerStatus/CronJob/WorkerTask timestamps.
- [x] Add DB Health Active Instances, cron schedule timestamps, task timeline and trigger labels.
- [x] Persist recommendation-performance and Swing companion progress as task events without double execution.
- [x] Surface sanitized Google Sheets header diagnostics; fix direct publish timestamp and explicit metrics publish outcome/feedback.
- [x] Add focused runtime, Sheets status, exporter and publish-route regression tests.
- [ ] Run targeted Jest suites and full required checks individually: npm run test, npx tsc --noEmit, npm run lint, npm run quickbuild.
- [ ] Review branch diff/status and resolve any failures. No commit/push/PR/merge/deploy beyond documentation commits already made through the branch API; deployment remains user-controlled.

Important limits: Active/stale classification uses WorkerStatus heartbeat freshness (15 min); idle worker processes may not refresh shared Prisma heartbeats continuously. First-seen is WorkerStatus.createdAt, not guaranteed process boot time. Runtime endpoint is bounded and separately polled to preserve the existing zero-Prisma DB Health GET. Sheets Sync now drains undelivered retry-ledger rows only; it does not replay delivered rows.

## Previous session context
## Current (2026-11-03 — v3.54.0 Spec 35 scheduled historical price sync)

Branch `fix/swing-indicators-daily-prices-gap` (from `main` `9a44878`) — **COMMIT PENDING USER; merge/deploy are user-only actions (D9)**.

- [x] **Spec + Plan 35** authored and approved (`.agents/specs/35-scheduled-historical-price-sync.md`, `.agents/plans/35-scheduled-historical-price-sync.md` — all boxes checked, deviations noted)
- [x] **5th system cron** — `Historical Price Sync (System)` `45 10 * * 1-5` (16:15 IST Mon–Fri) in `ensureRecommendationCrons()`, `SYSTEM_JOB_NAME_BY_TASK_TYPE` entry, per-def `defConfig` with `dryRun:false` on create + drift self-heal
- [x] **Scope + defaults** — `resolveSyncScope` = NIFTY 50 ∪ `getSwingSignalSymbols()` (mirror, zero Prisma), `DEFAULT_MAX_SYMBOLS 50→200`, `DEFAULT_DAYS 180→60`
- [x] **New mirror read** — `sqlite.getSwingSignalSymbols(limit)` (interface + impl, never throws, clamp 1…2000)
- [x] **Swing indicator fallback** — `fetchRecentCloses` Prisma → per-symbol SQLite gap fill; **`NSE:<SYMBOL>` key bug caught pre-commit** (Lesson 167) + regression test
- [x] **Tests** — 4 suites touched / **117 targeted pass**
- [x] **Gates** — `check-tsc-baseline` 46 exact (prod 0, delta +0) · full Jest **138/138 · 2110 pass / 4 skip / 0 fail** · ESLint 0 errors
- [x] **Docs** — `versions-v3.54.md` + CHANGELOG index + versions-index + Primer + agent-memory + Lesson 167 + HANDOFF + latest.md (AGENTS.md row DEFERRED, Lesson 142)
- [ ] **Commit + push + PR** — pending explicit user request
- [ ] **Live verify** — deferred (no local Postgres/Timescale this session); prod: one manual wide-scope `historical_price_sync` run, then the 16:15 IST cron

## Previous (2026-11-02 — Spec 36: AI-down actionable picks + duplicate daily-notice fix)

- [x] Spec 36 specification and plan authored/approved.
- [x] AI failure handling: HTTP 402/credit exhaustion recognized and quota latch + connection-test status wired.
- [x] Duplicate daily-notice suppression per UTC day; worker catch-up dedup verified.
- [x] AI-down broadcast uses screener/fallback-backed BUY/SELL picks when actionable; genuine all-HOLD preserved.
- [x] Swing and stock fallback paths verified to return technical target/stop levels with success:true.
- [x] Gates recorded: tsc 46 exact; targeted Jest 8 suites / 286 tests; lint 0 errors; doc-size gate pass.
- [ ] External blocker: OpenRouter credits/AI availability; deployment remains user-controlled.
- Spec/plan: .agents/specs/36-ai-down-actionable-picks-dedup.md and .agents/plans/36-ai-down-actionable-picks-dedup.md.

## Previous (2026-10-30 — AI fallback targets for Swing + Daily Recommendations)

- [x] **Create `lib/services/ai/fallbackAnalysis.ts`** — pure technical-analysis fallback target/SL calculation using momentum20, volatility20, distanceFrom20dHigh, changePercent; direction-aware via `evaluateRecommendationLevels`
- [x] **Modify `lib/services/ai/swing-agent.ts`** — replace `getDefaultSwingAnalysis` (OBSERVE, success:false) with `calculateFallbackSwingAnalysis` (directional, success:true) so targets show and analysisStatus becomes "done"
- [x] **Modify `lib/services/ai/recommendation-agent.ts`** — replace `getDefaultRecommendation` (HOLD, success:false) with `calculateFallbackRecommendation` (directional, success:true) so daily picks persist with targets
- [x] **Modify `lib/services/dailyRecommendationService.ts`** — remove the all-fail early-return that discards the run; fallback results now succeed so the run completes normally
- [x] **Add/update tests** for fallback analysis + agent integration — 113 tests pass
- [x] **Verify**: tsc (prod 0), Jest (fallback + swing + daily suites), eslint
- [x] **Document**: agent-memory.md, Primer.md, session-todos.md
