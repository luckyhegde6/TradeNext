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

## D7 — `recommendationsCache` must be a `globalThis` singleton, not a module-scope const (v3.11.2)**Decision**: share ONLY `recommendationsCache` via `globalThis` (`__recommendationsCache`, the `lib/prisma.ts`
pattern); leave main/hot/static/historical caches at module scope. The other caches are NOT invalidated
cross-module (the worker's market sync writes the DB `market_cache` table, and read paths re-validate DB
freshness), so sharing them would be speculative — keep the diff surgical.
**Why**: Next.js dev (Turbopack) loads `instrumentation.ts` (worker/cron daemon) and API routes as SEPARATE
module graphs — `lib/cache.ts` was evaluated twice, so the worker's `invalidateRecommendationsCache()` flushed
ITS NodeCache copy while the route kept serving the 23h-stale `latest` entry ("Last updated: 14/8/2026" right
after the v3.11.1 fix re-ran recs). Invalidation is object identity — it only works when both sides resolve the
same instance.
**Test strategy**: `jest.resetModules()` + re-`require` simulates two module graphs; assert identity
(`toBe`), cross-instance visibility, and the worker→route regression (`flushAll` in load B empties load A's
view). This catches any future regression where someone moves the cache back to module scope.
**Not chosen**: (a) sharing ALL caches (unjustified — no cross-module invalidation semantics; each shared
instance also resists dev hot-reload garbage collection, so only share what must be shared); (b) moving the
cache into the DB (overkill — the NodeCache + 23h TTL is correct; only the instance identity was wrong).

## D8 — Full serverless purge: Netlify is a persistent server, no opt-out, no Blob store (v3.11.3)

**Decision**: remove every "serverless" branch, opt-out, and Blob-store dependency that the v3.11.0 in-process
node-cron daemon made obsolete: (1) DELETE the `CRON_DAEMON_DISABLED=1` guard + comments from
`instrumentation.ts` + `cron-daemon.ts` — Netlify runs the app as a persistent Next.js server so the daemon
must self-start there (⚠️ BREAKING vs the v3.11.0 doc: the flag must NOT be set anymore); (2) DELETE
`lib/netlify-logger.ts` + drop `@netlify/blobs` from `package.json`/lock; strip ALL Blob/serverless branches
from `lib/logger.ts` + `worker-logger.ts` (file logs = single truth); (3) drop `serverless:` fields + the amber
"file-system logs ephemeral" banner from monitoring route/page; (4) rewrite ~25 stale "serverless" comments.
**Why**: the v3.11.0 daemon only runs inside a persistent process — with Netlify now serving the app as a
persistent server, every conditional serverless path is dead weight and actively misleading (the opt-out could
silently disable the daemon in prod, and the Blob mirror duplicated logging with a store that no longer needs
to exist). One codepath = predictable behavior.
**Kept**: `NEXT_RUNTIME === "nodejs"` + `NEXT_PHASE !== "phase-production-build"` in `instrumentation.ts`
(build/Edge safety, not serverless — the app genuinely must not start the daemon during a production build or
on an Edge runtime); `netlify.toml` + `@netlify/plugin-nextjs` (deploy config still valid); prisma/schema.prisma
line-4 "serverless" boilerplate (Prisma's own template text, not an app claim); "server-logs" monitoring tab
type names (legit file-log feature, unrelated to the Blob store).
**DataFetcher un-skip**: `DataFetcher.test.tsx` was `describe.skip`'d for a REMOVED API (`children`/`apiCall`
props + undefined `mockUseApi`/`mockApiCall` globals). Rewrote it for the current `apiUrl` + `render`
render-prop API with `@/lib/hooks/useApi` mocked (DataFetcher 7 + PaginatedDataFetcher 1 + RealtimeDataFetcher 1
= 9 tests, 9/9 pass). Caught a real render-prop mismatch (raw data passed as the render arg, not `{data}`).
**Not chosen**: (a) keeping the opt-out "just in case" (it would silently disable the daemon on Netlify — the
exact failure mode the daemon replaced); (b) keeping `@netlify/blobs` for "future logs" (the Blob store was the
serverless workaround; a persistent server writes normal files); (c) fixing the repo-wide jest-dom
`toBeInTheDocument` typing gap (pre-existing across ALL test files, runtime-fine via jest.setup.js — out of
scope for a purge commit).
