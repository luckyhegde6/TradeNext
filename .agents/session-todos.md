# Session Todos

## Current (2026-10-29 — Fix Daily Market Sync cron + Daily Recommendations cron silently dropped)
- [x] **Root cause found**: On boot, `ensureRecommendationCrons()` runs BEFORE `catchUpMissedCronJobs()`. `ensureRecommendationCrons()` ALWAYS advances `nextRun` to the next future occurrence, so an overdue once-daily job (e.g. Daily Market Sync at 01:01 UTC, missed due to Netlify suspension) gets its `nextRun` advanced to the next day WITHOUT ever spawning a task. `catchUpMissedCronJobs()` then runs but finds `nextRun` already in the future — the job is silently dropped.
- [x] **Fix 1**: Swapped boot order in `cron-daemon.ts` — `catchUpMissedCronJobs()` now runs BEFORE `ensureRecommendationCrons()`, so overdue jobs are spawned first.
- [x] **Fix 2**: `ensureRecommendationCrons()` now skips advancing `nextRun` for jobs whose current `nextRun` is in the past (overdue). Left for `catchUpMissedCronJobs()` to handle.
- [x] **Verify**: tsc clean on modified files; 3 test suites pass (51 tests): recommendationCronService, cron-daemon, daemon-sqlite-first
- [ ] **Commit** — Ready to commit on branch `fix/openrouter-credits-accelerate-6hr-sync`
- [ ] **Push** — Push to origin
- [ ] **Update PR** — PR #137 will automatically include these new commits
