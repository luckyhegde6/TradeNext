# Session Flow — Spec 42 Implementation (2026-11-08)

## 1. Symptom
Netlify scheduling/worker execution relies on in-process `node-cron` + `setTimeout` loops tied to request-serving Node process lifetime. On Netlify, instances are ephemeral (~2h idle suspension, ~15-min background function cap), so due cron ticks are missed and long jobs (Daily Recommendations 25–35 min) are killed mid-flight. Spec 42 replaces this with platform-scheduled, authenticated, bounded standalone Netlify Functions.

## 2. Root-cause trace
- `instrumentation.ts` `register()` → `watchLeaderRole("worker")` → `startWorker()` → `pollAndExecute()` every 30s (process-local, dies with instance)
- `instrumentation.ts` → `watchLeaderRole("cron-daemon")` → `startCronDaemon()` → node-cron (dies on recycle)
- `worker-engine.ts` `pollAndExecute()` → `executeTask()` wrapped in `Promise.race` with `TASK_TIMEOUT_MS = 240 min` — cannot be reliably cancelled at platform deadline
- `dailyRecommendationService.ts` `runDailyRecommendations()` — monolithic, 25–35 min, not resumable
- `leader.ts` `isLeader()` fail-open on DB down — multiple serverless instances can self-elect

## 3. Code changed this session
| File | Change | Why |
|------|--------|-----|
| `netlify/functions/worker-dispatch.mjs` (new) | Scheduled function, 1-min UTC, POST to background fn | Platform wake-up, no Prisma |
| `netlify/functions/worker-runner-background.mts` (new) | Background function, validate secret, bounded runner | 15m execution, fail-closed lease |
| `lib/services/worker/netlify-runner.ts` (new) | Bounded claim/execute, 13-min budget, concurrency 1 | Serverless-safe task execution |
| `instrumentation.ts` | Skip worker/cron loops on Netlify | No persistent daemons on serverless |
| `app/api/admin/db-health/runtime/route.ts` | Extend with tick→runner→lease→task→publish fields | Observability |
| `lib/services/dailyRecommendationService.ts` | Coordinator/batch/finalizer phases | Resumable within 15-min cap |
| `lib/services/worker/worker-service.ts` | Task runtime eligibility metadata | Budget-aware dispatch |
| Tests (new) | Handler, runner, checkpoint, lease tests | Verification |

## 4. Verified so far
- Branch `feature/spec-42-durable-worker-cron-v2` at `bfdbf7a`, clean tree, in sync with remote
- `main`/`origin/main` at `10337d9` (PR #154 merge `a5daee9`)
- `leader.ts` already has `failOpen:false` on acquire/renew/heartbeat (commits 6a77bb5/0c24f53)
- `netlify/functions/package.json` exists (`{"type":"commonjs"}`)
- No tests/tsc/lint/quickbuild run yet on this branch

## 5. Verification matrix (definition of done)
| Check | Command | Pass criterion |
|-------|---------|----------------|
| Jest unit tests | `npm run test` | All suites pass, no new failures |
| TypeScript | `npx tsc --noEmit` | 46 exact baseline, 0 production errors |
| ESLint | `npm run lint` | 0 errors on changed files |
| Quickbuild | `npm run quickbuild` | All pages build, 0 warnings |

## 6. Execution order (replay)
1. Create `netlify/functions/worker-dispatch.mjs`
2. Create `netlify/functions/worker-runner-background.mts`
3. Create `lib/services/worker/netlify-runner.ts`
4. Modify `instrumentation.ts` for Netlify split
5. Modify `dailyRecommendationService.ts` for checkpoint phases
6. Modify `worker-service.ts` for task eligibility
7. Modify `db-health/runtime/route.ts` for observability
8. Write tests for all new/modified code
9. Run `npm run test`, `npx tsc --noEmit`, `npm run lint`, `npm run quickbuild`
10. Update docs (HANDOFF, latest, Primer, Lessons, agent-memory, TODO, changelog)
11. Commit, push, create PR (user controls merge/deploy)
