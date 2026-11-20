# Spec 44: Prisma ORM 7.10.1 → 8.0.0-rc.34 Upgrade & Optimization

> Planning/documentation spec (SDD). **No runtime/schema/dependency migration implementation in this session.** Implementation requires human approval of this spec and the companion plan.

## 1. Overview

**What**: Produce a repo-specific upgrade and optimization blueprint to migrate TradeNext from Prisma ORM **7.10.1** (`@prisma/client`, `prisma`, `@prisma/adapter-pg`, `@prisma/extension-accelerate`, `@prisma/instrumentation`) to Prisma **8.0.0-rc.34** (CLI/MCP target used for planning), covering schema/contract conversion, runtime/client rewrite, query-API migration, migration workflow handoff, observability/caching/resilience parity, build/deploy/CI/test impacts, and codebase optimization opportunities.

**Why**: The project currently runs a Prisma 7 architecture with significant custom behavior in `lib/prisma.ts` (pg adapter/direct + Accelerate, `$extends` `$allOperations` for ops counting/write-budget enforcement, plan-limit breaker, per-query timeout, DB error classification/telemetry, OTel/query logging integration, Accelerate `cacheStrategy` boundary helper) and widespread Prisma call sites. Prisma 8 introduces a fundamentally different model (contract/config/runtime/query/migration workflow) and is not a drop-in CLI/config upgrade for this repo. A deliberate spec/plan is required to reduce migration risk, preserve production resilience behavior, and identify optimization opportunities before implementation.

**Scope (IN)**:
- Upgrade planning from Prisma 7.10.1 to Prisma 8.0.0-rc.34 (RC) for this repository.
- Codebase inventory/impact analysis (schema, config, runtime, call sites, scripts, tests, build/deploy, docs).
- Prisma CLI and MCP-assisted planning evidence and findings.
- Target architecture and migration strategy options (all-at-once vs route-by-route), including feasibility assessment for TradeNext.
- Optimization opportunities (ORM/runtime/query/build/ops) and refactor candidates discovered during analysis.
- Documentation/architecture updates for upgrade readiness and planned target state.
- Verification, rollout, rollback, and risk controls for implementation phases.

**Scope (OUT)**:
- Implementing the Prisma 8 dependency/config/schema/runtime/query migration in this session.
- Changing production database state, running destructive migrations, or deploying.
- Switching providers (PostgreSQL remains) unless separately approved.
- Replacing non-ORM subsystems (SQLite mirror design, worker/cron architecture, auth, business logic) except where required for Prisma 8 compatibility.
- Auto-merging/deploying changes (PR creation only when explicitly requested).

**Depends on**: Current Prisma 7 baseline (`prisma/schema.prisma`, `prisma.config.ts`, `lib/prisma.ts`, `lib/db-utils.ts`, `lib/otel.ts`, `prisma/migrations/`), Netlify/build pipeline, existing SQLite mirror/outbox architecture, and human approval of spec/plan before implementation.

## 2. Routes / APIs / Interfaces

> Prisma upgrade is cross-cutting; most impact is library/runtime/build/migration infrastructure rather than public HTTP route contracts.

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | None planned. Route behavior must remain contract-compatible unless a separately approved spec changes it. |

### Modified Interfaces (implementation phase)
| Area | Change |
|------|--------|
| `lib/prisma.ts` | Rewrite to Prisma 8 runtime/client construction and parity wrappers for ops counting, breaker, timeout, error recording/classification, logging/OTel integration, and (if retained) caching strategy equivalents. |
| `prisma/schema.prisma` → Prisma 8 contract (`.prisma` contract file + `prisma7Schema` metadata during migration) | Convert v7 schema/config to Prisma 8 contract format and generated artifact flow. |
| `prisma.config.ts` | Replace v7 `defineConfig`/`env` migration datasource config with Prisma 8-compatible config (or retire per chosen workflow) aligned with `prisma.config.ts`/contract expectations. |
| `@/lib/prisma` consumers | Migrate query-call style/imports to Prisma 8 `db.orm.<schema>.<Model>...` patterns and new result/error types as required. |
| `package.json` scripts / CI / Netlify build | Update generate/migrate/build commands (`contract emit`, `db sign`/`migration plan`/`db migrate`, `prisma7` coexistence if route-by-route). |
| `tsconfig.json` / generated client paths | Adjust module resolution/includes/paths for generated ORM client artifacts if needed. |

