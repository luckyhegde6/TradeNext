# Session 2026-08-11-c995a10 — Execution Flow

> Where execution actually travels this session: entry points, call order, and which parts of the codebase changed.

---

## 1. What broke (prod symptom)

```
/recommendations (public)  →  "Last updated: 19/7/2026"    ← stale for 3+ weeks
```

## 2. Root-cause trace (the actual execution path)

```
Admin Run Now (/admin/recommendations/daily)
  └─ POST /api/admin/recommendations { action: "run_now" }
      └─ lib/services/worker/task-orchestrator.ts — spawnRegularTask()
          └─ WorkerTask (pending → running → completed)
              └─ lib/services/worker/worker-service.ts — executeTask("recommendations")
                  └─ lib/services/dailyRecommendationService.ts — runDailyRecommendations()
                      ├─ chartinkService.runDailyScreeners()      → 1055 raw hits, 3/7 screeners ok
                      ├─ rankAndCapRecommendations()              → top-50 cap (MAX_AI_STOCKS)
                      ├─ circuitBreaker.call(() => analyzeStocks(aiInput))   ← LINE 322
                      │    └─ ai/recommendation-agent.ts — analyzeStocks()
                      │         → analyzeBatch() → directPrompt(prompt, config)
                      │              └─ ai/llm-provider.ts — fetch(openrouter.ai/api/v1/chat/completions)
                      │                   ↓ model resolves to: process.env.AI_MODEL || DEFAULT_MODEL
                      │                   → "tencent/hy3:free"  ← DOES NOT EXIST on OpenRouter → HTTP 404
                      │                   → directPrompt returns "AI request failed (HTTP 404)..."
                      │                   → parseAIResponse() fails → getDefaultRecommendation()
                      │                   → HOLD / 50 ("AI analysis unavailable — defaulting to HOLD")
                      └─ public getLatestRecommendations() filters stocks: { some: actionable }
                           → all-HOLD run → filtered out → falls back to Jul 19 run
```

**The two defects:**

