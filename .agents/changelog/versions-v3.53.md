# v3.53.0 — AI-Down Actionable Picks + Duplicate Daily-Notice Fix (Spec 36)

**Date:** Nov 02 2026
**Spec:** `.agents/specs/36-ai-down-actionable-picks-dedup.md` (approved + amended per user directive)
**Plan:** `.agents/plans/36-ai-down-actionable-picks-dedup.md` (approved; Phases A/B/C/D implemented this pass)
**Branch context:** on top of `main` @ `9a44878` (v3.52.0); prior uncommitted Spec-35 WIP (`historicalPriceSyncService`, `recommendationCronService`, `swingRecommendationService`, `sqlite.ts` + tests) was left in the tree — NOT part of this release.

## User-reported prod defect cluster (2026-11-02)

Prod log `2Nov.log` (~24h window, Nov 1 23:58 → Nov 2 11:22, ~17k lines) showed:

1. **AI completely down** for the daily recommendations run — all models failed:
   - `openrouter/free` → `Empty model response` (tokens=0, ~59 s).
   - `openrouter/auto` → HTTP **402** `{"error":{"message":"Insufficient credits. This account never purchased credits...","code":402}}`.
   - `nvidia/nemotron-3-ultra-550b:a55b:free` → `Empty model response` / 503 overloaded.
   → `AI pre-flight FAILED on all models → skipAi` → technical fallback → run completed via fallback → **all-HOLD Telegram notice**.

2. **Duplicate run + duplicate Telegram notice**:
   - 10:00 cron tick MISSED (node-cron WARN) → 10:04 task `5f6eb4ad` spawned (missed-tick recovery) → 10:13 pre-flight FAILED → 10:15 run completed → **Telegram all-HOLD notice sent**.
   - 10:19 catch-up task `c24955fe` enqueued → 10:26 pre-flight FAILED → 10:27 task `c24955fe` completed → **second identical Telegram notice sent**.

## Fixes shipped in v3.53.0 (Spec 36)

### Phase A — AI failure-mode handling (credit exhaustion / empty response)
- `lib/services/ai/quotaLatch.ts`: NEW exported `isAiCreditExhaustionMessage(raw)` — true for HTTP 402 / `Insufficient credits` / `never purchased credits` (distinct from the daily free-quota 429 predicate `isDailyFreeQuotaMessage`).
- `lib/services/ai/recommendation-agent.ts`: batch early-exit now latches the UTC day on `isDailyFreeQuotaMessage(raw) || isAiCreditExhaustionMessage(raw)` (quota latch companion for account-credit exhaustion; generic transient 429 still NOT latched).
- `lib/services/ai/connectionTestService.ts`: `runAiConnectionTest` computes `quotaExhausted` (any probed model `httpStatus === 402` or error text matches credit exhaustion) → surfaced in report + audit metadata (`{quotaExhausted:true}`) alongside the existing 429 handling.

### Phase B — Duplicate-run / Telegram-notice dedup
- `lib/services/dailyRecommendationService.ts`: NEW in-process per-UTC-day notice suppression (`lastDailyRecNoticeDay`) at the completion broadcast → at most ONE daily recommendations Telegram notice per UTC day even if a same-day double-fire slips past run-level guards.
- Run-level guards verified green (no change needed): Spec 30 catch-up dedup (`workerTask` `triggeredBy:"catchup"` createdAt ≥ UTC day start) + `hasSuccessfulRunToday` + `ensureDailyRecommendationRan` in-flight guard.

### Phase C — AI-down actionable BUY/SELL broadcast
- `lib/services/recommendationBroadcast.ts`: `buildRecommendationBroadcast(stocks, dateLabel, opts?: {aiDown?: boolean})` — AI-down branch broadcasts actionable (BUY/SELL) fallback/screener-backed picks (screener confluence desc, capped at `MAX_BROADCAST_PICKS`) instead of falling straight to the all-HOLD notice; genuine all-HOLD days keep the all-HOLD notice.
- `lib/services/dailyRecommendationService.ts`: wires `aiDown: skipAi === true` into the broadcast.

### Phase D — Swing target generation + Stock AI analysis fallback
- Verified existing v3.30 fallbacks (no new code path required): `swing-agent.analyzeSwingStocks` → `calculateFallbackSwingAnalysis` (directional LONG/SHORT/OBSERVE, `success:true`); `recommendation-agent` → `calculateFallbackRecommendation` (BUY/HOLD/SELL, `success:true`). Targeted Jest suites green.

## Gates

- `npx tsc --noEmit`: **46 = exact baseline (0 new errors)** — `check-tsc-baseline` reports `total 46 (delta +0) / prod 0 (delta +0)` (remaining repo errors are pre-existing test-only noise).
- Jest (targeted): **quotaLatch + recommendation-agent + recommendationBroadcast + dailyRecommendationService + aiConnectionTestService + swing-agent + swingRecommendationService + worker-engine = 8 suites / 286 tests — ALL PASS**.
- Jest (full): **138/138 suites · 2113 passed / 4 skipped / 0 failed** (~110 s).
- ESLint: **0 errors** repo-wide (1163 pre-existing warnings — includes the untouched Spec-35 WIP files; changed files 11 pre-existing warnings, none new).
- `npm run quickbuild`: **201/201 static pages, compiled successfully** (no dev server running).
- Doc-context budget gate: **PASS** total 98,225 B / 102,400 B; AGENTS.md 32,725 B / 32,768 B (43 B headroom — the v3.53.0 row is the last that fits; next release must trim or defer, Lesson 142).
- No Prisma schema change; no new packages; no new API routes.

## External blocker (user action)

OpenRouter AI availability for this account — `openrouter/auto` HTTP 402 (Insufficient credits / never purchased) + free-model empty responses. User must top up credits / switch key. Code-side AI-down behavior now delivers actionable picks instead of a flat all-HOLD notice, with credit-exhaustion + empty-response failure modes handled as first-class AI-unavailable conditions.

## Release state

**CODE + TESTS + DOCS DONE — COMMIT PENDING USER (D9).** Merge/deploy: user-only.
