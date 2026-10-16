# Spec 32 — Production resilience fixes (AI quota latch · Prisma breaker tightening · degraded-queue dedup)

> Status: **DONE (2026-10-16)** — implemented, tested, gated, documented; **COMMIT PENDING USER (D9)**. · Author: agent · Scope: bug fixes / resilience (user-approved direction, D9).
> Spec-driven workflow: `.agents/rules/spec-driven-development.md`.

## 1. Overview

**What**: Three independent production-hardening fixes:

1. **AI quota exhaustion is silent and repeated** — OpenRouter free-tier returns
   HTTP 429 `free-models-per-day`; the daily recommendation pipeline then runs
   to failure on *every* subsequent attempt, with no day-level latch and no
   visibility. Add a **per-UTC-day AI quota latch** (zero Prisma) that (a) marks
   the day exhausted the moment the 429 is seen, (b) short-circuits AI batches
   for the rest of that UTC day (no wasted calls), (c) surfaces the state in
   admin AI Monitoring + DB Health, and (d) auto-clears at UTC midnight /
   at the provider's `X-RateLimit-Reset` when supplied.
2. **Transient Prisma timeouts freeze the whole app.** `isPlanLimitHoldError()`
   trips the 5-minute plan-limit breaker on **any** `name.includes("timeout")` —
   including transient Accelerate `PrismaQueryTimeoutError` on a healthy DB.
   Tighten it so only a genuine hold (`P6003` / "hold on your account" /
   "planLimitReached") trips the breaker; per-query graceful degradation via
   `isDbUnavailableError` is unchanged; verify half-open recovery.
3. **Degraded queue re-fires a completed job every tick.** `_degraded_task`
   dedup only counts `pending`/`running`, and the degraded path never advances
   the mirror's `next_run`, so a completed cron stays "due" and
   `catchUpMissedCronJobs` re-enqueues it on every resync. Extend the dedup to
   terminal rows within a **per-job cadence window**.

**Why** (prod evidence):
- AI: 2026-10-14/15 run failed on all 100 stocks with `free-models-per-day`; the
  quota is account-wide so retries/fallbacks cannot help.
- Breaker: v3.24.0 root cause — `PrismaQueryTimeoutError` matches both
  `isDbUnavailableError` **and** `isPlanLimitHoldError`, so a 120s stall on a
  healthy DB latched the breaker for 5 min (split leadership → duplicate work).
- Degraded: Lesson 159 / `versions-v3.47.md` "BUG A" — a completed degraded run
  leaves the cron "due"; only the pending/running dedup stopped a 3rd fire.

**Scope**:
- IN: `lib/db-utils.ts`, `lib/sqlite.ts`, `lib/cron-parser.ts`,
  `lib/services/worker/degradedQueue.ts`, `lib/services/ai/quotaLatch.ts` (new),
  `lib/services/ai/{llm-provider,recommendation-agent}.ts`,
  `app/api/admin/ai/monitoring/route.ts`, `app/admin/utils/ai-monitoring/page.tsx`,
  plus tests + docs.
- OUT: schema/migrations (none), new runtime deps, buying OpenRouter credits,
  the Netlify deploy itself.

**Depends on**: Spec 21 (degraded engine), v3.20.3/v3.26.0 (breaker), Spec 30
(recommendations). Nothing new.

---

