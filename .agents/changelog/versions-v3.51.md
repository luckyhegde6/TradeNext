# v3.51.0 — Prod resilience: AI daily-quota latch · breaker trips on the *cause* · degraded-queue cadence dedup

> Status: **CODE + TESTS + GATES + DOCS DONE — COMMIT PENDING USER (D9)**. Push / merge / deploy are **user actions only**.
> Spec: `.agents/specs/32-prod-resilience-fixes.md` · Plan: `.agents/plans/32-prod-resilience-fixes.md` (spec-driven workflow).
> Three *independent* production-hardening fixes. Diff: **14 modified + 1 new** source/test file. No Prisma schema change → no migration. No new runtime package.

---

## 1. Overview

| # | Symptom (prod) | Root cause | Fix |
|---|----------------|-----------|-----|
| 1 | Every daily-recommendation attempt fails silently all day (~70 runs/notices 2026-10-14/15) | OpenRouter free tier: **account-wide** per-UTC-day budget → HTTP 429 `free-models-per-day`; no day latch, so the pipeline re-runs 100 stocks × batches × models to failure each time | New **per-UTC-day quota latch** (`free-models-per-day` only) → `analyzeStocks` short-circuits (zero HTTP calls); visible in AI Monitoring + API; operator "Clear latch" |
| 2 | Whole app freezes for 5 min at a time | `isPlanLimitHoldError()` matched `name.includes("timeout")`, so a **transient** `PrismaQueryTimeoutError` opened the 5-minute plan-limit breaker | Narrow the predicate to a **real hold** (`P6003` / "hold on your account" / `planLimitReached`). A transient timeout degrades **per-query** (`isDbUnavailableError`) instead of freezing everything |
| 3 | Job re-fires every 5-min resync forever | `DEGRADED_DEDUP_SQL` only checked `pending`/`running` rows; once a run **completed**, the still-"due" mirror cron (`next_run` deliberately static) was re-enqueued on the next resync | Status-agnostic dedup **+** the window is the job's **own cadence** (`cronNextGapMs`), clamped 60 s…32 d (90-min fallback for an invalid expression) |

**Bonus (residual v3.50.0):** two stale tests in `lib/__tests__/dbHealthRoute.test.ts` encoded the pre-`0a712eb` *synchronous* `deploy_prep` contract ("breaker-open fast-fail"). They were red on `main` independent of these changes; rewritten to the **async 202-queued** contract.

---

## 2. Fix 1 — AI daily free-quota latch

**New module `lib/services/ai/quotaLatch.ts`** (zero Prisma):

- `markAiQuotaExhausted({detail, model, resetAt?, now?})` — idempotent; latches the **UTC day**; `resetAt` defaults to next UTC midnight; record = `{utcDay, markedAt, resetAt, detail, model}`.
- `getAiQuotaStatus(now?)` / `isAiQuotaExhausted(now?)` — **self-clearing**: a record whose `utcDay` ≠ today, or whose `resetAt` has passed, is ignored **and deleted** (no reset job needed).
- `clearAiQuotaExhausted()` — operator clear.
- `isDailyFreeQuotaMessage(raw)` — latches **only** the account-wide *daily free* 429 (`free-models-per-day` / `free models per day` / `free-model`+`day`). A transient per-minute 429 intentionally does **not** latch the day.
- `__resetAiQuotaLatchForTests()`.

**Persistence is SQLite-first** (`lib/sqlite.ts`): new generic KV helpers `persistBackupMeta` / `restoreBackupMeta` / `deleteBackupMeta` over `_backup_meta` (all three never throw; no-op when the mirror is not ready). At runtime the latch also lives on `globalThis.__aiQuotaLatch`, so a cold SQLite mirror can never disable the short-circuit **mid-instance**. The key is `ai_quota_exhausted`.

**Wiring:**

