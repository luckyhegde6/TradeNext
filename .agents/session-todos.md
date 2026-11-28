## Current (2026-11-27 — Netlify deploy fix: pin npm ci + PR size gate + make everything COMMITTED — prod re-test)

### Session tasks (user instruction 2026-11-27)
- [x] **Pin `install-command = "npm ci"`** in `netlify.toml` `[build]`. (Local `npx netlify build` resolved config doesn't print it; prod uses its own build; verify on Netlify dashboard.)
- [x] **Committed-not-untracked:** `scripts/predeploy/prune-standalone.mjs` re-applies `@netlify/plugin-nextjs` `server.js` filter + `cjs.ts` + `[turbopack]_runtime.js` at build time; `next.config.ts` `outputFileTracingExcludes` keeps `logs/`, `worker_logs/`, `cache/`, `*.js.map`, Prisma engines, test/sample/docs/mocks out of `.next/standalone`; prune `rm`s `.next/cache`, `.next/standalone/logs`, `.next/standalone/worker_logs`, `.next/standalone/.next/cache`, `*.js.map`. (Fixed a duplicated `"*"` key TS1117.)
- [x] `npx netlify build` PR gate: `.github/workflows/netlify-function-size.yml` + `scripts/dev-checks/check-function-size.mjs`.
- [x] **Verify prod-parity on fresh `npm ci`.** Local fresh `npm ci` + `npx netlify build` + `check-function-size.mjs` → **all 4 functions < 250MB** (worker-runner-background 49.21MB, __csp-violations 162.59MB, ___netlify-server-handler 48.06MB, worker-dispatch 0.05MB). NOTE: my prod-parity run hit a *local Windows edge* `[turbopack]_runtime.js` issue in my `prune` patch interfering with edge bundling — but **Functions bundling completed**; prod runs on ubuntu-latest. Known separate issue.
- [x] **Commit + push.** `436d17b` → `436d17b`… `7a01282` on `main`.
- [ ] **Netlify production deploy success NOT VERIFIABLE from sandbox.** Last ready prod deploy `6aef7712780133b526dae9fc` (commit `a5daee93`, ready, no `worker-runner-background`); my `deploy-site` trigger → 403; `get-project` doesn't show a new build. **Check Netlify dashboard** that `7a01282` built `worker-runner-background`+`__csp-violations` < 250MB. Historically prod pushed-logs showed 250MB fails even when local `npx netlify build` passed — **if prod still fails, keep debugging**.
- [ ] **Lesson + learnings + how to proceed in future:** `Lessons.md` + docs.

## Current (2026-11-26 — Netlify deploy fix complete — functions < 250MB)

Functions now fit the Netlify upload limit locally: `worker-runner-background.zip` 65.24MB, `__csp-violations.zip` 162.59MB, `___netlify-server-handler.zip` 48.06MB (measured with `node C:\Users\lucky\AppData\Local\Temp\opencode\measure2.cjs .netlify/functions`).

### Netlify deploy fix (v3.59.0) — local `npx netlify build` run 3: COMPLETE
- [x] `netlify.toml` `[functions] external_node_modules` += prisma/pg/googleapis/@opentelemetry/*/node-cron/bullmq/nodemailer/… (no `onnxruntime-node`/`@huggingface/tokenizers` — Laya/decision-engine removed)
- [x] Plugin 5.16.9 local patches (Windows edge-runtime path fix + logs exclusion in `dist/build/content/server.js`)
- [x] NEW `scripts/predeploy/prune-standalone.mjs` (appended to build command): deletes `.next/cache/turbopack` (~260MB), `.next/standalone/worker_logs`, all `*.js.map` — 2022 paths
- [x] `scripts/cleanup-logs.mjs` — logs/ → 39.2MB remaining (15d/50MB cap); `scripts/cleanup-logs.mjs` + run (772.6MB removed)
- [ ] **User action:** redeploy (`npx netlify deploy --prod` / Netlify dashboard). Known remaining: edge function `___netlify-edge-handler-node-middleware` Windows path bug (blocked, needs edge-runtime debug).

---

## Current (2026-11-28 — Netlify 250MB function-size fix on `fix/netlify-250mb`)

- Branch `fix/netlify-250mb`. Added `outputFileTracingExcludes` + `serverExternalPackages`, `scripts/predeploy/prune-standalone.mjs`, `install-command="npm ci"`+`NPM_FLAGS`, `.github/workflows/netlify-function-size.yml` + `scripts/dev-checks/check-function-size.mjs`, `clsx`. All 4 functions <250MB locally. **No onnxruntime-node/@huggingface/tokenizers/Laya/decision-engine.** Prod not verified.


### [x] Remove the Laya + decision engine (2026-11-24)
- [x] Deleted: `lib/services/laya/**` (mock ONNX agent/tokenizer/weights), `lib/services/decision/**`, `app/api/decision/evaluate`, `app/api/admin/decision/{ping,monitoring}`, `app/admin/decision/`, decision tests, `scripts/dev-checks/{laya-agent,laya-forward}.ts`, `scripts/spike-laya/`, `scripts/fetch-laya-weights.mjs`, code docs.
- [x] Removed decision UI: admin nav "Decision Engine" + `/admin/decision` page, AI Monitoring "Decision Engine" tab, Google Sheets `decisions` tab (rows/tabs/exporter/syncService/status route) + decision rows/exports/sinks.
- [x] Removed decision env knobs, `onnxruntime-node` + `@huggingface/tokenizers` deps, `.gitignore` Laya rules. Docs (`docs/laya.md`, `docs/designDoc/ph22-*.md`) kept per user.
- [x] Verification: `npm run test -- googleSheets` → 10 suites / 269 passed; stale `.next` deleted; `npx tsc --noEmit` — the only prior error (stale status-route import) is fixed.

### [x] New decision engine build — `lib/services/decision/` (IB + PM + expert swing trader, 1st-system math-first, no PoC) — unit tests 1 suite / 8 passed
### Plan — Redesign the decision engine (Pure implementation — 1st-system design, mathematical prediction models — IB + PM + expert swing trader — technical + fundamental analysis — data from NSE APIs; not a PoC) — [x] engine built (types/technical/fundamental/portfolio/engine/index) + tests green; wiring to daily recs/swing/stock analysis = follow-up.
- [ ] **Perspectives (independent, first-principles):**
  - **IB:** fundamentals — company profile + financials + corporate actions via NSE data (`nseFetch`/existing services) → debt-equity, ROE/ROIC, margins, P/E, sector comparables → view.
  - **PM:** risk math from OHLCV (volatility/ATV, max drawdown, Sharpe) + position sizing — reuse `lib/services/rebalancerService` + portfolio risk metrics.
  - **Swing trader:** technical indicators (MA/EMA/RSI/MACD/ATR/Bollinger) from daily OHLCV + swing levels, entry/target/SL from ATR.
- [ ] **Pure engine:** `lib/services/decision/` recreated — `analyzeStock(symbol): DecisionConclusion` (verdict BUY/HOLD/SELL, rationale, confidence) — deterministic math; no mocks/PoC.
- [ ] **Wire:** daily recommendations + swing + stock-analysis flows call the engine.
- [ ] **Tests:** pure unit tests (indicators, fusion, verdict thresholds).
- [ ] **Docs/branch:** new branch, session-todos/rules/AGENTS.md/CHANGELOG updates.

## Current (2026-11-21 — Netlify deploy fix — branch: fix/netlify-worker-runner-function-size, based on latest main)

Branch: `fix/netlify-worker-runner-function-size` (created 2026-11-21 from latest `origin/main` @ `899fee6`).

### Netlify Deploy Fix — `worker-runner-background` function artifact exceeded Netlify's function upload limit
- [x] **Root cause:** built `worker-runner-background` (Spec 42 durable worker runner — `netlify/functions/worker-runner-background.mts`) bundles the worker engine + Prisma client + logger (via `lib/services/worker/netlify-runner` → `worker-engine`/`worker-service`/`@/lib/prisma`); with the default bundler the artifact exceeded Netlify's function upload limit (~50 MB; same error documented in the Netlify Support Forums — "could not parse form file: http: request body too large"). Production is still on the pre-Spec-43 build.
- [x] **Fix (commit on this branch):** `netlify.toml` — `[functions] node_bundler = "esbuild"` — the documented Netlify Functions → Bundle fix ("esbuild is the documented bundler for shrinking function artifacts"). Fallbacks if esbuild is insufficient: `external_node_modules = ["prisma", "@prisma/client"]` (exclude the heavy client), or lazy-import the worker engine in the function entry.
- [ ] **Verify (user action):** redeploy — Netlify dashboard or `npx netlify deploy --prod` — deploy log should show `worker-runner-background` uploading successfully — then prod serves the new build (Swing shows the "Prediction targets" banner + target cards; daily shows predictions on AI-down runs). (Separate finding: the AI 429 — openrouter/free auto-router routed to google/gemma-4-26b-a4b-it:free, rate-limited upstream — not part of this fix.)

## Spec 43/44 Session (2026-11-15 — branch: feature/spec-43-and-44-execution)

Branch: `feature/spec-43-and-44-execution` (created 2026-11-21 from `main` @ `899fee6`; tree clean on `main` before branch).

### Spec 43 — Prediction targets & `analysisMode` (no "AI targets off") — EXECUTED & MERGED (PR #156)
- Spec: `.agents/specs/43-prediction-targets-analysis-mode.md` · Plan: `.agents/plans/43-prediction-targets-analysis-mode.md` · Session: `.agents/sessions/2026-11-15-prediction-targets/{decisions,flow}.md`
- [x] Phases 1–6 complete and committed as `1cb4d36` (schema/migration `20261115160000_add_analysis_mode_prediction_targets`, SQLite mirror/push sinks, daily/swing prediction + per-stock mode propagation, perf bounded/idempotent backfill hooks, APIs/UI/Telegram/exports/Sheets consumers, targeted tests/gates as recorded in changelog/handoff).
- [x] **Merged:** PR #156 (`6343f53`) on `main` @ `899fee6`; `analysisMode` present in `prisma/schema.prisma` (lines 1432, 1495, 1576) — execution complete; nothing to re-execute.

### Spec 44 — Prisma ORM 7.10.1 → 8.0.0-rc.34 Upgrade & Optimization — PLANNING DONE, EXECUTION PENDING APPROVAL
- Spec: `.agents/specs/44-prisma-8-upgrade.md` · Plan: `.agents/plans/44-prisma-8-upgrade.md` · Docs: `.agents/docs/prisma-8-upgrade.md` · Session: `.agents/sessions/2026-11-21-prisma8-upgrade/{decisions,flow}.md` · `ARCHITECTURE.md` (ORM/tooling + upgrade-readiness notes)
- [x] Spec + plan + architecture/docs completed (planning merged on main).
- [ ] **Precondition — human approval (per Spec 44 doc):** Spec 44 + Plan 44 approved; target release policy decided at implementation time (pin `8.0.0-rc.34` vs latest stable — revalidate release notes); strategy decided after feasibility spike (Option A all-at-once vs Option B route-by-route); non-production rehearsal env confirmed; unrelated schema changes frozen during cutover.
- [ ] **Phase 0 — Feasibility Spike & Baseline:** capture baseline inventory (`@/lib/prisma` importers, direct `@prisma/client` importers, `$transaction/$queryRaw/$executeRaw/$extends/cacheStrategy` usage, Prisma mocks/tests, scripts); baseline gates (`npx tsc --noEmit`, `npm run lint`, `npm run quickbuild` as environment permits); Prisma 8 coexistence spike (Option-B feasibility: command collisions, generated paths, TS resolution, Netlify/build compatibility). → verify: baseline results + documented feasibility/blockers.
- [ ] **Phases 1–6 (per Plan 44):** toolchain/contract scaffold · runtime/client parity (`lib/prisma.ts`/`lib/otel.ts`/`lib/db-utils.ts` + ops counting/write budget/plan-limit breaker/per-query timeout/error classification/OTel/query logging/cache parity) · call-site migration (shared libs → API routes/server → scripts/tests) · workflow/build/Netlify (`package.json` scripts, `netlify.toml`, CI, docs) · optimization & cleanup (approved optimizations, retire Prisma 7 artifacts) · stabilization (full verification matrix, release notes, session memory). → verify per plan gates: `contract emit`/`db sign`/`db migrate` dry-runs, `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run quickbuild`, preview deploy smoke.
- [ ] **Constraints:** no production behavior changes; no migrations executed until approval; no deploys without explicit request; rollback per Plan 44 §Rollback (pre-merge: git revert on branch; post-deploy: redeploy prior build; DB rollback via approved runbook only).

### TODO Enhancements Review (2026-11-21)
- Reviewed `TODO_ENHANCEMENTS.md` (Priority 1–5 legacy analytics/portfolio enhancements): **no items map to Specs 43/44** — Spec 43 is merged (prediction targets/analysisMode); Spec 44 is the Prisma 8 upgrade. Spec 38 (RefSite theme refresh) + Spec 39 (Advanced Analytics) are separate in-progress features in `TODO.md` ("In progress"). Pre-existing unchecked items (P4 alerts email/SMS, P5 F-Score→screener filter) are unrelated legacy TODOs — not added/changed here.

### Tracks 1–4 — Outbound notification tracking/persistence/UI + synchronous deploy-prep/workers (COMMITTED ON MAIN)
- [x] **Track 1:** per-recipient/chatId outbound-notification tracking in structured logs + DB hooks across outbound channels (Telegram broadcasts/direct alerts/bot replies, daily/swing notices incl. all-HOLD, email/webhook/in-app alert deliveries, admin/announcement sends) via `lib/services/outboundNotificationService.ts` and integrations in `telegramBotService.ts`, `dailyRecommendationService.ts`, `swingRecommendationService.ts`, `app/api/admin/telegram/broadcast/route.ts`, `app/api/user/telegram/test/route.ts`, `lib/services/notificationService.ts`, `lib/alerts/delivery/index.ts`, `app/api/admin/announcements/route.ts`.
- [x] **Track 2:** unified notification persistence — `OutboundNotification` (`@@map("outbound_notifications")`) in `prisma/schema.prisma` + migration `prisma/migrations/20261115170000_add_outbound_notifications/migration.sql`; SQLite-first mirror/outbox/read-write helpers + push sink (`lib/sqlite.ts`, `lib/sqlitePushSinks.ts`, `outbound_notification`), id-keyed upsert, best-effort Prisma fallback.
- [x] **Track 3:** `/admin/utils/notifications` history/manage UI + `GET/PATCH /api/admin/notifications` (filters/detail/retry/cancel/audit), utils sidebar `Notifications`, `/admin/alerts` and `/admin/utils/announcements` unified send-history/cross-links, announcement create/activate stores send records.
- [x] **Track 4:** synchronous in-request “Prepare for Deploy” in `app/api/admin/db-health/route.ts` creating/updating real `worker_tasks` record with checks (`probePrismaNow`, breaker/latency, SQLite ready/flush, mirror/outbox/sync state) and persisted result; `/admin/utils/workers` task visibility aligned.
- [x] **Local DB/schema:** `docker compose up -d db` (`tradenext-db-1` healthy on `:5432`) + `npx prisma db push` synced (incl. `outbound_notifications`).
- [x] **Verification:** `npx tsc --noEmit` → 47 pre-existing test-file errors only; `npm run lint` exit 0 (warnings); `npx jest lib/__tests__/dbHealthRoute.test.ts --runInBand` **21/21 pass** (test updated for sync deploy-prep contract, uncommitted); `npm run quickbuild` **202/202** (incl. `/admin/utils/notifications`); `node scripts/dev-checks/check-doc-sizes.mjs` **OK (95.9 KB / 100.0 KB)**.
- [x] **Visual validation (Playwright, admin `admin@tradenext6.app` / `admin123`, dev on `:3000`, stopped after):** `.playwright-cli/snapshots/track2-notifications.png`, `track2-notifications-loaded.png`, `track3-admin-alerts.png`, `track3-admin-announcements.png`, `track4-workers.png`, `track4-db-health.png` — notifications/alerts/announcements/workers/db-health pages render with expected Tracks 1–4 UI states; workers show tasks (50 total, not 0); no console errors observed on captured pages.
- [x] **Committed:** Tracks 1–4 changes are on `main` — `OutboundNotification` model (`prisma/schema.prisma:1312`, `@@map("outbound_notifications")`) + migration `prisma/migrations/20261115170000_add_outbound_notifications/migration.sql` (commit `e3be4ed`); Tracks 1–4 admin UI/artifacts verified on main. No push/merge/deploy without explicit request.

### Tooling / diagrams (2026-11-15)
- [x] **Archify (project-only, opencode):** discovered/installed via skills CLI to `.agents/skills/archify` (203 files), `node .agents/skills/archify/bin/archify.mjs doctor` → ready. Candidates: `.archify/architecture-tracks-1-4-20261116/candidate.json`, `.archify/dataflow-tracks-1-4-20261116/candidate.json`, `.archify/workflow-tracks-1-4-20261116/candidate.json`. Finalized validated HTML artifacts (browser-check pass): `.archify/architecture-tracks-1-4-20261116/tracks-1-4-architecture.html`, `.archify/dataflow-tracks-1-4-20261116/tracks-1-4-dataflow.html`, `.archify/workflow-tracks-1-4-20261116/tracks-1-4-workflow.html` (evidence/receipts alongside). Candidates adjusted for uncommitted files (sources stripped, repo pin removed) and layout/routing simplified for validation.
- [x] **Graphify (option C):** `python -m pip install --user graphifyy` (`graphifyy-0.9.110`) + `graphify install` completed. `graphify extract . --code-only` + `graphify cluster-only .` produced `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md` (+ `.graphify_analysis.json`, `.graphify_build.json`, `.graphify_labels.json`, cache/manifest). Note: 278 communities with placeholder labels (no LLM backend configured).

### Prod worker/tasks investigation (tradenext6.netlify.app/admin/utils/workers, 2026-11-15 snapshot)
- [x] Collected snapshot: **35 pending / 0 running / 0 completed / 0 failed** tasks (oldest 2026-11-09, newest deploy_prep 2026-11-15 06:08:51 pm), all `startedAt`/`completedAt` empty, retries `0/3`; 1 idle worker (`169.254.45.199-9`, completed 0, failed 0, heartbeat 6:06:39 pm); leaders `sqlite-sync`/`worker`/`cron-daemon` all holding same instance; Accelerate reachable (360ms). System/crons show last runs up to 2026-11-13 and next runs future; recent sync history shows frequent `↓ to SQLite` boots today + one `↑ to Prisma` admin sync.
- [x] Code/config analysis completed (see session response): likely contributors — SQLite-fresh mirror discovery can hide Prisma-pending rows until stale fallback, degraded/breaker/runner/runtime path can prevent Prisma task claims, and durable runner/dispatch preconditions (Spec 42) must be satisfied on prod.
- [ ] Implement remediation/fix path and validate (code and/or prod config/deploy actions as required).

### Carried forward
- [ ] **S2 (blocked):** retry minimal Prisma-Remote prod read-only diagnostics (ops-limited) once approval/tool access is available.
- [ ] **User controls merge/deploy**; Spec 42 standalone worker functions + `WORKER_DISPATCH_SECRET` removed (250MB function-size fix); in-process cron/worker daemon re-enabled. No merge/deploy without explicit user request.

### Tooling / diagrams (user-requested)
- [ ] **Archify:** install for the user by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt and following its confirmed install steps (respect install-scope/agent confirmation and package-install permission). Use Archify to draw diagrams based on the codebase. Repo: https://github.com/tt-a1i/archify/tree/main
- [ ] **Graphify:** install CLI + register skill (`uv tool install graphifyy` or `pipx install graphifyy`, then `graphify install`) and run `/graphify .` to generate `graphify-out/{graph.html,GRAPH_REPORT.md,graph.json}` for the codebase (requires package/tool-install permission). Repo: https://github.com/Graphify-Labs/graphify
