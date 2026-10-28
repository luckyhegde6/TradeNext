# Plan 34: 20-stock AI batches + conviction ranking + durable Telegram delivery

**Spec:** `.agents/specs/34-ai-batch-20-ranking-and-telegram-delivery.md`
**Branch:** fix/mirror-blobs-upload-race
**Date:** 2026-10-22
**Status:** IMPLEMENTED (docs + commit pending)

## Steps

1. `lib/services/ai/recommendation-agent.ts`
   - [x] `BATCH_SIZE 5 → 20`, `CONCURRENCY 5 → 3`; header/docstrings updated.
   - [x] Add `rankStockAnalysisResults()` (confidence → screener score → market cap →
         symbol) and call it after the batches are combined; log the top 5.
2. `lib/logger.ts`
   - [x] Additional structured console mirror (`LOG_CONSOLE_EXTRA`, default on, skipped in
         tests) for `info`/`warn`/`error` (+ `debug` when enabled).
3. `lib/services/telegramBotService.ts`
   - [x] `broadcastToSubscribers(title, message, opts?: { prependTitle?: boolean })` +
         `sendAlertToUser(..., opts)`.
   - [x] Log `failed` alongside `total`/`sent`; warn on zero subscribers.
4. `lib/services/recommendationBroadcast.ts`
   - [x] `🔔 ` prefix on the three headers (daily / swing / AI unavailable).
   - [x] `buildSwingUnavailableNotice()` for `failed` swing jobs.
5. `lib/services/dailyRecommendationService.ts`
   - [x] Pass `{ prependTitle: false }` (daily + AI-unavailable).
   - [x] Rank `successfulResults` (confidence → screenerCount → marketCap) before
         persisting/broadcasting.
6. `lib/services/swingRecommendationService.ts`
   - [x] `notifySwingTerminal(jobId)` + `SWING_TG_WINDOW_MS` (6h) + `SWING_TG_FLUSH_MS` (1h).
   - [x] Called from the processor tail, the stale-exhausted recovery path, both terminal
         serve paths, and the daemon sweep (newest 5 terminal jobs, within 1h).
7. `lib/sqlite.ts`
   - [x] `getSwingAnalysisJobs({ order: "asc" | "desc" })` (default asc — no caller change).
8. `app/components/recommendations/SwingTab.tsx`
   - [x] Drop the no-op `onSuccess` guard; keep the `lastRefreshAt` fast-poll window.
9. Tests
   - [x] `recommendation-agent.test.ts` — batches-of-20, ranking suite, failed-last.
   - [x] `recommendationBroadcast.test.ts` — single-header contract + failure notice.
   - [x] `swingRecommendationService.test.ts` — `notifySwingTerminal` (once, skip
         pending/old, failed copy, processor tail); `order` in the mirror mock.
10. Verify
    - [x] `node_modules\.bin\tsc.cmd --noEmit` → **46 errors, all `__tests__`** (prod 0).
    - [x] Targeted Jest — agent 104 + swing 104 passed (127 before the re-run).
    - [x] `npx eslint` on changed files → 0 errors (warnings pre-existing).
    - [ ] Playwright: `/recommendations` Swing tab live check (dev server).
11. Docs + hygiene
    - [x] AGENTS.md version row, `.agents/changelog/versions-v3.52.md`, `@Primer.md`,
          `@agent-memory.md`, `@Lessons.md`, session `decisions.md` + `flow.md`.
    - [x] Deleted `tmpread.cjs`, `tmp.js`, `f.js`, `f.mjs`, `_add_spam.ps1`, `tsc_check.txt`.

## Rollback

- Logger mirror: `LOG_CONSOLE_EXTRA=false`.
- Batching: revert the two constants (no schema/state dependence).
- Swing notification marker is additive JSON; old builds ignore `tgNotifiedAt`.
