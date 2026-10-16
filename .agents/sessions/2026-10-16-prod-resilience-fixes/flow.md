# Flow — 2026-10-16 Spec 32 prod resilience (AI quota latch · breaker cause · degraded dedup)

> Execution path + code touched. All changes UNCOMMITTED at session end (`main` ahead of `origin/main` by 1 = the prior `0a712eb` v3.50.0 commit).

## 1. Analysis (read-only)

1. Re-read the v3.50.0 findings (`.agents/changelog/versions-v3.50.md`) + prod logs for the three symptoms.
2. Traced Fix 3: `lib/services/worker/cron-daemon.ts` (`ensureDailyRecommendationRan` boot + 5-min resync) → `worker-engine.ts` `catchUpMissedCronJobs` (`:815`) → `runDegradedPathIfActive("cron")` → `enqueueDueCronJobsFromMirror` (`:357`) → `lib/services/worker/degradedQueue.ts` `enqueueDegradedTask` → `lib/sqlite.ts` `DEGRADED_DEDUP_SQL` (`:297`, `status IN ('pending','running')`). Confirmed the mirror `next_run` is never advanced on the degraded path ⇒ only the dedup row can stop the loop.
3. Traced Fix 2: `lib/db-utils.ts` `isPlanLimitHoldError` (`:236`) matched `name.includes("timeout")` — and `PrismaQueryTimeoutError` also satisfies `isDbUnavailableError`, so a transient timeout latched the 5-min global freeze.
4. Traced Fix 1: `lib/services/ai/recommendation-agent.ts` `analyzeBatch` (`:266`) detected quota and **threw** (no latch); `analyzeStocks` therefore re-attempted every resync.
5. Confirmed doc-budget constraints: `scripts/dev-checks/check-doc-sizes.mjs` (32 KB/file, 100 KB total); AGENTS.md 31.9 KB / TODO.md 32.6 KB before this session ⇒ both needed trimming to gain a row.

## 2. Spec + plan

| File | Change |
|------|--------|
| `.agents/specs/32-prod-resilience-fixes.md` | NEW — overview, modified routes, schema (none), A–H functions, files, API contract, guardrails, test strategy, DoD. Status ticked **DONE**. |
| `.agents/plans/32-prod-resilience-fixes.md` | NEW — Phases 0–5 (recon → Fix 3 → Fix 2 → Fix 1 → gates → docs) + risks/rollbacks + out-of-scope. Status ticked **DONE**. |

## 3. Fix 3 — degraded-queue cadence dedup

