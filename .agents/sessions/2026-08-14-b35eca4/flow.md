# Session Flow — 2026-08-14 (v3.10.1) → continued 2026-08-15 (v3.11.0 → v3.11.1 → v3.11.2)

Branch: `fix/cron-tz-swing-perf` | Commit: `0e39902` (cron TZ, prior) + `b35eca4` (v3.10.1 batch, committed unpushed) + v3.11.0 daemon work + v3.11.1 no-fake-HOLD + v3.11.2 cache singleton (commits pending user)

## v3.11.2 execution path (2026-08-15, same branch/session)

```
1. User: "What did we do so far?" → prior summary → next step was the v3.11.1 cache-invalidation follow-up
   (recsCache dual-instance bug found during the v3.11.1 live-verify: "Last updated: 14/8/2026" persisted).

2. Root-cause investigation (grep + read, no code):
   - lib/cache.ts exports recommendationsCache (23h TTL) + main/hot/static/historical caches.
   - grep: only dailyRecommendationService.ts + recommendationPerformanceService.ts import recommendationsCache —
     BOTH are used by the worker (instrumentation.ts graph) AND the API routes (route graph).
   - CONCLUSION: Next.js dev (Turbopack) loads instrumentation.ts and API routes as SEPARATE module graphs, so
     lib/cache.ts was evaluated TWICE → two independent NodeCache instances. Worker's invalidateRecommendationsCache()
     (flushAll) hit ITS copy; the route kept serving the stale 23h 'latest' entry.

3. Fix (lib/cache.ts, surgical — ONE cache):
   - recommendationsCache → globalThis singleton: globalForCache.__recommendationsCache ?? (assign new NodeCache).
     Mirrors lib/prisma.ts. Comment documents the module-graph reasoning.
   - Other caches (main/hot/static/historical) UNCHANGED — short TTLs, no cross-module invalidation semantics
     (worker's market sync writes DB market_cache, read paths re-validate DB freshness — no dual-instance bug).

4. NEW lib/__tests__/cacheSingleton.test.ts (4 tests):
   - freshCacheModule(): jest.resetModules() + require("@/lib/cache") → simulates TWO module graphs.
   - afterEach: delete globalThis.__recommendationsCache (no cross-test leakage).
   - T1 identity: two loads → same instance (toBe).
   - T2 cross-instance visibility: set in load A, get in load B.
   - T3 worker→route regression: route caches 'latest' → worker flushAll → route get undefined + keys() empty.
   - T4 shared keys(): writes from both instances visible in both.

5. Verification: suite 700 pass / 11 skip (was 696; +4 new); tsc --noEmit 71 = exact baseline (0 new).
   No UI change → no Playwright re-run (consistent with checklist — server-side cache only).

6. Docs bundle (done): AGENTS.md v3.11.2 row; .agents/CHANGELOG.md index; versions-v3.md v3.11.2 entry;
   TODO.md row; Lessons #76 (per-module-instance caches → globalThis singleton pattern); Primer Last Updated +
   v3.11.2 status; agent-memory entry; HANDOFF state; session-todos; this flow.md + decisions.md D7.

7. Commits PENDING user (code + docs); NO push/deploy — same branch hold as v3.11.0/v3.11.1.
```

## Code touched (v3.11.2)

