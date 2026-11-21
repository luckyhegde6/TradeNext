# Prisma 8 Upgrade Planning (Spec 44)

> Status: **Planning/documentation only** (2026-11-21). No runtime/schema/dependency migration implemented.  
> Target: Prisma ORM **7.10.1 → 8.0.0-rc.34** (RC used for CLI/MCP planning; final implementation version to be re-confirmed).  
> Spec/Plan: `.agents/specs/44-prisma-8-upgrade.md`, `.agents/plans/44-prisma-8-upgrade.md`

## 1. Why this upgrade is non-trivial

Prisma 8 is not a drop-in version bump for TradeNext. The repo currently depends on Prisma 7-specific schema/config/runtime/query patterns and a heavily customized central client (`lib/prisma.ts`) that provides cross-cutting resilience and observability behavior. Prisma 8 changes the contract/config model, generated client workflow, runtime packages, query API shape, and migration workflow.

## 2. Current state (baseline)

| Area | Current implementation |
|------|------------------------|
| Packages | `@prisma/client`/`prisma` `^7.10.1`, `@prisma/adapter-pg` `^7.10.1`, `@prisma/extension-accelerate` `^3.0.1`, `@prisma/instrumentation` `^7.10.1` |
| Schema | `prisma/schema.prisma` (v7): PostgreSQL datasource, `prisma-client-js` generator, ~1859 lines, **85 models**, 0 enums |
| Config | `prisma.config.ts` uses `defineConfig`/`env` with local/remote/DIRECT_URL migration URL selection |
| Migrations | `prisma/migrations/*` SQL history + `migration_lock.toml`; build/scripts use `prisma generate` and `prisma migrate deploy` |
| Runtime | `lib/prisma.ts`: env-selected Accelerate or pg-adapter+Pool client, `withAccelerate()` extension, `$extends({ query: { $allOperations } })` for ops counting/write budget, plan-limit breaker, per-query timeout, DB error recording/classification, benign P2002 handling, breaker recovery; `withAccelerateCache()` boundary helper |
| OTel/logging | `lib/otel.ts` opt-in Prisma instrumentation; opt-in dev query logging via constructor log config |
| Usage | Widespread `@/lib/prisma` imports across app/lib/scripts; direct `@prisma/client` imports in scripts/seed/libs (types + `PrismaClient`/`Prisma`) |
| Build/deploy | `package.json` postinstall/build hooks and `netlify.toml` run Prisma generate/migrate deploy in build flow |

## 3. CLI and MCP planning evidence

### Prisma CLI
- `npx prisma --version` → **`8.0.0-rc.34`** (environment CLI)
- `npx prisma validate` → `CLI.V7_COMMAND` (`prisma validate` not available in Prisma 8 for this v7 project shape; docs indicate contract/schema validation moves to `contract emit` workflow)
- `npx prisma migrate status` → `CLI.V7_COMMAND` (suggests Prisma 8 migration status/check commands and/or `prisma7` alias while v7 workflow still owns migrations)

**Interpretation**: the local CLI is already Prisma 8, but the repository config/schema/workflow remain Prisma 7. A coordinated conversion (not command substitution) is required.

### Prisma MCP (read-only)
- `tools["Prisma-Remote"].list_prisma_projects` succeeded and returned accessible projects (`TradeNext`, `ecomzen`) — confirms MCP connectivity for planning context.
- No remote mutations or deploy actions were performed.

### External Prisma 8 references consulted
- Upgrade hub: https://www.prisma.io/docs/guides/upgrade-prisma-orm
- PostgreSQL all-at-once (v6/7→8): https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql
- PostgreSQL route-by-route (v7→8): https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql-incremental
- Coming from Prisma ORM 7: https://www.prisma.io/docs/orm/coming-from-prisma-orm-7

## 4. Key Prisma 8 changes relevant to TradeNext