## 3. Database Schema / Contract

### A. Current State (Prisma 7)
- **Schema**: `prisma/schema.prisma` (v7 style), PostgreSQL datasource, `generator client { provider = "prisma-client-js" }`, ~1859 lines, **85 models**, 0 enums.
- **Migrations**: `prisma/migrations/` contains historical SQL migrations (40 migration directories observed in scan) plus lock/config artifacts; workflow currently uses `prisma generate` / `prisma migrate deploy` (Netlify/build scripts).
- **Config**: `prisma.config.ts` uses `defineConfig` + `env('DATABASE_URL')` and custom local/remote/DIRECT_URL selection logic for migrate/deploy.
- **Runtime**: `lib/prisma.ts` constructs `PrismaClient` with `accelerateUrl` + `$extends(withAccelerate())` or `@prisma/adapter-pg` + `pg.Pool`, then wraps with `$extends({ query: { $allOperations(...) } })` for breaker/budget/ops/error/timeout behavior.
- **Direct Prisma package usage**: `@prisma/client` imported directly in scripts/seed/utilities and some libs (type/value imports), not only via `@/lib/prisma`.

### B. Target State (Prisma 8, planned)
- Convert to Prisma 8 **contract** and generated ORM workflow (`contract emit` produces `.generated/orm/...` artifacts per docs; exact repo layout to be finalized in implementation).
- Use Prisma 8 PostgreSQL runtime package(s) (docs indicate `@prisma/orm-postgres`) and `db.orm.<schema>.<Model>` query API.
- Preserve PostgreSQL schema/data and model semantics; schema evolution continues via Prisma 8 migration workflow (`db sign`, `migration plan`, `db migrate`) after baseline handoff.
- Keep `prisma7Schema` metadata and coexistence artifacts only as long as needed for incremental migration (if route-by-route chosen).

### C. Migration Strategy Options
| Option | Summary | Pros | Cons / Fit |
|--------|---------|------|-------------|
| **A. All-at-once (recommended baseline candidate)** | Convert entire app/runtime/query surface and migration workflow to Prisma 8 in one coordinated cutover (v6/7→8 guide path adapted to this repo). | Single runtime/toolchain after cutover; avoids dual-client complexity; clearer end state. | Large blast radius; requires broad mechanical + behavioral refactor and strong regression coverage before merge. |
| **B. Route-by-route / incremental (v7→8)** | Run Prisma 7 and Prisma 8 side-by-side, migrate call sites incrementally, then retire Prisma 7 (`migration move`). | Lower per-step risk; easier rollback by area during transition. | Higher complexity in monorepo-ish single app: dual deps/configs/binaries, generated artifacts, mixed query APIs, test/build wiring, and migration ownership split until retirement. May be difficult given centralized `@/lib/prisma` coupling. |

**Planning recommendation**: prefer **Option A in a dedicated migration branch/PR series** with strict phase gates and parity harnesses, unless implementation spike proves low-friction coexistence is feasible. A short feasibility spike (Phase 0/1 of plan) should confirm coexistence constraints before committing to Option B.

## 4. Functions / Business Logic / Runtime Behavior

