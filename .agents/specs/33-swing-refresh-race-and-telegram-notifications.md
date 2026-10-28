# Spec 33: Swing refresh race fix + resilient swing Telegram notifications

**Status:** DRAFT  
**Author:** Agent  
**Date:** 2026-10-20  
**Branch:** fix/mirror-blobs-upload-race (proposed)  
**Related:** Spec 15 (Swing AI auto-seed), Plan 09 Phase 8, v3.16.0 Telegram broadcast, Spec 30 (AI-unavailable dedup/fix)

## Problem statement
User reports from prod logs/UI:
1. `/recommendations` Swing Trading Signals shows "AI targets off 20 picks · 185 flagged · 34 screeners — ⟳ Refresh even after triggering refresh getting AI targets off"
2. "also no telegram notification is triggered on swing"
3. **Daily recommendations Telegram spam** (from user logs): repeated "⚠️ AI Unavailable" messages every ~10 min from ~04:01 AM to ~04:59 AM, then again throughout the day (15 Oct). Run history shows many failed runs with 0 stocks / 0 AI-analyzed (some with 100 stocks but still failed). Also saw legitimate messages like "/swing" returning data and "/daily-recommendations" returning older data. Need to understand why this happens.

Root causes:
- **UI race (SWR):** `SwingTab` subscribes to `AUTO_FEED_URL` (`analyze=0`, cached `skipped`). Clicking Refresh calls `mutate(fetch(REFRESH_FEED_URL)...)` with `{revalidate:false}`, setting the same SWR key to `pending` (from analyze=1). The 60s poll (and/or 10s poll while pending) re-fetches `AUTO_FEED_URL` (`analyze=0`). In `getSwingRecommendations`, `analyze=false` never checks for in-flight jobs (jobs are only inspected when `analyze=true && !breakerOpen`) and falls through to the screener path returning `analysisStatus: "skipped"` with cached/stale data → overwriting pending with "AI targets off".
- **No Telegram notification:** `broadcastToSubscribers` for swing is only called when `analysisStatus === "done"` (≥1 stock has AI analysis). When AI analysis fails for all stocks, `analysisStatus` becomes `"failed"` and the broadcast is skipped entirely. Also even if signals exist, failed analysis means no actionable LONG/SHORT from AI → notification not sent.

## Goals
1. **Fix refresh race:** When a manual Refresh is triggered (or when any job is pending/running for the swing tab), the auto-feed/poll must not clobber `pending` with `skipped`. The tab must reliably transition pending → done/failed.
2. **Resilient Telegram notifications:** Send swing notifications on terminal states (done or failed) when there are signals to report, with an honest message when AI analysis failed (or when no actionable AI picks exist). Never block feed/job completion on notification failures.

## Non-goals
- Changing Chartink/TV fallback behavior
- Changing screener logic
- Modifying the job queue architecture
- Sending notifications for analyze=false (screener-only) polls

## Proposed solution

### A) Fix SWR refresh race (backend + UI)
**Backend (`lib/services/swingRecommendationService.ts`):**
- Check for latest swing analysis job **regardless of `analyze` flag** (or when `analyze === false` also inspect jobs). If a fresh pending/running job exists and `!forceRefresh`, return its frozen feed as `pending` (same as analyze=true path). This makes the auto-feed (`analyze=0`) job-aware.
- Alternatively restructure: move job inspection to before the analyze-branch split, so analyze=false polls see in-flight jobs.
- Ensure `jobToResponse` already handles pending/running correctly.

**UI (`app/components/recommendations/SwingTab.tsx`):**
- When `refresh()` mutates, prevent the poll from immediately overwriting with `skipped`. Options:
  - Track a local "refreshing" flag and adjust `refreshInterval` (return null/longer while pending and recently refreshed)
  - Use `mutate` to also seed/update in a way that’s resilient
  - After refresh, call mutate on AUTO_FEED_URL again with the pending response and set a timestamp to ignore the next poll response if it’s skipped
- Simplest: after setting pending via mutate, if the next poll returns `skipped` while we expect pending, ignore it. Or change refreshInterval to `data?.analysisStatus === "pending" ? 5000 : 60000` and also handle the case where analyze=false poll overwrites.

