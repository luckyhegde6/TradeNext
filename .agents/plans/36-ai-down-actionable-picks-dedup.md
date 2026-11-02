# Plan Document — 36: AI-Down Actionable Picks + Daily-Run Duplicate Notice Fix

> Based on Spec 36 — `.agents/specs/36-ai-down-actionable-picks-dedup.md`
> Save to `.agents/plans/36-ai-down-actionable-picks-dedup.md`

## 1. Approach

Three atomic workstreams, sequenced:

- **Phase A — AI failure-mode handling** (foundation, lowest risk).
- **Phase B — duplicate-run / Telegram-notice dedup** (secondary, user-requested).
- **Phase C — AI-down actionable BUY/SELL broadcast** (feature, highest design surface; gated on Phase A outputs).

## 2. Plan Steps

### Phase A — AI failure-mode handling

- [x] **A1** — `lib/services/ai/connectionTestService.ts`: extend the connection-test outcome handling so HTTP 402 / `Empty model response` are surfaced as AI-unavailable signals in the report + audit metadata (alongside existing 429 quota handling).
  - Verification: `npx tsc --noEmit`; targeted Jest `connectionTestService` tests.
- [x] **A2** — `lib/services/ai/quotaLatch.ts` + caller wiring: add companion handling for credit-exhaustion (402) / empty-response AI-unavailable so the day-level latch/pre-flight flow treats them consistently (design decision recorded in spec §16 Q3).
  - Verification: targeted Jest `quotaLatch` tests.

### Phase B — Duplicate-run / Telegram-notice dedup

- [x] **B1** — `lib/services/worker/worker-engine.ts`: tighten the daily-recommendations catch-up dedup so a scheduled-recovery run that already completed today is not re-enqueued by the catch-up path (defensive; aligned with Spec 30 §4B + Lesson 162/163).
  - Verification: `lib/__tests__/worker-engine.test.ts` catch-up guard tests.
  - Status: already shipped via v3.50.0/v3.52.0 (Spec 30 Fix A + catch-up day-level dedup + `hasSuccessfulRunToday`); verified green in this pass (`worker-engine.test.ts` catch-up guard matrix).
- [x] **B2** — `lib/services/dailyRecommendationService.ts`: NEW in-process per-UTC-day notice suppression (`lastDailyRecNoticeDay`) at the completion-broadcast site → at most ONE daily recommendations Telegram notice per UTC day even if a same-day double-fire slips past the run-level guards.

### Phase C — AI-down actionable BUY/SELL broadcast

- [x] **C1** — `lib/services/recommendationBroadcast.ts`: `buildRecommendationBroadcast` AI-down branch → screener-backed actionable picks (fallback technical levels) instead of unconditional all-HOLD notice.
- [x] **C2** — `lib/services/dailyRecommendationService.ts`: wire AI-down actionable-picks broadcast (`aiDown: skipAi === true`).

### Phase D — Swing target generation + Stock AI analysis fallback

- [x] **D1** — `lib/services/ai/swing-agent.ts`: verify/ensure AI-down swing target generation emits real actionable levels (LONG/SHORT/OBSERVE) via `calculateFallbackSwingAnalysis`, marked `success:true` (v3.30 behavior) with direction-aware target/SL (ITC-bug guard).
- [x] **D2** — `lib/services/ai/recommendation-agent.ts`: verify/ensure AI-down stock analysis fallback emits actionable BUY/HOLD/SELL verdicts via `calculateFallbackRecommendation`, marked `success:true`.
  - Verification: targeted Jest suites for swing/recommendation fallback (all green).

## 3. Test Strategy

- `lib/__tests__/recommendationBroadcast.test.ts`: AI-down → actionable picks; genuine all-HOLD → all-HOLD notice.
- `lib/__tests__/dailyRecommendationService.test.ts`: AI-down actionable path.
- `lib/__tests__/worker-engine.test.ts`: dedup regression.
- `lib/__tests__/ai/*`: 402 / empty-response handling.

## 4. Verification Commands

```bash
npm run test
npx tsc --noEmit
npm run lint
```

## 5. Doc Checklist

- [ ] AGENTS.md version row, `.agents/CHANGELOG.md`, TODO, Primer, agent-memory, Lessons, session memory, swagger/OpenAPI if API surface changes.

## 6. Risks / Tradeoffs

- Screener-only pick semantics need a decision (open question in spec §16 Q1).
- Dedup fix must not suppress legitimate next-day runs (per-day, not global).

## 7. Approval

- [x] Spec approved by human
- [x] Plan approved by human