### A. Current Critical Runtime Behavior (must preserve or intentionally redesign)
| Component | Current behavior | Prisma 8 implication |
|-----------|------------------|---------------------|
| `lib/prisma.ts` singleton | Env-based URL selection (local/remote/accelerate/direct), globalThis singleton, dev hot-reload safety | Recreate with Prisma 8 client/config model; preserve URL selection semantics and singleton lifecycle. |
| Adapter/driver | `@prisma/adapter-pg` + `pg.Pool` for direct PG; `accelerateUrl` for Prisma Accelerate/Postgres proxy | Verify Prisma 8 equivalent driver/connection construction (`@prisma/orm-postgres`, adapter options) and pool/tuning parity. |
| Accelerate caching | `$extends(withAccelerate())` + `withAccelerateCache()` helper injecting `cacheStrategy` at boundary | Determine Prisma 8-native caching mechanism/API; preserve cache TTL/SWR behavior where used or explicitly deprecate with replacements. |
| `$allOperations` extension | Ops counting (IST day), read/write classification, write budget guard, plan-limit breaker fast-fail, per-query timeout race, DB error recording/classification, breaker close-on-success, benign P2002 skip | Reimplement parity using Prisma 8 extensibility/observability hooks or wrapper layer; maintain fail-fast and telemetry semantics. |
| OTel | `otelSetup()` before client construction; `@prisma/instrumentation` | Validate Prisma 8 instrumentation package/API and initialization ordering. |
| Query logging | Opt-in `PRISMA_QUERY_LOG=1` constructor logging in dev/local | Re-map to Prisma 8 logging/observability options. |
| Consumers | `prisma.<model>.<op>`, `$transaction`, `$queryRaw/$executeRaw`, `Prisma` types/helpers from `@prisma/client` | Mechanical and semantic migration to `db.orm...` and new type/error/result APIs; raw SQL and transactions need focused validation. |

### B. Codebase Impact Inventory (planning baseline)
- **Central importers**: widespread `@/lib/prisma` usage across `app/`, `lib/`, `scripts/`, etc. (high coupling; prior scan indicated 100+ sites).
- **Direct `@prisma/client` usage**: scripts/seed/utilities and selected libs (value and type imports, e.g. `PrismaClient`, `Prisma`, model types).
- **High-risk API usage**: `$transaction`, `$queryRaw/$executeRaw`, `$extends`-dependent behavior, `cacheStrategy`/`withAccelerateCache`, `createMany/upsert` patterns, dynamic/raw operations, and tests/mocks coupled to current module shape.
- **Schema breadth**: 85 models covering auth/users, portfolio, market/corporate data, recommendations/swing, workers/cron/tasks, alerts, audit/logging, AI/agent, screener/backtest, Google Sheets, intelligence cache, etc.
- **Build/deploy coupling**: `postinstall`/`build`/`quickbuild` scripts and `netlify.toml` invoke Prisma generate/migrate deploy; CI and local workflows assume Prisma 7 commands/config.

### C. Optimization Opportunities (to evaluate during implementation)
| Opportunity | Rationale | Notes / Guardrails |
|-------------|-----------|--------------------|
| **Unify ORM access through a single runtime module** | Reduce direct `@prisma/client` construction in scripts/tests; centralize config/telemetry/resilience. | Keep script ergonomics; allow explicit exceptions only where necessary. |
| **Refactor resilience/telemetry into composable layers** | Current `$allOperations` mixes counting, budget, breaker, timeout, classification, and side effects. | Preserve exact behavior/contracts first; optimize structure second with tests. |
| **Revisit caching strategy under Prisma 8** | Current cache helper is tied to Accelerate extension semantics and base-type limitations. | Avoid regressions in hot read paths; benchmark/cache-hit validation required. |
| **Migration workflow modernization** | Prisma 8 migration tooling (`sign/plan/migrate`) may improve reviewability/auditability. | Requires careful baseline/handoff from existing `prisma/migrations` history. |
| **Generated artifact hygiene** | Explicit contract emit output can make generated client boundaries clearer. | Must integrate cleanly with Next/Netlify bundling and TypeScript pathing. |
| **Query-pattern cleanup during rewrite** | Mechanical migration is a chance to remove obsolete wrappers, duplicated raw SQL, or inconsistent transaction usage. | Only opportunistic, behavior-preserving refactors; no speculative rewrites without tests. |

