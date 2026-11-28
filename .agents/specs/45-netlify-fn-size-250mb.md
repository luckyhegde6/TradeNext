# Spec Document — Netlify 250 MB Serverless-Function Size Regression

> Fill in ALL sections. Delete N/A sections only with justification.
> Save to `.agents/specs/45-netlify-fn-size-250mb.md`. Parent investigation: `.agents/sessions/2026-11-28-2f8e66cb/` + Lessons **87/88/89**.

## 1. Overview

**What**: Fix a Netlify production-deploy regression where serverless functions `worker-runner-background` and `__csp-violations` exceed Netlify's **250 MB per-function upload limit**, failing `Deploy site` with HTTP 400 `uploadDeployFunction`, even though the Next.js build, `prune-standalone.mjs`, and Functions bundling all succeed. Reduce what `@netlify/plugin-nextjs` ships per function and restore a **hard size gate**.

**Why**: Production `main@50d9522` (PR #167, `fix/netlify-250mb`) **fails to deploy**; last good prod `main@a5daee9` (PR #154, `@netlify/plugin-nextjs@5.15.8`) had `__csp-violations`=41.8 MB / `___netlify-server-handler`=33.9 MB / 2 functions / no `worker-runner-background`. The repo's PR#167 mitigations reduce but do not cap size and several exclusions target wrong paths. **Build-time-only Prisma CLI/engines + un-excluded non-runtime bulk + `external_node_modules` applied to `*` + `@netlify/plugin-nextjs` 5.15.8→5.16.9 + prod `origin:ui` + `worker-runner-background` + Prisma 7.10.1 `query_compiler*` + TypeScript 7 native binaries** push both fns over 250 MB. (Prod evidence + my measured local artifacts + repo Lessons; prod-internal zip not inspectable from sandbox.)

**Scope**:
- IN: `netlify.toml` `[functions]`, `[[plugins]]`, build `command`; `next.config.ts` `outputFileTracingExcludes` + `serverExternalPackages`; `scripts/predeploy/prune-standalone.mjs`; `scripts/dev-checks/check-function-size.mjs`; `.github/workflows/netlify-function-size.yml`; `@netlify/plugin-nextjs` pin + prod UI-plugin reconciliation; `.gitignore` hygiene; per-function scoping; `@prisma/*` runtime-vs-build separation; Prisma-7 `query_compiler*` names. No app/runtime code changes.
- OUT: no Prisma schema/migration, no DB change, no app feature, no UI, no `worker-runner-background`/`worker-dispatch` **code** change, no commit/push/deploy/merge, no Netlify env change applied (only recommendation), no removing CSP, no disabling `predeploy:preserve`, no `@prisma/extension-accelerate`/`@prisma/adapter-pg` runtime removal unless verified, no removing runtime `@prisma/client`/`pg`, no Next version change, no `PRISMA_CLIENT_ENGINE_TYPE=library` (Prisma-6; no effect on Prisma 7 + `@prisma/adapter-pg` + Accelerate).

**Depends on**: PR #167 baseline; Spec 42 `worker-runner-background`; Prisma 7.10.1 + `@prisma/adapter-pg` + `@prisma/extension-accelerate` + Accelerate (`ACCELERATE_URL`, `accelerate.prisma-data.net`); `@netlify/plugin-nextjs@5.16.9` installed + `origin:ui`; `npm ci` reproducible; `@netlify/build` + `@netlify/plugin-nextjs` packaging. `WORKER_DISPATCH_SECRET` not part of size (separate Spec 42 prod requirement). `instrumentation.ts` no-ops in `phase-production-build`.

---

## 2. Routes

N/A — **no app/API routes** change. Build/system serverless functions only; their **code/contracts unchanged**:
`___netlify-server-handler`, `worker-runner-background`, `worker-dispatch`, `__csp-violations`. No `app/api/**`. `netlify.toml` `[functions]` `*`, `node_bundler`, `external_node_modules`, `[[plugins]]`, `[build]`, `publish`, `SECRETS_SCAN_OMIT_PATHS` are config, not routes. (Netlify rule `netlify-coding-rules` reviewed: no CORS added; `.netlify` ignored; secrets in env; no function code authored.)

---

## 3. Database Schema

N/A — no Prisma model change, no migration, no `prisma migrate`, no `db push`. (`npx prisma generate` still runs at build; `prisma migrate deploy` unaffected; `PRISMA_CLIENT_ENGINE_TYPE` explicitly NOT changed.)

---

## 4. Functions to Implement

No new application function. Only **build-pipeline changes**; signatures unchanged.

### A. `scripts/predeploy/prune-standalone.mjs` (Modify; stays a no-fail post-quickbuild pre-`onPostBuild`/`onBuild` step)

Current behavior (verified): removes `.next/cache`, `.next/cache/turbopack`, `.next/standalone/{logs,worker_logs,.next/cache,.next/cache/turbopack}`, all `*.js.map` under `.next`; patches `[turbopack]_runtime.js` `RUNTIME_ROOT`; re-applies `@netlify/plugin-nextjs` `content/server.js` `excludedSegs` filter + `edge-runtime/lib/cjs.ts` patch with **`try/catch` non-fatal + `if(!src.includes(...))` + string `anchor`**.

Required additions (no new file):
- **Prune artifact-bounding non-runtime weight** under `.next/standalone` (recursive): `@prisma/engines/**`, `node_modules/prisma/**`, `node_modules/@prisma/dev/**`, `node_modules/@prisma/studio-core/**`, `node_modules/@prisma/query-plan-executor/**`, `node_modules/@prisma/query-insights/**`, `node_modules/@typescript/**`, `node_modules/@electric-sql/**`, `**/*.js.map`, `**/*.d.ts`, `node_modules/sql.js/dist/*debug*`, `node_modules/sql.js/dist/sqljs-all.zip`, `**/.env*`, `**/sqlite-mirror.sqlite`, `**/logs/**`, `**/worker_logs/**`, nested `node_modules/<pkg>/node_modules/**`, **`*query_engine*`**, **`*query_compiler_*` for non-PostgreSQL targets** (keep `query_compiler*postgresql*`; never remove `@prisma/client` runtime needed by `@prisma/adapter-pg`), `.next/standalone` nested-copy duplication where safe. Keep `@prisma/client`, `@prisma/adapter-pg`, `@prisma/extension-accelerate`, `@prisma/instrumentation`, `pg`, `pg-protocol`, `pgpass`, `@opentelemetry/*`, `@netlify/blobs`, `sql.js` `sql-wasm.wasm`, runtime deps. 
- **Fail-loud patch application:** `prune-standalone` prints `patched:`; on prod make missing `anchor` / missing plugin path **non-silent** (warn; optionally fail) so a plugin version change can't silently disable size reduction. Keep `try/catch` only around fs, not around `anchor` matching. 
- Re-apply `excludedSegs` (+`.js.map`) additions; add the `@prisma/*`/`@typescript`/`@electric-sql`/`sql.js` exclusions. 
- The script cannot filter Netlify `external_node_modules`; size fix does NOT rely on it alone.

### B. `netlify.toml` `[functions]` (Modify)

- `node_bundler="esbuild"` (keep).
- `[functions]."*".external_node_modules`: **remove `prisma`, `@prisma/engines`.** Keep runtime-only: `@prisma/client`, `pg`, `pg-protocol`, `pgpass`, `@opentelemetry/*`, `googleapis`, `node-cron`, `bullmq`, `nodemailer`, `@prisma/adapter-pg`, `@prisma/extension-accelerate`, `@prisma/instrumentation`, `@netlify/blobs`, `sql.js`. (Verify Prisma-7 + Accelerate runtime needs in prod before final list; `@prisma/engines`/`prisma` are build-only.) 
- **Per-function scoping:** `[functions."worker-runner-background"] external_node_modules=[...]` minimal; **do NOT apply worker externals to `__csp-violations`/`worker-dispatch`.** `__csp-violations` needs no app `node_modules`.
- `[[plugins]] package="@netlify/plugin-nextjs"` **pinned `@netlify/plugin-nextjs@5.15.8`** (last-good) OR keep `5.16.9` only if `prune-standalone` `patched:` confirmed + size gate green on prod-parity; **remove prod UI duplicate `origin:ui`** (toml + package are enough); keep lock reproducible. 
- `publish=".next"`, `install-command="npm ci"`, `NPM_FLAGS`, `NODE_VERSION=22`, `SECRETS_SCAN_OMIT_PATHS`, `.nvmrc`. `.netlify` gitignored. `npx @prisma/prisma7@7` migrate (build-only; consider replace with `npx prisma@7.10.1 migrate deploy`; not required for size). 

### C. `next.config.ts` `outputFileTracingExcludes` `*` (+`/*`,`next-server`) & `serverExternalPackages` (Modify)

Add exclusions (keep existing): `**/node_modules/prisma/**`, `**/node_modules/@prisma/engines/**`, `**/node_modules/@prisma/dev/**`, `**/node_modules/@prisma/studio-core/**`, `**/node_modules/@prisma/query-plan-executor/**`, `**/node_modules/@prisma/query-insights/**`, `**/node_modules/@typescript/**`, `**/node_modules/@electric-sql/**`, `**/*.js.map`, `**/*.d.ts`, `**/node_modules/sql.js/dist/*debug*`, `**/node_modules/sql.js/dist/sqljs-all.zip`, `**/.env*`, `**/sqlite-mirror.sqlite`, `**/logs/**`, `**/worker_logs/**`, `**/node_modules/**/node_modules/**`, `**/node_modules/next/dist/compiled/**/*.js.map`, `**/query_compiler_*sqlserver*`, `**/query_compiler_*cockroachdb*`, `**/query_compiler_*mysql*`, `**/query_compiler_*sqlite*`. Replace ineffective Prisma-6 `**/node_modules/prisma/libquery_engine*` + `**/node_modules/.prisma/client/libquery_engine*` with Prisma-7 **`**/query_compiler*`** appropriately (keep PostgreSQL variant) + keep `@prisma/engines`. No duplicate `"*"`. `serverExternalPackages` keeps `@prisma/client`,`prisma`,`.prisma/client`,`@prisma/engines`,`@prisma/extension-accelerate`,`pg*`,`sql.js`,... (server bundling; size handled by above + `[functions]`).

### D. `scripts/dev-checks/check-function-size.mjs` + `.github/workflows/netlify-function-size.yml` (Modify lightly)

Keep `LIMIT_BYTES=250*1024*1024`, `.netlify/functions*` scan, `checked===0→fail`. **Add optional stricter `STRICT_LIMIT_BYTES` (e.g. 200 MB) warn/report** + **artifact-content assertions**: no `@prisma/engines`, `node_modules/prisma`, `@prisma/dev`, `@prisma/studio-core`, `@typescript`, `@electric-sql`, `*.js.map`, `*query_engine*`, `.env`, `sqlite-mirror.sqlite`, sql.js debug in any zip; `__csp-violations` has no app `node_modules`; print top-N largest entries. Keep ubuntu-latest + `npm ci` + `npx @netlify/build` + `CONTEXT=production`. No prod publish.

### E. `.gitignore` + hygiene (Modify)

Remove junk line `` `/scripts/spike-laya/weights/` removed... ``; keep `.netlify`,`logs/`,`worker_logs/`,`/sqlite-mirror.sqlite`,`.env*`,`graphify-out/`; **`git rm -r --cached graphify-out`** (currently tracked ~11 MB); `.env*` not shipped. Not strictly size-critical given exclusions, but reduces clone+tracing weight. No secrets.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `netlify.toml` | Modified | `[functions]` externals trim + per-fn scoping; `@netlify/plugin-nextjs` pin; remove `origin:ui` dup (recommend dashboard); keep esbuild/npm ci/`SECRETS_SCAN_OMIT_PATHS` |
| `next.config.ts` | Modified | `outputFileTracingExcludes` + `serverExternalPackages` broaden; Prisma-7 `query_compiler*`; no dup `*` |
| `scripts/predeploy/prune-standalone.mjs` | Modified | prune Prisma/`@typescript`/`@electric-sql`/sql.js/.map/`.d.ts`/.env/sqlite + `*query_engine*`/`*query_compiler_*` (keep PostgreSQL) + nested dup; fail-loud `patched:` |
| `scripts/dev-checks/check-function-size.mjs` | Modified | strict limit + artifact-content assertions + top-N |
| `.github/workflows/netlify-function-size.yml` | Modified | keep; run added assertions; no prod publish |
| `.gitignore` | Modified | remove junk line; `graphify-out/` + `.env*`; `.netlify` |
| `package.json` / `package-lock.json` | Modified | pin `@netlify/plugin-nextjs` exact `5.15.8` (or `5.16.9`); lock; `git rm --cached graphify-out` |
| (dashboard) Netlify UI | recommendation | remove UI `@netlify/plugin-nextjs`, use repo-pinned; confirm `npm ci`; keep `NPM_FLAGS`; don't set `PRISMA_CLIENT_ENGINE_TYPE=library`; `SECRETS_SCAN_OMIT_PATHS`; `WORKER_DISPATCH_SECRET` (Spec42, not size) |
| `.agents/sessions/<date>-<hash>/{decisions,flow}.md`, `Lessons.md`, `.agents/CHANGELOG.md`, `AGENTS.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`, session memory | docs (impl time) | repo mandatory; NOT done in analysis-only |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | Reduction only; `@netlify/plugin-nextjs` **pinned** `5.15.8` (or `5.16.9` if gate green) |

### Removed / not shipped at runtime
`prisma`, `@prisma/engines`, `@prisma/dev`, `@prisma/studio-core`, `@prisma/query-plan-executor`, `@prisma/query-insights`, `@typescript/*`, `@electric-sql/*`, sql.js debug, `*query_engine*`, non-PG `*query_compiler*`, `@netlify/plugin-nextjs` UI duplicate. Runtime `@prisma/client`+`@prisma/adapter-pg`+`@prisma/extension-accelerate`+`@prisma/instrumentation`+`pg*`+`@opentelemetry/*`+`@netlify/blobs`+`sql.js` retained.

### Internal Dependencies
`@/lib/prisma` (`@prisma/client`+`@prisma/adapter-pg`+`withAccelerate`), `@/lib/logger`, `@/lib/sqlite`, `@/lib/services/worker/*`, `@netlify/blobs`. No runtime change.

---

## 7. API Contract

N/A — no app route or serverless **request/response** contract change. `worker-runner-background` envelope/`WORKER_DISPATCH_SECRET`, `worker-dispatch`, `__csp-violations`, `___netlify-server-handler` unchanged.

---

## 8. UI/UX Requirements

N/A — no UI change. (Build/runtime parity only; app must still build `nodejs24.x`; no CSP change.) Standard repo UI gates N/A.

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components; Prisma server-only; `no_prisma_in_client_components`.
- [ ] No app code change; no runtime contract change; no schema/migration.
- [ ] `no_secrets_in_client`; `no_secrets_in_next_public_env`; **no `.env`/secret in function artifact**; `SECRETS_SCAN_OMIT_PATHS`; `.netlify` ignored; `DEPLOY_GUARD_TOKEN`/`WORKER_DISPATCH_SECRET` server-only.
- [ ] `npm ci` reproducible; lock unchanged semantics; pin plugin; no uncommitted `node_modules` patch reliance.
- [ ] `node_bundler="esbuild"`; per-fn `external_node_modules`; `outputFileTracingExcludes`; `serverExternalPackages`; `prune-standalone`; `instrumentation` `phase-production-build` no-op preserved.
- [ ] `@netlify` Netlify rule: `.netlify` not user code; no CORS; secrets in env; `.mts`; no versioned imports (`@netlify/functions`, not `@NETLY/functions@X`).
- [ ] Prisma-7 `query_compiler*` not Prisma-6 `libquery_engine*`; keep PostgreSQL compiler; no `PRISMA_CLIENT_ENGINE_TYPE=library`.
- [ ] `outputFileTracingExcludes` no duplicate `"*"`.
- [ ] `predeploy:preserve` soft-fail preserved; `prune-standalone` non-fatal on fs but **loud on patch-anchor**; `preserve-mirror` not part of size.
- [ ] size gate `check-function-size` `<250 MB`, fail on `checked===0`, no prod publish; PR gate ubuntu + `npm ci`.
- [ ] **no commit/push/deploy/merge** in this analysis; repo `/pre-commit-check` + human approval at implementation.

---

## 10. Expected Behavior

1. `npx @netlify/build` (fresh `npm ci`, prod-parity ubuntu, `CONTEXT=production`, no prod publish) completes **build + functions + edge**; `prune-standalone` prints `patched:` (or warns loudly).
2. `node scripts/dev-checks/check-function-size.mjs` → **`ok`, all fns < 250 MB** (target also < strict limit). Currently (local) `__csp-violations`=162.6→reduce; `worker-runner-background`=77.9→reduce; prod `__csp-violations`>250→reduce. `___netlify-server-handler`, `worker-dispatch` unaffected.
3. `__csp-violations.zip` has **no app `node_modules`** / no `@prisma/*` / `@typescript` / `@electric-sql` / `prisma`; `worker-runner-background.zip` no `@prisma/engines`, `node_modules/prisma`, `@prisma/dev`, `@prisma/studio-core`, `@prisma/query-plan-executor`, `@typescript`, sql.js debug, `.js.map`, `.env`, `sqlite-mirror.sqlite`, non-PG `query_compiler*`; no duplicated `.next/standalone` / `.next/server` + `node_modules` pairs where safe; only `query_compiler*postgresql*` + needed runtime; `@prisma/client`+`@prisma/adapter-pg`+`@prisma/extension-accelerate` intact.
4. Prod `@netlify/plugin-nextjs` version == repo pin; no `origin:ui` dup; `npm ci`; `nodejs24.x`.
5. PR size gate passes; prod deploy `state=ready`, `available_functions` sizes <250 MB, `worker-runner-background`+`__csp-violations` upload; `WORKER_DISPATCH_SECRET` presence is runtime not size. No regression to app runtime, CSP, `predeploy:preserve`, `prisma migrate deploy`, `prisma generate`, SQLite.
6. Local Windows `___netlify-edge-handler-node-middleware` Turbopack issue remains **separate**; not part of this fix; prod ubuntu. (Do not require local edge bundling to pass.)

---

## 11. Error Handling

| Scenario | Behavior | Level |
|----------|----------|-------|
| Function zip > 250 MB | `check-function-size` exits 1; PR gate fails; deploy blocked | error |
| `checked===0` no zips | exit 1 | error |
| `prune-standalone` fs rm fails | `try/catch` non-fatal `/*non-fatal*/` | warn |
| `prune-standalone` plugin patch `anchor`/path missing | **warn (or fail); NOT silent** | warn/error |
| `predeploy:preserve` fails | soft `exit 0`, deploy continues | warn |
| `prisma migrate deploy`/`generate` | unaffected; build fails only on real error | error |
| `@netlify/plugin-nextjs` version drift `origin:ui` | pin + `patched:` verify; PR gate catches size | warn/error |
| Runtime `@prisma/*` accidentally removed | verify prod; don't ship untested list | block release |
| Local Windows edge bundling | known separate; not 250 MB; not prod | warn |

---

## 12. Test Strategy

No app unit test added (no app code change). **Build-config verification + the PR gate IS the test.** Repo `@netlify/plugin-nextjs` `node_modules` patch isn't unit-tested today; `check-function-size` + prod-parity + `patched:` logs verify. 

### A. `scripts/dev-checks/check-function-size.mjs` (self-test script style, repo has no Jest for build scripts; not a `lib/__tests__` app test)
- [ ] passes when all zips < `LIMIT_BYTES`; fails when one `>250 MB`; `checked===0→1`.
- [ ] artifact-content assertions catch `@prisma/engines`,`node_modules/prisma`,`@prisma/dev`,`@prisma/studio-core`,`@typescript`,`@electric-sql`,`*.js.map`,`*query_engine*`,`.env`,`sqlite-mirror.sqlite`,sql.js debug; `__csp-violations` no app `node_modules`.
- [ ] strict limit warning when between strict & 250 MB.

### B. `scripts/predeploy/prune-standalone.mjs`
- [ ] removes `.next/cache(/turbopack)`, standalone `logs/worker_logs`, `.next/cache`, `*.js.map`, `*.d.ts`, Prisma engines, `@prisma/dev`/`@prisma/studio-core`/`@prisma/query-plan-executor`, `@typescript`, `@electric-sql`, sql.js debug, `sqljs-all.zip`, `.env`, `sqlite-mirror.sqlite`, `*query_engine*`, non-PG `*query_compiler*`, nested dup.
- [ ] patches `[turbopack]_runtime.js`; re-applies `excludedSegs` + `.js.map` + `cjs.ts`; **loud** if `anchor`/plugin missing; `patched:` printed; still exits 0 on fs error.

### C. Prod-parity reproduction (`test`-equivalent, no DB writes; no prod publish)
- [ ] fresh `npm ci`; `npx prisma generate`; `npx @netlify/build` (scratch/toml `command` `quickbuild && prune`, `[functions]`, `CONTEXT=production`, `NETLIFY_SKIP_GIT`); **`prisma migrate deploy` against a THROWAWAY DB in CI** (already in PR gate); no prod `origin:ui` dup.
- [ ] unzip inspection (Node `unzipper`/`Expand-Archive`) `__csp-violations.zip`, `worker-runner-background.zip`, `___netlify-server-handler.zip`, `worker-dispatch.zip`.
- [ ] `@netlify/plugin-nextjs` version + `origin`; `prune` `patched:`; `@netlify/plugin-nextjs` anchor match.

### D. PR gate `.github/workflows/netlify-function-size.yml`
- [ ] ubuntu-latest, Node 22, `npm ci`, `npx @netlify/build`, `CONTEXT=production`, `NETLIFY_SKIP_GIT`, `npx --yes @netlify/build`, `node scripts/dev-checks/check-function-size.mjs`. No `netlify deploy`.

### E. App regression (implementation time; not this analysis)
- [ ] `npm run test`, `npx tsc --noEmit` (0 new; baseline 46), `npm run lint`, `npm run quickbuild`; `npx prisma validate`/`generate`; no new test files needed for config; repo `/pre-commit-check`.

---

## 13. Performance Considerations

Goal = smaller artifacts. `outputFileTracingExcludes`+`excludedSegs`+`prune`+trim `external_node_modules`+per-fn scoping reduce upload + cold start; no runtime query change; `prisma migrate deploy`/`prisma generate` unchanged; `npm ci`; no caching regression; `@prisma/client`+`adapter-pg`+Accelerate runtime intact. Build time unaffected except slightly faster zip. No N+1/DB impact.

---

## 14. Security Considerations

- No secrets shipped: `.env*` excluded; `.env` currently in artifact → exclude; `SECRETS_SCAN_OMIT_PATHS`; `.netlify` ignored; `WORKER_DISPATCH_SECRET`,`DEPLOY_GUARD_TOKEN`,`ACCELERATE_URL`,DB/`AUTH_SECRET`,`TELEGRAM_SECRET`,Google OAuth server-only; no `NEXT_PUBLIC_*` secrets; Netlify secrets scan. No CORS added. No auth/RBAC change (`worker-runner-background` `WORKER_DISPATCH_SECRET` untouched; `predeploy:preserve` `DEPLOY_GUARD_TOKEN` untouched). No CSP change. Admin unaffected. `.agents`/`graphify-out` repo-internal not needed in function; never published. `PRISMA_CLIENT_ENGINE_TYPE` not set. `@prisma/engines`/`prisma` build-only not shipped. `sqlite-mirror.sqlite` not shipped.

---

## 15. Definition of Done

- [ ] Root cause documented (artifact evidence + prod PR#154→#167 diff + `@netlify/plugin-nextjs` `copyNextServerCode`/`copyNextDependencies` + `external_node_modules` semantics + Prisma-7 `query_compiler*` + `origin:ui` + `worker-runner-background`).
- [ ] `[functions]."*"` trimmed `external_node_modules` (no `prisma`/`@prisma/engines`); per-fn `worker-runner-background`; `__csp-violations` unburdened; `esbuild`; pinned plugin; `origin:ui` reconciled.
- [ ] `outputFileTracingExcludes`/`serverExternalPackages`/`excludedSegs`/`prune-standalone` broadened; Prisma-7 names; `.js.map`/`.d.ts`; `.env`; sqlite; `@typescript`; `@electric-sql`; non-PG query-compiler; nested dup; no dup `*`.
- [ ] `prune-standalone` still appended after `quickbuild`; non-fatal fs; **loud patch**; `patched:`.
- [ ] `check-function-size` `<250 MB` (+strict +content asserts); PR gate; no prod publish.
- [ ] prod-parity fresh `npm ci` reproduces; `npx @netlify/build` completes; all fns `<250 MB`; unzipped clean; `patched:`; `nodejs24.x`; `origin`.
- [ ] **prod `get-deploy` `state=ready`, `s<250MB`, upload OK** (human/dashboard; repo can't verify from sandbox) + `predeploy` soft + `prisma migrate deploy`/`generate` OK. Local Windows edge not a gate.
- [ ] no app code/schema/CSP/runtime contract change; runtime `@prisma/*`+`pg*`+`@opentelemetry/*`+`@netlify/blobs`+`sql.js` intact; no `PRISMA_CLIENT_ENGINE_TYPE=library`.
- [ ] `.gitignore` hygiene; `graphify-out` untracked; `.netlify`; `.env`; no secrets; junk removed.
- [ ] no commit/push/deploy/merge; `/pre-commit-check`; `npm run test`,`tsc`,`lint`,`quickbuild` (impl time); docs updated (impl time).

---

## Notes / Deviations
Analysis-only (user chose "Analysis + spec/plan only"). **No code changed.** `@netlify/plugin-nextjs` pin target `5.15.8` = last-good prod `a5daee9`, but repo PR#167 uses `5.16.9` + patch; **final pin deferred to prod-parity size-gate verification** (can't confirm prod `origin:ui` version from sandbox; Netlify `get-deploy` of good `a5daee9` showed `@netlify/plugin-nextjs@5.15.8`, failed `50d9522` not inspectable). Hypothesis chain = `external_node_modules` + plugin bump + `origin:ui` + `worker-runner-background` + Prisma7 + `@typescript` + un-excluded bulk; **primary verified mechanism = `@netlify/plugin-nextjs` ships too much per fn + `external_node_modules` re-adds; prod-only inflation not byte-measured.** Prisma 7.10.1 + `@prisma/adapter-pg` + `@prisma/extension-accelerate` + `withAccelerate()` + `ACCELERATE_URL` verified; **not** Prisma-6 `PRISMA_CLIENT_ENGINE_TYPE=library`. `@prisma/engines`/`prisma` build-only. `@prisma/adapter-pg` not currently in `external_node_modules`; keep as runtime.
