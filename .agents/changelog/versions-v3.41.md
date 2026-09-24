# v3.41.2 — Recommendations plan-limit fallbacks (Spec 01: History/Performance/Ideas) + HistoryTab error state

> **Branch**: `feature/ph22-decision-engine` (on `a269057` = v3.41.1 committed; parent `ab6fd65` = v3.41.0 committed; grandparent `2909b22` = v3.40.8 spike)
> **Spec**: `.agents/specs/01-recommendations-plan-limit-fallbacks.md` · **Plan**: `.agents/plans/01-recommendations-plan-limit-fallbacks.md`
> **Status**: CODE + TESTS + VERIFICATION DONE — tsc **46 exact baseline (0 new)** · lint 0 · **109/109 suites (1440 pass / 4 skip / 0 fail)** · quickbuild **189/189** ✓ · e2e **`recommendations.spec.ts` 10/10** (live dev server, user-approved) · **commit as v3.41.2 pending user approval (no push/PR)**

## Why

Under the Prisma P6003 plan-limit hold (2026-09-24 → ~2026-10-02) the prod `/recommendations` page's History / Performance / Ideas tabs returned HTTP 500 `{error: ...}` on every load: the read paths (`$queryRaw` top-stocks, `recommendationPerformanceService`, `syncedDataService`) were Prisma-only, and the breaker rejected the queries immediately. The SQLite mirror held the SAME fresh rows (the write path WAS mirroring via `syncedDataService`) — but nothing READ them, so real product data was invisible until the hold lifted. The History tab's client then turned the 500 into a **masked 500-as-empty-state** (failed fetch → silently render "no recommendations yet" — no error, no retry). Spec 01 adds breaker-aware hot-read fallbacks to the mirror + an explicit HistoryTab error state.

## What changed

