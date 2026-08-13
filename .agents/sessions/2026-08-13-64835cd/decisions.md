# Session Decisions — 2026-08-13 (v3.8.0)

Branch: `fix/cron-reaper-ai-pipeline` · Commit: 5b7c5da

## Decisions & Reasoning

1. **AI pre-flight gate** — Run `runAiConnectionTest(preflightTimeoutMs)` FIRST when `aiInput.length > 0 && hasValidConfig(aiConfig)`. Reasoning: the 14-min background cap was being burned batch-by-batch against a dead model; fail fast instead. Status mapping: `ok` → configured model; `fallback` → run uses `preflight.recommendedModel`; `failed` → skip AI, all-HOLD via `holdFallback` with `aiSuccess:false`.
2. **Cron system-job dedupe** — `CronJob.name` has no unique constraint, so racing Netlify instances could create duplicates via findFirst-then-create. Post-pass orders system rows by `createdAt: asc` and keeps the EARLIEST per name (scoped to the 4 system names only; user crons untouched).
3. **Spawn dedup (DEDUP_WINDOW_MS = 90 min)** — A due job with a pending/running task in the window skips re-spawning but STILL advances `nextRun` (nextRun must never lag).
4. **Stale-task reaping (STALE_MS = 16 min)** — `WorkerTask` rows keyed on `startedAt`, `DailyRecommendationRun` keyed on `createdAt` (no startedAt); reaped → `failed` + error message; throttled `maybeReap` ≤1/min from poll loop + startup.
5. **maxTokens default → 8192** — 2048 truncated JSON answers (IPO-report-v2 + batch reasoning) → HOLD defaults. Caveat confirmed: `loadConfig()` merges DB `ai_config` Secret metadata OVER env, so a DB-stored 2048 defeats the default. Local DB had stale 2048 (UI save) → fixed to 8192 (model kept). Prod was already 8192 + nvidia nemotron default (revert-script run had persisted there) — no-op write.
6. **Test mocking discipline** — (a) `jest.mock` specifier must resolve to the SAME module identity the source imports (`@/lib/services/worker/...`), not a relative path; (b) next/jest loads `.env`/`.env.local` → `OPENROUTERKEY` present → `hasValidConfig()` true → pre-flight gate opens in tests → a default "ok" `mockRunAiConnectionTest` mock in `beforeEach` is required.
7. **Commit scope** — Included all v3.8.0 code + tests + docs + session files + `scripts/cleanup-stale-worker-tasks.ts`. EXCLUDED temp debug scripts (`scripts/_debug-ai-calls.ts`, `_debug-running-tasks.ts`, `_probe-ai-model.ts`, `_revert-ai-model.ts`) — local tooling only.

## Verified

- Full suite: 597 pass (48 suites, 1 pre-existing skip); tsc clean on touched files.
- Visual: `/admin/ai` shows Max Tokens 8192 + model preserved; `/admin/utils/cron` renders 3 system jobs (4th "AI Connection Test" appears after server/worker restart); `/recommendations` renders, 0 console errors on all pages.
- Known display artifact: Today's Picks cards still show pre-fix inverted SELL levels (ITC/GMRAIRPORT) from the Aug-12 run — clears on the next run after deploy.