## 5. Files to Create / Modify

### New (this planning session)
| File | Purpose |
|------|---------|
| `.agents/specs/44-prisma-8-upgrade.md` | **This spec** — upgrade/optimization contract and analysis. |
| `.agents/plans/44-prisma-8-upgrade.md` | Phased implementation plan with verification gates. |
| `.agents/docs/prisma-8-upgrade.md` | Focused subsystem/planning reference (current state, target, decisions, risks, rollout notes). |
| `.agents/sessions/2026-11-21-prisma8-upgrade/{decisions.md,flow.md}` | Session memory/audit trail (already created). |

### Modified (this planning session)
| File | Change |
|------|--------|
| `ARCHITECTURE.md` | Add Prisma 8 upgrade planning/readiness notes and clarify current-vs-target ORM state. |

### Expected Implementation Targets (future, approved phase)
| File / Area | Change |
|-------------|--------|
| `package.json`, `package-lock.json` | Upgrade Prisma packages/CLI/runtime deps and scripts. |
| `prisma/schema.prisma` / contract files / generated artifacts | Convert to Prisma 8 contract + generated ORM layout. |
| `prisma.config.ts` | Replace/realign for Prisma 8 migration/config model. |
| `lib/prisma.ts`, `lib/otel.ts`, `lib/db-utils.ts` (if needed) | Rebuild runtime client/wrappers and parity behavior. |
| `app/**`, `lib/**`, `scripts/**`, `prisma/seed.ts`, tests | Migrate imports/calls/types/query patterns and mocks. |
| `netlify.toml`, CI/workflows, docs (`AGENTS.md`, `.agents/*`, README/USAGE as needed) | Update commands, runbooks, and architecture/status docs. |

## 6. Edge Cases & Error Handling

- **RC volatility**: `8.0.0-rc.34` may differ from eventual stable; implementation must pin exact tested version and reassess release notes before merge.
- **Behavioral parity gaps**: `$extends` `$allOperations` semantics, error classes/codes, transaction behavior, and raw query result shapes may differ; parity tests required.
- **Accelerate/cache behavior**: `cacheStrategy` support/path may differ or move; avoid silent cache-disable regressions in hot paths.
- **Migration history handoff**: existing `prisma/migrations` must be baselined/signed correctly before Prisma 8 owns future migrations; mishandling risks drift or accidental reapplication attempts.
- **Direct-client scripts**: scripts/seed tasks that bypass `@/lib/prisma` can miss resilience config and may break independently.
- **Netlify/serverless constraints**: generated client bundling, WASM/binary/runtime artifacts, and cold-start behavior must be validated in CI/preview deploys.
- **SQLite mirror coupling**: mirror sync/push sinks depend on model names/fields/query patterns; schema/contract conversion must not desynchronize PostgreSQL and SQLite representations.
- **Plan/budget telemetry**: ops counting and write-budget enforcement are product-critical guardrails; migration must not drop them without an approved replacement.
- **Coexistence hazards (Option B)**: dual Prisma runtimes can cause type confusion, command collisions (`prisma` vs `prisma7`), and inconsistent generated outputs.

## 7. Test Plan

### Planning-phase verification (this session)
- `node scripts/dev-checks/check-doc-sizes.mjs` (doc/context budget safety)
- `git diff --check` / basic formatting sanity for edited docs (as applicable)
- Optional targeted checks only if doc changes affect linted/configured paths (not expected)

