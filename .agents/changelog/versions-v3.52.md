# v3.52.0 — 20-stock AI batches + conviction ranking · durable swing Telegram delivery · single-message header · structured console mirror

> Status: **CODE + TESTS + GATES + DOCS DONE — COMMIT PENDING USER (D9)**. Push / merge / deploy are **user actions only**.
> Spec: `.agents/specs/34-ai-batch-20-ranking-and-telegram-delivery.md` · Plan: `.agents/plans/34-ai-batch-20-ranking-and-telegram-delivery.md`.
> Diff: **13 modified** source/test files + 1 new spec + 1 new plan. No Prisma schema change → **no migration**. No new runtime package.

---

## 1. Overview

| # | Symptom (user report) | Root cause | Fix |
|---|----------------------|-----------|-----|
| 1 | Daily AI run with `configuredModel=openrouter/free`, `stocks=100` burns the free daily quota and fails; results need ordering | `BATCH_SIZE=5` ⇒ 20 batch calls per run; batches completed out of order and were merged in completion order; the ranking helper `rankActionableByConfidence` was **dead code — never called** | `BATCH_SIZE=20`, `CONCURRENCY=3` ⇒ 5 calls; new `rankStockAnalysisResults()` combines batches then orders **confidence → screener score → market cap → symbol**; the daily service re-asserts the same order before persisting/broadcasting |
| 2 | "no telegram notification is triggered on swing" | Broadcast lived **only** at the tail of `processSwingAnalysisJob`. Netlify freezes the request-path processor after the response; the stale-exhausted recovery path marked jobs `failed` with **no broadcast**; `getSwingRecommendations` served terminal jobs without ever broadcasting | Durable marker `payload.tgNotifiedAt` + `notifySwingTerminal(jobId)` called from **every** observation point (processor tail, stale-exhausted recovery, terminal serve, 1-hour daemon sweep) → **exactly one** notification per job |
| 3 | Telegram message shows **two headers**: `🔔 ⚠️ AI Unavailable` then `⚠️ AI Analysis Unavailable — 20 Oct 2026` | `broadcastToSubscribers(title, body)` always prefixed `🔔 *title*`, while every builder's body already carried its own `⚠️/📈/🌊 *… — date*` header | `opts.prependTitle` (default `true` for admin announcements) + `{ prependTitle: false }` from the three recommendation call sites; builders own the single `🔔` header |
| 4 | "wherever logger.info/warn/error exists add an additional console.log" | `writeToFile()` already console-mirrored the formatted one-line string (hard to filter in Netlify's function viewer) | One central change: an **additional** native `console.log/warn/error("[LEVEL]", message, ...args)` for every call, opt-out `LOG_CONSOLE_EXTRA=false`, silent under `NODE_ENV=test` |
| — | Honesty gap found while fixing #2 | A `failed` swing job has no AI verdicts, so `buildSwingBroadcast` rendered its "No actionable swing signals today" branch | New `buildSwingUnavailableNotice()` — states the AI failed, optional reason, points at the screener feed |

---

## 2. Batching + ranking (`lib/services/ai/recommendation-agent.ts`)

- `BATCH_SIZE 5 → 20`, `CONCURRENCY 5 → 3`. A 100-stock run now issues **5** model calls instead of 20 (free-tier friendly) while the worker pool keeps the phase inside the 14-minute background cap.
- `rankStockAnalysisResults(results)` — pure, non-mutating, exported for tests:
  1. `success` before `failed` (a synthetic HOLD fallback never outranks a real verdict),
  2. `confidence` desc,
  3. screener agreement (`screenerNames.length`) desc — the "score",
  4. `marketCap` desc,
  5. `symbol` asc (total order ⇒ deterministic across runs).
- `analyzeStocks()` applies it once, after `Promise.all` (i.e. after the batches are **combined**), and logs the top 5 (`msg=Stock analysis ranked`).
- Contract change: the old docstring promised "results preserve input order" — now documented as "combined + ranked".

**`lib/services/dailyRecommendationService.ts`** re-asserts the same comparator on `successfulResults` (defensive: the circuit-breaker/cached paths can bypass the agent). This order drives DB row order, Today's Picks and the Telegram body.

---

## 3. Durable swing notification (`lib/services/swingRecommendationService.ts`)

- `SWING_TG_WINDOW_MS` = 6 h (never resurrect a stale job), `SWING_TG_FLUSH_MS` = 1 h (daemon sweep horizon), `swingNotifyInFlight` per-process guard.
- `notifySwingTerminal(jobId)`:
  1. re-read the job; require terminal (`done`/`failed`) **and** a non-empty `payload.stocks`;
  2. skip when `payload.tgNotifiedAt` is set, when the job is older than `SWING_TG_WINDOW_MS`, or when this process is already notifying it;
  3. build (`buildSwingBroadcast` for `done`, `buildSwingUnavailableNotice` for `failed`) → `broadcastToSubscribers(..., { prependTitle: false })`;
  4. **merge** `{ tgNotifiedAt, tgNotifiedSent }` back into the payload (never replace — it holds the feed). At-least-once on crash, at-most-once on retry.
- Observation points (any one of them delivers):
  - tail of `processSwingAnalysisJob` (fresh completion),
  - stale-exhausted recovery in `maybeProcessSwingAnalysis` (previously **silent**),
  - `getSwingRecommendations` when serving a terminal job (latest, and the newest terminal behind a stale in-flight row),
  - daemon sweep after the pending job: newest **5** terminal jobs completed within 1 h.
- `lib/sqlite.ts`: `getSwingAnalysisJobs({ order })` — default `"asc"` (every existing caller unchanged); `"desc"` gives the sweep the newest rows without parsing a 500-row payload tail.

**State location:** `payload` is JSON on both the SQLite mirror and Prisma (`SwingAnalysisJob.payload Json`) ⇒ additive key, **no migration**.

### 3.1 Live-verification follow-up — the cache short-circuit hid the in-flight job (same release)

Spec 33's job-aware read was **unreachable on a cache hit**: `getSwingRecommendations` returned `staticCache` *before* it ever looked at the job table. So the `analyze=false` auto-poll was answered from the warm-up's screener-only payload (`analysisStatus: "skipped"` → header "AI targets off") while the manual Refresh's job was still pending — **the reported symptom survived Spec 33** and only reproduced in a live browser (unit tests never prime the cache).

- `findFreshInFlightSwingJob(sqlite)` — newest **fresh** (`SWING_JOB_STALE_MS`) `pending`/`running` row, or `null`. A stale/abandoned row must never mask a terminal feed.
- The in-flight lookup now runs **before** the cache return, and only when the cache cannot beat the job: `!cached || cached.analysisStatus === "skipped" || cached.analysisStatus === "failed"`. A cached `done` payload still wins (strictly richer, and it avoids a SQLite read on every poll).
- The old post-cache duplicate block was deleted (dead once the check moved up); the breaker guard still short-circuits everything (plan-limit hold ⇒ zero Prisma).
- Regression test: `serves the in-flight job to an analyze=false poll even when a skipped payload is cached (Spec 33 follow-up)` — warm-up caches `skipped`, a `pending` row appears, the poll must return `pending`, must not re-scan, and must not create a second job.

**Live proof (dev server, 2026-10-22 18:18 → 18:28 IST):**

| Observation | Before the follow-up | After |
|---|---|---|
| Banner 20–35 s after Refresh | `AI targets off` (served from cache) | `AI targets generating…` for the entire run |
| Server log, every 10 s poll | cache hit, no job read | `Swing served from in-flight job (cache-bypass poll), status=running, jobId=85b8d47e…, analyze=false, cachedStatus=skipped` |
| Job outcome | — | `Swing analysis complete, total=20, succeeded=20, failed=0` |
| Telegram | never sent (only the frozen request path had it) | `Telegram broadcast for swing signals, sent=0, jobId=85b8d47e…, status=done` — **0 because local Prisma is down (`ECONNREFUSED`), not because the path failed** |

---

## 4. Single header (`lib/services/telegramBotService.ts` + `recommendationBroadcast.ts`)

- `sendAlertToUser(chatId, title, message, link?, opts?)` → `opts.prependTitle === false` sends the body as-is.
- `broadcastToSubscribers(title, message, opts?)` forwards the option; admin `/api/admin/telegram/broadcast` keeps the default (title inline).
- Builders now emit `🔔 📈 *Daily Recommendations — …*`, `🔔 🌊 *Swing Signals — …*`, `🔔 ⚠️ *AI Analysis Unavailable — …*`, `🔔 ⚠️ *Swing Analysis Unavailable — …*`.
- Broadcast counters now log `{ total, sent, failed }`; zero verified subscribers logs a warning instead of a silent `sent: 0`.

---

## 5. Console mirror (`lib/logger.ts`)

```ts
const extraConsoleEnabled = (() => {
  try { if (process.env.NODE_ENV === "test") return false;
        return process.env.LOG_CONSOLE_EXTRA !== "false"; }
  catch { return true; }
})();
```

`writeToFile(entry, level, message, args)` keeps the formatted line (unchanged, still written to `logs/<date>.log`) then emits `console.log("[INFO]", message, ...args)` / `console.warn("[WARN]", …)` / `console.error("[ERROR]", …)`. Netlify renders the raw object expandable and `[WARN]`/`[ERROR]` greps work.

---

## 6. UI (`app/components/recommendations/SwingTab.tsx`)

Removed the `onSuccess` guard added in Spec 33 — a **no-op**: SWR commits the payload to cache *before* the callback runs, so it could never "ignore" a `skipped` response. The race is fixed server-side (job-aware `getSwingRecommendations`), so the guard was deleted rather than left as misleading dead code. The `lastRefreshAt` 15 s fast-poll window is kept.

---

## 7. Tests

| Suite | Added / changed |
|-------|-----------------|
| `lib/__tests__/recommendation-agent.test.ts` | batches-**20** test (25 stocks = 2 calls); failure isolation rewritten for 40 stocks / failed-last; new `rankStockAnalysisResults` describe (confidence, score, cap, failed-last, determinism/no-mutation, `analyzeStocks` end-to-end order) |
| `lib/__tests__/recommendationBroadcast.test.ts` | new `single-header contract` describe: one `🔔` header for each builder + honest failure notice |
| `lib/__tests__/swingRecommendationService.test.ts` | `broadcastToSubscribers` mock; mirror mock honours `order`; new `notifySwingTerminal` describe (once, no re-send, skip pending/old, failed copy, processor-tail wiring); **Spec 33 follow-up regression**: an in-flight job must beat a cached `skipped` payload on an `analyze=0` poll |

Gates: `tsc --noEmit` → **46 errors, all `__tests__` (prod 0)** · targeted Jest **104 + 104 passed** · `eslint` on all changed files **0 errors** (58 pre-existing warnings) · full Jest **138/138 suites · 2095 passed / 4 skipped / 0 failed** · `npm run quickbuild` **compiled successfully, 201/201 static pages**.

**Doc-budget gate follow-up**: the first full-suite run after the doc pass failed only `lib/__tests__/check-doc-sizes.test.ts` — the new v3.52.0 row pushed `AGENTS.md` to **32.6 KB** against the **32 KB** per-file budget (total was still 96.9/100 KB). Fixed by compressing the v3.52.0 row to the release essentials and demoting older verbose rows (v3.43.0, v3.44.0, v3.47.0) to their `.agents/changelog/` files → **31.9 KB**, total **95.9 KB**, gate green. Lesson: a version row is *injected context*, so its detail belongs in `.agents/changelog/`.

---

## 8. Known limits

- **OpenRouter credits exhausted is an external condition** (HTTP 402 `Insufficient credits`). Batching cuts the call count; it cannot buy credits. The daily quota latch (v3.51.0) and Spec 30 catch-up dedup keep the outage quiet (≤1 "AI unavailable" notice per UTC day).
- Telegram delivery is at-most-once **per job**; a job that never reaches a terminal status simply produces no message (correct — there is nothing to report).
- The daemon sweep only runs on a warm instance; that is why the marker is observed from the request path too.
