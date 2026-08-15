# Session Decisions — 2026-08-14 (v3.10.1)

Branch: `fix/cron-tz-swing-perf` | Commit: `b35eca4`

## D1 — Honest latest-run: single query, no verdict filter (A1)

**Decision**: `getLatestRecommendations` selects the latest run with `status in ["completed","failed"]` AND
`uniqueStocks > 0`, WITHOUT filtering verdicts; returns all stocks incl. HOLD; BUY/SELL filtering is
presentation-only in the UI.
**Why**: the old "latest run with a BUY/SELL stock" query showed a STALE actionable run (Aug 13) while today's
run existed but was all-HOLD — public page looked frozen. An all-HOLD day is itself news ("no actionable picks
today"); hiding it misleads. Trade-off: the Daily Picks tab may show HOLD-heavy days — acceptable and honest.
**Not chosen**: adding a `hasActionable` flag column (migration + backfill for a presentation concern).

## D2 — Shared pure fallback-chain module, uniform contract (A2)

**Decision**: NEW `lib/services/ai/modelChain.ts` — `AI_FALLBACK_MODELS = ["openrouter/free","openrouter/auto"]`,
`modelFallbackChain(primary?)` (deduped, fresh array). All three agents (recommendation, swing, IPO) use the
same loop shape: primary = RETRY_MAX attempts, each fallback = 1 attempt, whole chain bounded by the batch
deadline, `trackAiCall` records `usedModel`, error messages carry "(M models)".
**Why**: three divergent ad-hoc retry loops existed; a single contract makes prod behavior predictable and
testable. Fresh-array per call because the config object is mutated (`{ ...config, model }`).
**Not chosen**: a framework (langchain) or a shared "execute with chain" wrapper — the three callers have
different prompt/batch/deadline shapes; a thin pure helper keeps them decoupled.

## D3 — IPO loop wraps only directPrompt; sentinel throw; stale fallback preserved

**Decision**: loop over models for the `directPrompt` call; sentinel (`AI is not configured` / `AI request
failed`) → try next model; all fail → throw "AI analysis failed — please try again."; `MarketCache` stale
fallback + outer catch untouched. `content` declared `string | undefined` and re-asserted after the catch.
**Why**: full-chain retries burn the 14-min cap; one attempt per model on the shortest path is enough signal.
TS can't narrow loop-assigned variables across try/catch — the declaration/guard is the minimal sound fix.

## D4 — Swing tracker persistence keyed to analysisStatus "done", non-fatal

**Decision**: `swingTrackerDraft` (pure) + `persistSwingTrackers` hooked in `getSwingRecommendations` only when
`analysisStatus === "done"` (≥1 stock analyzed), wrapped in try/catch (never breaks the swing response).
Mapping LONG→BUY / SHORT→SELL / OBSERVE→HOLD; `timeHorizon = "swing"` so the existing Performance filter
(`where.timeHorizon = category`) and 3:30 PM IST perf-check cron pick the trackers up with NO schema change.
Existing active trackers get currentPrice/lastCheckedAt refreshed, targets stay as-of creation; duplicates
prevented via `createMany skipDuplicates` on the `@@unique([symbol, createdAt])` constraint.
**Why**: user asked for swing picks to show in the Performance tab; the tracker model already supports arbitrary
timeHorizons. **Not chosen**: a new SwingPosition model or a schema migration (unnecessary — the constraint +
timeHorizon already fit).

## D5 — daysTracked sort → orderBy createdAt (pre-existing 500, fixed en route)

**Decision**: `sort=daysTracked` (public API option since v3.5.0) passed the computed field raw to Prisma →
500 `Unknown argument 'daysTracked'`. Fixed: `daysTracked` is floor((now-createdAt)/day)+1 → strictly monotonic
with createdAt → `orderBy.createdAt = order` (same pattern as returnPercent). Regression test asserts
`orderBy = { createdAt: order }` and no "daysTracked" key.
**Why**: found live while verifying the Performance tab for D4's tracker surfacing; it's a one-line mapping +
test on the exact page being verified. Surgical, no behavior change for other sorts.

## D6 — No push, no deploy

**Decision**: commit to `fix/cron-tz-swing-perf` only; do NOT push/merge/deploy (user manages prod; Netlify
CRON_SECRET state still unknown — recs cron hasn't fired since Aug 13 05:10 UTC, must be checked by user
post-deploy to validate the fallback fix).
