# Session 2026-10-15 — Prod hotfix: deploy-prep 502 + AI-unavailable Telegram spam

> Branch: session started clean at `7d03998`. All code changes UNCOMMITTED at session end (D9: agent max git action = commit on explicit request; merge/deploy = user only).

## Decisions

| # | Decision | Reasoning |
|---|----------|-----------|
| D1 | Rework "Prepare for Deploy" as an **async worker task** instead of running it in-request. | The route called `flushWriteBehind()` + `ensureSqliteBackup()` + `syncFromPrisma({force:true})` synchronously; under the Netlify gateway timeout (plan-limit hold → each Prisma call near its per-query timeout) the request never returned → **502** and the UI saw `undefined`. The pattern is already established in this repo (Spec 27 moved Google-Sheets re-scan to a worker task for the same reason). |
| D2 | Keep the executor body **byte-for-byte identical** to the old route body (moved verbatim). | Preserves behaviour; only the *when/where* changes. Avoids a silent regression in what deploy-prep actually does. |
| D3 | Return **202 `{queued, taskId}`** and tell the admin to watch Workers → Tasks. | A queued task is not "complete"; a 200 "Deploy prep complete" would be a lie. The db-health page learned the `body.queued` branch. |
| D4 | Drop the in-route breaker 503 short-circuit; the executor owns the breaker check. | The route no longer touches Prisma, so the breaker is only relevant to the executor. Keeping it in-route would 503 a request that merely enqueues — no value. |
| D5 | Add `deploy_prep` as the **31st registry type** (not a special case). | `degradedTaskRegistry` ↔ `worker-service` switch order is asserted by a test; any new dispatchable type must be registered. `degradedSafe: false` (needs Prisma to flush + mirror). |
| D6 | Fix A: bound the catch-up by counting **persisted worker-task rows for the UTC day** (`taskType:"recommendations", triggeredBy:"catchup"`). | `hasSuccessfulRunToday()` can never become true on a day where every stock fails (run persisted `status:"failed", aiProcessed:0`), so a success-keyed guard re-fires forever. Bound on the *attempt* record instead of the outcome. |
| D7 | Fix A **fails safe**: a count throw ⇒ `dedup-check-failed` ⇒ skip. | The dedup counter's failure mode is exactly the loop it exists to prevent; on an uncertain read, prefer skipping the retry over re-spamming. |
| D8 | Fix B: gate the Telegram notice on a **separate** flag (`notifyAiUnavailable`, default true; catch-up passes false). | Work-dedup and notice-dedup are different invariants. Even one bounded retry would re-notify unconditionally; the notice needs its own door. Default true keeps every existing caller (and the scheduled run) notifying once. |
| D9 | Do **NOT** commit `15OctProdlog..txt` (user-provided) or the scratch `*-out.txt`. | Repo hygiene: user artifacts + agent scratch outputs are not source. |
| D10 | Root trigger (OpenRouter free-tier 429 daily quota) is **external** — report, do not "fix" in code. | Not a code defect; the fix makes the app resilient to it, not the quota. Flagged to the user. |

## Findings

- **Spam root cause**: Spec 30 `ensureDailyRecommendationRan()` fires at daemon **boot** + every **5-min resync**; day guard `hasSuccessfulRunToday()` stays false on all-fail days ⇒ ~70 runs / ~70 duplicate "AI Analysis Unavailable" Telegram notices on 2026-10-14/15. Contradicts the spec's "only ever retry once" intent.
- **Real AI-failure trigger**: OpenRouter `openrouter/free` HTTP 429 `free-models-per-day` (`X-RateLimit-Reset` present).
- **Swing**: Chartink HTTP 419 → TradingView fallback is normal; no loop.
- **Performance**: `"Recommendation Performance Check (System)"` cron `30 10 * * 1-5` once/day; no loop.
- **Daemon leader-flapping** (many cold starts, each calling `ensureDailyRecommendationRan`) is another retrigger path; Fix A bounds it.
