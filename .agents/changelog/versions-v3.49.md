# v3.49.0 — Specs 28–31 completion (missing plan tests) + PR #135 CI fixes

> Branch `fix/daily-rec-swing-cron-worker`; the Specs 28–31 implementation was committed earlier as `28d6806` ("test"). This version completes the **approved plans' test deliverables** (Spec 30 + Spec 31 had **no tests at all**) and fixes the **two PR #135 CI failures**: Quality Gate `tsc-baseline` (2 PRODUCTION tsc errors) and Playwright (route-mock drift). COMMIT pending user (D9); MERGE/DEPLOY always user actions.

## Context — why this version exists

PR #135 was red on 2 of its checks:

1. **Quality Gate / `tsc-baseline`** — reported production tsc errors in `app/admin/google-sheets/page.tsx`.
2. **Playwright Tests** — `e2e/admin-google-sheets.spec.ts` failed.

Separately, the approved plans for **Spec 30** (`.agents/plans/30-weekend-stale-cron-freshness.md`) and **Spec 31** (`.agents/plans/31-google-sheets-prod-env-arming.md`) each list test deliverables that had never been written, so "Spec 28–31 tests pass" was not actually provable.

## 1. CI Fix 1 — Quality Gate `tsc-baseline`

**Root cause.** Spec 31's "not armed" card renders `{status.missingEnvVars.length > 0 && …}` and `status.missingEnvVars.map(…)` **unconditionally**, but the page's local `SheetsStatus` interface had no `missingEnvVars` member:

- `page.tsx:180` → `TS2339: Property 'missingEnvVars' does not exist on type 'SheetsStatus'`
- `page.tsx:187` → `TS2551: Did you mean 'spreadsheetId'?`

**Fix (in code, never in the baseline).** Added `missingEnvVars: string[]` to the local `SheetsStatus` interface in `app/admin/google-sheets/page.tsx`.

**Baseline untouched.** `scripts/dev-checks/tsc-baseline.json` is **not modified** (it is absent from `git status`). Verified by running the raw compiler, not just the gate:

- `npx tsc --noEmit` → **exactly 46 `error TS…` lines, every one inside `__tests__/`, zero in `page.tsx` / `app/admin`.**
- `node scripts/dev-checks/check-tsc-baseline.mjs` → `total 46 (baseline 46, delta +0) · prod 0 (baseline 0, delta +0) · OK`.

So the debt was **fixed**, not **re-recorded** — the gate's "prod = 0" is now literally true rather than an artifact.

> **Investigation note (anti-hallucination).** An intermediate `worker_logs/tscbase.txt` reading showed a `[tsc-baseline] target:` header plus a `detail:` block listing 4 `page.tsx` errors — including TS1005 `',' expected`, i.e. a *syntax* error. That output does **not** match `check-tsc-baseline.mjs`'s source (which emits only the `TypeScript error baseline:` block and never a `detail:` header or an `isProdFile()` classifier), and the raw `tsc` run shows no `page.tsx` error at all. Conclusion: the stale file was not this script's output; **ground truth is the raw `tsc --noEmit` run + the script's real stdout**, both of which agree (46 / 0 / +0). Read the script source before trusting a captured log whose format you cannot place.

## 2. CI Fix 2 — Playwright route-mock drift (Lesson 161)

**Root cause.** `e2e/admin-google-sheets.spec.ts`'s `statusBody()` helper builds the mocked `GET` status payload from the **pre-Spec-31 contract** and omitted `missingEnvVars`. Because `page.tsx` now reads `status.missingEnvVars.length` unconditionally, `undefined.length` throws **inside render** → the route's ErrorBoundary renders its fallback → **every `gs-…` assertion fails** (tabs, toolbar, queue table).

