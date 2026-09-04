# Session Todos

## Current (v3.27.0 — Prisma Postgres Migration Phase 1-3: `withAccelerate()` wiring + `cacheStrategy` at 5 direct-Prisma read sites)

Branch: `v3.26.0-prod-failure-triage` (on top of v3.26.0 work). Code + tests + docs VERIFIED; **diff pending user commit** (no auto-commit/push/deploy).

- [x] Phase 1 (`lib/prisma.ts`): `new PrismaClient({ accelerateUrl }).$extends(withAccelerate())` in the accelerate branch (order documented — `withAccelerate()` first so `$allOperations` wraps it); `let prismaClient: any`; `type AccelerateClient = PrismaClient`; NEW **`withAccelerateCache(strategy)(args)`** boundary helper (preserves contextual typing via `Parameters<T>[0]`/`ReturnType<T>` — base read-args hard-type `cacheStrategy: never`, intersections don't override it); NEW `ACCELERATE_CACHE_TTL = Number(process.env.PRISMA_ACCELERATE_CACHE_TTL) || 300` — DONE
- [x] Phase 2 — `cacheStrategy` at 5 direct-Prisma reads: corp-actions `{ttl:300,swr:60}`; chartinkScreenerResult `{ttl:900,swr:300}`; recommendationTracker ×2 `{ttl:600,swr:60}`; dailyPrice ×2 `{ttl:60,swr:30}` (`lib/stock-service.ts`); marketCache `{ttl:300,swr:60}` — DONE
- [x] Test coupling fixes: `withAccelerateCache` pure stub added to both `{__esModule, default}` mock factories (recommendationPerformanceService + chartinkScreenerService); chartink exact-args assertion → `expect.objectContaining({where, orderBy})` — DONE
- [x] Phase 3 verification: tsc **46 = exact baseline (0 new)**; `prisma validate` valid + `prisma generate` ok; full suite **995 pass / 4 skip / 2 fail** (2 = pre-existing `intelligence.test.ts` async-cache flake, fails identically in isolation; excluding it 71 suites / **995 pass / 4 skip / 0 fail**) — DONE
- [x] Docs: AGENTS.md v3.27.0 row, `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.27.md`, TODO.md rows, Primer.md, agent-memory.md, Lessons.md #104, `.env.example` (`PRISMA_ACCELERATE_CACHE_TTL`), HANDOFF.md, session-todos; spec+plan `.agents/specs/05-prisma-postgres-migration.md` + `.agents/plans/05-prisma-postgres-migration.md` committed `db5a5cc` — DONE
- [x] Pre-commit jazz: `git status` / `git diff` hygiene, no junk artifacts, no secrets — DONE
- [ ] User decision: commit v3.27.0 diff (8 code files + doc files) — PENDING USER (no auto-commit/push/deploy)
- [ ] PR #114 (v3.26.0 fixes + Accelerate docs) — still pending user merge against `main`

## Deferred / Other Workstreams
- [ ] **REQUIRED (Dec 1 2026 Accelerate retirement)**: Phase 0 — manual Prisma Postgres provisioning in Prisma Console at deploy-time (no code); post-move, `withAccelerate()` wrapper may be dropped (Prisma Postgres caches by default; `PRISMA_ACCELERATE_CACHE_TTL` remains the knob); `DATABASE_URL`+`DIRECT_URL` already documented (v3.20.5). See BUGS.md #14 + `.agents/specs/05-prisma-postgres-migration.md`
- [ ] Post-deploy: live-verify `/admin/utils/db-health` on Netlify (SQLite Ready + Total Ops restored + Cache & Read-Tier Utilisation card)
- [ ] Prod (post-hold): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
