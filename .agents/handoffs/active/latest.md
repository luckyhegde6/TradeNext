---
handoff: v3.40.2-mirror-contract-fixes
handoff_version: "1.1"
session_id: 2026-09-18-v3402-mirror
date: 2026-09-18
branch: fix/mirror-contract-fixes (from main @ e183a3a)
last_commits: e183a3a (changelog), 15fa0a3 (PR #128 merge), 5a8f3af (v3.40.1 fix), 32c18a1 (v3.40.1 docs)
dev: local :3000 up (PID 19896); do not kill MCP/OpenCode 4096 or pg docker 5432
status: in-progress (CODE + TESTS + DOCS DONE; commit/push/PR/deploy PENDING USER)
tier: B
---

# Handoff — v3.40.2 Mirror-contract fixes for BUGS 15/16/17

> Superseded: the v3.40.1 live-verification handoff (report-only, 3 bugs found). Prior handoffs are
> recoverable from git history of this file.

## Context

- **Task**: fix the 3 bugs found in the v3.40.1 live-site verification (P6003 plan-limit hold until
  2026-10-02 + near-empty SQLite mirror). User-approved scope: **"15 + 16 + high-impact 17"** plus
  **"add auth to POST too"** (the workers/status heartbeat).
- **Outcome**: CODE + TESTS + DOCS DONE. In scope: bug 16 (shared mirror mapper + IST day key),
  bug 15 (alerts mirror fallback + client guard), bug 17-high (`/api/admin/workers/status` GET+POST
  auth + mirror fallback + poll backoff; `/api/dividends/calendar` mirror fallback).
  **Commit/push/PR/deploy PENDING USER** (never auto-commit).
- **Files Changed**: code — NEW `lib/services/corpActionMirror.ts`, `app/api/corporate-actions/combined/route.ts`,
  `app/markets/calendar/page.tsx`, `app/api/alerts/route.ts`, `app/alerts/page.tsx`,
  `app/api/admin/workers/status/route.ts`, `app/admin/utils/workers/page.tsx`,
  `lib/services/dividendCalendarService.ts`, `app/api/openapi/route.ts`; tests — 4 NEW suites;
  docs — `BUGS.md`, `Lessons.md`, `.agents/changelog/versions-v3.40.md`, `.agents/changelog/versions-index.md`,
  `Primer.md`, `agent-memory.md`, `.agents/session-todos.md`, this file + session files.
  **No migration, no new packages.**
- **Spec/Plan**: `.agents/specs/13-mirror-contract-fixes.md` + `.agents/plans/13-mirror-contract-fixes.md`.

## Progress

- [x] Recon — root causes confirmed at source for all 3 bugs
- [x] Spec + plan written (`13-mirror-contract-fixes`) + scope approved by user
- [x] Branch `fix/mirror-contract-fixes` created from `main`
- [x] Bug 16 — NEW `lib/services/corpActionMirror.ts` mapper applied to both mirror branches; calendar `toDayKey()`
- [x] Bug 15 — `/api/alerts` list + `action=count` mirror fallback; `/alerts` `Array.isArray` + error state
- [x] Bug 17-high — workers/status GET+POST auth + mirror fallback; Workers poll backoff; dividend calendar mirror
- [x] Tests — 4 NEW suites / **26/26**
- [x] Verification — **97/97 suites, 1309 pass / 4 skip / 0 fail**; tsc **46/46 prod 0**; doc budget **76,669/102,400 B**; lint **0 errors**
- [x] UI verification — `/alerts` renders signed-in (0 console errors); `/markets/calendar` + `/admin/utils/workers` SSR 200
- [x] Docs — BUGS/lessons/changelog/openapi/Primer/memory/todos/handoff/session files
- [ ] **Commit/push/PR/deploy — PENDING USER APPROVAL**

## Decisions

- **Scope cut to "high-impact 17"** — `/api/admin/monitoring` (5 types), `/api/admin/users`,
  `/api/admin/workers`, `/api/admin/cron`, `/api/screener/saved` are recorded as a `BUGS.md` row-17
  follow-up rather than fixed here.
- **`/api/admin/users` cannot get a mirror fallback** — the SQLite mirror has **no `user` table**;
  recorded honestly instead of faking one.
- **POST auth added even though the in-repo heartbeat has no caller** — the worker engine writes
  through direct Prisma; the endpoint was nevertheless publicly writable, so it is now admin-only
  (user explicitly approved).
- **Both sides fixed for bug 17** — the endpoint (mirror fallback) AND the client (backoff), because
  fixing only the client still storms a hard-failing dependency (Lesson 131).
- **Shared mapper over per-branch patching** — one `mapMirrorCorporateAction()` used by both mirror
  branches + the dividend fallback, so the fallback cannot drift from the Prisma contract again.

## Blockers

| Blocker | Impact | Status |
|---------|--------|--------|
| Prisma P6003 plan-limit hold (until 2026-10-02) | Prisma-only APIs stay hold-degraded in prod | **Environmental** — mirror-first fallbacks are the fix path |
| Mirror has no `user` table | `/api/admin/users` cannot fall back | **Accepted** — deferred in BUGS.md row 17 |
| Browser automation hangs on `/markets/calendar` | No full admin workers walkthrough via MCP | **Accepted** — covered by SSR check + unit tests |
| No commit/push without permission | — | Standing rule |

## Learnings

1. **A fallback/mirror branch is a second implementation of the contract** — it must reuse the same
   mapper or it silently drifts (snake_case leak invisible to `tsc`). (Lesson 129)
2. **Unguarded `.filter`/`.map` on a `{error}` body turns a recoverable 500 into a blank page** via
   the Error Boundary. (Lesson 130)
3. **An unbounded client poll amplifies an outage** — a fixed 10 s `setInterval` against failing
   endpoints produced 186+ console errors per visit; back off and show a paused hint. (Lesson 131)
4. **`toISOString()` on a local-midnight date is an off-by-one** for IST viewers — use a local Y-M-D key.
5. **Jest prints guard-suite `FAIL:` lines for negative-path cases** — run the guard script directly
   to confirm the real exit code before reacting.

## Next Steps

1. **Await user approval**, then commit on `fix/mirror-contract-fixes` (code + tests + docs), push, open PR.
2. After merge/deploy: re-run the v3.40.1 live checks for the 3 fixed surfaces (`/alerts`,
   `/markets/calendar`, `/admin/utils/workers`) — with a fresh browser (the MCP session hung on the
   heavy calendar page last time).
3. **Optional follow-up**: bug-17 remainder (`/api/admin/monitoring`, `/api/admin/workers`,
   `/api/admin/cron`, `/api/screener/saved`) as a new spec — `/api/admin/users` stays impossible
   until the mirror has a user table.

## Subagent Status

| Dispatch | Agent | Tier | Budget | Outcome | Notes |
|----------|-------|------|--------|---------|-------|
| none | — | B | — | n/a | subagents remain provider-blocked on this tier (v3.40.0 D3/D11) |

## Handoff Summary
- **Tier used**: B — no dispatch attempted (known provider block)
- **State**: code + tests + docs complete on `fix/mirror-contract-fixes`; **uncommitted**
- **Verified**: jest 97/97 suites / 1309 pass / 4 skip / 0 fail · tsc 46/46 (prod 0) · doc budget
  76,669/102,400 B · lint 0 errors · live `/alerts` 0 console errors · calendar + workers SSR 200
- **Blocked**: nothing code-side; Prisma hold is environmental until 2026-10-02
- **Next**: commit/push/PR on explicit request; then post-deploy re-verify of the 3 fixed surfaces

## Verification

| Check | Result |
|-------|--------|
| `npm run test` | **97/97 suites, 1309 pass / 4 skip / 0 fail** (baseline 93/1283 + 4 suites/26 tests) |
| `check-tsc-baseline.mjs` | **46/46, prod 0 → OK (exit 0)** |
| `check-doc-sizes.mjs --json` | **ok — 76,669 / 102,400 B** |
| `npm run lint` | **0 errors** (1,139 pre-existing warnings) |
| `/alerts` (signed-in) | renders tabs + "No alerts configured", **0 console errors** |
| `/markets/calendar` | SSR 200 (1.97 s) |
| `/admin/utils/workers` | SSR 200 |
| IST day key | `2026-09-22T00:00:00+05:30` → old `2026-09-21`, new `2026-09-22` |
| `git status` | 13 modified + 7 untracked (spec/plan, 4 tests, `corpActionMirror.ts`) — **uncommitted** |

## Checkpoints

```bash
git log --oneline -5
# e183a3a docs: update changelog [skip ci]
# 15fa0a3 Merge pull request #128 from luckyhegde6/fix/production-analytics-rec-serve
# 32c18a1 docs: v3.40.1 changelog, lessons 128, primer, handoff, session todos [skip ci]
# 5a8f3af fix(sqlite): production recovery serving - deferred Blobs restore + Netlify detection + health telemetry (v3.40.1)
# 898a3f6 docs: update changelog [skip ci]
```

## Session archive

Prior sessions: `.agents/sessions/` · Chunked history: `.agents/session-archive/` ·
Version history: `.agents/changelog/versions-index.md`
