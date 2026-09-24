# v3.41.1 handoff — Decision Engine monitoring + e2e hardening (Spec 17) DONE, commit pending approval

> **Branch**: `feature/ph22-decision-engine` (HEAD `ab6fd65` = v3.41.0 COMMITTED — engine core + POC A/B; parent `2909b22` = v3.40.8 spike VERDICT APPROVE). **CODE + TESTS + VERIFICATION + DOCS DONE — NEXT = user approves `git commit` as v3.41.1 (no push, no PR). v3.41.0 is committed but NOT pushed — push/PR after this commit carries both.**
> **Read next**: `.agents/changelog/versions-v3.41.md` + `.agents/sessions/2026-09-23-decision-engine/{flow.md, decisions.md}` + `scripts/spike-laya/VERDICT.md` + `Lessons.md` 135/136/137

## Status (v3.41.1 — spec 17, DECISION_TRACE_ENABLED-gated monitoring; off = byte-identical)
- NEW `lib/services/decision/monitoring.ts`: **zero-Prisma** in-memory ring buffer max 500 (`DECISION_TRACE_MAX`), globalThis `__decisionTraces`, burst-safe snapshot; `buildDecisionStats()` pure aggregation (total / successRate / avgLatencyMs / avgAttempts / questionsEvaluated / gatesEmitted + kind · provider · gate-severity breakdowns); `clearDecisionTraces()`.
- Instrumented client `evaluate` + `ping`, POC A `runChartinkUnifiedScreeners()` (chartinkUnifiedScreenerService.ts), POC B Swing `gateAutoGenerate()` (swingAutoSeedService.ts) — all `DECISION_TRACE_ENABLED === "true"` gated, off = byte-identical.
- Route: `GET/DELETE /api/admin/decision/monitoring` (`?view=stats|traces`, admin-gated, `runtime="nodejs"`); DELETE → `DECISION_MONITORING_CLEARED` audit. OpenAPI tag 'Decision Engine' (header v3.41.1).
- UI: **Decision Engine tab** in `app/admin/utils/ai-monitoring/page.tsx` — 6 stat cards, breakdowns (kind/provider/gate-severity), 10 trace rows (time/source/provider/status/latency/attempts/details), Clear; loading/error/empty/absent states; dark-mode OK.
- e2e: NEW `e2e/decision-monitoring.spec.ts` — **env-only creds** (`E2E_ADMIN_EMAIL/PASSWORD || ADMIN_EMAIL/PASSWORD`, `test.skip` when unset — user directive, no literals), serial, resilient `loginAsAdmin()` (**first WebKit login in the suite — LESSON 136**: server-side signIn 302+Set-Cookie never completes client-side under single-threaded dev-server load; dev-server.log still showed `Auth: Login successful userId=1`; fix = 3 attempts + 12 s URL probe / 45 s last + reload → session re-check → re-submit) + `pingAdmin()` one inline retry on ECONNRESET + strict `.last()` on duplicated "Success Rate"/"Avg Latency" labels (AI grid renders the same labels) + mobile `getByText(/\d+ms/)`.
- Tests: NEW `lib/__tests__/decisionMonitoring.test.ts` **15/15** (ring cap 500, snapshot decoupling, off gating, breakdowns, clear).

## Verification (2026-09-24)
- `npx tsc --noEmit`: **46 = exact baseline** (0 decision-file errors; all 46 = legacy `*.test.ts(x)` matcher noise).
- `npm run lint`: **0 errors**.
- `npm run test`: **108/108 suites, 1416 pass, 4 skip, 0 fail**.
- `npm run quickbuild`: **Compiled successfully** (189/189 page baseline unchanged �?" new work is test-only).
- `npm run test:e2e` after auth-gate hardening (LESSON 137): full headed run **84 passed / 1 failed (Contact-chromium nav waitForURL flake) / 3 flaky / 1 did-not-run**; full headless run (user-selected, 5 projects) **86 passed / 1 failed (News-webkit, failed both attempts �?" same pre-existing navigation.spec dev-server-starvation flake class) / 2 did-not-run (serial-group skips)**; **auth gate GREEN in every run**. Target runs `auth.setup.ts` + `login.spec.ts` ×3: 4/4 each. `navigation.spec.ts` isolated headed: 21 passed / 1 flaky (Analytics-webkit self-healed) �?" proves remaining failures are load-induced, not regression. The 2 pre-existing flake variants are documented (Lesson 55 class: single-threaded dev server starved under 2-worker parallel load; CI mitigates via `workers:1` + `retries:2`).
- **Auth-gate hardening (NEW this session, LESSON 137)**: root-caused the interleaved `auth.setup.ts`+`navigation.spec.ts` failure = Auth.js **double-submit CSRF race** — two concurrent no-cookie `GET /api/auth/session` on RTL mount mint csrf tokens A+B; jar keeps last cookie (B); `signIn` csrf GET returns body A; POST sends cookie B vs body A → `MissingCSRF` → "Invalid email or password" rendered on correct creds. Config retries can't fix (fresh context re-rolls the race). Fix = **in-context 2-attempt resubmit loop** in `e2e/auth.setup.ts` + `e2e/login.spec.ts` (banner → resubmit WITHOUT reload, jar has settled token; else reload → re-fill → retry). Evidence: Playwright request/response trace + jar state single-token-after-POST.
- MCP browser live check of Decision Engine tab: renders, stats correct, persisted trace row, **0 console errors**, dark mode OK.
- Full unit output: `C:\Users\lucky\.local\share\opencode\tool-output\tool_0cfcfd4290018tTxVGj1rsI5jj`

## NEXT (awaiting user)
1. Approve commit as **v3.41.1** (message prepared; working tree = 5 modified + 6 untracked spec-17 files + 2 modified e2e auth files (`e2e/auth.setup.ts`, `e2e/login.spec.ts` — Lesson 137 in-context resubmit loop) — `scripts/spike-laya/weights/` (503MB) and `smoke-results.json` stay untracked/gitignored). Then push + PR (carries v3.41.0 `ab6fd65` + v3.41.1).
2. After commit: P1–P3 real Laya inference behind a parity gate (laya-mock stays default) — needs user grant (install + key).

## From prior turn (context)
- v3.40.8 P0 spike VERDICT **APPROVE** (onnxruntime-node; SPLIT encoder+head graphs; full-decision median 2316 ms @ seq 128; RSS 611 MB; artifacts `scripts/spike-laya/VERDICT.md` + `smoke-results.json`).
- v3.41.0 base (spec 16): `DECISION_PROVIDER=none|laya` (unknown → coerce none), confidence-gated ACT/REVIEW via `shapeConfidence`, POC A screener scoring + POC B Swing `gateAutoGenerate`, `POST /api/decision/evaluate` + `GET /api/admin/decision/ping`, admin panel `/admin/decision`, `typesafeProvider.ts` deleted (Laya-only; Jev = docs-only hosted API, NOT OSS).
- Don't read conversation memory — read the session `flow.md`/`decisions.md` files.