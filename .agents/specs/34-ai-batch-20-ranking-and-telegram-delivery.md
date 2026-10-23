# Spec 34: 20-stock AI batches + conviction ranking + durable Telegram delivery

**Status:** IMPLEMENTED (verification pending)
**Author:** Agent
**Date:** 2026-10-22
**Branch:** fix/mirror-blobs-upload-race
**Related:** Spec 33 (swing refresh race), v3.16.0 broadcast, v3.50.0 (AI-unavailable dedup), v3.51.0 (quota latch), Plan 09 Phase 8

## Problem statement

Four user-reported defects, one release:

1. **Daily AI analysis throughput.** With `configuredModel=openrouter/free` and `stocks=100`
   the run issues 20 batch calls (`BATCH_SIZE=5`). Free-tier quota burns out and the whole
   run fails. User's direction: batch **20 per call**, then **combine all batch results and
   order by score and confidence**.
2. **Swing Telegram notification never arrives.** `processSwingAnalysisJob` broadcasts only
   from the instance that finished the analysis. On Netlify the request-path processor is
   frozen as soon as the HTTP response is returned, and the stale-exhausted recovery path
   marks a job `failed` **without broadcasting**. Result: no swing notification, ever.
3. **Duplicate Telegram header.** `broadcastToSubscribers(title, body)` prefixes
   `🔔 *title*`, while each builder's body repeats its own `⚠️/📈/🌊 *... — date*` line:
   `🔔 ⚠️ AI Unavailable` followed by `⚠️ AI Analysis Unavailable — 20 Oct 2026`.
4. **"Server logs are proper".** `lib/logger.ts` already mirrors to the console, but the
   formatted single-string line is hard to filter. User asked for an additional console log
   everywhere `logger.info/warn/error` is used.

## Goals

1. `BATCH_SIZE = 20`, `CONCURRENCY = 3`; combined results are deterministically ordered by
   **score then confidence** before they leave the agent.
2. Swing notifications are **delivered at least once per terminal job**, even when the
   processing instance dies, and never re-sent for the same job.
3. Every broadcast message has exactly **one** header line.
4. Logger emits an **additional structured console line** for every `info/warn/error`
   (single central change, env-gated, no call-site churn).

## Non-goals

- No new worker task type, no degraded-registry change, no DB migration.
- No change to the AI model chain / OpenRouter credit handling (external).
- No change to screener or swing scoring math.

## Proposed solution

### A) Batch of 20 + combined ranking (`lib/services/ai/recommendation-agent.ts`)

- `BATCH_SIZE = 20`, `CONCURRENCY = 3` (fewer, larger calls; still inside the 14-min cap).
- New exported pure helper `rankStockAnalysisResults(results)`:
  `successful first` → `confidence desc` → `screenerCount desc` → `marketCap desc` →
  `symbol asc`. Ties are stable.
- `analyzeStocks()` calls it once after `Promise.all` (i.e. after the batches are combined)
  and logs the top 5. The documented contract changes from "preserve input order" to
  "combined + ranked".

### B) Durable swing notification (`lib/services/swingRecommendationService.ts`)

- Notification state lives **inside the job payload** (`payload.tgNotifiedAt`) — the
  `swing_analysis_job.payload` column is JSON on both SQLite and Prisma, so this needs no
  migration.
- `notifySwingTerminal(jobId)`:
  1. re-read the job; require terminal status (`done`/`failed`) and a non-empty
     `payload.stocks`;
  2. skip when `payload.tgNotifiedAt` is set, when the job completed more than
     `SWING_TG_WINDOW_MS` (6 h) ago, or when the module guard already handled it;
  3. build + broadcast; on success write `tgNotifiedAt` back (payload merged, never
     replaced) — at-least-once, no duplicate on a normal retry.
- Called from three observation points so a dead processor can never swallow it:
  - end of `processSwingAnalysisJob` (fresh completion),
  - stale-exhausted recovery inside `maybeProcessSwingAnalysis` (previously silent),
  - `getSwingRecommendations` when it serves a terminal job (fire-and-forget).

### C) Single header (`lib/services/telegramBotService.ts` + `recommendationBroadcast.ts`)

- `broadcastToSubscribers(title, message, opts?: { prependTitle?: boolean })`; default
  `true` keeps admin announcements unchanged.
- Daily / swing / AI-unavailable callers pass `{ prependTitle: false }`; the three builders
  prefix their own header with `🔔 `, so the delivered message is:
  `🔔 ⚠️ *AI Analysis Unavailable — 22 Oct 2026*` + body.
- `broadcastToSubscribers` summary log gains `failed` so a partial delivery is visible.

### D) Additional console mirror (`lib/logger.ts`)

- `writeToFile()` keeps the formatted line, then emits a second native call with the raw
  object (`console.log("[INFO]", msgStr, meta)` / `console.warn` / `console.error`).
- Gated by `LOG_CONSOLE_EXTRA` (`"false"` disables), skipped under `NODE_ENV=test`.

## Verification

- `npx tsc --noEmit` → 46 errors, all in `__tests__` (prod 0).
- Targeted Jest: recommendation agent, recommendationBroadcast, swing service, logger.
- `npm run lint` clean on changed files.
- Playwright: `/recommendations` Swing tab — Refresh → pending persists → terminal state.

## Risks

- Larger batches raise per-call output tokens; `maxTokens` is 8192 and the default model has
  a 1M context window. A truncated batch still degrades per-stock (HOLD + error), unchanged.
- `tgNotifiedAt` rides in the JSON payload; the Prisma `Json` column accepts the extra key.
