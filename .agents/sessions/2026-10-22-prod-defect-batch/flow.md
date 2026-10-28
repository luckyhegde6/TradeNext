# Flow — 2026-10-22 v3.52.0 (Spec 34)

## Diagnosis path

1. Prod log review (`22 Oct`, two instances `e7ec86fa` / `f9489e7c`): leader locks healthy; `Cron boot
   recommendations catch-up enqueued … reason=missed-daily-window` ⇒ the 04:30 UTC daily run did not succeed;
   every AI call failed with OpenRouter **402 Insufficient credits** (also empty model responses).
2. Swing tab: `Refresh` (`force=1`) returned `analysisStatus: "skipped"` while the analysis job was in flight —
   the `analyze=0` poll was not job-aware and clobbered `pending` with `skipped` (fixed in Spec 33).
3. Telegram: prod never received the swing summary even for completed jobs. Read `processSwingAnalysisJob` →
   broadcast at the tail only; `maybeProcessSwingAnalysis` stale-exhausted path → `failed` with **no** broadcast;
   `getSwingRecommendations` terminal serve → no broadcast. Root cause = execution lifetime + missing marker.
4. Duplicate Telegram header: `broadcastToSubscribers` prepends `🔔 *title*`, builders already emit their own
   `⚠️/📈/🌊 *… — date*` line ⇒ two headers.
5. Batching: `BATCH_SIZE = 5` ⇒ 20 model calls per 100-stock run; results merged in completion order;
   `rankActionableByConfidence` in `dailyRecommendationService` is never called (dead code).

## Code touched (in order)

| # | File | Change |
|---|------|--------|
| 1 | `lib/services/ai/recommendation-agent.ts` | `BATCH_SIZE 5→20`, `CONCURRENCY 5→3`, docstrings; new exported `rankStockAnalysisResults()` called once after `Promise.all` + top-5 log |
| 2 | `lib/logger.ts` | `extraConsoleEnabled`; `writeToFile(entry, level, message?, args?)` emits `console.log/warn/error("[LEVEL]", msg, ...args)`; all four logger methods pass `message`/`args` |
| 3 | `lib/services/telegramBotService.ts` | `sendAlertToUser(..., opts)` + `broadcastToSubscribers(title, message, opts)` with `prependTitle`; broadcast log `{ total, sent, failed }`; zero-subscriber warn |
| 4 | `lib/services/recommendationBroadcast.ts` | `🔔 ` prefix on daily / swing / AI-unavailable headers; new `buildSwingUnavailableNotice()` |
| 5 | `lib/services/dailyRecommendationService.ts` | rank re-assert on `successfulResults`; `{ prependTitle: false }` on both broadcasts |
| 6 | `lib/services/swingRecommendationService.ts` | `SWING_TG_WINDOW_MS` / `SWING_TG_FLUSH_MS` / `swingNotifyInFlight`; `notifySwingTerminal(jobId)`; wired processor tail + stale-exhausted recovery + both terminal serves + daemon sweep (moved **after** the pending job so a real analysis is never delayed) |
| 7 | `lib/sqlite.ts` | `getSwingAnalysisJobs({ order })` (`asc` default, `desc` = newest first) |
| 8 | `app/components/recommendations/SwingTab.tsx` | removed the no-op `onSuccess` guard (kept the 15 s fast-poll window) |

## Tests

- `lib/__tests__/recommendation-agent.test.ts` — batches **20** (25 stocks ⇒ 2 calls); failure isolation rewritten
  (40 stocks, `\bSTOCK1\b` anchor, failed-last assertions); new `rankStockAnalysisResults` describe (confidence,
  score, market cap, failed-last, determinism + no input mutation, `analyzeStocks` end-to-end order); the
  "order differs" test now asserts symbol lookup + ranked order.
- `lib/__tests__/recommendationBroadcast.test.ts` — new `single-header contract` describe (one `🔔` header for all
  three builders) + honest swing failure notice.
- `lib/__tests__/swingRecommendationService.test.ts` — `broadcastToSubscribers` mocked; mirror mock honours
  `order`; new `notifySwingTerminal` describe (once, no re-send, skip pending, skip >6 h, failed copy,
  processor-tail wiring); **Spec 33 follow-up regression**: a fresh in-flight job must beat a cached `skipped`
  payload on an `analyze=0` poll (cache primed by a real warm-up call).

## Late defect found by live verification (same release)

Playwright on `/recommendations` (dev :3000 started by me, demo session) showed the header going
`AI targets generating…` → **`AI targets off`** ~15–20 s after Refresh. Cause: `getSwingRecommendations`
returned `staticCache` **before** the job-aware lookup, so once the tab's 15-s fast-poll window expired the
`analyze=0` poll was answered from the warm-up's cached `analysisStatus: "skipped"` — Spec 33's fix was present,
tested and **never executed**. Fix: `findFreshInFlightSwingJob(sqlite)` resolved before the cache return, and it
overrides only when the cache cannot be strictly better (`!cached || skipped || failed`; a cached `done` wins). The
old post-cache duplicate block was deleted. Lesson 166.

Live re-verification: 15 × `Swing served from in-flight job (cache-bypass poll) … cachedStatus=skipped` while the
header stayed `AI targets generating…`; `Swing analysis complete, total=20, succeeded=20, failed=0`; then
`Telegram broadcast for swing signals, sent=0, jobId=85b8d47e…, status=done` (0 = local Prisma down).
A second dev boot served a stale Blobs mirror snapshot, so a post-restart terminal re-render was not observable
(covered by unit tests instead).

## Verification

```
node_modules\.bin\tsc.cmd --noEmit          → 46 errors, all app/**/__tests__ + lib/__tests__ (prod 0)
npx jest swingRecommendationService         → 65/65 (incl. the cache-precedence regression)
npx jest --silent (full)                    → 138/138 suites · 2095 pass / 4 skip / 0 fail
npx eslint <11 changed files>               → 0 errors (58 pre-existing warnings)
npm run quickbuild                          → compiled successfully · 201/201 static pages
node scripts/dev-checks/check-doc-sizes.mjs → OK 31.9 KB AGENTS.md · 95.9 KB total
```

## Docs updated

`AGENTS.md` (v3.52.0 row + "latest version detail" pointer), `.agents/changelog/versions-v3.52.md`,
`.agents/changelog/versions-index.md`, `Primer.md` (Last Updated + Current Project Status), `agent-memory.md`,
`Lessons.md` (Lesson 165 + Update Log), `.agents/plans/34-…` checkboxes, this session folder.