But backend fix is cleaner and prevents the issue for all consumers.

### B) Resilient swing Telegram notifications
**Service (`lib/services/swingRecommendationService.ts`):**
- Change broadcast condition from `if (analysisStatus === "done")` to `if (analysisStatus === "done" || analysisStatus === "failed")` when there are stocks to report.
- Or broadcast whenever job completes and has stocks, regardless of analysisStatus.

**Broadcast (`lib/services/recommendationBroadcast.ts`):**
- `buildSwingBroadcast` already handles empty actionable list with "No actionable swing signals today — X stocks scanned." This is acceptable for failed-analysis case.
- Optionally enhance message to mention AI analysis failed when `analysisStatus === "failed"`, but not required.

**Safety:**
- Keep try/catch around broadcast (already present)
- Don't fail job completion on broadcast errors
- Respect existing subscriber filtering

### C) Investigate and fix daily recommendations Telegram spam ("AI Unavailable")
From user logs:
- Repeated "⚠️ AI Unavailable" messages every ~10 min (04:01, 04:13, 04:23, ..., 04:59) and again later in day
- At 08:56 PM got a normal "Daily Recommendations" message with data (IDEA BUY etc) — so data exists later
- Run history shows many failed runs (0 stocks / 0 AI-analyzed) and one failed run with 100 stocks but 0 AI-analyzed

**Investigation points:**
1. **Catch-up logic (`lib/services/worker/worker-engine.ts`, `ensureDailyRecommendationRan`)**: Spec 30 added dedup (per-UTC-day catch-up). Check if dedup is working correctly. The daemon/resync might be re-enqueueing runs repeatedly.
2. **AI unavailable notice (`lib/services/dailyRecommendationService.ts`, `buildAiUnavailableNotice`)**: v3.50.0 added Fix B to make catch-up retries silent (`notifyAiUnavailable=false` when payload.source==="catchup"). Check if ALL re-enqueues are marked as catchup. Also check if the cron-triggered runs are triggering notices incorrectly.
3. **`hasSuccessfulRunToday()` logic**: If a run fails with all stocks having no AI analysis, is it considered "successful"? The spam suggests the system thinks it needs to retry/re-notify.
4. **Rate of enqueues**: 5-min resync tick could be creating many catch-up tasks if not deduplicated properly. Check `worker-engine` dedup logic.
5. **Manual triggers / admin actions**: Check if there are other paths triggering runs.

**Likely fix:** Strengthen dedup (per-day + per-hour + track last notice timestamp), ensure notifyAiUnavailable only fires for "primary" scheduled runs not retries, and add cooldown on AI-unavailable notices.

## Files to change
- `lib/services/swingRecommendationService.ts` - job inspection for analyze=false; broadcast on failed/done
- `app/components/recommendations/SwingTab.tsx` - SWR refresh race mitigation (if needed after backend fix)
- `lib/services/recommendationBroadcast.ts` - possibly minor message tweak (optional)
- Tests: `lib/__tests__/swingRecommendationService.test.ts`, `app/components/recommendations/__tests__/SwingTab.test.tsx` (if exists)

## Acceptance criteria
1. Clicking Refresh on Swing tab shows "AI targets generating…" (pending) and transitions to done/failed without being clobbered back to "AI targets off" within a few polls.
2. When AI analysis fails for all stocks, a Telegram broadcast is still sent (with honest message like "No actionable swing signals today — N stocks scanned" or similar) to subscribers.
3. Existing behavior unchanged for normal success case.
4. No regressions in feed loading, caching, or job processing.
5. Tests pass.

## Risks
- Making analyze=false job-aware could change caching behavior slightly - need to ensure cache keys don't conflict.
- Broadcasting on failed analysis might send more notifications, but they're honest and non-actionable; better than silence per user report.
- SWR timing issues in tests.

## Rollout
1. Implement backend fixes first
2. Add/update tests
3. Verify with Playwright against local dev server
4. Update docs (AGENTS.md, CHANGELOG, Primer, agent-memory, Lessons)
5. Ask permission to commit
