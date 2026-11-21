# Implementation Plan 44: Prisma ORM 7.10.1 → 8.0.0-rc.34 Upgrade & Optimization

> Generated from spec: `.agents/specs/44-prisma-8-upgrade.md`  
> Save path: `.agents/plans/44-prisma-8-upgrade.md`

## Spec Reference

- **Spec**: `.agents/specs/44-prisma-8-upgrade.md`
- **Branch (planning artifacts)**: `fix/semver-preload-nft-next-server-exclude` (docs/spec/plan only; implementation should move to a dedicated feature branch per SDD)
- **Created**: 2026-11-21
- **Status**: Planning complete; **implementation blocked pending human approval**

---

## Preconditions / Gates

- [ ] Human review and approval of Spec 44 and Plan 44.
- [ ] Decide target release policy: pin `8.0.0-rc.34` for parity spike or adopt latest stable Prisma 8 at implementation time (re-validate docs/release notes).
- [ ] Choose migration strategy after feasibility spike: **Option A (all-at-once)** or **Option B (route-by-route v7→v8 coexistence)**.
- [ ] Confirm non-production environment(s) for migration workflow rehearsal (DB copy/staging) and backup/snapshot/rollback procedure.
- [ ] Freeze unrelated schema changes during cutover window where possible.

## Implementation Steps

> Ordered phases. Each phase should end in a green, reviewable checkpoint (commit/PR slice) where feasible.

### Phase 0: Feasibility Spike & Baseline (no production behavior changes)

1. **Create implementation branch** from latest `main` (e.g. `feature/prisma-8-upgrade`) → verify: clean branch, up-to-date base.
2. **Capture baseline inventory** (automate where possible): `@/lib/prisma` importers, direct `@prisma/client` importers, `$transaction/$queryRaw/$executeRaw/$extends/cacheStrategy` usage, tests mocking Prisma modules, scripts using Prisma. → verify: checked-in inventory note/script output in PR description or `.agents/docs/prisma-8-upgrade.md` appendix.
3. **Run baseline verification** on current Prisma 7 state: targeted tests for Prisma-heavy modules + `npx tsc --noEmit` + `npm run lint` (scoped) + `npm run quickbuild` as environment permits. → verify: baseline results recorded.
4. **Prisma 8 coexistence spike (Option B feasibility)**: attempt minimal dual-install/config (`prisma7` CLI alias + Prisma 8 packages/config/contract emit) in isolated branch state without broad call-site rewrites. → verify: document feasibility/blockers (command collisions, generated paths, TS resolution, Netlify/build compatibility).
5. **Decide strategy (A/B)** and update plan notes/spec deltas if needed. → verify: decision recorded in session/docs and approved.

### Phase 1: Toolchain & Contract Conversion Scaffold

6. **Update dependencies** (scoped): add/upgrade Prisma 8 packages required for PostgreSQL runtime and tooling; retain Prisma 7 packages only if Option B selected. → verify: `npm ls`/lockfile diff reviewed; install succeeds.
7. **Introduce Prisma 8 contract/config artifacts**: create/convert contract (`.prisma`) from `prisma/schema.prisma`, preserve `prisma7Schema` metadata if dual-run, and add/adjust `prisma.config.ts` for Prisma 8 workflow. → verify: `npx prisma contract emit` (or project-selected command) succeeds in spike environment.
8. **Set generated output and TS integration**: define generated ORM/client output path (e.g. `.generated/orm` per docs convention) and wire imports/tsconfig/build resolution strategy. → verify: TypeScript can resolve generated types in a sample module.
9. **Preserve migration history baseline**: map existing `prisma/migrations` to Prisma 8 migration handoff plan (`db sign`/baseline artifacts) without applying destructive changes. → verify: dry-run commands and handoff checklist documented and reviewed.

### Phase 2: Runtime/Client Parity Layer

10. **Rewrite core Prisma runtime module** (`lib/prisma.ts`): Prisma 8 client construction, direct PostgreSQL connection/driver setup, environment URL selection parity, global singleton lifecycle. → verify: app boots locally; basic read/write smoke passes.
11. **Reimplement cross-cutting behaviors** currently in `$allOperations`: ops counting (`getIstDayKey` integration), write classification/budget guard, plan-limit breaker open/close/fast-fail semantics, per-query timeout, DB error recording/classification, benign P2002 handling, query timing/error logs. → verify: unit/parity tests for `lib/prisma.ts` + `lib/db-utils.ts` behavior matrix.
12. **Restore observability hooks**: Prisma 8-compatible query logging (opt-in) and OTel instrumentation initialization/order in `lib/otel.ts` + runtime bootstrap. → verify: `PRISMA_QUERY_LOG` and `PRISMA_OTEL_ENABLED` behavior validated in dev.
13. **Reconcile caching layer**: replace or adapt `withAccelerateCache`/`cacheStrategy` usage to Prisma 8-supported mechanism (or explicitly remove with approved fallback). → verify: hot-path read sites compile and preserve expected cache semantics/perf characteristics.
14. **Update direct Prisma consumers outside app runtime where appropriate**: scripts/seed/utilities to use shared bootstrap or Prisma 8-native client creation consistently. → verify: representative scripts (`prisma generate`-adjacent checks, seed/dry-run scripts as safe) execute.

### Phase 3: Call-Site & Type Migration (domain-sliced)

