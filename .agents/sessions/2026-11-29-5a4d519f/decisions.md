# Decisions — 2026-11-29 Netlify 250MB / prod 500

## D1. Bisect from last-good commit
**Decision:** branch off `a5daee9` (last good prod) and preview each config change via Netlify API `createSiteBuild` (branch), not `netlify deploy --trigger`.

- *Context:* prod `50d9522` failed at upload; `netlify deploy --trigger` mistakenly built `main`+`production` — canceled via `cancelSiteDeploy`.
- *Impact:* verified baseline 2 functions (33.88/41.78MB); isolated externals as one cause; worker-runner remained >250MB.

## D2. Remove worker chain, keep work on Node.js side
**Decision:** delete `worker-runner-background.mts`, `worker-dispatch.mjs`, `netlify-runner.ts` + test, drop `WORKER_DISPATCH_SECRET`; re-enable `instrumentation.ts` watchdogs on Netlify.

- *Context:* user instruction (worker/task/cron on Node.js side); function was inert without the secret (503).

## D3. Remove `external_node_modules` and `prune-standalone.mjs`
**Decision:** remove both from `netlify.toml`; delete prune script.

- *Context:* `external_node_modules` copies packages (does not shrink); `excluded_files` invalid per Netlify schema; prune's `[turbopack]_runtime.js` patch broke Linux SSR (`/var/task/.next/server/server/chunks/ssr/...` → 500) despite `ready` upload.
- *Impact:* no build-time patching of generated framework files; no oversized functions.

## D4. Pin plugin + add `$schema` + skill
**Decision:** `@netlify/plugin-nextjs@5.15.8` exact devDependency + `[[plugins]] pinned_version="5"` (file-based config overrides UI); `$schema` key in `netlify.toml`; new `netlify-deploy-debug` skill.

- *Context:* Netlify docs: UI plugins run all contexts; file-based wins; schema validates config keys.

## Transparency
- No prod deploy/merge by agent. Mistaken `main`+`production` build was canceled; possible DB side effects unverified. User reported prod 500; fix pending user deploy.
