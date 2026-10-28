# Plan 33: Swing refresh race fix + resilient swing Telegram notifications

**Status:** DRAFT  
**Author:** Agent  
**Date:** 2026-10-20  
**Branch:** fix/mirror-blobs-upload-race  
**Related:** Spec 33

## Scope
Two fixes:
1. **Fix refresh race:** Make `analyze=false` path job-aware (check for pending/running swing analysis jobs) so the auto-feed doesn't overwrite a manual refresh's `pending` response.
2. **Resilient notifications:** Broadcast swing signals when job completes (done or failed), not just when done.

## Changes

### 1) Backend: job-aware for analyze=false (`lib/services/swingRecommendationService.ts`)

#### (a) Add helper to check for fresh in-flight job
Near other helpers, add logic to detect latest pending/running job that's not stale.

At ~1000-1100 in `getSwingRecommendations`:
- When `analyze === false` (or before analyze branch), also inspect jobs. If there's a fresh pending/running job, return its frozen `pending` feed from jobToResponse - this prevents the auto-feed (analyze=0) from clobbering when user clicked Refresh (analyze=1 creates job).
- Also check terminal job? If analyze=false and there's a recent terminal job, maybe return it - but analyze=false is meant to be "screener-only" view. The key issue: when a job is in-flight, analyze=false must not return "skipped".

So restructure:
```typescript
// After getting sqlite, templateIds, breakerOpen
// Job inspection (for both analyze paths to avoid race)
const jobs = sqlite?.getSwingAnalysisJobs({... all ...}) ?? [];
const latestJob = jobs[jobs.length-1] || null;
// Check fresh in-flight
// If fresh pending/running exists and not forceRefresh -> return jobToResponse(latestJob) (pending)
// This applies even if analyze=false - protects against poll overwriting refresh
```

But need to be careful not to break analyze=false semantics. The current analyze=false path never reads jobs - it always does a fresh scan.

**Proposed fix:** In `getSwingRecommendations`, after computing `sqlite`, also do job inspection when NOT `forceRefresh`. If latest job is fresh pending/running, return its frozen feed regardless of `analyze` value? Because the job contains the stocks from that run - returning pending is the correct state during generation.

Look up how jobs are stored: when analyze=true and not breakerOpen, we create job with the enriched stocks. So for an in-flight job, those stocks are the "current" run.

**Change location:** Insert job inspection before the analyze-specific branches (around line 996). Keep existing logic for analyze=true (has more complex handling for stale/terminal). Also add a simpler case for analyze=false.

```typescript
// Job inspection to prevent refresh race
if (!forceRefresh && sqlite) {
  const jobs = sqlite.getSwingAnalysisJobs({...}) ?? [];
  const latest = jobs[jobs.length-1];
  if (latest) {
    const status = String(latest.status);
    // check fresh in-flight
    const staleBefore = Date.now() - SWING_JOB_STALE_MS;
    // compute staleTime for pending/running
    if ((status === 'pending' || status === 'running') && !stale) {
      return jobToResponse(latest); // pending
    }
    // if analyze=false and terminal exists and not stale? maybe not - analyze=false is explicit screener-only
    // but to prevent race on poll, if in-flight, return pending
  }
}
```

But this changes behavior: a plain analyze=false poll while job is running will now return `pending` instead of doing a fresh scan. That’s actually better - consistent state.

#### (b) Resilient Telegram broadcast
In `processSwingAnalysisJob` (line ~875):
```typescript
// v3.16.0: broadcast actionable swing signals (LONG/SHORT) to Telegram
// Broadcast on terminal states (done or failed) when stocks exist — non-critical.
if (analysisStatus === "done" || analysisStatus === "failed") {
  try { ... buildSwingBroadcast ... broadcastToSubscribers ... }
  catch (tgErr) { logger.warn(...) }
}
```

Also consider: maybe broadcast even if no stocks? buildSwingBroadcast handles empty. Probably fine.

Also in the initial run path (around 1309+ when breakerOpen+analyze=true returns pending screener-only - no job, so no broadcast possible). Correct.

### 2) UI: mitigate SWR race if backend still clobbers (`app/components/recommendations/SwingTab.tsx`)

Even with backend fix, the mutate promise + poll timing could be tricky. Add defensive handling:
- Track `lastRefreshTs` when refresh() is called
- In refreshInterval, if data is pending and we just refreshed recently, maybe be more conservative
- Or after mutate, revalidate with REFRESH_FEED_URL result properly

Current:
```typescript
const refresh = () => {
  mutate(
    fetch(REFRESH_FEED_URL).then((r) => r.json()),
    { revalidate: false },
  );
};
```

This sets the cached data. The poll continues. With backend fix (analyze=false poll sees job is pending/running), it should return pending. That should fix it.

Alternatively, also set `refreshInterval` to treat "just refreshed" case.

### 3) Daily recommendations spam fix

#### (a) Strengthen catch-up dedup in `lib/services/worker/worker-engine.ts`
- Track last AI-unavailable notice timestamp per UTC day in memory/SQLite
- Ensure `ensureDailyRecommendationRan` doesn't re-enqueue if a run was already triggered recently
- Make dedup more aggressive (hourly window in addition to daily)

#### (b) Gate AI unavailable notice in `lib/services/dailyRecommendationService.ts`
- Only send `notifyAiUnavailable` for primary scheduled runs (not catchup, not retries triggered by resync)
- Add cooldown: don't send if last notice was sent within last X hours
- Track last notice in SQLite or in-memory

#### (c) Add notice cooldown in `lib/services/telegramBotService.ts` or a shared utility
- Centralize "AI Unavailable" notice dedup to prevent cross-path spam
- Use `_backup_meta` or similar mechanism for persistence across restarts

## Testing

### Unit tests
**`lib/__tests__/swingRecommendationService.test.ts`:**
- Add test: analyze=false poll while job is pending returns pending (not skipped)
- Add test: analyze=false poll while job is running returns pending
- Add test: broadcast sent when analysisStatus is failed and stocks exist
- Add test: broadcast not sent if job completion throws after patching? (non-critical; broadcast is try/catch)

**`lib/__tests__/dailyRecommendationService.test.ts`:**
- Add test: AI unavailable notice not sent when notifyAiUnavailable=false
- Add test: AI unavailable notice cooldown prevents spam
- Add test: only primary runs trigger notice

**`lib/__tests__/worker-engine.test.ts`:**
- Add test: catch-up dedup prevents multiple enqueues per day
- Add test: catch-up with cooldown

### Integration
**`app/components/recommendations/__tests__/SwingTab.test.tsx`:**
- If it exists, add test for refresh behavior. Otherwise may need to add minimal test.

## Verification
1. `npx tsc --noEmit` (tsc baseline must stay 46 exact prod 0)
2. `npm run test -- --maxWorkers=2` (full suite) 
3. `npm run lint` (on changed files)
4. `npm run quickbuild`
5. Playwright: load `/recommendations` Swing tab, click Refresh, verify badge becomes "AI targets generating…" then transitions without flipping to "AI targets off"

## Docs
- AGENTS.md: v3.52.0 row (or bump appropriately)
- `.agents/changelog/versions-v3.52.md` (new)
- `.agents/CHANGELOG.md` index
- `versions-index.md`
- `TODO.md` (if needed)
- `@Primer.md` Current Project Status
- `@agent-memory.md` activity log
- `@Lessons.md` if new lesson
- `HANDOFF.md`, `latest.md`, session files

## Rollout order
1. Implement backend (job-aware + broadcast)
2. Implement UI defensive changes if needed
3. Tests
4. Gates
5. Docs
6. Ask permission to commit (D9)