**Why nobody saw it locally.** The admin specs **self-skip** unless `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (or `ADMIN_*`) are exported in the shell. A local run without them reports *"no tests"* and stays green, while CI exports the creds, runs the real body, and fails. That asymmetry is exactly how mock drift survives a "verified locally" pass.

**Fix.**

- Added `missingEnvVars: []` to `statusBody()` so the mock matches the contract the page now reads.
- Added the Spec 31 regression test `'an unarmed deploy lists the missing env vars by name'`, which asserts `data-testid="env-not-armed"`, the literal **"3 required env var(s) missing"**, and all 3 variable names — pinning the contract from **both** sides (page + mock).

## 3. Missing Spec 30 / Spec 31 plan tests authored

The plans required these; none existed before this session.

**Spec 30 — `lib/__tests__/dailyRecommendationService.test.ts` (+13 → 56/56)**

- `getNextRunAt` — next-run computation, weekend/market-day behaviour.
- `computeFreshnessFields` — `RECS_STALE_AFTER_MS` (default 48 h) derived freshness.
- `computeIsStale` — staleness flagging against the freshness window.
- `hasSuccessfulRunToday` — success-today gate used by the catch-up guard.
- New `count` + `cronJob` module mocks; logger accessed via `jest.requireMock` (no new ESLint warnings).

**Spec 30 — `lib/__tests__/worker-engine.test.ts` (+12 → 55/55)**

Full guard matrix for `ensureDailyRecommendationRan` (`lib/services/worker/worker-engine.ts:856`): degraded mode → skip · not leader → skip · weekend → skip · before window → skip · already ran today → skip · in-flight → skip · check-failed → skip · enqueue-failed → skip · **audit fires only on a real enqueue**. New `leader` / `audit` / `dailyRecommendationService` mocks + `spawnRegularTask`.

**Spec 31 — `lib/__tests__/googleSheetsStatus.test.ts` (+6 → 21/21)**

`missingEnvVars` contract: armed → `[]`; each of the 3 required vars unset → named individually; partial-arming → only the missing names; and the "not armed" surface the page renders.

## 4. Local CI reproduction (Docker + seeded DB)

Authenticated Playwright could not run without a database. Reproduced CI's provisioning:

1. Started Docker Desktop (script `worker_logs/start-docker.ps1` → `DOCKER_READY`).
2. `docker compose up -d db redis` → both `healthy` (existing 5-week volume, db `:5432`, redis `:6379`).
3. `npx prisma migrate deploy` → *38 migrations found … No pending migrations to apply.*
4. `npx tsx prisma/seed.ts` → demo user **id 2**, admin user **id 1** (plus portfolios, deals, 1960 corporate actions).
5. `npx playwright test --project=setup` → **1 passed (19.3 s)** — confirms the dev server (started *before* the DB existed) picks up the DB lazily; Prisma reconnects on first query, so **no dev-server restart was needed**.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **46 errors, all in `__tests__/`, 0 in production** |
| `check-tsc-baseline.mjs` | **total 46 / prod 0, delta +0** — baseline JSON unmodified |
| Jest (`npm run test`) | **137 suites · 2053 passed / 4 skipped / 0 failed** (68.9 s) |
| Spec 28–31 targeted set | **6 suites · 187 tests pass** |
| ESLint (changed files) | 0 errors, no new warnings |
| `npm run quickbuild` | **201/201 static pages, 0 `warn` lines** (CI warning gate) |
| `check-doc-sizes.mjs` | within budget |
| Playwright (all projects, as CI runs it) | **126 passed · 2 flaky (retry-green) · 0 failed** (10.9 m) |

The 2 flaky are known dev-server-load flakes (`navigation.spec.ts` "navigates to Contact", `privacy-terms.spec.ts` contact legal-links) that `playwright.config.ts` `retries: 1` absorbs locally; CI runs `retries: 2` with `workers: 1`, which is more stable, not less.

## Lesson 161

An e2e route mock is a **contract with the page it stands in for**. When a page starts reading a field **unconditionally**, a mock that omits it turns the ErrorBoundary on and the spec goes permanently red — and you cannot see it locally unless the credentials that un-skip the spec are actually exported. See `Lessons.md` Lesson 161 for the full rules.

## Files changed (v3.49.0)

**Fixes (production + e2e):**

- `app/admin/google-sheets/page.tsx` — added `missingEnvVars: string[]` to local `SheetsStatus` (CI Fix 1); the Spec 31 "not armed" card at ~line 529 reads it.

**Tests (new plan deliverables):**

- `lib/__tests__/dailyRecommendationService.test.ts` (+13 Spec 30 helpers → 56/56)
- `lib/__tests__/worker-engine.test.ts` (+12 Spec 30 guard matrix → 55/55)
- `lib/__tests__/googleSheetsStatus.test.ts` (+6 Spec 31 → 21/21)
- `e2e/admin-google-sheets.spec.ts` (`statusBody()` + `missingEnvVars: []`; +1 Spec 31 regression test)

**Docs:**

- `AGENTS.md` (v3.49.0 row + `nextjs-agent-rules` block re-added by `next dev`)
- `.agents/CHANGELOG.md`, `.agents/changelog/versions-v3.49.md` (this file), `.agents/changelog/versions-index.md`
- `Primer.md`, `agent-memory.md`, `Lessons.md` (Lesson 161), `.agents/session-todos.md`, `HANDOFF.md`

**Not changed (deliberately):**

- `scripts/dev-checks/tsc-baseline.json` — the baseline was **fixed against**, never raised.
