---
name: netlify-deploy-debug
description: Use when a Netlify deploy fails or behaves oddly — build exit 2, "function exceeds the maximum size of 250 MB", uploadDeployFunction 400, secret scanning failure, pending/untrusted deploy, wrong context or commit built, plugin/version drift, missing env var, or when asked to read/analyze a Netlify deploy log. Covers deploy contexts (production/branch-deploy/deploy-preview), branch vs commit_ref checks, file-based vs UI plugins, and safe preview triggers.
---

# Netlify Deploy Debug

## Core principle

**Read the deploy log and the deploy metadata before proposing a fix.** A Netlify deploy has stages; each stage has a distinct failure signature. The same HTTP 400 can come from a build script, a plugin, or the upload step, and the fix differs. Never guess from the error line alone.

Authoritative references:
- Deploy overview / contexts / log: https://docs.netlify.com/deploy/deploy-overview/
- Build plugins (UI vs file-based, precedence, version): https://docs.netlify.com/extend/install-and-use/build-plugins/
- `netlify.toml` JSON schema: https://open-api.netlify.com/netlify.schema.json
- Environment variables with frameworks (build vs runtime scope): https://docs.netlify.com/build/frameworks/use-environment-variables-with-frameworks/

## Stage map (find the failing stage first)

| Stage in log | Typical failure | Read |
|---|---|---|
| Initializing / clone / install | missing source ref, dependency install, `postinstall` | log lines from "Preparing Git Reference", `npm ci` output |
| `build.command` | exit code 2, migration, prisma generate, framework build, script crash | the **last command before the error** in the command |
| Build plugin hooks (`onPreBuild`/`onBuild`/`onPostBuild`) | plugin version drift, patch not applied, config parse | "Using Next.js Runtime - vX", "Loading plugins", "patched:" |
| Functions bundling | missing files, oversized bundle, native deps | packaging list + zipped sizes |
| Edge Functions bundling | path/runtime errors (Windows-only local issues exist) | error stack |
| Secrets scanning | hardcoded secrets in build output | `SECRETS_SCAN_OMIT_PATHS` |
| `Deploy site` | `uploadDeployFunction` 400, 250 MB cap, file count | `Failed to upload file: <name>` |
| Post processing | forms/headers/redirects | `Post processing - …` |

`Site is live ✨` + `state=ready` = success; `state=error` with `Build script returned non-zero exit code: 2` = build or upload failure, not necessarily the same cause.

## Metadata first (every time)

Call `tools.netlify["netlify-deploy-services-reader"]({ selectSchema: { operation: "get-deploy", params: { deployId } } })` (or `get-deploy-for-site` with `siteId`) and read:
- `state`, `error_message`
- **`branch`, `context`, `commit_ref`** — confirm the deploy actually built the branch/commit you think (a preview trigger can silently build `main` + `production`)
- `available_functions` → function names, sizes (`s`), generators (`g`), runtime
- `summary.messages` → how many functions/files were deployed

CLI equivalents:
```bash
npx netlify status                       # auth + linked site/project id
npx netlify logs:deploy                  # stream logs of CURRENTLY building deploys (relink first if "must link a project")
npx netlify watch                        # wait for the current deploy to finish
npx netlify api getSiteBuild --data '{ "site_id": "...", "build_id": "..." }'
```
Deploy log permalinks from the UI are shareable: `.../deploys/<ID>#L<start>-L<end>`.

## Triggering a preview safely

- **`npx netlify deploy --trigger` triggers the site's configured branch in `production` context.** It does *not* build your local branch. Use it only if you intend a production rebuild.
- To build **a specific branch** remotely: use `npx netlify api createSiteBuild --data '{ "site_id": "...", "branch": "<branch>" }'` (or a Netlify MCP deploy tool that accepts a branch), then watch the returned `deploy_id`.
- `npx netlify deploy` builds **locally** then uploads a draft; it is not prod-parity (no remote `npm ci`, no UI plugins, local env).
- **Never** use `--prod` unless the user explicitly asks for production. No merge/push-to-main without explicit request.
- Mistaken build: `npx netlify api cancelSiteDeploy --data '{ "deploy_id": "..." }'` (HTTP 200; verify `state=error`, `error_message="Canceled build"`). A canceled build may already have run the build command — check DB side effects.

## Failure playbook

| Symptom | Check | Fix direction |
|---|---|---|
| `The function exceeds the maximum size of 250 MB` / `uploadDeployFunction 400` | which function from `Failed to upload file:`; local `npx @netlify/build` + `node scripts/dev-checks/check-function-size.mjs`; unzip artifact and group by `node_modules/<pkg>` / `.next/…` | `external_node_modules` **copies** packages into the artifact (does not shrink); `ignored_node_modules` leaves packages out; `included_files` supports `!` exclusions — **`excluded_files` is not in the schema**; prune `.next` before plugin hooks; remove the function if it is inert |
| Build exit 2 with no upload error | read the last command; check migrations/generate/build; `CONTEXT` (production-only steps e.g. `predeploy:preserve` self-skip on branch-deploy) | fix the failing command; use a throwaway preview DB if `prisma migrate deploy` might write to prod |
| Plugin version/behavior differs from repo | log "Using … Runtime - vX", `plugins[].origin`; docs: file-based config takes precedence over UI, but removing one does not remove the other | pin exact devDependency + `[[plugins]] package=... pinned_version="<major>"`; disable the UI copy if needed |
| Env var missing in function/runtime but present in `netlify.toml` | docs: `netlify.toml` env is **build-only**; runtime needs UI/CLI/API vars with **Functions** scope | set variable in Netlify UI/API with Builds+Functions scopes; never commit secrets |
| `Pending review` / untrusted deploy | deploy permissions / untrusted policy in docs | ask a team owner to approve; don't bypass |
| Edge bundling fails locally only | Windows Turbopack `[turbopack]_runtime.js` path issue; prod is Linux | treat as separate from 250 MB; verify via remote preview |
| Config may be invalid | add `"$schema" = "https://open-api.netlify.com/netlify.schema.json"` at top of `netlify.toml`; validate keys against the schema | schema ignores `$schema` at build; directory existence etc. still only checked during build |

## Evidence template (paste into handoff/PR)

```
Deploy: <id>  branch=<...>  context=<...>  commit_ref=<...>  state=<...>
Failing stage: <...>   Error: <verbatim line + log #L...>
Functions: <name>=<MB> (<generator>), …
Root cause: <what actually changed / why this stage fails>
Fix: <files/commands changed>
Verification: local build+size gate → <result>; remote preview → <deploy id/state/sizes>; prod → <state>
Not verified: <prod artifacts, DB side effects, env values, etc.>
```

## Red flags / safety

- Never log secret values (`WORKER_DISPATCH_SECRET`, `DEPLOY_GUARD_TOKEN`, DB URLs). MCP `getSiteEnvVars` can return values — print only key/scope/context.
- No production deploy, DB migration, schema change, or merge without explicit user request.
- A preview rebuild can execute `prisma migrate deploy` against whatever `DATABASE_URL` the context resolves — confirm a throwaway DB before triggering.
- Do not claim "fixed" from a local build alone: local Windows artifacts can be ~1/3 of Linux size. Verify with a remote preview of the correct branch (`branch-deploy`/`deploy-preview`, not `main`/`production`).
