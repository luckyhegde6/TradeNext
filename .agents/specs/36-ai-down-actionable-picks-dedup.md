# Spec Document — 36: AI-Down Actionable Picks + Daily-Run Duplicate Notice Fix

> Copy of `.agents/templates/spec-template.md` — filled in for Spec 36.
> Save to `.agents/specs/36-ai-down-actionable-picks-dedup.md`

## 1. Overview

**What**: Four coordinated changes to the daily-recommendations / swing AI-down path:
1. **Duplicate-run / Telegram-notice fix**: prevent a single logical daily run from producing more than one Telegram notice (observed: two runs + two identical notices on 2026-11-02 — task `5f6eb4ad` via missed-tick recovery, task `c24955fe` via catch-up).
2. **AI-down actionable picks**: when AI is unavailable, broadcast actionable **screener-backed BUY/SELL** picks (fallback technical levels) instead of the flat all-HOLD notice ("No BUY/SELL picks today — all N analyzed stocks rated HOLD").
3. **AI failure-mode handling**: treat the observed failure modes — `Empty model response` and HTTP **402 Insufficient credits** — as first-class AI-unavailable conditions (not only the `free-models-per-day` daily-quota 429 that the quota latch keys on).
4. **Swing target generation + Stock AI analysis fallback**: harden the swing-agent and recommendation-agent fallback paths so AI-down days still produce real actionable swing targets / stock verdicts (fallback levels marked `success:true`).

**Why**: Prod log analysis of `2Nov.log` (~24h window, 2026-11-01 23:58 → 2026-11-02 11:22) showed today's daily run double-fired and, per run, hit `AI pre-flight FAILED on all models → skipAi` → fallback → all-HOLD → Telegram all-HOLD notice. The OpenRouter outage is external, but the surrounding run/notice/broadcast behavior and the AI-down fallback coverage are part of the same defect cluster the user asked to fix.

**Scope**: IN — duplicate-run/notice dedup fix; AI-down screener-only BUY/SELL broadcast; AI failure-mode handling (classification/latch companion); swing target generation + stock AI analysis fallback hardening. OUT — changing AI provider credentials/model selection (external/user action); redesigning `/recommendations` UI beyond the existing `aiUnavailable` banner wiring; changing fallback confidence semantics broadly; performance-check semantics.

**Depends on**: v3.30 fallback targets (`fallbackAnalysis.ts` / `holdFallback`), v3.11.1 no-fake-HOLD persistence partition, v3.50.0 Spec 30 catch-up guards + notice gating, v3.51.0 quota latch, v3.52.0 batching/ranking/broadcast header.

---

## 2. Routes

> No new HTTP routes. Modified: none (changes are service/broadcast level; Telegram delivery + `/api/recommendations` payload flow through existing routes).

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| `POST /api/telegram/...` (via `telegramBotService.broadcastToSubscribers`) | none | Broadcast payload/text changes only; no route contract change |

---

## 3. Database Schema

### A. New Model

N/A — no schema change.

### B. Modifications to Existing Models

N/A — no model change.

### C. Migration Notes

- N/A (no migration required; no new fields).

---

## 4. Functions to Implement

### A. `lib/services/dailyRecommendationService.ts` — `runDailyRecommendations`

#### Behavior change on AI-down path

- When `skipAi` is true (pre-flight failed) **or** the AI phase produced zero successful verdicts, instead of only the all-HOLD fallback, the run must:
  - Compute actionable fallback picks from the analyzed stock set (screener-confluence-backed where available).
  - Broadcast via the screener-only BUY/SELL path (see §4B) rather than the unconditional all-HOLD notice.

#### Signature/behavior notes

- Existing `holdFallback(reason, errorMsg)` returns verdicts with `success: true` (fallback) — unchanged contract.
- Run persistence partition (v3.11.1: only `success:true` persisted; zero-success → failed run, no broadcast) remains authoritative.

### B. `lib/services/recommendationBroadcast.ts` — `buildRecommendationBroadcast`

#### New behavior

- When the run is AI-down (fallback / no-AI) **and** no actionable BUY/SELL exists, build the broadcast from **screener-backed picks**: actionable directional picks derived from the analyzed set's screener confluence + fallback technical levels, topped by `MAX_BROADCAST_PICKS`.
- All-HOLD-only days (real AI verdicts all HOLD, `success:true`) keep the existing all-HOLD notice (genuine HOLD days are not AI-down days).

### C. `lib/services/ai/quotaLatch.ts` + `lib/services/ai/connectionTestService.ts`

- Extend AI-unavailable classification so the observed failure modes (`Empty model response`, HTTP 402 / insufficient credits) are recognized:
  - `testOpenRouterModel` already returns structured `ok/httpStatus/error` — the 402 path already short-circuits fallback probing when it is the *primary*.
  - Add recognition/handling so credit-exhaustion (402) and empty-response failures feed the AI-unavailable flow (latch companion + pre-flight outcome) rather than only the `free-models-per-day` 429.

### D. `lib/services/worker/worker-engine.ts` — catch-up / dedup

