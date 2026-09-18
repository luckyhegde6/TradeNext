---
handoff: v3.40.3-predeploy-mirror-preserve
handoff_version: "1.1"
session_id: 2026-09-19-predeploy-guard
date: 2026-09-19
branch: feature/predeploy-mirror-preserve (from main @ 27c0770)
last_commits: 27c0770 (changelog), 38ee7da (PR #129 merge), 46b360e (v3.40.2 fix), e183a3a (changelog), 15fa0a3 (PR #128 merge)
dev: local :3000 up (PID 19896); do not kill MCP/OpenCode 4096 or pg docker 5432
status: in-progress (CODE + TESTS + VERIFIED; docs phase 8 done; commit/push/PR/deploy PENDING USER)
tier: B
---

# Handoff — v3.40.3 Predeploy mirror-preservation guard (Spec 14)

> Superseded: the v3.40.2 mirror-contract-fixes handoff (MERGED via PR #129 `38ee7da`, `main` @ `27c0770`).
> Prior handoffs are recoverable from git history of this file.

## Context

- **Task**: guarantee a production deploy during the **P6003 plan-limit hold (until 2026-10-02)** never
  cold-starts with an EMPTY SQLite mirror — the same served-empty class as v3.40.1 (Spec 14). A Netlify
  **build-time guard** calls the LIVE production app BEFORE the new build serves traffic:
  `node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild`.
- **Outcome**: CODE + TESTS + VERIFIED DONE. Guard route modes `"pushed" | "backed_up" | "skipped"`
  (P6003 hold → breaker OPEN → deliberately `backed_up`). `DEPLOY_GUARD_TOKEN` upserted via Netlify MCP.
  **Commit/push/PR/deploy PENDING USER** (never auto-commit).
- **Files Changed**: NEW `lib/services/mirrorBackup.ts`, NEW `app/api/admin/predeploy/preserve/route.ts`,
  NEW `scripts/predeploy/preserve-mirror.mjs`, `lib/sqlite.ts` (Phase 1), `netlify.toml`, `package.json`,
  `.env.example`, `app/api/openapi/route.ts`; tests — NEW `mirrorBackup.test.ts` (14) +
  `predeployPreserveRoute.test.ts` (11); docs — `Lessons.md` (132/133), `.agents/changelog/versions-v3.40.md`
  (§v3.40.3 + §v3.40.1/§v3.40.2 MERGED fixes), `.agents/changelog/versions-index.md` (v3.40.3 row),
  `.agents/CHANGELOG.md` (addenda), `Primer.md`, `agent-memory.md`, `TODO.md`, `.agents/session-todos.md`,
  this file + session files. **No migration, no new packages.**
- **Spec/Plan**: `.agents/specs/14-predeploy-mirror-preserve.md` + `.agents/plans/14-predeploy-mirror-preserve.md`.

## Progress

- [x] Recon — no build-time preservation existed; cold-start-empty risk confirmed; Spec 14 approved
- [x] Spec + plan written (`14-predeploy-mirror-preserve`) + scope approved by user
- [x] Branch `feature/predeploy-mirror-preserve` created from `main` `27c0770`
- [x] Phase 1 `lib/sqlite.ts` — `SyncTrigger "deploy"`; `MirrorBlobsStoreLike` exported/widened (`list?`/`delete?`); `getMirrorBlobsStore()` exported
- [x] NEW `lib/services/mirrorBackup.ts` — `backups/sqlite-mirror-<ISO>.sqlite`, keep 5, 200 MiB cap, fail-open `key|null`, error-tolerant list/prune
- [x] NEW `app/api/admin/predeploy/preserve/route.ts` — ordering contract + modes + 500 `push_failed` + GET diagnostics; `runtime="nodejs"` + `dynamic="force-dynamic"`
- [x] Auth — `x-deploy-guard-token` vs `DEPLOY_GUARD_TOKEN` (64-hex, `timingSafeEqual` + length check, 503 when unset) + admin-session fallback; token never logged
- [x] NEW `scripts/predeploy/preserve-mirror.mjs` — production gating, soft-fail exit 0, 20 s timeout, URL chain, one summary line
- [x] Wiring — `netlify.toml` build chain, `package.json` `predeploy:preserve`, `.env.example`, OpenAPI block
- [x] Env — `DEPLOY_GUARD_TOKEN` upserted via Netlify MCP (production, scopes builds+runtime, site `78401e5d-b137-4b6d-94bb-ad1ec8de6b05`; temp file deleted)
- [x] Tests — 2 NEW suites / **25/25**
- [x] Verification — **99/99 suites, 1334 pass / 4 skip / 0 fail**; tsc **46/46 prod 0**; doc budget **74.9/100 KB**; lint **0 errors**; quickbuild **185/185**
- [x] Docs — Lessons 132/133 + changelogs (v3.40.3 + PR #128/#129 MERGED fixes) + Primer + memory + TODO + session-todos + this handoff + session archive
- [ ] **Commit/push/PR/deploy — PENDING USER APPROVAL**; after deploy: verify `/api/admin/predeploy/preserve` GET diagnostics live + one manual `--force` script run

## Decisions

- **Build-time guard calls the LIVE app** — the deploy itself is the trigger; the script self-gates
  production (`CONTEXT === "production"` OR `--force`), so local/dev builds skip with warn + exit 0.
- **Soft-fail is a hard requirement** — any preservation error → warn + **exit 0**: a deploy must never
  be blocked by preservation; `npm run quickbuild` remains the real build gate.
- **Ordering contract** — `getOutboxPending()` → snapshot (persist + export + upload Blobs) →
  versioned backup → **breaker-closed only** `pushSqliteToPrisma({reason:"deploy", leaderGate:false})`
  → audit `ADMIN_DB_SYNC`. On the P6003 hold the breaker is OPEN → `backed_up` by design.
- **Dedicated deploy token, never logged** — `x-deploy-guard-token` vs `DEPLOY_GUARD_TOKEN` (64-hex,
  length-checked `crypto.timingSafeEqual`; 503 `guard_token_not_configured` when env unset + presented)
  + admin-session fallback via `authorize(req)`.
- **Versioned backups + retention** — `MIRROR_BACKUP_KEEP = 5`, `MIRROR_BACKUP_MAX_BYTES = 200 MiB`;
  Blobs `list`/`delete` are optional-capability → prune error-tolerantly.
- **Legacy finding — record only** — `.github/workflows/deploy.yml` publishes `./out` via
  `nwtgck/actions-netlify@v3.0`; NOT the real netlify.toml → quickbuild → `.next` path. DO NOT modify.
- **Corrected stale doc state** — v3.40.1/v3.40.2 rows that still said "PENDING USER / PR #129 open"
  were amended to MERGED (PRs #128 `15fa0a3` / #129 `38ee7da`).

## Blockers

| Blocker | Impact | Status |
|---------|--------|--------|
| Prisma P6003 plan-limit hold (until 2026-10-02) | Prisma-only APIs stay hold-degraded; guard degrades to `backed_up` | **Environmental** — by design |
| No commit/push without permission | — | Standing rule |

## Learnings

1. **ISO-date builders need a 2-digit day** — `new Date("2026-09-1T…")` is `Invalid Date` →
   `.toISOString()` throws → a fail-open guard silently returns `key: null` and the failure surfaces
   in the WRONG test layer; use `String(part).padStart(2, "0")` + unit-test the key format directly. (Lesson 132)
2. **A deploy-time call back into the live app must be orderly, gated and always green** —
   explicit mutation order, breaker-gated push (hold → `backed_up`), soft-fail exit 0, dedicated
   64-hex token via `timingSafeEqual`, versioned backups + retention, one summary line, token never logged. (Lesson 133)

## Next Steps

1. **Await user approval**, then commit on `feature/predeploy-mirror-preserve` (code + tests + docs),
   push, open PR against `main`.
2. After merge + deploy: hit production `GET /api/admin/predeploy/preserve` to confirm
   `{breakerOpen: true, sqliteReady, pending, backups, keep}` and run `preserve-mirror.mjs --force`
   once manually to observe `mode=backed_up` + a `backups/sqlite-mirror-…` Blobs key.
3. Optional follow-ups (out of scope): BUGS.md row-17 remainder (`/api/admin/monitoring`,
   `/api/admin/workers`, `/api/admin/cron`, `/api/screener/saved`); `/api/admin/users` stays
   impossible until the mirror has a user table.

## Subagent Status

| Dispatch | Agent | Tier | Budget | Outcome | Notes |
|----------|-------|------|--------|---------|-------|
| none | — | B | — | n/a | subagents remain provider-blocked on this tier (v3.40.0 D3/D11) |

## Handoff Summary
- **Tier used**: B — no dispatch attempted (known provider block)
- **State**: code + tests + docs complete on `feature/predeploy-mirror-preserve`; **uncommitted**
- **Verified**: jest 99/99 suites / 1334 pass / 4 skip / 0 fail · tsc 46/46 (prod 0) · doc budget
  74.9/100 KB · lint 0 errors · quickbuild 185/185 · `DEPLOY_GUARD_TOKEN` present in Netlify env
- **Blocked**: nothing code-side; Prisma hold is environmental until 2026-10-02 (guard handles it)
- **Next**: commit/push/PR on explicit request; then post-deploy live verification of the guard

## Verification

| Check | Result |
|-------|--------|
| `npm run test` | **99/99 suites, 1334 pass / 4 skip / 0 fail** (97/1309 v3.40.2 baseline + 2 suites/25 tests) |
| `check-tsc-baseline.mjs` | **46/46, prod 0 → OK (exit 0)** |
| `check-doc-sizes.mjs --json` | **ok — 74.9 / 100 KB** |
| `npm run lint` | **0 errors** (1,139 pre-existing warnings) |
| `npm run quickbuild` | **185/185 COMPILED OK** |
| Netlify env | `DEPLOY_GUARD_TOKEN` set (production, builds+runtime) — never echoed |
| `git status` | code + tests + spec/plan + docs — **uncommitted** |

## Checkpoints

```bash
git log --oneline -6
# 27c0770 docs: update changelog [skip ci]
# 38ee7da Merge pull request #129 from luckyhegde6/fix/mirror-contract-fixes
# 46b360e fix(admin): mirror-contract fixes for BUGS 15/16/17 (v3.40.2)
# e183a3a docs: update changelog [skip ci]
# 15fa0a3 Merge pull request #128 from luckyhegde6/fix/production-analytics-rec-serve
# 32c18a1 docs: v3.40.1 changelog, lessons 128, primer, handoff, session todos [skip ci]
```

## Session archive

Prior sessions: `.agents/sessions/` · Chunked history: `.agents/session-archive/` ·
Version history: `.agents/changelog/versions-index.md`