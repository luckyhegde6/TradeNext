# Session 2026-08-11-c995a10 — Decision Log

> Every meaningful decision made while writing code this session, with the reasoning behind it.
> Format: **Decision** → *Context* → *Why this approach* → *Impact (files/packages touched)*

---

## D1. Root-cause investigation: stale Daily Recommendations on prod

**Decision:** Stop at the symptom layer and trace the full AI config resolution chain before changing anything.

- *Context:* Public `/recommendations` was stuck at "Last updated: 19/7/2026". Admin run history showed completed runs (Aug 6/7) that produced 50 stocks each — but the public page never showed them.
- *Why this approach:* The failure appeared "silent" (runs completed, `aiFailed: 0`), so a naive fix (re-run) would have repeated the same all-HOLD outcome. Traced: run result → `aiRecommendation: "HOLD", confidence: 50, reasoning: "AI analysis unavailable — defaulting to HOLD"` → `directPrompt` → HTTP 404 → model.
- *Impact:* `lib/services/dailyRecommendationService.ts`, `lib/services/ai/*`, Netlify env inspection.

## D2. Model selection was NOT the root cause — the config plumbing was

**Decision:** Treat "admin picked a bad model" as a symptom, not the cause, after the 404 persisted with the bundled default.

- *Context:* After switching the saved DB model to `tencent/hy3:free` (code default), the admin `POST /api/admin/ai/test` STILL returned `AI request failed (HTTP 404)`.
- *Why this approach:* Listing the live OpenRouter `/models` catalog proved `tencent/hy3:free` **does not exist** (it was inventing nothing — the code's `AVAILABLE_MODELS`/`DEFAULT_MODEL` were stale vs. reality). Wasted no further guesswork.
- *Impact:* Verified live catalog (`curl openrouter.ai/api/v1/models`), 399 models. Only real free+tool models retained.

## D3. `loadConfig()` shared helper — single source of truth for DB-aware AI config

**Decision:** Add a shared async `loadConfig()` to `lib/services/ai/config.ts` instead of duplicating the test-route's local copy.

- *Context:* `app/api/admin/ai/test/route.ts` had its own private `loadConfig()` reading the `ai_config` Secret; the **recommendations pipeline called `analyzeStocks(aiInput)` with NO config** (`dailyRecommendationService.ts:322`) → fell back to env-only `getDefaultConfig()` → always used `process.env.AI_MODEL || DEFAULT_MODEL` (which was `tencent/hy3:free`, a nonexistent model).
- *Why this approach:* One function = consistent behavior across test endpoint AND pipelines; keeps the DB `ai_config` Secret meaningful (admin UI model selection now actually reaches runs). Lazy `import("@/lib/prisma")` keeps `config.ts` client-safe (no top-level Prisma import).
- *Impact:* `lib/services/ai/config.ts` (added `loadConfig`), `dailyRecommendationService.ts` (wire-in, next), `app/api/admin/ai/test/route.ts` (dedupe opportunity).

## D4. Refresh `AVAILABLE_MODELS`/`DEFAULT_MODEL` against the LIVE catalog

**Decision:** Point `DEFAULT_MODEL` at a real model (`nvidia/nemotron-3-ultra-550b-a55b:free`) and swap the stale list entries for verified ones.

- *Context:* `tencent/hy3:free` (weekly-free "recommended default") and `qwen/qwen3-next-80b-a3b-instruct:free` both **404** on OpenRouter. Without this, every cold/deploy default would keep producing all-HOLD runs even after the pipeline fix.
- *Why this approach:* Verified against the actual OpenRouter model list (fetched 2026-08-11). Kept $0/free models that support `tools` + structured output, since the recommendation agent requires tool-call JSON. `nemotron-3-ultra` is the highest-quality free model currently in the catalog.
- *Impact:* `lib/services/ai/config.ts` — `DEFAULT_MODEL`, `AVAILABLE_MODELS` (removed `tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free`; added `google/gemma-4-26b-a4b-it:free`, `inclusionai/ling-3.0-tiny:free`, `cohere/north-mini-code:free`).

## D5. Fix prod config via API instead of the UI to avoid modal-dialog interference

**Decision:** Perform prod config/model mutations with `fetch()` from the Playwright page context, not by clicking the admin UI.

- *Context:* Early UI clicking accidentally opened a remove-model confirm dialog and mutated prod custom-models state (removed gems, switched saved model).
- *Why this approach:* The admin UI's confirm-dangerous dialogs intercept clicks; direct API calls (`POST /api/admin/ai/config`, `POST /api/admin/ai/custom-models`, `PATCH /api/admin/workers?action=runNow`) are deterministic and auditable.
- *Impact:* No code change; operational technique. Also restored `google/gemma-4-26b-a4b-it:free` + `google/lyria-3-pro-preview` custom models after the accidental removal.

## D6. Defer scaling — top-50 cap stays; test/prod runs share the same pipeline

**Decision:** No cap change this session. The top-50 `MAX_AI_STOCKS` cap is not the problem; all 50 stocks were HOLD because every AI batch hit the nonexistent model.

- *Context:* Aug 7 run: `totalStocks: 1055, uniqueStocks: 50, aiProcessed: 50, aiFailed: 0` — so the pipeline ran fine; every stock just got the HOLD fallback.
- *Why this approach:* Fix the true cause (config plumbing) first, then re-observe. Raising the cap without fixing the model would only burn more quota on 404s.
- *Impact:* none (no code change).

## D7. Per-session `decisions.md` + `flow.md` memory infrastructure (this session's meta-decision)

**Decision:** Establish the per-session folder memory system the user requested: `.agents/sessions/<YYYY-MM-DD-<hash>>/` containing a live `decisions.md` (every decision + reasoning: why approach / why package added-modified-removed) and `flow.md` (entry point → execution order → code touched), codified as a hard rule.

- *Context:* User asked for a durable session-and-memory record system with timestamp/hash-based folder naming, made into a rule.
- *Why this approach:* Flat archive files (`YYYY-MM-DD-<hash>.md`) captured outcomes but not the decision reasoning or execution path; the new format makes replay/review precise (decisions with reasoning; flow with call chain + file:line). Folder-per-session keeps both files colocated with a stable hash name. Rule file `.agents/rules/session-decisions-flow.md` + index updates (session-memory-rules §3, sessions/README, AGENTS.md table, rules/README) make it enforceable.
- *Impact:* Created `.agents/rules/session-decisions-flow.md` (rule), `.agents/sessions/2026-08-11-c995a10/{decisions,flow}.md` (this session), updated `.agents/sessions/README.md`, `.agents/rules/session-memory-rules.md`, `.agents/rules/README.md`, `AGENTS.md`. No runtime code.

## D8. Cron job ledger fix — record runs from the real execution paths on serverless

**Decision:** Add `recordCronRun(jobName, success)` and call it from (a) `netlify/functions/run-cron-background.ts` (scheduled runs, success + error branches) and (b) admin `PATCH /api/admin/workers` runNow/retry for tasks WITHOUT `cronJobId`.

- *Context:* User reported Admin → Utils → Cron showed "no recent runs" despite 2 jobs. Verified on prod via `/api/admin/cron`: both system jobs had `lastRun: null, runCount: 0, successCount: 0, failureCount: 0` and stale `nextRun` (Aug 10, in the past).
- *Root cause:* The `CronJob` ledger was only written by `spawnCronTask()` (task-orchestrator) and the resident worker-engine scheduler loop — neither runs on Netlify serverless. Real scheduled runs execute directly via `run-cron-background.ts → runDailyRecommendations()/checkRecommendationPerformance()` and never touched the table; admin "Run Now" used `spawnRegularTask` (no `cronJobId` link) + `executeTask`, also never touching it. `successCount`/`failureCount` had NO writer anywhere (grep-verified).
- *Why this approach:* Single ledger-writer (recordCronRun) wired into the two actual execution paths. Skip `cronJobId`-linked tasks in the PATCH route to avoid double-counting (spawnCronTask already increments at spawn). Helper locates the job by stable name (idempotent with `ensureRecommendationCrons`), never throws, safe no-op when the job is missing. `successCount`/`failureCount` finally get writers.
- *Impact:* `lib/services/recommendationCronService.ts` (+`recordCronRun` +`RecordCronRunResult`), `netlify/functions/run-cron-background.ts`, `app/api/admin/workers/route.ts`, new test `lib/__tests__/recommendationCronService.test.ts` (5 tests). Verified: `tsc` clean on touched files, 41 related tests pass. ESLint/`next lint` blocked repo-wide by pre-existing eslintrc circular-config error (Next 16 removed `next lint`) — noted, not fixed (out of scope). **User chose code-fix only, NO deploy.**

---

## Accidental prod mutations logged (transparency)

- UI clicks on `/admin/ai` removed custom models `google/gemma-4-26b-a4b-it:free` + `google/lyria-3-pro-preview` on prod; both restored via `POST /api/admin/ai/custom-models`.
- Saved model on prod was briefly switched during investigation; final prod DB config = `nvidia/nemotron-3-ultra-550b-a55b:free` (verified working: test returns "4").
- Env vars: `AI_MODEL` NOT set on Netlify (falls to `DEFAULT_MODEL`); `OPENROUTERKEY` configured and valid.