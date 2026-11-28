# Flow — 2026-11-29 Netlify 250MB / prod 500

## Symptom
- Prod `50d9522`: upload 400, `worker-runner-background` + `__csp-violations` >250MB.
- Prod `main@35783f6` (`6b0b34812ff171557c73c613`, `ready`, 2 fns 42.6/45.8MB): homepage 500.

## Root-cause trace
`netlify.toml build.command` → `npm run quickbuild` → `scripts/predeploy/prune-standalone.mjs` → rewrote `const RUNTIME_ROOT` in every `[turbopack]_runtime.js` → Linux SSR resolves `server/chunks/ssr/...` under `/var/task/.next/server` → duplicated `server/` → `ChunkLoadError` → 500 (function logs).

## Code changed
| File | Change | Why |
|------|--------|-----|
| `netlify.toml` | removed `[functions]`, prune from command; `$schema`; `[[plugins]] pinned_version=5` | size + config correctness |
| `package.json`/lock | `@netlify/plugin-nextjs` exact `5.15.8` | last-good prod plugin |
| `netlify/functions/*`, `lib/services/worker/netlify-runner.ts`, test | deleted | worker on Node.js side |
| `instrumentation.ts` | watchdogs on all runtimes | restore cron/worker |
| `scripts/predeploy/prune-standalone.mjs` | deleted | caused prod 500 |
| `.agents/skills/netlify-deploy-debug/SKILL.md` + matrix/AGENTS | added | deploy-log triage |
| docs (AGENTS/CHANGELOG/versions-v3.60/Primer/agent-memory/Lessons/TODO/session-todos/handoff) | updated | repo rule |

## Verification matrix
- `npx tsc --noEmit`: clean.
- Pre-commit gates: passed on commits.
- Local `npx @netlify/build` + `check-function-size.mjs`: pending final run after prune removal.
- Netlify branch preview: baseline ready; after removals `__csp-violations` fixed; worker removed; final HTTP check pending.
- Prod: user-owned merge/deploy; verify HTTP 200 + function logs.

## Execution order
1. branch from `a5daee9` → preview baseline.
2. remove externals → preview; remove worker chain → prod deploy ready/500.
3. remove prune → local build → preview HTTP → docs → commit/push → PR.
