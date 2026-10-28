# Session 2026-10-22 — v3.52.0 (Spec 34): batching/ranking · durable swing Telegram · single header · console mirror

Branch: `fix/mirror-blobs-upload-race` (holds the uncommitted Spec 33 + 34 work).
Spec/plan: `.agents/specs/34-ai-batch-20-ranking-and-telegram-delivery.md` / `.agents/plans/34-…`.

## Decisions

- **D1 — Batch 20, concurrency 3.** `BATCH_SIZE 5 → 20`, `CONCURRENCY 5 → 3`. The binding constraint is the
  free-tier *daily* model quota (a 100-stock run at 5/batch = 20 calls), not wall clock; 20 keeps the phase
  inside the 14-minute background cap. Rejected: dynamic batch sizing (adds a config surface, no evidence it
  helps) and raising concurrency (more parallel 429s).
- **D2 — Rank once, at the combine boundary.** New exported, pure, non-mutating `rankStockAnalysisResults()`:
  success → confidence desc → `screenerNames.length` desc → marketCap desc → symbol asc. A total order, so two
  runs over the same data agree. Rejected: reviving `rankActionableByConfidence()` (in `dailyRecommendationService`)
  — it *filters* to BUY/SELL and truncates, which would drop HOLD rows the run must still persist; it stays as
  dead code, out of scope.
- **D3 — Defensive re-assert in the service.** `dailyRecommendationService` re-applies the same comparator on
  `successfulResults` because the breaker/cache paths can bypass the agent. Cheap, and it keeps the persisted
  row order, Today's Picks and the Telegram body consistent.
- **D4 — Swing notification is a *durability* problem, not a formatting one.** Diagnosis: the broadcast lived
  only at the tail of `processSwingAnalysisJob`, which is kicked fire-and-forget from the HTTP request; Netlify
  freezes that instance after the response, the stale-exhausted recovery marked `failed` **silently**, and
  `getSwingRecommendations` served terminal jobs without broadcasting. Fix = marker + multiple observation
  points, not "call Telegram harder".
- **D5 — Marker in `payload` (JSON), not a new column.** `tgNotifiedAt` / `tgNotifiedSent` ride in
  `SwingAnalysisJob.payload`, which is `Json` on Prisma and `jsonKeys` on the SQLite mirror ⇒ **no migration**,
  and old builds simply ignore the keys. Rejected: a Prisma schema change (sensitive op, needs approval, and a
  migration for a delivery flag is disproportionate).
- **D6 — Mark after the attempt, merge into the existing payload.** Marking before the send would lose a message
  on a crash; replacing the payload would delete the stock feed the message is built from. Windows:
  `SWING_TG_WINDOW_MS` 6 h (skip stale jobs) and `SWING_TG_FLUSH_MS` 1 h (how far back the daemon sweep looks —
  a fresh boot must not message users about yesterday's run).
- **D7 — `getSwingAnalysisJobs({ order })`, default `"asc"`.** The sweep needs the *newest* terminal jobs; the
  existing query is `ORDER BY created_at ASC LIMIT ?`, so `limit: 5` would have returned the five oldest rows in
  the table and the sweep would never have matched. Additive option, default unchanged, so every existing caller
  is byte-identical.
- **D8 — Honest failure copy.** A `failed` swing job has no AI verdicts, so `buildSwingBroadcast` renders its
  "No actionable swing signals today" branch — a lie when the AI never ran. New `buildSwingUnavailableNotice()`
  states the analysis failed + reason + the screener feed still exists.
- **D9 — One header, one owner.** `prependTitle?: boolean` (default `true` for admin announcements) on
  `broadcastToSubscribers` / `sendAlertToUser`; the three recommendation call sites pass `false` and the builders
  own the `🔔` line. Rejected: stripping the prefix inside the broadcast (text surgery, breaks `toContain` tests).
- **D10 — Console mirror at the sink.** One change in `lib/logger.ts` adds a native
  `console.log/warn/error("[LEVEL]", msg, ...args)` beside the formatted file line, gated by `LOG_CONSOLE_EXTRA`
  (default on) and forced off under `NODE_ENV=test`. Rejected: editing ~500 `logger.*` call sites (unreviewable)
  and `process.stdout` monkey-patching (fragile under Netlify).
- **D11 — Delete the no-op `onSuccess` guard in `SwingTab.tsx`.** SWR commits the payload to cache *before* the
  callback runs, so it could never "ignore" a `skipped` response; leaving it would be misleading dead code. The
  real fix is server-side (job-aware `getSwingRecommendations`).
- **D12 — OpenRouter 402 is out of scope for code.** Prod logs show `Insufficient credits`; batching reduces the
  call count, it cannot buy credits. The v3.51.0 quota latch + Spec 30 catch-up dedup keep the outage to ≤1
  "AI unavailable" notice per UTC day. Recorded as an external action for the user.
- **D13 — Commit is user-only (D9 rule).** Code + tests + gates + docs are complete; the agent stops before
  `git commit` and waits for an explicit request. Merge/deploy are never agent actions.

## Not done / deliberately deferred

- Full Jest suite + `npm run quickbuild` + Playwright `/recommendations` live check were still pending when the
  docs were written (targeted suites + tsc + eslint were green).
- `rankActionableByConfidence()` remains dead code in `dailyRecommendationService.ts` (pre-existing).
- The blobs upload-race fix and the branch-policy lesson commit (`5c15987`) are separate, unpushed work items.