15. **Create codemod/migration helpers** for repetitive transforms (`prisma.<model>` → `db.orm.<schema>.<Model>`, import rewrites, type import updates, `$queryRaw/$executeRaw`/transaction patterns). → verify: helper scripts/codemods idempotent on sample directories.
16. **Migrate shared libraries first** (`lib/services/**`, `lib/*.ts` core data-access helpers, SQLite sync/push sinks/outbox code paths) because they fan out broadly. → verify: domain-focused tests/build slices pass.
17. **Migrate API routes and server components/actions** (`app/api/**`, server-only pages/loaders) preserving response contracts. → verify: route-level tests/smoke checks pass.
18. **Migrate scripts/tests** (Jest mocks, factories, fixtures, seed, maintenance scripts) to Prisma 8 APIs/types and new module boundaries. → verify: targeted Jest suites for migrated domains pass.
19. **Remove or isolate legacy compatibility shims** incrementally once domains are migrated (Option B only: retire per-domain `prisma7` usage; Option A: remove v7-only paths after full cutover). → verify: no mixed-runtime usage remains in migrated scope.

### Phase 4: Migration Workflow, Build/CI, and Netlify Integration

20. **Update project scripts and CI**: replace Prisma 7 commands (`prisma generate`, `prisma migrate deploy/status/validate`) with Prisma 8 equivalents (`contract emit`, `db sign`, `migration plan`, `db migrate`, status/check commands as applicable). → verify: local script dry-runs and CI workflow lint/checks pass.
21. **Update Netlify/build pipeline** (`netlify.toml`, postinstall/build hooks, standalone bundling assumptions) for generated artifacts and any new runtime files. → verify: `npm run quickbuild` and preview deploy/build trace succeed.
22. **Rehearse migration handoff on non-production DB copy**: sign/baseline/plan/apply flow, verify no unintended schema drift, document operator runbook. → verify: migration commands produce expected no-op/apply plan and ledger state.
23. **Finalize deployment/runbook docs**: update `ARCHITECTURE.md`, `.agents/docs/prisma-8-upgrade.md`, `AGENTS.md`/ops docs as needed with exact commands, env vars, rollback steps. → verify: docs review complete.

### Phase 5: Optimization & Cleanup

24. **Apply approved optimizations discovered during migration** (e.g. centralize script client bootstrap, simplify wrapper layering, remove dead compatibility code, query-path cleanups with tests). → verify: measurable/no-regression evidence (tests + targeted perf/ops checks).
25. **Retire Prisma 7 artifacts** (Option A finalization or Option B phase-5): remove `@prisma/prisma7` alias/config, `prisma7Schema` metadata-only paths, legacy deps/scripts/docs. → verify: repo-wide search shows no unintended Prisma 7 runtime dependency.
26. **Stabilize and monitor**: run full verification matrix, fix regressions, and prepare release notes/changelog/session memory updates. → verify: all required gates green.

## File Change Summary (expected)

| File / Area | Action | Phase |
|-------------|--------|-------|
| `package.json`, `package-lock.json` | Modify | 1,4,5 |
| `prisma/schema.prisma` / Prisma 8 contract files | Modify/Create | 1,4 |
| `prisma.config.ts` | Modify/Replace | 1,4 |
| `.generated/orm/**` (or chosen output) | Generate (commit policy TBD) | 1+ |
| `lib/prisma.ts` | Rewrite | 2 |
| `lib/otel.ts`, `lib/db-utils.ts` | Modify (as needed) | 2 |
| `app/**`, `lib/**`, `scripts/**`, `prisma/seed.ts` | Modify | 2–3 |
| tests (`lib/__tests__`, `app/**/__tests__`, e2e as needed) | Modify/Add | 0,2,3,6 |
| `netlify.toml`, CI workflows | Modify | 4 |
| `ARCHITECTURE.md`, `.agents/docs/prisma-8-upgrade.md`, runbooks | Modify/Create | 0,4,6 |

## Verification

- **Per phase**: targeted unit/integration tests for touched domains, typecheck/lint, and build checks.
- **Before merge**: `npx tsc --noEmit`, `npm run test` (or agreed scoped/full suite), `npm run lint`, `npm run quickbuild`, Prisma 8 schema/contract/migration validation commands, and preview deploy smoke for critical flows.
- **Before production apply**: migration plan reviewed on DB copy, rollback/runbook approved, explicit human confirmation for deploy/migration execution.

## Rollback

- Phase-level rollback via git revert/reset on migration branch (before merge).
- Dual-run rollback (Option B): switch domains back to Prisma 7 path until retirement.
- Post-deploy rollback: redeploy prior build; treat DB migration rollback separately with approved backup/ledger procedure only.

## Risks / Open Items

- Prisma 8 RC behavior changes before stable; API names/commands must be revalidated at implementation time.
- `$allOperations` parity may require different hook/wrapper architecture in Prisma 8.
- Accelerate `cacheStrategy`/extension semantics may not map 1:1; caching parity must be proven.
- Large mechanical migration across 100+ import sites and many tests risks regressions; codemods must be reviewed and test-backed.
- Migration-history handoff (`db sign`/baseline) is operationally sensitive.
- Netlify bundling of generated ORM artifacts and runtime deps may require config adjustments.
- SQLite mirror/push sink correctness depends on exact model/query behavior and must be regression-tested.