- Ensure at most one daily recommendations task/notice per logical run per day (defensive dedup alongside existing `DEDUP_WINDOW_MS` spawn dedup and Spec 30 day-level catch-up guards).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/worker/worker-engine.ts` | Modified | Dedup/notice-path alignment for daily rec catch-up vs scheduled recovery |
| `lib/services/dailyRecommendationService.ts` | Modified | AI-down actionable-picks broadcast wiring |
| `lib/services/recommendationBroadcast.ts` | Modified | Screener-only BUY/SELL broadcast when AI down |
| `lib/services/ai/connectionTestService.ts` | Modified | Failure-mode classification (402 / empty response) |
| `lib/services/ai/quotaLatch.ts` | Modified | Companion handling for credit-exhaustion / empty-response AI-unavailable signals |
| `lib/__tests__/recommendationBroadcast.test.ts` | Modified | New AI-down screener-picks tests |
| `lib/__tests__/dailyRecommendationService.test.ts` | Modified | AI-down actionable-picks + dedup tests |
| `lib/__tests__/worker-engine.test.ts` | Modified | Catch-up dedup regression tests |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/ai/fallbackAnalysis` | `calculateFallbackRecommendation` | Fallback levels for actionable picks |
| `@/lib/services/ai/modelChain` | `AI_FALLBACK_MODELS` | Fallback chain |
| `@/lib/services/recommendationBroadcast` | `buildRecommendationBroadcast` | Telegram text |
| `@/lib/services/worker/worker-engine` | `ensureDailyRecommendationRan` | Catch-up guard |

---

## 7. API Contract

### Telegram broadcast (existing event, changed text/behavior)

**AI-down + actionable picks** (new): `🔔 📈 *Daily Recommendations — <date>*` + top actionable picks (BUY/SELL) with target/SL/confidence + footer.

**AI-down + no actionable picks**: keeps existing all-HOLD notice (unchanged).

---

## 8. UI/UX Requirements

- `/recommendations` already surfaces the `aiUnavailable` banner via `DailyPicksTab` (v3.11.1/Spec 29) — no change required unless wiring reveals gaps.

---

## 9. Rules & Guardrails

- [x] No Prisma changes (no schema migration).
- [x] All changes via service layer; no business logic in UI.
- [x] Logging via `@/lib/logger` only.
- [x] Background/worker changes leader-gated + deduped.
- [x] No secrets in logs.

---

## 10. Expected Behavior

1. [x] When AI is down and actionable fallback/screener picks exist → broadcast actionable BUY/SELL picks (not all-HOLD).
2. [x] When AI is down and no actionable picks exist → broadcast all-HOLD notice (existing).
3. [x] Genuine all-HOLD days (real AI verdicts) → all-HOLD notice (unchanged).
4. [x] At most one daily recommendations Telegram notice per run/day; duplicate runs suppressed.
5. [x] AI failure modes `Empty model response` / HTTP 402 are handled as AI-unavailable.

---

## 11. Error Handling

| Scenario | Behavior |
|----------|----------|
| AI pre-flight failed on all models | skipAi → fallback actionable picks / all-HOLD notice |
| AI failure = empty response / 402 credits | classified AI-unavailable; handled in latch/pre-flight flow |

---

## 12. Test Strategy

- Unit: `recommendationBroadcast` (AI-down → screener picks; all-HOLD genuine), `dailyRecommendationService` (AI-down actionable path), `worker-engine` (catch-up dedup), `quotaLatch`/`connectionTestService` (402/empty handling).

## 13. Performance Considerations

- Fallback pick computation is in-memory over ≤100 stocks — no extra DB cost.

## 14. Security Considerations

- No new auth surface; Telegram notice text contains symbols only.

## 15. Definition of Done

- [x] Spec approved
- [x] Plan approved
- [x] Unit tests green (`npm run test`)
- [x] `npx tsc --noEmit` 0 new errors
- [x] `npm run lint` clean on changed files
- [ ] Docs updated (AGENTS.md/CHANGELOG/etc.)
- [ ] Session memory updated
- [ ] Live-verified on :3000 (Telegram/broadcast unit-level; Playwright if UI change — none expected)

---

## 16. Open Questions / Decisions Needed

1. [x] Resolved — actionable screener-only BUY/SELL pick = actionable (BUY/SELL) fallback verdicts from the analyzed set, sorted by screener confluence (`screenerNames` desc) + capped at `MAX_BROADCAST_PICKS`; fallback verdicts are already direction-aware via `evaluateRecommendationLevels`.
2. [x] Resolved — YES, genuine all-HOLD days keep the all-HOLD notice (existing design).
3. [x] Resolved — BOTH: (a) run-level guards already existed (Spec 30 catch-up dedup + `hasSuccessfulRunToday`; worker-engine `catchUpMissedCronJobs` day-level + in-flight dedup verified by tests); (b) NEW in-process per-UTC-day notice suppression (`lastDailyRecNoticeDay`) in the daily recommendations completion broadcast so a same-day double-fire can never send two notices.

---

## 17. References

- Prod log: `2Nov.log` (repo root, ~24h window)
- Prior specs: 29 (`ai-failed-run-ux`), 30 (`weekend-stale-cron-freshness`), 32 (`prod-resilience-fixes`), 34 (`ai-batch-20-ranking-and-telegram-delivery`)
- Lessons: 162 (success-keyed day guard re-fires), 163 (breaker-on-cause / dedup-window-from-schedule), 165 (batching/ranking)