- `lib/services/ai/llm-provider.ts` — `directPrompt` failure string keeps its `HTTP <status>` marker and appends `[<trimmed provider body>]` (whitespace-collapsed, ≤300 chars) so the daily signal survives into the caller while existing substring checks (e.g. `isQuotaExhausted`) keep working unchanged.
- `lib/services/ai/recommendation-agent.ts` — `analyzeBatch` calls `markAiQuotaExhausted({model, detail})` when (and only when) `isDailyFreeQuotaMessage(raw)`; `analyzeStocks` returns a labelled `failedResult` for every stock **without any HTTP call** when `isAiQuotaExhausted()`.
- `app/api/admin/ai/monitoring/route.ts` — `GET ?type=stats` now also returns `quota`; new `GET ?type=quota`; new **`POST {action:"clear-quota"}`** (admin-only; unknown action → 400).
- `app/admin/utils/ai-monitoring/page.tsx` — `AiQuotaStatus` interface, `quota` state, amber banner (day · model · auto-clear time · detail) with a **"Clear latch"** button (`handleClearQuota`).

Behavioural rules: the latch is generic KV so a missing mirror is a no-op, and it deliberately covers **only** an account-wide daily budget — a per-minute 429 must not disable the AI for a day.

---

## 3. Fix 2 — the breaker must trip on the HOLD, not on a timeout

`lib/db-utils.ts` `isPlanLimitHoldError()` dropped the `name.includes("timeout")` clause. It now matches **only**:

```
code === "P6003" || message.includes("hold on your account") || message.includes("planlimitreached")
```

**Why.** `PrismaQueryTimeoutError` is our own 120 s deadline; the Accelerate proxy can exceed it on a **healthy** DB. It also matches `isDbUnavailableError`, so treating it as a hold latched the 5-minute global freeze on transient latency (and the split-leadership path then produced duplicate work). Now a transient timeout degrades **per-query** via the existing `isDbUnavailableError` chain, while a genuine P6003 hold still opens the breaker (the proxy returns P6003/"hold on your account" in that case).

Tests: `db-utils.test.ts` — the timeout expectation flipped to `false` (from `true`) and a **"degrades per-query"** test was added (`isDbUnavailableError(timeout) === true` while `isPlanLimitHoldError(timeout) === false`) so the two predicates can never be conflated again.

---

## 4. Fix 3 — degraded-queue dedup: completed count, window = cadence

Three coupled edits:

1. **`lib/sqlite.ts` `DEGRADED_DEDUP_SQL`** dropped the status filter:
   - before: `… AND status IN ('pending','running') AND created_at >= ?`
   - after: `… AND created_at >= ?`
   Any row (including terminal `completed`/`failed`/`skipped`) inside the window now suppresses a re-enqueue. The pre-v3.51.0 filter only stopped a duplicate **while in flight** — once a run finished, the next resync re-enqueued a still-due cron.