| File | Change |
|------|--------|
| `lib/cron-parser.ts` | NEW `cronNextGapMs(expr, from = new Date()): number` — ms from `from` to the **next** scheduled occurrence; **−1** for a non-5-field/invalid expression (so `calculateNextRun`'s +60 s fallback is never mistaken for a schedule gap). |
| `lib/sqlite.ts` | `DEGRADED_DEDUP_SQL` **drops** `AND status IN ('pending','running')` → status-agnostic (a terminal `completed`/`failed`/`skipped` row suppresses); comment updated. |
| `lib/services/worker/degradedQueue.ts` | NEW `cronDedupWindowMs(cronExpression, from?)` = `cronNextGapMs` clamped `60_000 … 30d`, falling back to `DEDUP_WINDOW_MS` (90 min) when the gap is not a positive finite number; `enqueueDegradedTask` now defaults `dedupWindowMs` to it (was the constant). |

## 4. Fix 2 — breaker keys on the cause

| File | Change |
|------|--------|
| `lib/db-utils.ts` | `isPlanLimitHoldError` narrowed to `code === "P6003"` / `"hold on your account"` / `"planlimitreached"`; **removed** `name.includes("timeout")`. `isDbUnavailableError` untouched (per-query degradation preserved). |

## 5. Fix 1 — AI daily free-quota latch

| File | Change |
|------|--------|
| `lib/services/ai/quotaLatch.ts` | **NEW** (zero Prisma): `isDailyFreeQuotaMessage()`, `markAiQuotaExhausted({model, detail, resetAt?})`, `isAiQuotaExhausted()`, `getAiQuotaStatus()`, `clearAiQuotaExhausted()`, `__resetAiQuotaLatchForTests()`; UTC-day validity + self-clear on read; persistence = `restoreBackupMeta`/`persistBackupMeta`/`deleteBackupMeta` on `_backup_meta` **+** `globalThis.__aiQuotaLatch`. |
| `lib/sqlite.ts` | NEW generic `_backup_meta` KV helpers `persistBackupMeta` / `restoreBackupMeta` / `deleteBackupMeta` (best-effort, never throw, no-op when the mirror isn't ready). |
| `lib/services/ai/llm-provider.ts` | `directPrompt` keeps the `HTTP <status>` text and **appends** the trimmed provider body (≤300 chars, whitespace-collapsed) so the quota signal survives to the caller. |
| `lib/services/ai/recommendation-agent.ts` | `analyzeBatch` latches on `isDailyFreeQuotaMessage(raw)` only; `analyzeStocks` short-circuits → labelled failed results with **zero HTTP calls** while latched. |
| `app/api/admin/ai/monitoring/route.ts` | `quota: getAiQuotaStatus()` in stats; `type=quota`; `POST {action:"clear-quota"}` (unknown → 400). |
| `app/admin/utils/ai-monitoring/page.tsx` | Amber banner (day · model · auto-clear · detail) + **Clear latch** button. |

## 6. Tests + verification

- NEW `lib/__tests__/quotaLatch.test.ts`; updated `cronParser`, `degradedQueue`, `sqlite`, `recommendation-agent`, `db-utils` tests; `dbHealthRoute.test.ts` 2 stale sync-contract tests → async 202 (**21/21**).
- `npx tsc --noEmit` → **46 exact (prod 0)**.
- `npm run test` → **138/138 suites · 2078 pass / 4 skip / 0 fail** (run alone).
- `eslint` on touched files → **0 errors** (6 pre-existing warnings unchanged).
- `npm run quickbuild` → compiled, **201/201** static pages.
- `git --no-pager diff --stat` → 24 modified, +529/−79; plus 5 untracked (spec, plan, `quotaLatch.ts`, `quotaLatch.test.ts`, `versions-v3.51.md`).
- **Playwright** (admin login on dev :3000, PID 25396 — pre-existing, not started here): `/admin/utils/ai-monitoring` renders, **0 real console errors**; `?type=stats` carries `quota`; `?type=quota` → 200; `POST {action:"clear-quota"}` → 200; unknown action → 400; banner markup + `Clear latch` present in the 16 served client chunks. Browser closed; dev server left running (not ours to kill). Banner visually unconfirmed (D15).

## 7. Docs updated

`.agents/changelog/versions-v3.51.md` (NEW, 9 sections + Lesson 163) · `AGENTS.md` (v3.51.0 row + v3.41.1–3 collapsed → 31,697 B) · `.agents/CHANGELOG.md` index · `.agents/changelog/versions-index.md` · `TODO.md` (v3.51.0 block + v3.48.0 demoted → under cap) · `Primer.md` (Last Updated + `### v3.51.0` status) · `agent-memory.md` · `Lessons.md` (**Lesson 163**) · `.agents/session-todos.md` (new Current block) · `HANDOFF.md` (state + v1.17 row) · `.agents/handoffs/active/latest.md` (rewritten; BUG A recorded as resolved-by-window) · spec/plan status ticks + `setBackupMeta`→`persistBackupMeta` naming alignment · this session folder.

## 8. Not done

- **COMMIT** (D9 — on explicit user request only); merge/push/deploy user-only.
- Visual confirmation of the amber quota banner (needs a real daily-free 429 or a dev-mirror latch write — not approved).
- OpenRouter quota restore (credits / non-free model) — external, not code.