### Implementation-phase verification (required later)
| Layer | Scope |
|------|-------|
| **Static/type** | `npx tsc --noEmit` (or project typecheck command), lint on touched files, schema/contract validation via Prisma 8 commands |
| **Unit** | `lib/prisma` parity behavior (breaker/budget/timeout/error classification/ops counting/cache helper), `lib/db-utils`, `lib/otel`, consumers with Prisma mocks/factories |
| **Integration** | DB-backed service/API flows (recommendations, swing, workers/cron, alerts, audit/logging, market/screener, Google Sheets sinks), transaction/raw-query paths, SQLite mirror sync/push behavior |
| **Migration workflow** | `contract emit`, schema diff/plan/sign/migrate dry-runs, baseline validation against staging/dev DB copy, migration status/history integrity |
| **Build/deploy** | `npm run quickbuild`, `npm run build` (as environment allows), Netlify preview/build validation, generated artifact bundling checks |
| **E2E/smoke** | Auth, recommendations, admin DB health/AI monitoring, worker/cron-critical flows, key read/write paths under direct and fallback modes |
| **Perf/ops** | Query latency sampling, ops-counter/write-budget behavior, cold-start/bundle impact, cache effectiveness (if retained) |

## 8. Migration / Rollback

### Migration (planned implementation phases)
1. **Feasibility & parity harness**: capture current behavior/tests around `lib/prisma.ts`, critical services, and migration commands.
2. **Toolchain/config conversion**: introduce Prisma 8 deps/config/contract and generated artifact pipeline (or dual-run scaffold for Option B spike).
3. **Runtime/client rewrite**: replace Prisma 7 client construction and compatibility wrappers; restore OTel/cache/budget/breaker/timeout parity.
4. **Call-site migration**: convert `@/lib/prisma` and direct `@prisma/client` usage to Prisma 8 APIs/types incrementally by domain with tests.
5. **Migration workflow handoff**: baseline/sign/plan/migrate workflow on non-production copy, then codify CI/Netlify/runbook.
6. **Cutover & cleanup**: remove Prisma 7 artifacts/deps (`prisma7` alias, `prisma7Schema`, legacy config) after verification.

### Rollback
- **Before merge**: revert branch/PR; no production impact.
- **During dual-run (if Option B)**: keep Prisma 7 path authoritative until parity gates pass; rollback per-domain call sites.
- **After merge, before deploy**: block deploy; revert merge commit/PR.
- **After deploy (code-only issues)**: redeploy previous known-good build; do not run forward/backward DB migrations blindly.
- **After migration workflow handoff**: rollback requires a pre-approved DB/runbook plan (snapshots/backups, migration ledger state). No destructive rollback without explicit approval.

## 9. Security Considerations

- **Secrets/config**: DB URLs (`DATABASE_URL`, `DATABASE_REMOTE`, `ACCELERATE_URL`/direct URLs) and migration credentials must remain server-only; never expose in client bundles/docs examples.
- **Migration safety**: Prisma migration commands (`db migrate`, baseline/sign operations) require controlled environments and explicit approval; avoid accidental production execution during development.
- **Generated artifacts**: ensure generated ORM client/output paths are not publicly served and do not leak credentials/metadata.
- **Dependency trust**: pin and review Prisma 8 RC packages and transitive changes; monitor for security advisories before production adoption.
- **Observability data**: OTel/export endpoints and query logging must remain opt-in/sanitized to avoid leaking sensitive SQL/parameters.

## 10. Performance Considerations

- **Expected impact**: migration work is high-churn and may temporarily affect bundle size/cold start due to new runtime/generated artifacts; must be measured.
- **Parity targets**: preserve existing protections (per-query timeout, write budget, plan-limit breaker, ops telemetry) and hot-path caching behavior (or replace with equivalent).
- **Opportunities**: consolidate client wrappers, reduce duplicated query patterns during migration, and improve migration/build reproducibility.
- **Risks**: naive query rewrites or loss of caching can increase DB ops/latency; validate with targeted benchmarks/smoke on representative admin/recommendation/swing flows.

## 11. Future Enhancements

- Evaluate stable Prisma 8 release adoption and remove RC pin once validated.
- Introduce a typed internal data-access layer/facade over `@/lib/prisma` to isolate future ORM upgrades.
- Add automated parity checks for ops/budget/breaker/error-classification behavior in CI.
- Rationalize direct script Prisma usage into shared bootstrap helpers.
- Consider query observability dashboards tied to existing ops/DB-error telemetry after migration stabilizes.