- lib/cache.ts (recommendationsCache → globalThis singleton; comment) — ONLY cache changed
- lib/__tests__/cacheSingleton.test.ts (NEW, 4 tests)
- Docs: AGENTS.md, .agents/CHANGELOG.md, .agents/changelog/versions-v3.md, TODO.md, Lessons.md (#76),
  Primer.md, agent-memory.md, HANDOFF.md, .agents/session-todos.md, this file, decisions.md (D7)

## Verification (v3.11.2)

- Suite 700 pass / 11 skip (54 suites + 1 pre-existing skip; was 696)
- tsc --noEmit 71 = exact baseline (pre-existing test-noise only)
- cacheSingleton.test.ts: 4/4 (identity, cross-instance visibility, worker→route flushAll invalidation, shared keys)

## v3.11.0 execution path (2026-08-15, same branch/session)

```
1. User: "What did we do so far?" → prior summary → next step was the v3.11.0 node-cron daemon (replace Netlify
   scheduled-function cron) + daysTracked fix + carried v3.10.1 batch docs.

2. Cron daemon core (NEW lib/services/worker/cron-daemon.ts + root instrumentation.ts)
   - instrumentation register(): NEXT_RUNTIME === "nodejs" && NEXT_PHASE !== "phase-production-build" &&
     !CRON_DAEMON_DISABLED → startCronDaemon().catch(logger). Idempotent start (alreadyRunning guard).
   - startCronDaemon(): ensureRecommendationCrons() (self-heal system rows) → syncCronJobs() → 60s resync interval
     + heartbeat interval + initial heartbeat. stopCronDaemon(): destroy tasks + clear intervals + running=false.
   - syncCronJobs(): load active CronJob rows; for each: unchanged → keep; expression-change → destroy+re-register;
     cron.validate() false → skip (log); deactivated/deleted → drop; per-job config.timezone default Asia/Kolkata.
     Returns { registered }.
   - fireJob(jobId): re-fetch row (admin edits apply immediately); no-op when missing/inactive; delegates to
     spawnDueCronJob (imported from worker-engine); try/catch → logger.error, never throws.
   - writeHeartbeat(): workerStatus.upsert keyed cron-daemon-<host>-<pid> (memory MB + loadavg), non-fatal.
   - getCronDaemonStatus() + getRegisteredJobIds() (test hook).

3. worker-engine.ts refactor: spawnDueCronJob(job: DueCronJob) extracted + exported — 90-min dedup
   (workerTask.findFirst pending/running + createdAt window), indexName payload defaults per taskType
   (recommendations/perf/market_data/ai_connection_test/historical_price_sync), nextRun advance via
   calculateNextRun (config.expression), systemManaged → triggeredBy "system". checkScheduledJobs loops calling it
   with per-job try/catch. Daemon + legacy poll share ONE path.

4. Admin: app/api/admin/cron/route.ts zod enum FIX — added recommendation_performance / ai_connection_test /
   historical_price_sync (missing entries blocked system-job edits with 400). NEW app/api/admin/cron/daemon/route.ts
   (GET liveness: running/registeredJobs/daemonId/lastHeartbeatAgeMs, admin-guarded). Cron tab page.tsx: TASK_TYPES
   +3 entries + daemon status chip (useSWR 60s refresh) under cron list. workers/engine/route.ts: autoStartEngine +
   POST start/stop now start/stop the daemon (workerEngineRunner + daemon wiring).

5. Netlify cron deleted: netlify/functions/{cron-recommendations,cron-performance,cron-market-sync,
   cron-ai-connection-test,run-cron-background}.ts + empty netlify/functions/ dir + [functions] block in
   netlify.toml. (historical_price_sync stays as a worker task type; market-sync step-4 logic now lives in the
   daemon-fired job.)

6. Ledger outcome wiring (regression-close): recordCronRun(jobName, success, { skipSpawnCounted }) in
   recommendationCronService.ts — spawnCronTask already increments runCount + advances nextRun at spawn, so
   scheduled runs record OUTCOME ONLY (success/failure counters + completion lastRun) — no double-count; default
   path unchanged (manual/admin runs still count). NEW recordSystemRunOutcome(taskId, taskType, success) in
   worker-service.ts executeTask completion/catch — maps recommendations → RECOMMENDATION_CRON_NAME,
   recommendation_performance → RECOMMENDATION_PERFORMANCE_CRON_NAME; only when WorkerTask.cronJobId present
   (manual runs stay on admin recordManualRunLedger); non-fatal try/catch + logger.warn. Comment scrubs:
   workers/route.ts (records manual runNow/retry path only) + TODO-PERF-TESTING.md:47 (market-sync now via daemon).

7. Tests (NEW lib/__tests__/cron-daemon.test.ts, 12):
   - node-cron mock via CLOSURE-CAPTURE: factory returns { schedule: (...a) => mockSchedule(...a), validate: ... } —
     SWC does NOT hoist consts above imports; factories run during import evaluation → TDZ (probe verified;
     pattern from dailyRecommendationService.test.ts header). mockScheduled[] array of {name, fn, opt}.
   - startCronDaemon: ensures crons + registers (timezone opt), second call alreadyRunning, heartbeat upsert.
   - syncCronJobs: re-register on expression change, invalid expression skipped, deactivated dropped, per-job tz.
   - fireJob: delegates through REAL spawnDueCronJob (assert workerTask.create side effect) — callback is
     fire-and-forget void fireJob(...) → tests trigger mockScheduled[0].fn() then await setTimeout(0) flush
     (dynamic import hop); missing/deleted row no-op; DB failure never throws.
   - status/stop: getCronDaemonStatus reflects registered; stopCronDaemon destroys all tasks (mockDestroy calls).
   - Fixed: prisma.cronJob.update mock calls[0][0] (one object arg { where, data }), not [0][1].
   - +1 skipSpawnCounted outcome-only test in recommendationCronService.test.ts.

8. Verification: full suite 686 pass / 11 skip (was 673+11; +12 daemon +1 skipSpawnCounted); tsc 71 exact baseline
   (0 new). daysTracked regression test (carried) green.

9. Docs bundle (in progress → done): AGENTS.md v3.10.1 row CONSOLIDATED into v3.11.0 (node-cron daemon headline +
   carried batch + daysTracked + ledger wiring + suite 686); .agents/CHANGELOG.md index row; versions-v3.md v3.11.0
   entry; TODO.md v3.11.0 quick-ref row; Lessons #72 (jest.mock factory closure-capture — SWC no hoist above
   imports) + #73 (fire-and-forget callback needs setTimeout(0) macrotask flush when dynamic import in chain);
   Primer Last Updated + v3.11.0 status + Session 18; agent-memory 2026-08-15 entry; this flow.md appended.
   Temp script C:\Users\lucky\AppData\Local\Temp\opencode\v3110-docs.js (delete after).

10. Commits PENDING user (code + docs [skip ci]); NO push/deploy. After commit: restart dev server (PID 17564
    predates daemon) to smoke-test instrumentation auto-start + /api/admin/cron/daemon + admin Cron tab chip.
    Netlify: CRON_DAEMON_DISABLED=1 for serverless isolates + remove Netlify cron UI entries after deploy.
```

## Code touched (v3.11.0)

- lib/services/worker/cron-daemon.ts (NEW), instrumentation.ts (NEW), app/api/admin/cron/daemon/route.ts (NEW),
  lib/__tests__/cron-daemon.test.ts (NEW)
- lib/services/worker/worker-engine.ts (spawnDueCronJob export + DueCronJob), lib/services/worker/worker-service.ts
  (recordSystemRunOutcome)
- lib/services/recommendationCronService.ts (recordCronRun { skipSpawnCounted } + header comments)
- app/api/admin/cron/route.ts (zod enum), app/api/admin/workers/route.ts (comment),
  app/api/admin/workers/engine/route.ts (daemon wiring), app/admin/utils/cron/page.tsx (TASK_TYPES + liveness chip)
- lib/services/recommendationPerformanceService.ts + lib/__tests__/recommendationPerformanceService.test.ts
  (daysTracked → createdAt orderBy)
- netlify.toml ([functions] removed) + netlify/functions/*.ts deleted (5) + TODO-PERF-TESTING.md
- Docs: AGENTS.md, .agents/CHANGELOG.md, .agents/changelog/versions-v3.md, TODO.md, Lessons.md (#72/#73),
  Primer.md, agent-memory.md, this file, .agents/session-todos.md

## Verification

- Suite 686 pass / 11 skip (was 673 + 11 skip)
- tsc --noEmit 71 = exact baseline (pre-existing test-noise only)
- cron-daemon tests: 12 (closure-capture node-cron mock; fireJob → real spawnDueCronJob via setTimeout(0) flush)
- Playwright/daemon smoke test deferred until dev-server restart (commits pending user first)

## Execution path

```
User: "What did we do so far?" → resumed session; batch = fix stale prod recs (honest latest-run + AI model fallback
chain), Swing hero tenure pill + Confidence/Target/Stop, swing performance tracking surfaced in Performance tab,
dark-theme Entry/Current visibility, docs + Playwright verify + commit to fix branch only.

1. A1 honest latest-run (lib/services/dailyRecommendationService.ts)
   - getLatestRecommendations: SINGLE query — latest run status in ["completed","failed"], uniqueStocks > 0,
     NO verdict filter, all stocks incl. HOLD, ordered screenerCount desc, include tracker.
   - An all-HOLD run shows today's date instead of a stale actionable run; BUY/SELL filtering is presentation-only.
   - LATEST_KEY 23h cache unchanged. Tests rewritten (all-HOLD asserts where.status/uniqueStocks + stocks undefined;
     single-query asserts 1 findFirst call).

2. A2 AI model fallback chain (uniform across 3 agents)
   - NEW lib/services/ai/modelChain.ts (pure, zero imports): AI_FALLBACK_MODELS = ["openrouter/free","openrouter/auto"],
     modelFallbackChain(primary?) dedupes, drops empty primary, fresh array per call.
   - Contract: primary gets RETRY_MAX attempts; each fallback ONE attempt; whole chain bounded by per-batch deadline;
     fallback config = { ...(config as AIConfig), model } (cast safe — callers guard hasValidConfig);
     trackAiCall records actual model (usedModel); error messages preserved ("Unusable AI response (...)",
     "failed after N attempts (M models)").
   - recommendation-agent.ts analyzeBatch: import + model loop; LSP fixed (modelConfig cast).
   - swing-agent.ts analyzeSwingBatch: rewritten with chain + usedModel; test :261 2→4.
   - ipoAnalysisService.ts: model loop around directPrompt (each model 1 attempt capped getPromptTimeoutMs());
     sentinel throw "AI analysis failed — please try again." + stale MarketCache fallback preserved;
     outer content typed string | undefined + re-assert guard after catch (TS loop-assigned var narrowing).
   - connectionTestService.ts re-exports AI_FALLBACK_MODELS from ./modelChain.

3. A3 tests — ipoAnalysisService.test.ts mock now includes getPromptTimeoutMs (was missing → "AI analysis failed"
   failures); modelChain.test.ts NEW (5); recommendation-agent.test.ts +fallback-success (lastCall model
   openrouter/free, 4 calls at :224); suite green.

4. B1 swing tracker persistence (lib/services/swingRecommendationService.ts)
   - swingTrackerDraft(stock) PURE exported: LONG→BUY / SHORT→SELL / OBSERVE→HOLD via swingActionToRecommendation;
     timeHorizon "swing" (SWING_TIME_HORIZON), status active, entry/current = price, target/stop/confidence from
     SwingAnalysis, reasoning = logic, riskFactors, screenerAttribution {screenerNames, families, source}.
   - persistSwingTrackers(stocks, db?) with minimal structural SwingTrackerDb interface (findMany existing active
     swing trackers, createMany skipDuplicates, per-symbol updateMany currentPrice/lastCheckedAt — targets as-of
     creation). Hooked into getSwingRecommendations only when analysisStatus === "done", non-fatal try/catch.
   - Performance filter (where.timeHorizon = category) + perf-check cron pick up "swing" automatically.
   - 5 new tests (3 swingTrackerDraft + 2 persistSwingTrackers).

5. B2 UI
   - SwingCard.tsx: TENURE_META pills (short→"Short term" sky, medium→"Medium term" violet, long→"Long term" amber)
     replacing plain "Horizon:" text.
   - PerformanceTab.tsx: entryPrice + currentPrice now text-gray-200 tabular-nums (dark-theme visibility).

6. C1 verification — full npm run test: 672 pass/11 skip → 673 pass/11 skip (after +daysTracked regression);
   npx tsc --noEmit = 71 errors = exact pre-existing baseline, 0 new in touched files.

7. C2 Playwright verify (dev server was down → restarted detached via Start-Process, port 3000 listening)
   - /recommendations → Swing tab: "AI targets ready", 20 picks · 200 flagged · 34 screeners, tenure pills
     ("Medium term" violet / "Short term" sky on WELSPUNLIV), Entry/Target/Stop visible, indicators live for
     backfilled symbols (IDEA/DEVYANI/SANSERA), 0 console errors.
   - Log: AI ran on poolside/laguna-xs-2.1:free (DB-configured model), 20/20 succeeded, "Swing trackers persisted,
     created=20, updated=0" — B1 + A2 live-verified.
   - Performance tab: FOUND pre-existing 500 on sort=daysTracked (Unknown argument 'daysTracked' — computed field
     passed raw to Prisma; shipped in v3.5.0 sort enum, service never implemented). FIXED: daysTracked → orderBy
     createdAt (computed field monotonic with createdAt) + regression test. Tab now renders 809 total / 33 pages,
     0 console errors.
   - DB verified: 25+ swing trackers (timeHorizon swing, LONG→BUY/OBSERVE→HOLD mapping, confidence/entry/target/stop).

8. C3 commit — probes deleted (scripts/__probe-prod{1..3}.tmp.ts); staged 17 files; hooks passed;
   commit b35eca4 on fix/cron-tz-swing-perf (NOT pushed). Docs commit [skip ci] next.
```

## Code touched (this batch)

- lib/services/ai/modelChain.ts (NEW), lib/services/ai/modelChain.test.ts (NEW)
- lib/services/dailyRecommendationService.ts (getLatestRecommendations single-query)
- lib/services/ai/recommendation-agent.ts, lib/services/ai/swing-agent.ts (fallback chains)
- lib/services/ipoAnalysisService.ts (model loop + content typing)
- lib/services/ai/connectionTestService.ts (re-export AI_FALLBACK_MODELS)
- lib/services/swingRecommendationService.ts (SWING_TIME_HORIZON, swingTrackerDraft, persistSwingTrackers, hook)
- lib/services/recommendationPerformanceService.ts (daysTracked → createdAt orderBy)
- app/components/recommendations/SwingCard.tsx (TENURE_META pills)
- app/components/recommendations/PerformanceTab.tsx (text-gray-200 Entry/Current)
- Tests: dailyRecommendationService.test.ts, recommendation-agent.test.ts, swing-agent.test.ts,
  ipoAnalysisService.test.ts, swingRecommendationService.test.ts (+5), recommendationPerformanceService.test.ts (+1)

## Verification

- Suite 673 pass / 11 skip (52 passed suites, 1 skipped)
- tsc --noEmit 71 = exact baseline (pre-existing test-noise only)
- Playwright: Swing tab + Performance tab render, 0 console errors; swing trackers persisted (created=20)
- daysTracked 500 fixed + regression test green