| Prisma 7 concept | Prisma 8 direction (per docs) | TradeNext impact |
|------------------|-------------------------------|------------------|
| `schema.prisma` as primary schema | **Contract** (`.prisma`) with migration metadata; `prisma7Schema` during coexistence | Must convert schema/config and migration ownership carefully |
| `prisma generate` | **`contract emit`** (generates ORM artifacts, e.g. `.generated/orm`) | Build/CI/Netlify scripts, tsconfig paths, bundling, imports |
| `prisma migrate ...` (v7 flow) | **`db sign` / `migration plan` / `db migrate`** (+ coexistence/retirement steps) | Migration runbook and history handoff are high-risk |
| `new PrismaClient()` + `@prisma/client` | Runtime via Prisma 8 packages (e.g. `@prisma/orm-postgres`) and generated ORM usage | `lib/prisma.ts`, scripts, tests, mocks, type imports |
| `prisma.user.findMany()` style | **`db.orm.<schema>.<Model>.findMany()`** query chains | Broad mechanical refactor across 100+ call sites |
| Adapter/Accelerate extensions | New runtime/config/extension APIs (must be validated) | Cache strategy, connection/pooling, resilience wrappers |
| `validate` command | No separate validate command in Prisma 8 (emit reports invalid schema) | Developer workflow/docs and CI checks |

## 5. Hotspots and parity requirements

### `lib/prisma.ts` (critical)
Must preserve or consciously redesign with tests:
- URL selection (local vs remote vs Accelerate/direct) and singleton/globalThis behavior
- Ops counter (IST day) and write-budget guard (`DB_WRITE_BUDGET`)
- Plan-limit breaker fast-fail/half-open recovery (`isPlanLimitBreakerOpen`, `openPlanLimitBreaker`, `closePlanLimitBreaker`)
- Per-query timeout (`PRISMA_QUERY_TIMEOUT_MS`, `PrismaQueryTimeoutError`)
- DB error recording/classification (`recordDbError`, `classifyDbError`, benign P2002 suppression)
- Query/ops observability behavior and OTel initialization ordering
- Caching semantics currently provided via `withAccelerateCache`/`cacheStrategy`

### Data/migration surfaces
- 85-model schema breadth increases refactor/test surface.
- Existing SQL migration history must be baselined/signed correctly before Prisma 8 owns future migrations.
- SQLite mirror/outbox and push sinks depend on Prisma model behavior and must be regression-tested.

### Direct `@prisma/client` consumers
Scripts/seed/utilities and some libs import `PrismaClient`, `Prisma`, or model types directly; these need migration/alignment to avoid split-brain runtime behavior.

## 6. Recommended implementation strategy

- **Primary recommendation**: all-at-once migration in a dedicated branch/PR sequence after a feasibility spike, because `@/lib/prisma` centralization and cross-cutting behavior make partial runtime splits complex.
- **Alternative**: route-by-route coexistence only if spike proves clean dual-toolchain operation (packages, binaries, generated outputs, TS/build, tests, Netlify).
- **Execution discipline**: parity harness first (`lib/prisma.ts`, critical services, migration dry-runs), then domain-sliced call-site migration with tests, then migration workflow handoff rehearsal on non-production DB copy.

## 7. Optimization opportunities (candidate backlog)

- Consolidate script/seed Prisma bootstrapping through shared helpers (reduce direct client construction drift).
- Refactor resilience/telemetry wrapper into testable units while preserving behavior.
- Reassess cache strategy implementation for Prisma 8-native support and measurable hot-path impact.
- Use migration workflow handoff to improve runbook clarity and CI validation (plan/sign/migrate checks).
- Opportunistic cleanup during mechanical rewrite only where behavior-preserving and covered by tests.

## 8. Risks and open questions

- **RC risk**: 8.0.0-rc.34 may change before stable; pin/revalidate at implementation time.
- **API parity**: extension hooks, error types/codes, transaction/raw query semantics, and caching APIs may differ.
- **Operational risk**: incorrect migration baseline/sign can cause drift or unsafe apply behavior.
- **Performance risk**: bundle/cold-start and DB-op regressions if caching/wrappers are mishandled.
- **Testing risk**: many Jest mocks/factories assume current module exports/shapes.

## 9. Rollout / rollback (planning summary)

- Rehearse on DB copy/staging with backups/snapshots and explicit migration runbook.
- Keep rollback path simple before cutover (revert branch/PR, redeploy previous build).
- After migration workflow handoff, any rollback involving DB ledger/state requires pre-approved operator steps; no destructive actions without explicit approval.

## 10. Deliverables produced in this planning session

- `.agents/specs/44-prisma-8-upgrade.md`
- `.agents/plans/44-prisma-8-upgrade.md`
- `.agents/docs/prisma-8-upgrade.md` (this document)
- `ARCHITECTURE.md` Prisma planning/readiness update
- Session records: `.agents/sessions/2026-11-21-prisma8-upgrade/decisions.md`, `.agents/sessions/2026-11-21-prisma8-upgrade/flow.md`