## 2. Routes

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/ai/monitoring` | Add `quota` (latch status) to the `stats` response; new `type=quota` |
| POST | `/api/admin/ai/monitoring` | New: `{ action: "clear-quota" }` clears the latch (admin) |

---

## 3. Database Schema

No Prisma schema change. Persistence uses the **local SQLite** `_backup_meta`
key/value table (already exists) via two new generic accessors — zero Prisma ops,
so the latch works under the very hold it helps diagnose.

---

## 4. Functions to Implement

### A. `lib/cron-parser.ts`

#### `cronNextGapMs(expr, from = new Date()): number`
- Returns ms from `from` to the expression's next occurrence, or `-1` when the
  expression is not 5-field (invalid). Pure; no timezone surprises (UTC).

### B. `lib/services/worker/degradedQueue.ts`

#### `cronDedupWindowMs(cronExpression): number` (module-private)
- `cronNextGapMs(expr)` clamped to `[60s, 32d]`; falls back to `DEDUP_WINDOW_MS`
  (90 min) when the gap is `-1`/≤0. So a healthy daily job is deduped for
  ~24h, an hourly job for 1h, a `*/5` job for 5m.

#### `enqueueDegradedTask(job, opts)`
- Dedup window defaults to `cronDedupWindowMs(job.cronExpression)` (was the flat
  90 min), so a completed occurrence no longer re-fires every tick.
- Comments updated (the old "a COMPLETED row does not suppress" is now wrong).

### C. `lib/sqlite.ts`

- `DEGRADED_DEDUP_SQL`: drop `AND status IN ('pending','running')` — ANY row
  with the same key inside the window suppresses a re-enqueue.
- New generic meta accessors: `persistBackupMeta(key,value)`, `restoreBackupMeta(key)`,
  `deleteBackupMeta(key)` (all best-effort, never throw). *Implemented under these
  exact names — an earlier draft of this spec said `setBackupMeta`/`getBackupMeta`.*

### D. `lib/db-utils.ts`

#### `isPlanLimitHoldError(error)`
- Match ONLY: `code === "P6003"`, message contains "hold on your account" /
  "planlimitreached". Remove the `name.includes("timeout")` clause.
- `isDbUnavailableError` unchanged (still classifies timeouts/proxy faults →
  per-query degradation).

### E. `lib/services/ai/quotaLatch.ts` (new)

- `markAiQuotaExhausted({ detail?, model?, resetAt? })` — writes the UTC-day
  latch to SQLite `_backup_meta` key `ai_quota_exhausted` + a `globalThis`
  fast-path. Never throws.
- `getAiQuotaStatus(): { exhausted, utcDay, markedAt, resetAt, detail, model }`
  — in-memory first; SQLite second. Not exhausted when `utcDay !== today(UTC)`
  or `resetAt` has passed (self-clearing).
- `isAiQuotaExhausted(): boolean`
- `clearAiQuotaExhausted(): void`
- `isDailyFreeQuotaMessage(raw): boolean` — matches `free-models-per-day` etc.

### F. `lib/services/ai/llm-provider.ts`

- `directPrompt`: on non-OK, append the trimmed error body to the returned
  string (so `free-models-per-day` is visible) while preserving the existing
  `HTTP <status>` substring other call sites detect.

### G. `lib/services/ai/recommendation-agent.ts`

- `analyzeBatch`: in the quota-exhausted branch, `markAiQuotaExhausted(...)`
  before throwing (as today).
- `analyzeStocks`: short-circuit to `failedResult` for all stocks when the
  latch is set — no HTTP calls.

### H. `app/api/admin/ai/monitoring/route.ts`

- `GET` → include `quota: getAiQuotaStatus()`; support `type=quota`.
- `POST` → `{ action: "clear-quota" }` → `clearAiQuotaExhausted()` + 200.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/cron-parser.ts` | Modified | `cronNextGapMs` |
| `lib/sqlite.ts` | Modified | dedup SQL; generic `_backup_meta` accessors |
| `lib/services/worker/degradedQueue.ts` | Modified | cadence-aware dedup window + comments |
| `lib/db-utils.ts` | Modified | `isPlanLimitHoldError` no longer matches timeouts |
| `lib/services/ai/quotaLatch.ts` | **Created** | per-UTC-day AI quota latch |
| `lib/services/ai/llm-provider.ts` | Modified | surface the 429 body |
| `lib/services/ai/recommendation-agent.ts` | Modified | mark + short-circuit |
| `app/api/admin/ai/monitoring/route.ts` | Modified | `quota` in response + clear action |
| `app/admin/utils/ai-monitoring/page.tsx` | Modified | quota banner |
| `lib/__tests__/{db-utils,degradedQueue,cronParser,worker-engine,quotaLatch,recommendation-agent}.test.ts` | Modified/Created | coverage |

---

## 6. Dependencies

None new. Internal: `@/lib/sqlite`, `@/lib/logger`, `lib/cron-parser`.

---

## 6b. API Contract

`GET /api/admin/ai/monitoring?type=stats` → `{ stats: { ..., quota: { exhausted, utcDay, markedAt, resetAt, detail, model } } }`
`POST /api/admin/ai/monitoring { action: "clear-quota" }` → `{ success: true, quota }`

---

## 9. Rules & Guardrails

- Degraded queue stays zero-Prisma; `quotaLatch` is SQLite/global-only.
- Never widen a breaker predicate; only narrow it (fewer false trips).
- `directPrompt` must keep returning a STRING (never throw) — callers depend on it.
- No new runtime deps; no schema change.

---

## 11. Error Handling

| Scenario | Behavior | Log |
|----------|----------|-----|
| SQLite mirror not ready | latch = in-memory only; `getAiQuotaStatus` still works | debug |
| `_backup_meta` write fails | swallow; in-memory latch still short-circuits | debug |
| Daily-quota 429 | mark latch, stop remaining batches | warn |
| Latch set | `analyzeStocks` returns all-failed, zero HTTP | warn |
| Wrong shape in `_backup_meta` | treat as not-exhausted | debug |
| UTC rollover | latch self-clears (day mismatch) | info |

---

## 12. Test Strategy

### Unit
- `cronParser.test.ts`: `cronNextGapMs` (daily ≈ 24h, `*/5` = 5m, invalid = -1).
- `degradedQueue.test.ts`: completed row suppresses within window; cadence
  window from cron takes precedence; different keys still enqueue.
- `db-utils.test.ts`: `PrismaQueryTimeoutError` no longer matches; genuine
  hold (P6003 + message) still matches; existing 2×2 preserved.
- `quotaLatch.test.ts` (new): mark→status; UTC-day rollover clears; `resetAt`
  in the past clears; malformed meta tolerated; `clear` resets.
- `recommendation-agent.test.ts`: latch set ⇒ zero `directPrompt` calls;
  quota branch marks the latch.

### Existing guards
- `sqlite.test.ts` real-engine `DEGRADED_DEDUP_SQL` bind test must still pass
  (same 2 binds).

---

## 15. Definition of Done

- [ ] Fix 1/2/3 implemented per §4
- [ ] `DEGRADED_DEDUP_SQL` updated + real-engine guard passes
- [ ] No Prisma schema change; no new deps
- [ ] Unit tests added and green (targeted)
- [ ] `npx tsc --noEmit` = 46 exact baseline (prod 0)
- [ ] `npm run lint` clean on touched files
- [ ] `npm run quickbuild` succeeds
- [ ] Docs updated (AGENTS.md, CHANGELOG, Primer, Lessons, agent-memory, session-todos)
- [ ] Committed only after user approval (D9)