2. **New `lib/cron-parser.ts cronNextGapMs(expr, from?)`** — ms from `from` to the next occurrence, `-1` for a non-5-field expression (so callers never mistake `calculateNextRun`'s **+60 s** invalid-expression fallback for a real gap).
3. **`lib/services/worker/degradedQueue.ts`** — new `cronDedupWindowMs(expr, from?)` = that gap, clamped `60 s…32 d`, falling back to `DEDUP_WINDOW_MS` (90 min) when the gap is not a positive finite number. `enqueueDegradedTask` now defaults `dedupWindowMs` to `cronDedupWindowMs(job.cronExpression)` instead of the constant 90 min.

**Why the cadence is the only correct window.** The degraded path intentionally does **not** advance the mirror `next_run` (the user explicitly rejected "advance `next_run`"; the mirror row is replaced by the next `syncFromPrisma`). With the cursor static, the enqueue window **is** the schedule: a fixed 90-min window re-fires a daily job every 90 min, while the job's own gap fires it exactly once per occurrence — daily once a day, hourly once an hour.

---

## 5. Bonus — v3.50.0 residual test fix

`lib/__tests__/dbHealthRoute.test.ts` had two tests encoding the **pre-v3.50.0** synchronous `POST /api/admin/db-health {action:"deploy_prep"}` contract (deploy-prep "breaker-open fast-fail" → 503). Commit `0a712eb` moved the action to a queued worker task (always validating, then 202 `{queued:true, taskId}`), so the two tests were **red on `main`** independent of this work. Rewritten against the async contract (task orchestrator mocked); the suite is **21/21**. Recorded here as a residual v3.50.0 gap, not as new behaviour.

---

## 6. Files

| File | Change |
|------|--------|
| `lib/services/ai/quotaLatch.ts` | **NEW** — per-UTC-day latch (ack/nack, self-clearing, zero Prisma) |
| `lib/sqlite.ts` | `DEGRADED_DEDUP_SQL` status-agnostic; accessor comment; **new** generic `persistBackupMeta`/`restoreBackupMeta`/`deleteBackupMeta` |
| `lib/services/ai/llm-provider.ts` | `directPrompt` failure string keeps `HTTP <status>` and appends the trimmed provider body |
| `lib/services/ai/recommendation-agent.ts` | latch on daily-free 429; `analyzeStocks` short-circuit |
| `app/api/admin/ai/monitoring/route.ts` | `quota` in stats · `?type=quota` · `POST clear-quota` |
| `app/admin/utils/ai-monitoring/page.tsx` | `AiQuotaStatus` · `quota` state · amber banner · Clear latch |
| `lib/db-utils.ts` | `isPlanLimitHoldError` narrowed (timeout removed) |
| `lib/cron-parser.ts` | **new** `cronNextGapMs` |
| `lib/services/worker/degradedQueue.ts` | **new** `cronDedupWindowMs`; enqueue default window = cadence |
| `lib/__tests__/{cronParser,db-utils,dbHealthRoute,degradedQueue,recommendation-agent,sqlite}.test.ts` | updated/added (incl. 2 stale dbHealthRoute tests) |
| `lib/__tests__/quotaLatch.test.ts` | **NEW** |

---

## 7. Tests & gates

- **New/updated suites:** `quotaLatch.test.ts` (new), `cronParser.test.ts` (`cronNextGapMs`: Fri→Mon = 3 days), `degradedQueue.test.ts` (FakeMirror dedup status-agnostic; +2), `sqlite.test.ts` (dedup semantics inverted incl. a real-sql.js accessor test: a completed row suppresses inside the window, and backdating `created_at` −120 s lets a *new* occurrence fire), `recommendation-agent.test.ts` (quotaLatch mock + 3 wiring tests), `db-utils.test.ts` (timeout → `false`; new per-query test), `dbHealthRoute.test.ts` (orchestrator mocked; 2 rewritten → 21/21).
- **Full Jest:** `138/138` suites — **2078 passed / 4 skipped / 0 failed**.
- **tsc:** `46` exact, **prod 0** (all 46 are the standing `__tests__`-only baseline; no touched file contributes).
- **ESLint:** 0 errors on touched files (pre-existing 6 warnings in `recommendation-agent.test.ts` unchanged).
- **quickbuild:** compiled successfully, **201/201** static pages.

### Playwright (dev server on :3000)

- admin login → `/admin/utils/ai-monitoring` renders, **0 console errors** (the single logged error was a deliberate unknown-action probe).
- `GET /api/admin/ai/monitoring?type=stats` now carries `quota`; `?type=quota` → 200; `POST {action:"clear-quota"}` → 200 `{success:true,quota}`; unknown action → 400.
- The banner markup + the `"Clear latch"` string are confirmed **served** in the client chunks (16 scanned).
- **Not visually confirmed:** the banner only renders when the latch is actually set, and setting it locally would require either a real `free-models-per-day` 429 or writing dev-mirror state (not approved). Mitigated by the unit tests + the served-chunk check.

---

## 8. Not done / residual

- **External, not code:** OpenRouter free-tier daily quota is exhausted on the account (the Fix-1 latch bounds the damage; a true restore needs credits or a non-free model). Prisma plan-limit/Accelerate hold is external too (Fix 2 only tightens *our* breaker).
- **Deliberately unchanged:** the mirror `next_run` stays static on the degraded path (user decision); the 5-min re-fire loop is closed by the dedup window, not by advancing the cursor.

---

## 9. Lesson

**Lesson 163** — fix the classification, not the symptom: a breaker predicate that includes a *generic* symptom (`name.includes("timeout")`) couples unrelated failure modes and freezes on transient latency; and a dedup window must be derived from the schedule it guards, not a fixed constant, whenever the schedule cursor is immutable.