| # | Defect | Location |
|---|--------|----------|
| A | Pipeline calls `analyzeStocks(aiInput)` WITHOUT config → env-only `getDefaultConfig()`; DB `ai_config` Secret (admin's model choice) never reached the run | `dailyRecommendationService.ts:322` |
| B | `DEFAULT_MODEL`/`AVAILABLE_MODELS` point at models that don't exist on OpenRouter (`tencent/hy3:free`, `qwen3-next-80b`) | `lib/services/ai/config.ts` |

## 3. Code changed this session

| File | Change | Why |
|------|--------|-----|
| `lib/services/ai/config.ts` | `DEFAULT_MODEL` → `nvidia/nemotron-3-ultra-550b-a55b:free`; refreshed `AVAILABLE_MODELS` to live-catalog-verified free models; added async `loadConfig()` (DB `ai_config` Secret + env fallback, lazy Prisma import) | Fix defect B (D4); add the single-source config loader (D3) |
| `lib/services/dailyRecommendationService.ts` | Imported `loadConfig`; `analyzeStocks(aiInput, aiConfig)` — DB-aware config now reaches the pipeline | Fix defect A (D3) |
| `app/api/admin/ai/test/route.ts` | Removed private `loadConfig()`, uses shared one from `lib/services/ai/config.ts` | Consistency (D3) |
| `lib/services/recommendationCronService.ts` | Added `recordCronRun(jobName, success)` + `RecordCronRunResult` — sets `lastRun`, `runCount+1`, `successCount`/`failureCount+1`, advances `nextRun` via `calculateNextRun`; finds job by name; safe no-op when missing | Fix cron ledger showing no runs (D8) |
| `netlify/functions/run-cron-background.ts` | Calls `recordCronRun(...)` after successful pipeline AND in the error branch (both actions) | Wire the real scheduled path into the ledger (D8) |
| `app/api/admin/workers/route.ts` | Added `recordManualRunLedger(task, result)` helper; called after `executeTask` in PATCH runNow + retry; skips tasks WITH `cronJobId` (already counted at spawn by `spawnCronTask`) | Manual admin runs update the ledger; no double-count (D8) |
| `lib/__tests__/recommendationCronService.test.ts` | NEW — 5 tests for `recordCronRun` (success/failure/missing job/prisma find error/prisma update error) | Regression guard (D8) |
| `.agents/rules/session-decisions-flow.md` | NEW — mandatory rule for per-session decisions/flow logs | User-requested memory infra (D7) |
| `.agents/sessions/2026-08-11-c995a10/{decisions,flow}.md` | NEW — this session's live decision + execution logs | User-requested memory infra (D7) |
| `.agents/sessions/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/rules/README.md`, `AGENTS.md` | Folder-based session archive docs | D7 |

## 4. What is verified so far

- Live OpenRouter catalog: `tencent/hy3:free` ❌, `qwen/qwen3-next-80b-a3b-instruct:free` ❌, `nemotron-3-ultra:free` ✅, `openrouter/free` ✅, `cohere/north-mini-code:free` ✅ (curl to `/api/v1/models` with the prod key).
- Prod AI test with `nvidia/nemotron-3-ultra-550b-a55b:free`: **HTTP 200, response "4"** (rt ~1s).
- Prod run after config fix: completed, 50 stocks, `aiProcessed: 50` — but STILL all HOLD (proves defect A is code-side, not config-side).
- Prod worker task `44b81408…` executed synchronously via `PATCH /api/admin/workers { action: "runNow" }` (serverless has no resident poll engine).
- **Cron ledger issue (D8):** `GET /api/admin/cron` on prod → both system jobs `lastRun: null, runCount: 0, successCount: 0, failureCount: 0`, `nextRun` stale (Aug 10). Root cause: ledger only written by `spawnCronTask`/resident scheduler, never by the real (Netlify scheduled-function) execution path.
- **Verification (D8):** `npx tsc --noEmit` clean on all touched files (incl. `netlify/functions/run-cron-background.ts` — covered by `**/*.ts` in tsconfig); 5 new `recordCronRun` tests pass; 41 related tests (recs + performance + cronParser) pass. ESLint blocked repo-wide by pre-existing eslintrc circular-config error (`next lint` removed in Next 16, flat config jacks on legacy validator) — out of scope.

## 5. Verification matrix for the fix (definition of done)

| Check | Command / action | Pass |
|-------|------------------|------|
| Typecheck | `npx tsc --noEmit` | all clean |
| Tests | `npm run test` (recommendation-agent, dailyRecommendationService, new loadConfig tests) | green |
| Lint | `npm run lint` | clean |
| Prod AI test | `POST /api/admin/ai/test` | 200 + real content |
| Prod run | `PATCH /api/admin/workers action=runNow` | BUY/SELL picks present (not all HOLD) |
| Public page | `/recommendations` | fresh "Last updated" ≥ Aug 10 + actionable stocks |

## 6. Execution order this session (for replay)

1. Prod verify #69 (sessions) → #68 (monitoring) → v3.5.2 screener — all PASSED (earlier in session).
2. Stale-recs investigation → traced to model 404 (config plumbing).
3. Refresh model catalog knowledge (curl) → `tencent/hy3:free` doesn't exist.
4. Fix prod DB config → model now `nemotron-3-ultra` (test 200).
5. Trigger + run recs on prod → still all-HOLD → proved defect A.
6. Implement code fixes in `config.ts` + `dailyRecommendationService.ts` (D3/D4).
7. Session-memory infra (D7) — rule file + this decisions/flow pair.
8. **Cron ledger fix (D8):** user reported `/admin/utils/cron` shows no runs; verified prod API → zeroed ledger; root-caused to missing writer in real execution path; implemented `recordCronRun` + wiring (`run-cron-background.ts`, PATCH runNow/retry) + 5 tests; tsc clean; 41 tests green. **User chose: NO deploy.**
9. Commit + PR (next — pending user trigger; follow `.agents/linear-history.md`, pre-commit workflow, SSH push).