- **`lib/sqlite.ts`** — NEW `getRecommendationRuns(opts)` mirror query: camelCase row mapping (`id`, `generatedAt` Date, `source`, `status`, `uniqueStocks`), newest-first, `unique_stocks > 0`, status filter, limit clamped 1..2000 (default 200). Zero Prisma.
- **`app/api/recommendations/top-stocks/route.ts`** — fallback `topStocksFromSqlite()`: `getSqliteFallback()` → `getRecommendationRuns()` → `getRecommendationStocks()` → serializer (same result shape + `source: "sqlite_mirror_degraded"`), 1 h cache via `getWithCache` with fresh key; Prisma `$queryRaw` branch kept (run-status filter). Mirror-exhausted/not-ready → rethrow ORIGINAL 500.
- **`lib/services/recommendationPerformanceService.ts`** — NEW `listItemFromMirrorTracker()` + `getPerformanceListFromSqlite()` (JS-side status filter mirroring SQL semantics — the mock mirror's tracker getter returns rows independent of SQL args, Lesson 138), timerange-aware; Prisma branch wrapped so only `isDbUnavailableError` (message/code-based P6003 match) falls to the mirror; non-hold errors propagate.
- **`lib/services/syncedDataService.ts`** — steps 2 + 3 rewritten breaker/hold-aware: `mirrorWriteThrough` (write mirror EXCEPT when breaker open/plan-limit hold — mirror-only path) + `mirrorReadMarketCache` (breaker open/hold → mirror read with DateTime-safe cache key; rethrows original when mirror not ready). Prisma happy path byte-identical.
- **HistoryTab (`app/components/recommendations/HistoryTab.tsx`)** — Phase 5: NEW `error` state (reset per fetch, set on `data.success === false` OR fetch throw to `"Failed to load recommendations history"`); error card (title + message + Retry) rendered BEFORE the empty-state list even if stale rows exist (same pattern as PerformanceTab).
- **No migration, no packages, no env, no OpenAPI change** (no new routes).

## Tests

- NEW `lib/__tests__/recommendationsPlanLimitFallbacks.test.ts` — **21/21** (6 History route + 7 Performance service + 8 syncedDataService). Mocks `@/lib/logger`, `@/lib/prisma`, `@/lib/sqlite`, `@/lib/cache`, `@/lib/audit`; real `@/lib/db-utils` with test hooks `openPlanLimitBreaker`/`closePlanLimitBreaker`/`resetPlanLimitBreaker` (default CLOSED — prod safety: no breaker = pure Prisma path).
- `lib/__tests__/sqliteMirror.test.ts` — 11/11 (golden sql.js WASM), now exercises the syncedDataService path.
- Verification catch: `npx tsc --noEmit` → 0 new prod errors vs the 46-exact baseline (all 46 pre-existing `*.test.ts(x)` matcher noise — some in the new suite file too, verified pre-existing semantics); `npm run lint` 0 errors (1153 warnings pre-existing); full jest **109/109 suites · 1440 pass / 4 skip / 0 fail**; `npm run quickbuild` **189/189** pages ✓; live dev-server API sanity (top-stocks 200, performance 200 with LODHA, ideas 200) + e2e `e2e/recommendations.spec.ts` **10/10** (Chromium, user-approved).

## HistoryTab error-state shape (approved)

`loadingHistory ? spinner : error ? <ErrorCard .../> : stocks.length === 0 ? <EmptyState/> : <List/>` — the error card renders BEFORE the empty-state check so a 500 (masked as empty before this fix) now surfaces with a Retry that re-invokes `fetchStocks`.

---

# v3.41.1 — Decision Engine monitoring + e2e hardening (Spec 17)

> **Branch**: `feature/ph22-decision-engine` (on `ab6fd65` = v3.41.0 committed; parent `2909b22` = v3.40.8 spike)
> **Spec**: `.agents/specs/17-decision-engine-monitoring.md` · **Plan**: `.agents/plans/17-decision-engine-monitoring.md`
> **Status**: CODE + TESTS + VERIFICATION + DOCS DONE — tsc 46 exact baseline · lint 0 · 108/108 suites (1416 pass / 4 skip / 0 fail) · quickbuild ✓ · full e2e headless **86 passed / 1 failed (pre-existing nav flake News-webkit) / 2 did-not-run (serial skips)** — auth gate green in every run · **COMMITTED `a269057` (no push/PR)**

## Why

v3.41.0 shipped the decision-engine core; there was NO observability — nothing recorded what `evaluate()` did, at what latency, with what confidence, or which gates it emitted. Spec 17 adds an in-memory, zero-Prisma performance trace ring + stats aggregation + an admin monitoring surface, plus the first e2e spec that logs in on WebKit (root-cause + resilient-login lesson 136) and env-only credentials per the user's no-credential-literals directive.

## Monitoring core (`lib/services/decision/monitoring.ts`)

- `traceDecisionEvent()` — in-memory ring buffer (max 500, `DECISION_TRACE_MAX`), zero-Prisma (never a write op), snapshot-safe (trace object copied at write time), burst-safe (time-bounded/no-throw), captured on globalThis `__decisionTraces`.
- `buildDecisionStats()` — pure aggregation over the ring: `total`, `successRate`, `avgLatencyMs`, `avgAttempts`, `questionsEvaluated`, `gatesEmitted`, breakdowns by kind / provider / gate severity.
- `clearDecisionTraces()` — ring reset (admin Clear).
- `recordDecisionTrace` instrumentation in `client.ts` (evaluate + ping) + POC A `runChartinkUnifiedScreeners()` + POC B `gateAutoGenerate()` (gated by `DECISION_TRACE_ENABLED` env off-by-default; off = byte-identical).

## Route + admin UI

- `GET /api/admin/decision/monitoring` (admin-only, `runtime="nodejs"`): `?view=stats|traces` → `{success, stats?, traces?}`; `DELETE` → clear ring + `DECISION_MONITORING_CLEARED` audit. OpenAPI via `app/api/openapi/route.ts` (tag `Decision Engine`).
- `app/admin/utils/ai-monitoring/page.tsx` — NEW "Decision Engine" tab: stats cards (Total Traces, Success Rate, Avg Latency, Avg Attempts, Questions Eval., Gates Emitted), breakdowns (kind/provider/gate), trace rows (status/kind/timestamp/provider/latency), Clear action — with loading/error/empty/absent states.

## e2e hardening (`e2e/decision-monitoring.spec.ts`)

- **No credential literals** (user directive): `E2E_ADMIN_EMAIL || ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD || ADMIN_PASSWORD`, empty when unset → `test.skip(...)`. **First spec in the suite to log in on WebKit** (auth.setup + login.spec are chromium-only).
- Root cause (Lesson 136): server-side credentials sign-in SUCCEEDS (`Auth: Login successful userId=1` in dev-server.log) but the 302 + Set-Cookie response never completes in the browser under single-threaded dev-server load → page stuck on `/auth/signin` with no banner. Fix: resilient `loginAsAdmin(page)` helper — 3 attempts, 12 s URL probe (45 s last), reload→session-check→re-submit; `pingAdmin(page)` with one inline retry; strict-mode `.last()` on duplicated "Success Rate"/"Avg Latency" labels (AI grid renders the same labels).

## Auth-gate hardening (LESSON 137 — NEW this session)

- **Root cause (proven via Playwright trace + jar state)**: Auth.js double-submit CSRF race — RTL page load fires TWO concurrent no-cookie `GET /api/auth/session` (SessionProvider + `useSession`); under single-threaded dev-server load each mints its own csrf cookie (trace token A `6bc47ccd…` @31.749, token B `c9a217c3…` @31.761); the jar keeps the LAST-arriving Set-Cookie (B); `signIn()`'s csrf GET (jar=B) returns body token A; the credentials POST sends cookie B vs body A → `csrfTokenVerified=false` → `MissingCSRF` → signin page renders "Invalid email or password" on CORRECT credentials. Config `retries:1` cannot fix it — every config retry opens a fresh clean context that re-rolls the same race.
- **Fix**: in-context 2-attempt resubmit loop in `e2e/auth.setup.ts` + `e2e/login.spec.ts` (demo-login test): click Sign In → `toHaveURL` probe (12 s attempt 1 / 45 s attempt 2) → on catch: attempt 2 throw; banner "Invalid email or password" visible → continue WITHOUT reload (jar already holds one settled token, second csrf GET carries it → success); no banner (stalled-response Lesson-136 variant) → reload → re-fill → retry. Applied to ALL browsers via auth.setup (login.spec demo test is the user-facing path).
- **Verification**: targeted `auth.setup.ts` + `login.spec.ts` ×3 → 4/4 each; full headed run (95 tests) → auth gate green (84 passed / 1 failed Contact-chromium nav flake / 3 flaky / 1 did-not-run); full headless run (user-selected, 89 tests) → **86 passed / 1 failed (News-webkit, both attempts — pre-existing navigation.spec waitForURL dev-server-starvation flake, Lesson 55 class) / 2 did-not-run (serial skips)**; `navigation.spec.ts` isolated headed → 21 passed / 1 flaky (Analytics-webkit self-healed) proving remaining failures are load-induced, not regression.

## Tests & verification

- 15 unit tests (`lib/__tests__/decisionMonitoring.test.ts`): ring bounds, stats aggregation, clear, instrumentation wiring, env gating (off = no traces).
- **`tsc --noEmit` 46 = exact baseline** · lint **0** · **108/108 suites / 1416 pass / 4 skip / 0 fail** · quickbuild **189/189**.
- e2e: full suite **94 passed / 1 flaky (pre-existing navigation.spec dev-server-starvation flake, passes on retry) / 0 failed / 0 did not run** — all 6 new tests green on Chromium/Firefox/WebKit; standalone chromium 3/3 (24 s), webkit targeted 3/3 (1.1 m), headed chromium 3/3 (37.8 s). Post-Lesson-137 re-verification (headless, user-selected): **86 passed / 1 failed (News-webkit, pre-existing nav flake class) / 2 did-not-run (serial skips)** — auth gate green in every run.
- MCP browser live check (admin, `/admin/utils/ai-monitoring`): Decision Engine tab renders, stats correct, persisted trace row, **0 console errors**, dark mode OK. Full output: `C:\Users\lucky\.local\share\opencode\tool-output\`.

## Follow-ups

- Commit as v3.41.1 pending user approval (no push/PR). After commit: P1–P3 real Laya inference behind a parity gate (laya-mock stays default) — user approval + key.
- Notes: no Prisma migration (P6003 hold), no new packages, `SECRETS_SCAN_OMIT_PATHS` already covers `e2e/` (netlify.toml) but the spec carries no literals by design.

---

# v3.41.0 — Decision Engine Core + POC A/B (Spec 16, Laya-only)

> **Branch**: `feature/ph22-decision-engine` (on `2909b22` = v3.40.8 spike VERDICT APPROVE; parent `5453d91` = v3.40.7)
> **Spec**: `.agents/specs/16-decision-engine.md` · **Plan**: `.agents/plans/16-decision-engine.md`
> **Session**: `.agents/sessions/2026-09-23-decision-engine/`
> **Status**: **COMMITTED `ab6fd65`** (no push/PR) — tsc 46 exact baseline · lint 0 · 107/107 suites (1401 pass / 4 skip / 0 fail) · quickbuild 188/188 · superseded by v3.41.1 above

User-approved option (D1): **"Build engine core + POC A/B"** — no SDK install, no real provider, no live smoke (P6003 plan-limit hold).

## Why

v3.40.5 researched Laya (System One) + Jev as a decision-engine layer; v3.40.8 P0 spike (onnxruntime-node, ~503MB int8 weights, chained encoder→head smoke median 2316 ms, RSS 611 MB) returned **VERDICT APPROVE** — SPLIT graphs, engine P1–P6 next. v3.41.0 implements the engine core **Laya-only**: a confidence-gated evaluate/score/noul client + two POC integrations (screener scoring + swing auto-seed gate). `typesafeProvider.ts` **deleted** in the Laya-only pivot (no `@typesafe-ai/sdk`; Jev stays a docs-only reference — hosted API, not OSS).

## Engine core (`lib/services/decision/`)

- `types.ts` — `SHAPE_CONFIDENCE` constant; `Linearity`/`StructuralBalance`/`ScoreCriterion` unions; `DecisionProviderName = "none" | "laya"`; `EngineProvider` interface (`evaluate<T>` → `Decision<T> | null`); `LayaEvaluateRequest`; `DecisionResponse<T>` (`{ success, result, provider, elapsedMs }`).
- `config.ts` + `provider.ts` — provider resolution: `none` = inert, `laya` = LayaLlmProvider; `DECISION_PROVIDER` unknown value → warn + coerce `none` (D8). No `TYPESAFE_*` env; `next.config.ts` `serverExternalPackages` **NOT modified**.
- `gate.ts` — `DecisionGateSeverity` (`informational|moderate|destructive`), static `GATE_THRESHOLDS` (informational act 0.55 / review 0.35; moderate 0.75 / 0.5; destructive 0.9 / 0.7), `classifyAction()` → `ACT | REVIEW` only (never BLOCK/deny), `decisionGateText()`.
- `fusion.ts` — `weightedMean()` + `DecisionFusion` per-option weighted-mean `isPure` checks.
- `layaProvider.ts` — mock contract: choice → option-0 argmax + peaked probs + `shapeConfidence(p) = 1 − H(p)/log₂(k)`; score → expected-value weighted mean; noul → `p[1] = 0.85`, **no confidence**; never emits `targetPrice`/`stopLoss`.
- `client.ts` — evaluate retry ≤ 3 (250/500/1000 ms backoff), inert `evaluate()` → `null` on provider throw; seams `_createDecisionClientWithProviders` / `_resetDecisionClient` / `_setDecisionClient`.

## POC A + POC B

- **POC A** (`lib/services/chartinkUnifiedScreenerService.ts`): `runChartinkUnifiedScreeners()` gated on `DECISION_POC_ENABLED === "true"`, try/catch → non-fatal warn; engine off = byte-identical output; on: optional `decisionScore?` (fusion weighted-mean, `SCREENER_POC_RUBRIC` momentum 0.6 / signalSupport 0.4) + `decisionGate?` (worst-severity).
- **POC B** (`lib/services/swingAutoSeedService.ts`): `gateAutoGenerate()` — off → `"engine-off"` allow; on → allow only if noul ≥ `AUTO_SEED_NOUL_MIN` (0.75) **AND** choice `AUTOSEED_REGIME` (`"trending"`); else `"review"`; provider throw/inert → graceful allow + audit. Constants `AUTOSEED_NOUL`, `AUTOSEED_REGIME`.

## Routes + admin UI

- `POST /api/decision/evaluate` (nodejs, admin auth): zod `discriminatedUnion("type")` — `choice` (options 2–8), `score` (criteria 1–12), `noul` (instruction ≤ 500, statePath ≤ 128); questions 1–10; state JSON ≤ 16 384 B; 400 invalid JSON, 503 on provider throw, `"inert"` on null, 200 + `DECISION_EVALUATED` audit.
- `GET /api/admin/decision/ping` (admin-only): `{ success, ping: { mode, providers, detail }, flags: { DECISION_PROVIDER, DECISION_POC_ENABLED } }`.
- `app/admin/decision/page.tsx` + nav entry in `app/admin/layout.tsx` — mode + flags + live `evaluate` try-out (protected).
- OpenAPI: both routes after `/api/fo/expiries`, tag `['Decision Engine']`, header **"v3.41.0, spec 16"**.

## Audit tags (`lib/audit.ts`)

`DECISION_EVALUATED` + `DECISION_GATE` only (no `DECISION_PROVIDER_FALLBACK` — Laya-only has no failover). `createAuditLog` uses `metadata` (not `meta`), optional `userId`.

## Env (`.env.example`)

`DECISION_PROVIDER=none` (comment: `"laya" (mock)`) + `DECISION_POC_ENABLED=false`; **no `TYPESAFE_*` placeholders**.

## Harness fix — Lesson 135

`check-tsc-baseline.test.ts` failed at the harness boundary: `scripts/dev-checks/check-tsc-baseline.mjs` `buildGateTsconfig()` :47 does an unguarded `readFileSync(resolve(ROOT, "tsconfig.json"))` and `makeHarness()` copies the script into a temp dir WITHOUT the root `tsconfig.json` → ENOENT (the 46-baseline gate itself still passed). Fix: `makeHarness()` writes a stub `tsconfig.json` (`{ "include": ["**/*.ts"], "exclude": [] }`) → suite 9/9. → `Lessons.md` **135**.

## Tests & verification

- 13 route tests (evaluate 9 : ping 4) + `decisionGate`/`decisionFusion`/`decisionClient` suites + `layaProvider.test.ts` + NEW `swingAutoSeedService.test.ts`; `check-tsc-baseline.test.ts` updated (harness fix).
- **`tsc --noEmit` 46 = exact baseline** (0 decision-file errors) · lint **0** · **107/107 suites / 1401 pass / 4 skip / 0 fail** · quickbuild **188/188** (incl. `/admin/decision` + both routes; single pre-existing `themeColor` warning). Full output: `C:\Users\lucky\.local\share\opencode\tool-output\tool_0cfcfd4290018tTxVGj1rsI5jj`.

## Follow-ups

- P1–P3: real Laya inference behind a parity gate (laya-mock stays default) — user approval + key.
- Jev = docs-only reference (hosted API; NOT OSS) — no integration planned.
- Notes: no Prisma migration (P6003 hold), no new packages, no `next.config.ts` change.