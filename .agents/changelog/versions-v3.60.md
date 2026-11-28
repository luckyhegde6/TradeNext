# v3.60.0 — 2026-11-29 — Netlify 250MB fix + production 500 recovery

## Request
User: fix Netlify deploy failing at upload (`worker-runner-background`, `__csp-violations` >250MB), bisect from last-good `a5daee9`, preview via Netlify MCP/CLI; then remove the worker/secret (all worker/task/cron on the Node.js side); then recover the resulting production 500; add a deploy-log debug skill; document, add lessons, commit/push, create/update PR.

## Root causes (verified)
1. `[functions]."*".external_node_modules` **copies** heavy packages into every function; it does not shrink artifacts. Removing it fixed `__csp-violations`, but `worker-runner-background` stayed >250MB on Linux (esbuild bundle + full `node_modules` + duplicated `.next`). `excluded_files` is not a valid Netlify config key (ignored); `ignored_node_modules`/`included_files` with `!` are the real levers.
2. `worker-runner-background` was inert in prod (`WORKER_DISPATCH_SECRET` unset → 503). Removed the whole Spec 42 Scheduled/Background chain + secret; re-enabled in-process cron/worker watchdogs on Netlify in `instrumentation.ts`.
3. The published prod deploy `6b0b34812ff171557c73c613` (`main@35783f6`) was `ready` but homepage 500: `ChunkLoadError ... /var/task/.next/server/server/chunks/ssr/[root-of-the-server]__*.js` — duplicated `server/`. Cause: `scripts/predeploy/prune-standalone.mjs` rewrote `RUNTIME_ROOT` in **all** `[turbopack]_runtime.js` copies, including the Linux SSR runtime. Removed the whole script from the build command (the oversized function was gone, so pruning was no longer needed).

## Files changed
- `netlify.toml`: removed `[functions]`/`external_node_modules`/`prune-standalone` from `command`; added `$schema`, file-based `[[plugins]] package="@netlify/plugin-nextjs" pinned_version="5"`; kept `install-command=npm ci`, `NODE_VERSION`, `NPM_FLAGS`, `SECRETS_SCAN_OMIT_PATHS`; `package.json`/lock pinned `@netlify/plugin-nextjs@5.15.8` (last-good prod version).
- Deleted `netlify/functions/worker-runner-background.mts`, `netlify/functions/worker-dispatch.mjs`, `lib/services/worker/netlify-runner.ts`, `lib/__tests__/netlify-runner.test.ts`, `scripts/predeploy/prune-standalone.mjs`.
- `instrumentation.ts`: leader watchdogs (worker/cron/sqlite-sync) now start on every runtime including Netlify; no `isNetlifyRuntime()` skip.
- `next.config.ts`: comment only (generic function-bundle wording).
- New skill `.agents/skills/netlify-deploy-debug/SKILL.md` (+ matrix/AGENTS wiring).
- Docs: AGENTS version row, Lessons 174, Primer, agent-memory, TODO, session-todos, handoff, session memory.

## Verification evidence
- Netlify preview `6b0b1ad4...` baseline `a5daee9`: 2 functions (`___netlify-server-handler` 33.88MB, `__csp-violations` 41.78MB), plugin 5.15.8, `ready`.
- Preview with removals: `__csp-violations` fixed; worker-runner still >250MB → led to its removal.
- Prod `6b0b34812ff171557c73c613` (`main@35783f6`): `ready`, plugin 5.15.8, 2 functions 42.6MB/45.8MB, `Site is live ✨`; then 500 with the SSR chunk error above (function-log evidence).
- Local `npx @netlify/build` repros + `check-function-size.mjs`; fresh local rebuild after removing prune completed the build but hit a local-only plugin 5.15.8 manifest-patch error (Windows); **remote preview is authoritative**.
- **Final branch preview `6b0b3a212ad0e2374d3d76ca`** (`commit 5ba17cf`, `branch-deploy`): `ready`, 2 functions 42.6/45.8 MB, homepage **HTTP 200** rendered. PR **#168** opened against `main`.
- `npx tsc --noEmit` clean; pre-commit gates (Jest/tsc-baseline/forbidden patterns/swagger/logger) passed on commits.

## Decision / deviation
- No Prisma schema/migration, no DB writes; no prod deploy/merge by agent. Prod recovery requires the user to merge/deploy the fix (or restore a good deploy) — agent did not change prod after the 500 was reported.
- `netlify deploy --trigger` mistake: it triggered `main`+`production` (`6b0b1976...`), immediately canceled via `cancelSiteDeploy` (`state=error`, "Canceled build"); possible prod-DB side effects unverified.
- Netlify UI build settings (`npm run build`, publish `.next`, functions `netlify/functions`) are overridden by `netlify.toml` — no change needed.
