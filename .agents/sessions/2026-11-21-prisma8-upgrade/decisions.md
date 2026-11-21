# Session Decisions — Prisma 8 Upgrade Planning (2026-11-21)

## Context
- **Request**: scan the codebase and create a whole spec and plan for upgrading Prisma ORM `7.10.1 -> 8.0.0-rc.34` and optimization; use Prisma CLI and MCP for upgrade planning; update architecture and docs. After completion, create a PR for the bugfix and the documentation/spec/plan changes.
- **Branch**: `fix/semver-preload-nft-next-server-exclude` (contains Netlify NFT/semver preload bundling fixes + lockfile/override cleanup commits pushed earlier). Upgrade planning/docs added on this branch so one PR can include bugfix + planning deliverables as requested.
- **SDD**: This session produces **spec + plan + documentation artifacts only** (no Prisma runtime upgrade implementation). Implementation requires human approval of spec/plan and a separate execution phase (and likely a dedicated branch/session per repo rules).

## Decisions & Reasoning
1. **Spec/Plan numbering**: created `44-prisma-8-upgrade.md` in `.agents/specs/` and `.agents/plans/` (next available after 43; avoids collision with in-progress Spec 43).
2. **Scope boundary**: "upgrade and optimisation" interpreted as (a) comprehensive upgrade spec/plan covering architecture, migration workflow, query/runtime rewrite strategy, risk controls, optimization opportunities, and verification gates; (b) architecture/doc updates reflecting current state + planned target/migration path; (c) no dependency bumps or query rewrites in this session.
3. **CLI/MCP evidence used**:
   - `npx prisma --version` → `8.0.0-rc.34` (CLI available in environment).
   - `npx prisma validate` / `npx prisma migrate status` → `CLI.V7_COMMAND` failures against current v7-style `schema.prisma`/`prisma.config.ts` (confirms config/schema incompatibility with Prisma 8 CLI).
   - `npm ls` / package inspection → app deps/devDeps still on Prisma 7.x (`@prisma/client`, `prisma`, `@prisma/adapter-pg`, `@prisma/extension-accelerate`, `@prisma/instrumentation`).
   - Prisma Remote MCP (`Prisma-Remote.list_prisma_projects`) queried successfully (read-only) to demonstrate MCP-assisted planning context; no remote resources modified.
4. **Architecture/docs updates**: update `ARCHITECTURE.md` (ORM/tooling section, upgrade-readiness notes) and add `.agents/docs/prisma-8-upgrade.md` as a focused subsystem/planning reference; keep changes documentation-only.
5. **PR intent**: prepare commit(s) for spec/plan/docs/session artifacts on this branch and create PR to `main` when requested ("once evrything is done..."), subject to user confirmation before remote PR creation if needed by operating rules.

## Risks / Open Questions (for human review)
- Prisma 8 RC (`8.0.0-rc.34`) is pre-GA; API/behavior may change before stable. Pin/compatibility strategy must be decided at implementation time.
- Prisma 8 changes client/runtime/query/migration model fundamentally (`contract`/`prisma7Schema`, `@prisma/orm-postgres` runtime, `db.orm.<schema>.<Model>` query chains, `contract emit`/`db sign`/`migration plan`/`db migrate` workflow). Full rewrite cost is high (~100+ files import `@/lib/prisma`, many direct Prisma calls, scripts/tests).
- `lib/prisma.ts` contains critical cross-cutting behavior ($allOperations extension: ops counting, write budget, plan-limit breaker, per-query timeout, DB error recording/classification, OTel/query logging integration, Accelerate cache helper). Parity in Prisma 8 requires careful redesign (middleware/extension equivalents may differ).
- SQLite mirror/push sinks and outbox logic depend on current Prisma models/methods and raw SQL patterns; migration plan must include compatibility validation.
- Route-by-route upgrade feasibility depends on whether Prisma 7 and Prisma 8 toolchains/runtimes can coexist safely in this repo (separate packages/configs/binaries/generated artifacts) without breaking build/test/Netlify.
- Production migration ownership handoff (`db sign`, baseline, retirement of `prisma/migrations`) is high-risk and must be rehearsed against staging/copies.

## References
- Prisma 8 upgrade hub: https://www.prisma.io/docs/guides/upgrade-prisma-orm
- All-at-once (Postgres, v6/7->8): https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql
- Route-by-route (Postgres, v7->8): https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql-incremental
- Coming from Prisma ORM 7: https://www.prisma.io/docs/orm/coming-from-prisma-orm-7
- Repo artifacts: `prisma/schema.prisma`, `prisma.config.ts`, `lib/prisma.ts`, `package.json`, `ARCHITECTURE.md`, `netlify.toml`
